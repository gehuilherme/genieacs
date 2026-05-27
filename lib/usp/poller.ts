import { ObjectId } from "mongodb";
import * as db from "../db/db.ts";
import * as nats from "../mtp/nats.ts";
import { get } from "../config.ts";
import * as logger from "../logger.ts";
import { toMtpSubject } from "../mtp/subjects.ts";
import { taskToRpc, taskToSchemaRpc } from "./rpc.ts";
import { registerPending } from "./dispatcher.ts";
import type { Task } from "../db/types.ts";
import type { MtpKind } from "./types.ts";

const PROCESSED = new Set<string>();
let stopFlag = false;

function isTaskUsp(task: Task): boolean {
  if (task.protocol === "usp") return true;
  if (task.protocol === "cwmp") return false;
  // Unknown: caller resolves via device document
  return false;
}

async function processTask(task: Task): Promise<void> {
  // Atomically claim the task by deleting it. If null returned, another worker got it.
  const claimed = await db.collections.tasks.findOneAndDelete({ _id: task._id });
  if (!claimed) return;

  // Lookup device to get the Endpoint ID and preferred MTP
  const device = await db.collections.devices.findOne({ _id: task.device });
  if (!device || !device._usp) {
    await writeFault(task, "device-not-found", "USP device not found");
    return;
  }
  const endpointId = device._usp.endpointId;
  const mtp: MtpKind | undefined =
    device._usp.preferredMtp ?? device._usp.supportedMtps?.[0];
  if (!endpointId || !mtp) {
    await writeFault(task, "no-mtp", "Device has no reachable MTP");
    return;
  }

  let rpc;
  try {
    rpc = taskToRpc(task, endpointId);
  } catch (err) {
    await writeFault(task, "translation-failed", (err as Error).message);
    return;
  }

  const timeoutMs = get("USP_RPC_TIMEOUT") as number;
  const subject = toMtpSubject(mtp, endpointId);

  // refreshObject is special: in addition to fetching values via Get, we
  // ALSO fetch the supported data model schema (writability + xsd types)
  // via GetSupportedDM, so the UI can render edit controls correctly. Both
  // requests fire in parallel; we wait for both responses (each gets persisted
  // independently by the dispatcher) before marking the task done.
  const schemaRpc =
    task.name === "refreshObject" ? taskToSchemaRpc(task, endpointId) : null;

  const dispatch = (req: { msgId: string; recordBytes: Uint8Array }) =>
    new Promise<{ msg_type: string; body: unknown }>((resolve, reject) => {
      registerPending(req.msgId, resolve, reject, timeoutMs);
      try {
        void nats.publishPersistent(subject, req.recordBytes);
      } catch (err) {
        reject(err as Error);
      }
    });

  try {
    // Dispatch the value-fetch (Get / Set / Operate / etc.) first so that
    // multi-instance paths get persisted before the schema RPC runs — the
    // schema persist expands `{i}` placeholders against concrete instance
    // numbers it finds in the device doc, so it must see them already there.
    const primary = await dispatch(rpc);
    let schemaFetched = false;
    if (schemaRpc) {
      try {
        await dispatch(schemaRpc);
        schemaFetched = true;
      } catch (err) {
        logger.warn({
          message: "USP GetSupportedDM (schema) failed for refreshObject",
          device: task.device,
          exception: err as Error,
        });
      }
    }
    logger.info({
      message: "USP RPC complete",
      device: task.device,
      taskName: task.name,
      msgId: rpc.msgId,
      respType: primary.msg_type,
      schemaFetched,
    });
  } catch (err) {
    await writeFault(task, "rpc-failed", (err as Error).message);
  }
}

async function writeFault(
  task: Task,
  code: string,
  message: string,
): Promise<void> {
  await db.collections.faults.insertOne({
    _id: `${task.device}:task_${task._id.toString()}`,
    device: task.device,
    channel: "task",
    timestamp: new Date(),
    provisions: "",
    retries: 0,
    code,
    message,
  });
  logger.warn({
    message: "USP task fault written",
    device: task.device,
    taskName: task.name,
    code,
    faultMessage: message,
  });
}

// Mark MTPs as disconnected when we haven't seen a USP record from them for
// longer than this. This is best-effort without agent-side Last Will / Periodic
// notifications: a CPE that's connected but silent looks offline once the
// threshold passes. Tunable via USP_OFFLINE_THRESHOLD (ms).
const OFFLINE_SWEEP_INTERVAL_MS = 30_000;
let lastOfflineSweep = 0;

async function sweepOfflineMtps(): Promise<void> {
  const now = Date.now();
  if (now - lastOfflineSweep < OFFLINE_SWEEP_INTERVAL_MS) return;
  lastOfflineSweep = now;

  const thresholdMs = 5 * 60 * 1000; // 5 minutes
  const cutoff = new Date(now - thresholdMs);

  for (const mtp of ["mqtt", "ws", "stomp"] as const) {
    const r = await db.collections.devices.updateMany(
      {
        [`_usp.${mtp}.connected`]: true,
        [`_usp.${mtp}.lastSeen`]: { $lt: cutoff },
      } as never,
      { $set: { [`_usp.${mtp}.connected`]: false } } as never,
    );
    if (r.modifiedCount > 0) {
      logger.info({
        message: "Marked USP devices offline (lastSeen stale)",
        mtp,
        count: r.modifiedCount,
      });
    }
  }
}

async function tick(): Promise<void> {
  // Find devices that speak USP
  const uspDevices = await db.collections.devices
    .find(
      { _protocol: { $in: ["usp", "both"] } as never },
      { projection: { _id: 1 } },
    )
    .toArray();
  if (uspDevices.length === 0) {
    await sweepOfflineMtps().catch(() => undefined);
    return;
  }

  const ids = uspDevices.map((d) => d._id);
  const tasks = await db.collections.tasks
    .find({ device: { $in: ids } })
    .limit(100)
    .toArray();

  for (const task of tasks) {
    const key = task._id.toHexString();
    if (PROCESSED.has(key)) continue;
    PROCESSED.add(key);

    // Process asynchronously — don't block the tick on a single slow RPC
    void processTask(task as Task).finally(() => PROCESSED.delete(key));
  }

  await sweepOfflineMtps().catch(() => undefined);
}

export function start(intervalMs = 1000): void {
  stopFlag = false;
  const loop = async (): Promise<void> => {
    while (!stopFlag) {
      try {
        await tick();
      } catch (err) {
        logger.error({
          message: "USP task poller error",
          exception: err as Error,
        });
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  };
  void loop();
  logger.info({ message: "USP task poller started", intervalMs });
}

export function stop(): void {
  stopFlag = true;
}

// Keep the symbol used (for the lint to not complain)
void isTaskUsp;
void ObjectId;
