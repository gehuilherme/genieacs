import * as config from "../lib/config.ts";
import * as logger from "../lib/logger.ts";
import * as nats from "../lib/mtp/nats.ts";
import * as mqttBridge from "../lib/mtp/mqtt.ts";
import { version as VERSION } from "../package.json";

logger.init("usp-mqtt", VERSION);

let shuttingDown = false;

async function start(): Promise<void> {
  const MQTT_URL = config.get("USP_MQTT_URL") as string;

  logger.info({
    message: "genieacs-usp-mqtt starting",
    pid: process.pid,
    version: VERSION,
    mqttUrl: MQTT_URL || "(not configured)",
    natsUrl: config.get("NATS_URL"),
  });

  if (!MQTT_URL) {
    logger.warn({
      message: "USP_MQTT_URL not configured; MQTT bridge idle",
      pid: process.pid,
    });
    return;
  }

  await nats.connect();

  await mqttBridge.start({
    url: MQTT_URL,
    username: (config.get("USP_MQTT_USERNAME") as string) || undefined,
    password: (config.get("USP_MQTT_PASSWORD") as string) || undefined,
    clientId: config.get("USP_MQTT_CLIENT_ID") as string,
    topicPrefix: config.get("USP_MQTT_TOPIC_PREFIX") as string,
    controllerTopic:
      (config.get("USP_MQTT_CONTROLLER_TOPIC") as string) || undefined,
    tlsCa: (config.get("USP_MQTT_TLS_CA") as string) || undefined,
    tlsCert: (config.get("USP_MQTT_TLS_CERT") as string) || undefined,
    tlsKey: (config.get("USP_MQTT_TLS_KEY") as string) || undefined,
  });

  logger.info({ message: "genieacs-usp-mqtt ready" });
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({
    message: `Received signal ${signal}, exiting`,
    pid: process.pid,
  });
  try {
    await mqttBridge.stop();
  } catch (err) {
    logger.error({
      message: "Error stopping MQTT bridge",
      exception: err as Error,
    });
  }
  try {
    await nats.disconnect();
  } catch (err) {
    logger.error({ message: "Error closing NATS", exception: err as Error });
  }
  logger.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

start().catch((err) => {
  logger.error({
    message: "MQTT bridge startup failed",
    exception: err as Error,
    pid: process.pid,
  });
  process.exit(1);
});
