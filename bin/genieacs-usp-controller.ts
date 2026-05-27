import * as config from "../lib/config.ts";
import * as logger from "../lib/logger.ts";
import * as db from "../lib/db/db.ts";
import * as nats from "../lib/mtp/nats.ts";
import { handleIncomingRecord } from "../lib/usp/dispatcher.ts";
import * as poller from "../lib/usp/poller.ts";
import { fromMtpWildcard } from "../lib/mtp/subjects.ts";
import { version as VERSION } from "../package.json";

logger.init("usp-controller", VERSION);

let shuttingDown = false;

async function start(): Promise<void> {
  logger.info({
    message: "genieacs-usp-controller starting",
    pid: process.pid,
    version: VERSION,
    natsUrl: config.get("NATS_URL"),
  });

  await db.connect();
  await nats.connect();

  const subject = fromMtpWildcard();
  await nats.subscribeJetStream(
    subject,
    "usp-controller",
    "usp-controller",
    async (msg) => {
      try {
        await handleIncomingRecord(msg.subject, msg.data);
        msg.ack();
      } catch (err) {
        logger.error({
          message: "Controller failed to handle record",
          subject: msg.subject,
          exception: err as Error,
        });
        // m.nak() happens inside subscribe wrapper on throw, but we caught it
      }
    },
  );

  logger.info({ message: "USP controller subscribed", subject });

  poller.start(1000);
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ message: `Received signal ${signal}, exiting`, pid: process.pid });
  poller.stop();
  try {
    await nats.disconnect();
  } catch (err) {
    logger.error({ message: "Error closing NATS", exception: err as Error });
  }
  try {
    await db.disconnect();
  } catch (err) {
    logger.error({ message: "Error closing Mongo", exception: err as Error });
  }
  logger.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

start().catch((err) => {
  logger.error({
    message: "Controller startup failed",
    exception: err as Error,
    pid: process.pid,
  });
  process.exit(1);
});
