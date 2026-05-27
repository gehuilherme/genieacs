import * as config from "../lib/config.ts";
import * as logger from "../lib/logger.ts";
import * as db from "../lib/db/db.ts";
import { version as VERSION } from "../package.json";

logger.init("migrate", VERSION);

interface Migration {
  name: string;
  run: () => Promise<{ matched: number; modified: number }>;
}

const migrations: Migration[] = [
  {
    name: "set-protocol-cwmp-on-legacy-devices",
    run: async () => {
      const result = await db.collections.devices.updateMany(
        { _protocol: { $exists: false } },
        { $set: { _protocol: "cwmp" } },
      );
      return { matched: result.matchedCount, modified: result.modifiedCount };
    },
  },
];

async function main(): Promise<void> {
  logger.info({
    message: "genieacs-migrate starting",
    pid: process.pid,
    version: VERSION,
    mongoUrl: config.get("MONGODB_CONNECTION_URL"),
  });

  await db.connect();

  for (const m of migrations) {
    logger.info({ message: `Running migration: ${m.name}` });
    try {
      const stats = await m.run();
      logger.info({ message: `Migration done: ${m.name}`, ...stats });
    } catch (err) {
      logger.error({
        message: `Migration failed: ${m.name}`,
        exception: err as Error,
      });
      await db.disconnect();
      logger.close();
      process.exit(1);
    }
  }

  await db.disconnect();
  logger.info({ message: "All migrations complete" });
  logger.close();
  process.exit(0);
}

void main();
