import * as config from "../lib/config.ts";
import * as logger from "../lib/logger.ts";
import * as nats from "../lib/mtp/nats.ts";
import * as stompBridge from "../lib/mtp/stomp.ts";
import { version as VERSION } from "../package.json";

logger.init("usp-stomp", VERSION);

let shuttingDown = false;

async function start(): Promise<void> {
  const STOMP_URL = config.get("USP_STOMP_URL") as string;

  logger.info({
    message: "genieacs-usp-stomp starting",
    pid: process.pid,
    version: VERSION,
    stompUrl: STOMP_URL || "(not configured)",
    natsUrl: config.get("NATS_URL"),
  });

  if (!STOMP_URL) {
    logger.warn({
      message: "USP_STOMP_URL not configured; STOMP bridge idle",
      pid: process.pid,
    });
    return;
  }

  await nats.connect();

  await stompBridge.start({
    url: STOMP_URL,
    username: (config.get("USP_STOMP_USERNAME") as string) || undefined,
    password: (config.get("USP_STOMP_PASSWORD") as string) || undefined,
    destPrefix: config.get("USP_STOMP_DEST_PREFIX") as string,
  });

  logger.info({ message: "genieacs-usp-stomp ready" });
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({
    message: `Received signal ${signal}, exiting`,
    pid: process.pid,
  });
  try {
    await stompBridge.stop();
  } catch (err) {
    logger.error({
      message: "Error stopping STOMP bridge",
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
    message: "STOMP bridge startup failed",
    exception: err as Error,
    pid: process.pid,
  });
  process.exit(1);
});
