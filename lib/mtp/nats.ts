import {
  connect as natsConnect,
  NatsConnection,
  Subscription,
  StringCodec,
  JetStreamManager,
  JetStreamClient,
  RetentionPolicy,
  StorageType,
  DiscardPolicy,
  consumerOpts,
} from "nats";
import { get } from "../config.ts";
import * as logger from "../logger.ts";
import { SUBJECT_PREFIX, fromMtpWildcard } from "./subjects.ts";
import type { QueueGroup } from "./types.ts";

let nc: NatsConnection | null = null;
let js: JetStreamClient | null = null;
let jsm: JetStreamManager | null = null;
const sc = StringCodec();

export async function connect(): Promise<void> {
  if (nc) return;
  const url = get("NATS_URL") as string;
  const user = get("NATS_USER") as string;
  const pass = get("NATS_PASSWORD") as string;

  nc = await natsConnect({
    servers: url,
    user: user || undefined,
    pass: pass || undefined,
    reconnect: true,
    maxReconnectAttempts: -1,
    waitOnFirstConnect: false,
    name: process.env.GENIEACS_SERVICE_NAME || "genieacs",
  });

  logger.info({ message: "NATS connected", url });

  js = nc.jetstream();
  jsm = await nc.jetstreamManager();
  await ensureStream();
}

async function ensureStream(): Promise<void> {
  if (!jsm) return;
  const streamName = get("NATS_STREAM_NAME") as string;
  try {
    await jsm.streams.info(streamName);
  } catch {
    await jsm.streams.add({
      name: streamName,
      subjects: [`${SUBJECT_PREFIX}.from-mtp.>`, `${SUBJECT_PREFIX}.to-mtp.>`],
      retention: RetentionPolicy.Workqueue,
      storage: StorageType.File,
      discard: DiscardPolicy.Old,
      max_age: 24 * 60 * 60 * 1_000_000_000, // 24h in nanoseconds
    });
    logger.info({ message: "NATS JetStream stream created", stream: streamName });
  }
}

export async function disconnect(): Promise<void> {
  if (!nc) return;
  await nc.drain();
  nc = null;
  js = null;
  jsm = null;
  logger.info({ message: "NATS disconnected" });
}

export function isConnected(): boolean {
  return nc !== null && !nc.isClosed();
}

export function publish(subject: string, payload: Uint8Array): void {
  if (!nc) throw new Error("NATS not connected");
  nc.publish(subject, payload);
}

export async function publishPersistent(
  subject: string,
  payload: Uint8Array,
): Promise<void> {
  if (!js) throw new Error("NATS JetStream not connected");
  await js.publish(subject, payload);
}

export interface NatsMsgIn {
  subject: string;
  data: Uint8Array;
  reply?: string;
  headers?: Record<string, string>;
  ack(): void;
}

export function subscribe(
  subject: string,
  queue: QueueGroup | undefined,
  handler: (msg: NatsMsgIn) => void | Promise<void>,
): Subscription {
  if (!nc) throw new Error("NATS not connected");
  const sub = nc.subscribe(subject, { queue });
  (async () => {
    for await (const m of sub) {
      const headers: Record<string, string> = {};
      if (m.headers) {
        for (const [k, v] of m.headers) headers[k] = String(v[0]);
      }
      try {
        await handler({
          subject: m.subject,
          data: m.data,
          reply: m.reply,
          headers,
          ack: () => {
            // core nats has no ack — no-op for non-JS subs
          },
        });
      } catch (err) {
        logger.error({
          message: "NATS subscription handler error",
          subject: m.subject,
          exception: err as Error,
        });
      }
    }
  })().catch((err) => {
    logger.error({ message: "NATS subscription iterator error", exception: err });
  });
  return sub;
}

export async function subscribeJetStream(
  subject: string,
  durableName: string,
  queue: QueueGroup,
  handler: (msg: NatsMsgIn) => void | Promise<void>,
): Promise<void> {
  if (!js || !jsm) throw new Error("NATS JetStream not connected");
  const streamName = get("NATS_STREAM_NAME") as string;
  const opts = consumerOpts();
  opts.durable(durableName);
  opts.queue(queue);
  opts.deliverTo(`_INBOX.${queue}.${durableName}`);
  opts.manualAck();
  opts.ackExplicit();
  opts.bind(streamName, durableName);

  // Ensure the consumer exists
  try {
    await jsm.consumers.info(streamName, durableName);
  } catch {
    await jsm.consumers.add(streamName, {
      durable_name: durableName,
      deliver_subject: `_INBOX.${queue}.${durableName}`,
      filter_subject: subject,
      deliver_group: queue,
      ack_policy: "explicit" as never,
    });
  }

  const psub = await js.subscribe(subject, opts);
  (async () => {
    for await (const m of psub) {
      const headers: Record<string, string> = {};
      if (m.headers) {
        for (const [k, v] of m.headers) headers[k] = String(v[0]);
      }
      try {
        await handler({
          subject: m.subject,
          data: m.data,
          headers,
          ack: () => m.ack(),
        });
      } catch (err) {
        logger.error({
          message: "NATS JS subscription handler error",
          subject: m.subject,
          exception: err as Error,
        });
        m.nak();
      }
    }
  })().catch((err) => {
    logger.error({ message: "NATS JS iterator error", exception: err });
  });
}

export async function request(
  subject: string,
  payload: Uint8Array,
  timeoutMs: number,
): Promise<Uint8Array> {
  if (!nc) throw new Error("NATS not connected");
  const resp = await nc.request(subject, payload, { timeout: timeoutMs });
  return resp.data;
}

// Re-export commonly used helpers
export { fromMtpWildcard, sc };
