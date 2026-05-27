import * as fs from "node:fs";
import { connectAsync, MqttClient } from "mqtt";
import * as logger from "../logger.ts";
import * as natsModule from "./nats.ts";
import {
  fromControllerWildcard,
  fromMtpSubject,
  parseSubject,
} from "./subjects.ts";
import { decodeRecord } from "../usp/parser.ts";

export interface MqttBridgeOptions {
  url: string;
  username?: string;
  password?: string;
  clientId: string;
  topicPrefix: string; // e.g. "genieacs/usp/v1"
  controllerTopic?: string; // if empty, defaults to `${topicPrefix}/controller`
  tlsCa?: string; // path
  tlsCert?: string;
  tlsKey?: string;
}

// MQTT v5 User Property name used by TR-369 §8.2 to carry the Endpoint ID.
// We extract it case-insensitively because brokers/agents differ in casing.
const ENDPOINT_ID_USER_PROPERTY = "usp-endpoint-id";

let client: MqttClient | null = null;
let started = false;
let resolvedControllerTopic = "";
let resolvedTopicPrefix = "";

function readFileIfSet(p: string | undefined): Buffer | undefined {
  if (!p) return undefined;
  try {
    return fs.readFileSync(p);
  } catch (err) {
    logger.error({
      message: "Failed to read TLS file",
      path: p,
      exception: err as Error,
    });
    throw err;
  }
}

function extractEndpointIdFromUserProps(
  userProperties: Record<string, string | string[]> | undefined,
): string | null {
  if (!userProperties) return null;
  for (const [k, v] of Object.entries(userProperties)) {
    if (k.toLowerCase() === ENDPOINT_ID_USER_PROPERTY) {
      if (Array.isArray(v)) return v.length > 0 ? v[0] : null;
      return v;
    }
  }
  return null;
}

/**
 * Fallback: parse the agent endpoint ID out of the topic name if it followed
 * the pattern `<prefix>/agent/<endpointId>`. Returns null otherwise.
 */
function extractEndpointIdFromTopic(
  topic: string,
  topicPrefix: string,
): string | null {
  const agentPrefix = `${topicPrefix}/agent/`;
  if (topic.startsWith(agentPrefix)) {
    const rest = topic.slice(agentPrefix.length);
    // Take everything up to the next '/' (defensive — the endpointId itself
    // may contain ':' but should not contain '/'). If it does, take the full
    // remainder.
    const slash = rest.indexOf("/");
    const id = slash >= 0 ? rest.slice(0, slash) : rest;
    return id || null;
  }
  return null;
}

