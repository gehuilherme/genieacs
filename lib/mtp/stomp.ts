import * as stompit from "stompit";
import * as logger from "../logger.ts";
import * as natsModule from "./nats.ts";
import {
  fromControllerWildcard,
  fromMtpSubject,
  parseSubject,
} from "./subjects.ts";

export interface StompBridgeOptions {
  url: string; // stomp://host:port or stomp+ssl://host:port
  username?: string;
  password?: string;
  destPrefix: string; // e.g. "/queue/genieacs-usp"
}

// TR-369 §8.3 carries the Endpoint ID in this STOMP header on every MESSAGE
// and SEND frame.
const ENDPOINT_ID_HEADER = "usp-endpoint-id";

interface ParsedUrl {
  host: string;
  port: number;
  ssl: boolean;
}

function parseStompUrl(url: string): ParsedUrl {
  // Accepted schemes: stomp://, stomp+ssl://, stomp+ssl+tcp:// (treat any
  // "+ssl" suffix as TLS).
  const match = /^([a-z][a-z0-9+\-.]*):\/\/([^/?#]+)/i.exec(url);
  if (!match) {
    throw new Error(`Invalid STOMP URL: ${url}`);
  }
  const scheme = match[1].toLowerCase();
  const ssl = scheme.includes("ssl") || scheme.includes("tls");
  const authority = match[2];
  // Strip user-info if any (we get credentials from explicit username/password).
  const at = authority.lastIndexOf("@");
  const hostPort = at >= 0 ? authority.slice(at + 1) : authority;
  // IPv6 in brackets?
  let host: string;
  let portStr: string;
  if (hostPort.startsWith("[")) {
    const close = hostPort.indexOf("]");
    if (close < 0) throw new Error(`Invalid STOMP URL (unterminated IPv6): ${url}`);
    host = hostPort.slice(1, close);
    const rest = hostPort.slice(close + 1);
    portStr = rest.startsWith(":") ? rest.slice(1) : "";
  } else {
    const colon = hostPort.lastIndexOf(":");
    if (colon < 0) {
      host = hostPort;
      portStr = "";
    } else {
      host = hostPort.slice(0, colon);
      portStr = hostPort.slice(colon + 1);
    }
  }
  let port: number;
  if (portStr) {
    port = parseInt(portStr, 10);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      throw new Error(`Invalid STOMP URL port: ${url}`);
    }
  } else {
    port = ssl ? 61614 : 61613;
  }
  return { host, port, ssl };
}

let failover: stompit.ConnectFailover | null = null;
let currentClient: stompit.Client | null = null;
let connectHandle: { abort: () => void } | null = null;
let started = false;
let stopping = false;
let resolvedDestPrefix = "";
// Track the JetStream subscription so we can stop accepting outbound work on
// stop(). The current nats module doesn't expose a stop primitive for JS
// subscriptions, so we gate dispatch on `started`.
let natsSubscribed = false;

export async function start(opts: StompBridgeOptions): Promise<void> {
  if (started) return;
  started = true;
  stopping = false;
  resolvedDestPrefix = opts.destPrefix;

  const parsed = parseStompUrl(opts.url);
  const controllerDest = `${opts.destPrefix}/controller`;

  logger.info({
    message: "STOMP bridge connecting",
    url: opts.url,
    host: parsed.host,
    port: parsed.port,
    ssl: parsed.ssl,
    destPrefix: opts.destPrefix,
    controllerDest,
  });

  const connectHeaders: stompit.connect.ConnectHeaders = {
    "accept-version": "1.2",
    host: parsed.host,
    "heart-beat": "10000,10000",
  };
  if (opts.username) connectHeaders.login = opts.username;
  if (opts.password) connectHeaders.passcode = opts.password;

  const serverEntry: stompit.connect.ConnectOptions = parsed.ssl
    ? {
        host: parsed.host,
        port: parsed.port,
        ssl: true,
        connectHeaders,
      }
    : {
        host: parsed.host,
        port: parsed.port,
        ssl: false,
        connectHeaders,
      };

  failover = new stompit.ConnectFailover([serverEntry], {
    initialReconnectDelay: 1000,
    maxReconnectDelay: 30000,
    useExponentialBackOff: true,
    maxReconnects: -1,
  });

  failover.on("error", (err) => {
    logger.error({
      message: "STOMP bridge connect error",
      exception: err,
    });
  });

  failover.on("connecting", (server) => {
    const addr = server.serverProperties?.remoteAddress;
    logger.info({
      message: "STOMP bridge connecting to broker",
      host: addr ? `${addr.transportPath || ""}` : `${parsed.host}:${parsed.port}`,
      attempt: server.failedConnects,
    });
  });

  // Kick off connection with auto-reconnect. The callback fires every time a
  // (re)connection succeeds.
  connectHandle = failover.connect((err, client, reconnect) => {
    if (err) {
      logger.error({
        message: "STOMP bridge connection error",
        exception: err,
      });
      return;
    }
    currentClient = client;
    logger.info({ message: "STOMP bridge connected" });

    client.on("error", (e: Error) => {
      logger.error({
        message: "STOMP bridge client error",
        exception: e,
      });
      // ConnectFailover hooks into 'error' to drive its reconnect loop; we
      // only need to call reconnect() ourselves if we somehow want a forced
      // re-connect. Letting the library handle it is sufficient.
      if (!stopping) {
        try {
          reconnect();
        } catch {
          /* ignore — failover will retry on its own schedule */
        }
      }
    });

    // Subscribe to the controller destination. Each MESSAGE frame is acked
    // (or nacked) individually so we can apply at-least-once semantics.
    client.subscribe(
      {
        destination: controllerDest,
        ack: "client-individual",
      },
      (subErr, message) => {
        if (subErr) {
          logger.error({
            message: "STOMP subscribe error",
            destination: controllerDest,
            exception: subErr,
          });
          return;
        }

        // The stompit type definitions don't model the headers map on
        // incoming MESSAGE frames, but the runtime does set it.
        const msgHeaders =
          ((message as unknown as { headers?: Record<string, string> })
            .headers) || {};
        const endpointId = msgHeaders[ENDPOINT_ID_HEADER];
        if (!endpointId || typeof endpointId !== "string") {
          logger.warn({
            message:
              "STOMP bridge dropping MESSAGE without usp-endpoint-id header",
            destination: controllerDest,
            headers: msgHeaders,
          });
          // Drain the body to keep the parser advancing, then NACK.
          message.readString("utf-8", () => {
            try {
              client.nack(message);
            } catch {
              /* ignore */
            }
          });
          return;
        }

        const chunks: Buffer[] = [];
        message.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        message.on("error", (e: Error) => {
          logger.error({
            message: "STOMP MESSAGE read error",
            destination: controllerDest,
            endpointId,
            exception: e,
          });
          try {
            client.nack(message);
          } catch {
            /* ignore */
          }
        });
        message.on("end", () => {
          const body = Buffer.concat(chunks);
          const subject = fromMtpSubject("stomp", endpointId);
          natsModule
            .publishPersistent(subject, new Uint8Array(body))
            .then(() => {
              try {
                client.ack(message);
              } catch (e) {
                logger.error({
                  message: "STOMP ack failed",
                  destination: controllerDest,
                  endpointId,
                  exception: e as Error,
                });
              }
            })
            .catch((err: Error) => {
              logger.error({
                message: "STOMP->NATS publish failed",
                subject,
                endpointId,
                exception: err,
              });
              try {
                client.nack(message);
              } catch {
                /* ignore */
              }
            });
        });
      },
    );
    logger.info({
      message: "STOMP bridge subscribed to controller destination",
      destination: controllerDest,
    });
  });

  // Subscribe (JetStream) to outgoing controller->MTP messages.
  const outSubject = fromControllerWildcard("stomp");
  await natsModule.subscribeJetStream(
    outSubject,
    "usp-stomp",
    "usp-stomp",
    async (msg) => {
      try {
        const parsedSubj = parseSubject(msg.subject);
        const endpointId = parsedSubj?.endpointId;
        if (!endpointId) {
          logger.warn({
            message: "Dropping outgoing message: cannot parse endpoint ID",
            subject: msg.subject,
          });
          msg.ack();
          return;
        }
        if (!currentClient || stopping) {
          // Don't ack — let JetStream redeliver when we're back up.
          logger.warn({
            message:
              "STOMP bridge not connected; deferring outgoing message for redelivery",
            subject: msg.subject,
            endpointId,
          });
          return;
        }

        const destination = `${opts.destPrefix}/agent/${endpointId}`;
        const body = Buffer.from(msg.data);
        const sendHeaders: Record<string, string | number> = {
          destination,
          "content-type": "application/octet-stream",
          "content-length": body.length,
          [ENDPOINT_ID_HEADER]: endpointId,
        };

        await new Promise<void>((resolve, reject) => {
          if (!currentClient) {
            reject(new Error("STOMP client not connected"));
            return;
          }
          try {
            const frame = currentClient.send(sendHeaders);
            frame.on("error", (e: Error) => reject(e));
            frame.write(body);
            frame.end((err?: Error | null) => {
              if (err) reject(err);
              else resolve();
            });
          } catch (e) {
            reject(e as Error);
          }
        });
        msg.ack();
      } catch (err) {
        logger.error({
          message: "NATS->STOMP send failed",
          subject: msg.subject,
          exception: err as Error,
        });
        // Don't ack — let JetStream redeliver.
      }
    },
  );
  natsSubscribed = true;

  logger.info({
    message: "STOMP bridge subscribed to NATS outgoing subject",
    subject: outSubject,
  });
}

export async function stop(): Promise<void> {
  if (!started) return;
  started = false;
  stopping = true;

  if (connectHandle) {
    try {
      connectHandle.abort();
    } catch {
      /* ignore */
    }
    connectHandle = null;
  }

  if (currentClient) {
    await new Promise<void>((resolve) => {
      const c = currentClient;
      currentClient = null;
      if (!c) {
        resolve();
        return;
      }
      try {
        c.disconnect((err) => {
          if (err) {
            logger.error({
              message: "Error during STOMP disconnect",
              exception: err,
            });
          }
          resolve();
        });
      } catch (e) {
        logger.error({
          message: "Exception during STOMP disconnect",
          exception: e as Error,
        });
        resolve();
      }
    });
  }

  failover = null;
  natsSubscribed = false;
  logger.info({ message: "STOMP bridge stopped" });
}

// Exposed for tests / introspection.
export function _getResolvedDestPrefix(): string {
  return resolvedDestPrefix;
}

export function _isNatsSubscribed(): boolean {
  return natsSubscribed;
}
