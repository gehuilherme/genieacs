import * as config from "../lib/config.ts";
import * as logger from "../lib/logger.ts";
import * as nats from "../lib/mtp/nats.ts";
import * as wsBridge from "../lib/mtp/ws.ts";
import { version as VERSION } from "../package.json";

logger.init("usp-ws", VERSION);

let shuttingDown = false;

async function start(): Promise<void> {
  const WS_PORT = config.get("USP_WS_PORT") as number;
  const WS_INTERFACE = config.get("USP_WS_INTERFACE") as string;
  const WS_PATH = config.get("USP_WS_PATH") as string;
  const WS_SUBPROTOCOL = config.get("USP_WS_SUBPROTOCOL") as string;
  const WS_SSL_CERT = (config.get("USP_WS_SSL_CERT") as string) || "";
  const WS_SSL_KEY = (config.get("USP_WS_SSL_KEY") as string) || "";

  logger.info({
    message: "genieacs-usp-ws starting",
    pid: process.pid,
    version: VERSION,
    port: WS_PORT,
    interface: WS_INTERFACE,
    path: WS_PATH,
    subprotocol: WS_SUBPROTOCOL,
    natsUrl: config.get("NATS_URL"),
  });

  if (!WS_PORT || WS_PORT <= 0) {
    logger.warn({
      message: "USP_WS_PORT not configured (0); WebSocket bridge idle",
      pid: process.pid,
    });
    return;
  }

  await nats.connect();

  await wsBridge.start({
    port: WS_PORT,
    host: WS_INTERFACE,
    path: WS_PATH,
    subprotocol: WS_SUBPROTOCOL,
    sslCert: WS_SSL_CERT || undefined,
    sslKey: WS_SSL_KEY || undefined,
  });

  logger.info({ message: "genieacs-usp-ws ready" });
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({
    message: `Received signal ${signal}, exiting`,
    pid: process.pid,
  });
  try {
    await wsBridge.stop();
  } catch (err) {
    logger.error({
      message: "Error stopping WebSocket bridge",
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
    message: "WebSocket bridge startup failed",
    exception: err as Error,
    pid: process.pid,
  });
  process.exit(1);
});
