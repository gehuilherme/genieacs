import { ObjectId } from "mongodb";
import * as db from "../db/db.ts";
import * as logger from "../logger.ts";

const DEFAULT_BOOT_REF_LIST = ["Device.DeviceInfo."];

/**
 * Ensure the ACS-side default Subscription tasks exist for a freshly-onboarded
 * USP device. We queue `addSubscription` tasks; the controller's poller will
 * translate each one into an Add request against `Device.LocalAgent.Subscription.`.
 *
 * Idempotent: only inserts tasks that aren't already pending for this device.
 */
export async function ensureDefaults(deviceId: string): Promise<void> {
  const existing = await db.collections.tasks
    .find({
      device: deviceId,
      name: "addSubscription",
    })
    .limit(1)
    .toArray();
  if (existing.length > 0) return;

  const now = new Date();
  await db.collections.tasks.insertMany([
    {
      _id: new ObjectId(),
      device: deviceId,
      name: "addSubscription",
      protocol: "usp",
      timestamp: now,
      notificationType: "Boot",
      referenceList: DEFAULT_BOOT_REF_LIST,
      persistent: true,
    },
    {
      _id: new ObjectId(),
      device: deviceId,
      name: "addSubscription",
      protocol: "usp",
      timestamp: now,
      notificationType: "ValueChange",
      referenceList: ["Device.DeviceInfo.SoftwareVersion"],
      persistent: true,
    },
  ] as never);

  logger.info({
    message: "Default USP subscriptions queued",
    device: deviceId,
  });
}

/**
 * On first contact, enqueue a `refreshObject Device.` task so the controller
 * loads the full TR-181 data model schema (writability, xsd types per param)
 * via GetSupportedDM. Without this, only paths the user manually refreshes
 * get proper edit-controls in the UI.
 *
 * Idempotent against:
 *   1. A device document where `_usp.schemaLoadedAt` is set — a previous
 *      GetSupportedDM persist succeeded so the tree already carries schema.
 *   2. A pending root-refresh task already in the queue.
 *
 * On failure (CPE rejects GetSupportedDM, fault is written), this retries on
 * the next first-contact (e.g. factory reset / re-registration / restart).
 */
export async function ensureSchemaLoaded(deviceId: string): Promise<void> {
  const dev = (await db.collections.devices.findOne({ _id: deviceId })) as
    | { _usp?: { schemaLoadedAt?: Date } }
    | null;
  if (dev?._usp?.schemaLoadedAt) return;

  const existing = await db.collections.tasks
    .find({
      device: deviceId,
      name: "refreshObject",
      objectName: "Device.",
    })
    .limit(1)
    .toArray();
  if (existing.length > 0) return;

  await db.collections.tasks.insertOne({
    _id: new ObjectId(),
    device: deviceId,
    name: "refreshObject",
    protocol: "usp",
    timestamp: new Date(),
    objectName: "Device.",
  } as never);

  logger.info({
    message: "USP root schema refresh queued",
    device: deviceId,
  });
}
