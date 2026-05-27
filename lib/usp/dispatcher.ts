import * as logger from "../logger.ts";
import * as db from "../db/db.ts";
import { decodeRecord, decodeMsg, DecodedMsg } from "./parser.ts";
import { ingest as ingestNotify } from "./notify.ts";
import {
  persistGetResp,
  persistGetInstancesResp,
  persistGetSupportedDMResp,
} from "./persist.ts";
import type { MtpKind } from "./types.ts";
import { parseSubject } from "../mtp/subjects.ts";

// Pending request inbox: msgId -> resolver. Populated by rpc.ts before publishing,
// consumed by dispatcher when a *_RESP arrives.
const pending = new Map<
  string,
  { resolve: (msg: DecodedMsg) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
>();

export function registerPending(
  msgId: string,
  resolve: (msg: DecodedMsg) => void,
  reject: (err: Error) => void,
  timeoutMs: number,
): void {
  const timer = setTimeout(() => {
    pending.delete(msgId);
    reject(new Error(`USP RPC timeout: ${msgId}`));
  }, timeoutMs);
  pending.set(msgId, { resolve, reject, timer });
}

// Bump _lastInform + _usp.<mtp>.{connected,lastSeen} on every received record
// so the UI's "Last Inform" reflects real activity rather than just first Boot.
// No-op if the device isn't in the collection yet (it'll be created downstream
// by ingestNotify on first Connect/Notify).
async function touchActivity(endpointId: string, mtp: MtpKind): Promise<void> {
  const now = new Date();
  await db.collections.devices.updateOne(
    { "_usp.endpointId": endpointId } as never,
    {
      $set: {
        _lastInform: now,
        [`_usp.${mtp}.connected`]: true,
        [`_usp.${mtp}.lastSeen`]: now,
      },
    } as never,
  );
}

export async function handleIncomingRecord(
  subject: string,
  recordBytes: Uint8Array,
): Promise<void> {
  const parsed = parseSubject(subject);
  if (!parsed || parsed.kind !== "from-mtp" || !parsed.mtp || !parsed.endpointId) {
    logger.warn({ message: "Unknown from-mtp subject", subject });
    return;
  }
  const mtp = parsed.mtp;
  const endpointId = parsed.endpointId;

  let record;
  try {
    record = decodeRecord(recordBytes);
  } catch (err) {
    logger.error({ message: "Failed to decode USP Record", subject, exception: err as Error });
    return;
  }

  if (record.from_id !== endpointId) {
    logger.warn({
      message: "Record from_id does not match subject endpointId",
      from_id: record.from_id,
      endpointId,
    });
  }

  if (!record.record_type) {
    logger.warn({ message: "Empty USP Record (no record_type)", endpointId });
    return;
  }

  // MTP Connect Records (mqtt_connect, websocket_connect, stomp_connect, etc.)
  // carry the agent's Endpoint ID in `from_id` but no inner USP Msg. Per
  // TR-369 §8.2.2 they're how the agent announces presence after CONNACK.
  // Register the device on receipt so it shows up even before the agent
  // sends a Boot Notify (some CPEs don't ship default Boot subscriptions).
  if (
    record.record_type.case === "mqtt_connect" ||
    record.record_type.case === "websocket_connect" ||
    record.record_type.case === "stomp_connect" ||
    record.record_type.case === "uds_connect"
  ) {
    logger.info({
      message: "USP Connect Record received",
      endpointId,
      mtp,
      recordType: record.record_type.case,
    });
    try {
      await ingestNotify({
        endpointId,
        mtp,
        subType: "Connect",
      });
    } catch (err) {
      logger.error({
        message: "Failed to ingest USP Connect Record",
        endpointId,
        exception: err as Error,
      });
    }
    return;
  }

  if (record.record_type.case !== "no_session_context") {
    // SAR reassembly / session context not implemented in PR1 MVP
    logger.info({
      message: "USP Record skipped (not no_session_context)",
      endpointId,
      recordType: record.record_type.case,
    });
    return;
  }

  // Record bytes look valid USP → bump activity timestamp regardless of
  // whether the inner Msg is a Notify, response, or async error.
  await touchActivity(endpointId, mtp).catch((err) => {
    logger.error({
      message: "Failed to touch device activity",
      endpointId,
      exception: err as Error,
    });
  });

  let msg: DecodedMsg;
  try {
    msg = decodeMsg(record.record_type.payload);
  } catch (err) {
    logger.error({ message: "Failed to decode USP Msg", endpointId, exception: err as Error });
    return;
  }

  await dispatchMsg(endpointId, mtp, msg);
}

async function dispatchMsg(
  endpointId: string,
  mtp: MtpKind,
  msg: DecodedMsg,
): Promise<void> {
  logger.info({
    message: "USP Msg received",
    endpointId,
    mtp,
    msgId: msg.msg_id,
    msgType: msg.msg_type,
  });

  // Response correlation + persistence
  if (msg.msg_type.endsWith("_RESP") || msg.msg_type === "ERROR") {
    // Persist response data into the device document so the UI's data-model
    // tree reflects the new values. We do this BEFORE resolving the pending
    // Promise so the caller can rely on Mongo being up to date.
    try {
      const resp = (msg.body.response as Record<string, unknown> | undefined) ?? {};
      if (msg.msg_type === "GET_RESP" && resp.get_resp) {
        await persistGetResp(
          endpointId,
          resp.get_resp as Parameters<typeof persistGetResp>[1],
        );
      } else if (msg.msg_type === "GET_INSTANCES_RESP" && resp.get_instances_resp) {
        await persistGetInstancesResp(
          endpointId,
          resp.get_instances_resp as Parameters<typeof persistGetInstancesResp>[1],
        );
      } else if (
        msg.msg_type === "GET_SUPPORTED_DM_RESP" &&
        resp.get_supported_dm_resp
      ) {
        await persistGetSupportedDMResp(
          endpointId,
          resp.get_supported_dm_resp as Parameters<
            typeof persistGetSupportedDMResp
          >[1],
        );
      }
    } catch (err) {
      logger.error({
        message: "Failed to persist USP response",
        endpointId,
        msgType: msg.msg_type,
        exception: err as Error,
      });
    }
    const handler = pending.get(msg.msg_id);
    if (handler) {
      clearTimeout(handler.timer);
      pending.delete(msg.msg_id);
      handler.resolve(msg);
    }
    return;
  }

  // Notify routing
  if (msg.msg_type === "NOTIFY") {
    const notifyReq = (msg.body.request as { notify?: Record<string, unknown> })?.notify;
    let subType = "Unknown";
    if (notifyReq) {
      // Find the oneof discriminator (boot, value_change, periodic, etc.)
      const knownSubTypes = [
        "Boot",
        "ValueChange",
        "OnBoardRequest",
        "Periodic",
        "OperationComplete",
        "Event",
      ];
      for (const k of knownSubTypes) {
        const key = k.replace(/([A-Z])/g, "_$1").toLowerCase().slice(1);
        if (notifyReq[key]) {
          subType = k;
          break;
        }
      }
    }
    try {
      await ingestNotify({ endpointId, mtp, subType, raw: notifyReq });
    } catch (err) {
      logger.error({
        message: "Failed to ingest USP Notify",
        endpointId,
        exception: err as Error,
      });
    }
    return;
  }

  // Other request types from agent are uncommon in MVP (Register/Deregister come later).
  logger.info({
    message: "USP Msg ignored in PR1 MVP",
    endpointId,
    msgType: msg.msg_type,
  });
}
