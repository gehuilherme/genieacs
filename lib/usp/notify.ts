import * as db from "../db/db.ts";
import * as logger from "../logger.ts";
import { parseEndpointId, endpointIdToDocId, cwmpReconciliationFilter } from "./endpoint.ts";
import {
  ensureDefaults as ensureDefaultSubscriptions,
  ensureSchemaLoaded,
} from "./subscriptions.ts";
import type { MtpKind } from "./types.ts";
import type { Device } from "../db/types.ts";

export interface NotifyParams {
  endpointId: string;
  mtp: MtpKind;
  subscriptionId?: string;
  send_resp?: boolean;
  subType?: string; // "Boot" | "ValueChange" | "OnBoardRequest" | "Periodic" | "OperationComplete" | "Event"
  raw?: Record<string, unknown>;
}

export async function ingest(params: NotifyParams): Promise<void> {
  const now = new Date();
  const parts = parseEndpointId(params.endpointId);
  const reconciliation = cwmpReconciliationFilter(parts);

  const uspState = {
    endpointId: params.endpointId,
    endpointParts: parts,
    supportedMtps: [params.mtp],
    preferredMtp: params.mtp,
    [params.mtp]: { connected: true, lastSeen: now },
    lastNotify: {
      type: params.subType ?? "Unknown",
      ts: now,
    },
  };

  // Populate _deviceId so the existing UI (which filters by DeviceID.ID and
  // displays DeviceID.SerialNumber / OUI / ProductClass / Manufacturer)
  // can resolve and list the USP device. flattenDevice() maps these into
  // DeviceID.* paths consistently for CWMP and USP devices alike.
  const deviceIdFields = {
    _Manufacturer: parts.vendor ?? parts.scheme ?? "",
    _OUI: parts.oui ?? "",
    _ProductClass: "",
    _SerialNumber: parts.serial,
  };

  // Seed a minimal TR-181 Device.* subtree so the default device-page.jsx
  // (which checks `Device:object`) renders the TR-181 view. Actual parameter
  // values are populated later by Get/GetSupportedDM tasks via the dispatcher.
  const tms = now;
  const deviceTree = {
    _object: true,
    _timestamp: tms,
    _writable: false,
    DeviceInfo: {
      _object: true,
      _timestamp: tms,
      _writable: false,
      Manufacturer: {
        _value: parts.vendor ?? "",
        _type: "xsd:string",
        _timestamp: tms,
        _writable: false,
      },
      SerialNumber: {
        _value: parts.serial,
        _type: "xsd:string",
        _timestamp: tms,
        _writable: false,
      },
    },
    LocalAgent: {
      _object: true,
      _timestamp: tms,
      _writable: false,
      EndpointID: {
        _value: params.endpointId,
        _type: "xsd:string",
        _timestamp: tms,
        _writable: false,
      },
    },
  };

  let existing: Device | null = null;
  if (reconciliation) {
    existing = await db.collections.devices.findOne(reconciliation);
  }

  if (existing) {
    // Existing CWMP (or USP) device — merge USP state
    const update = {
      $set: {
        _protocol:
          existing._protocol === "cwmp" ? "both" : existing._protocol ?? "usp",
        _lastInform: now,
        // Keep _deviceId fresh only if missing (CWMP path wins when both exist)
        ...(existing._protocol !== "cwmp" && !(existing as { _deviceId?: unknown })._deviceId
          ? { _deviceId: deviceIdFields }
          : {}),
        "_usp.endpointId": params.endpointId,
        "_usp.endpointParts": parts,
        "_usp.preferredMtp": params.mtp,
        [`_usp.${params.mtp}.connected`]: true,
        [`_usp.${params.mtp}.lastSeen`]: now,
        "_usp.lastNotify": uspState.lastNotify,
      },
      $addToSet: { "_usp.supportedMtps": params.mtp },
    };
    await db.collections.devices.updateOne(
      { _id: existing._id },
      update as never,
    );
    logger.info({
      message: "USP Notify ingested (existing device)",
      deviceId: existing._id,
      endpointId: params.endpointId,
      mtp: params.mtp,
      subType: params.subType,
    });
    // Retry schema load if it was never successful (e.g. after factory reset
    // that wiped Device._writable, or if a previous attempt faulted).
    try {
      await ensureSchemaLoaded(existing._id);
    } catch (err) {
      logger.error({
        message: "Failed to queue schema load (existing device)",
        device: existing._id,
        exception: err as Error,
      });
    }
  } else {
    // New USP-only device
    const docId = endpointIdToDocId(params.endpointId);
    await db.collections.devices.updateOne(
      { _id: docId },
      {
        $setOnInsert: {
          _registered: now,
          _protocol: "usp",
          Device: deviceTree,
        },
        $set: {
          _lastInform: now,
          _usp: uspState,
          _deviceId: deviceIdFields,
        },
      },
      { upsert: true },
    );
    logger.info({
      message: "USP Notify ingested (new device)",
      deviceId: docId,
      endpointId: params.endpointId,
      mtp: params.mtp,
      subType: params.subType,
    });
    // Queue default Subscription installations on first contact
    try {
      await ensureDefaultSubscriptions(docId);
    } catch (err) {
      logger.error({
        message: "Failed to queue default subscriptions",
        device: docId,
        exception: err as Error,
      });
    }
    // Queue a full data-model schema fetch (GetSupportedDM Device.) so the UI
    // shows proper writability/types for every param without the user having
    // to manually refresh each subtree.
    try {
      await ensureSchemaLoaded(docId);
    } catch (err) {
      logger.error({
        message: "Failed to queue schema load (new device)",
        device: docId,
        exception: err as Error,
      });
    }
  }
}