export async function start(opts: MqttBridgeOptions): Promise<void> {
  if (started) return;
  started = true;

  const controllerTopic =
    opts.controllerTopic && opts.controllerTopic.length > 0
      ? opts.controllerTopic
      : `${opts.topicPrefix}/controller`;
  resolvedControllerTopic = controllerTopic;
  resolvedTopicPrefix = opts.topicPrefix;

  const ca = readFileIfSet(opts.tlsCa);
  const cert = readFileIfSet(opts.tlsCert);
  const key = readFileIfSet(opts.tlsKey);

  logger.info({
    message: "MQTT bridge connecting",
    url: opts.url,
    clientId: opts.clientId,
    controllerTopic,
    topicPrefix: opts.topicPrefix,
  });

  client = await connectAsync(opts.url, {
    clientId: opts.clientId,
    username: opts.username || undefined,
    password: opts.password || undefined,
    protocolVersion: 5,
    clean: true,
    reconnectPeriod: 5000,
    ca,
    cert,
    key,
  });

  client.on("connect", () => {
    logger.info({
      message: "MQTT bridge connected",
      url: opts.url,
      clientId: opts.clientId,
    });
  });

  client.on("error", (err) => {
    logger.error({
      message: "MQTT bridge error",
      exception: err,
    });
  });

  client.on("disconnect", () => {
    logger.warn({ message: "MQTT bridge received DISCONNECT from broker" });
  });

  client.on("offline", () => {
    logger.warn({ message: "MQTT bridge offline" });
  });

  client.on("reconnect", () => {
    logger.info({ message: "MQTT bridge reconnecting" });
  });

  client.on("close", () => {
    logger.info({ message: "MQTT bridge connection closed" });
  });

  // Subscribe to the controller topic where agents publish their USP records.
  await client.subscribeAsync(controllerTopic, { qos: 1 });
  logger.info({
    message: "MQTT bridge subscribed to controller topic",
    topic: controllerTopic,
  });

  client.on("message", (topic, payload, packet) => {
    // QoS 1 is auto-acked by mqtt.js.
    const userProps = packet?.properties?.userProperties as
      | Record<string, string | string[]>
      | undefined;
    const bytes =
      payload instanceof Uint8Array
        ? payload
        : new Uint8Array(Buffer.from(payload as unknown as string));

    let endpointId = extractEndpointIdFromUserProps(userProps);
    if (!endpointId) {
      endpointId = extractEndpointIdFromTopic(topic, opts.topicPrefix);
    }
    if (!endpointId) {
      // Last-resort fallback: decode the USP Record envelope and use from_id.
      // Many agents (including obuspa default config) publish on the controller
      // topic without setting the MQTT v5 `usp-endpoint-id` user property.
      try {
        const record = decodeRecord(bytes);
        if (record.from_id) endpointId = record.from_id;
      } catch {
        /* fall through to drop */
      }
    }
    if (!endpointId) {
      logger.warn({
        message: "MQTT bridge dropping message: no endpoint ID resolvable",
        topic,
      });
      return;
    }

    const subject = fromMtpSubject("mqtt", endpointId);

    natsModule.publishPersistent(subject, bytes).catch((err) => {
      logger.error({
        message: "MQTT->NATS publish failed",
        subject,
        endpointId,
        exception: err as Error,
      });
    });
  });

  // Subscribe (JetStream) to outgoing controller->MTP messages.
  const outSubject = fromControllerWildcard("mqtt");
  await natsModule.subscribeJetStream(
    outSubject,
    "usp-mqtt",
    "usp-mqtt",
    async (msg) => {
      try {
        const parsed = parseSubject(msg.subject);
        const endpointId = parsed?.endpointId;
        if (!endpointId) {
          logger.warn({
            message: "Dropping outgoing message: cannot parse endpoint ID",
            subject: msg.subject,
          });
          msg.ack();
          return;
        }
        if (!client || !client.connected) {
          // Don't ack — let JetStream redeliver when we're back up.
          logger.warn({
            message:
              "MQTT bridge not connected; deferring outgoing message for redelivery",
            subject: msg.subject,
            endpointId,
          });
          return;
        }

        const agentTopic = `${opts.topicPrefix}/agent/${endpointId}`;
        await client.publishAsync(agentTopic, Buffer.from(msg.data), {
          qos: 1,
          properties: {
            responseTopic: controllerTopic,
            // correlationData omitted for MVP — we don't decode the
            // USP Record here to extract the message ID.
          },
        });
        msg.ack();
      } catch (err) {
        logger.error({
          message: "NATS->MQTT publish failed",
          subject: msg.subject,
          exception: err as Error,
        });
        // Bad payload (e.g. unparseable subject) — ack to avoid redelivery loop.
        try {
          msg.ack();
        } catch {
          /* ignore */
        }
      }
    },
  );

  logger.info({
    message: "MQTT bridge subscribed to NATS outgoing subject",
    subject: outSubject,
  });
}

export async function stop(): Promise<void> {
  if (!started) return;
  started = false;
  if (client) {
    try {
      await client.endAsync();
    } catch (err) {
      logger.error({
        message: "Error closing MQTT client",
        exception: err as Error,
      });
    }
    client = null;
  }
  logger.info({ message: "MQTT bridge stopped" });
}

// Exposed for tests / introspection.
export function _getResolvedControllerTopic(): string {
  return resolvedControllerTopic;
}

export function _getResolvedTopicPrefix(): string {
  return resolvedTopicPrefix;
}
