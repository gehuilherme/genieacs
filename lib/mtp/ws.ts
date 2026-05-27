import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import { WebSocket, WebSocketServer } from "ws";
import * as logger from "../logger.ts";
import { decodeRecord } from "../usp/parser.ts";
import * as natsModule from "./nats.ts";
import {
  fromControllerWildcard,
  fromMtpSubject,
  parseSubject,
} from "./subjects.ts";

export interface WsBridgeOptions {
  port: number;
  host: string;
  path: string;
  subprotocol: string;
  sslCert?: string;
  sslKey?: string;
}

interface ConnState {
  ws: WebSocket;
  endpointId?: string;
  remoteAddress?: string;
}

let httpServer: http.Server | https.Server | null = null;
let wss: WebSocketServer | null = null;
let started = false;
// All connections currently open (whether or not they've declared an endpoint).
const connections: Set<ConnState> = new Set();
// Map from endpoint ID to its connection, used for outbound dispatch.
const endpointToConn: Map<string, ConnState> = new Map();

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

function setEndpointForConn(state: ConnState, endpointId: string): void {
  if (state.endpointId === endpointId) return;
  if (state.endpointId) {
    // Endpoint changed mid-stream — clear any previous mapping that still
    // points at this connection.
    if (endpointToConn.get(state.endpointId) === state)
      endpointToConn.delete(state.endpointId);
  }
  state.endpointId = endpointId;
  // If another connection already claims this endpoint, replace it. The new
  // connection wins — TR-369 agents that reconnect should always reach the
  // controller.
  const existing = endpointToConn.get(endpointId);
  if (existing && existing !== state) {
    logger.warn({
      message:
        "WebSocket bridge replacing existing connection for endpoint ID",
      endpointId,
    });
    try {
      existing.ws.close(1012, "Replaced by new connection");
    } catch {
      /* ignore */
    }
  }
  endpointToConn.set(endpointId, state);
}

function handleBinaryMessage(state: ConnState, bytes: Uint8Array): void {
  // First binary message: must establish the endpoint ID. Subsequent records
  // are forwarded as-is.
  if (!state.endpointId) {
    let decoded;
    try {
      decoded = decodeRecord(bytes);
    } catch (err) {
      logger.warn({
        message:
          "WebSocket bridge dropping first frame: not a parseable USP Record",
        remoteAddress: state.remoteAddress,
        exception: err as Error,
      });
      return;
    }
    const fromId = decoded.from_id;
    if (!fromId) {
      logger.warn({
        message:
          "WebSocket bridge dropping first frame: USP Record has empty from_id",
        remoteAddress: state.remoteAddress,
      });
      return;
    }
    setEndpointForConn(state, fromId);
    if (decoded.record_type?.case === "websocket_connect") {
      logger.info({
        message: "WebSocket bridge accepted WebSocketConnectRecord",
        endpointId: fromId,
        remoteAddress: state.remoteAddress,
      });
      // WebSocketConnectRecord carries no inner USP Msg payload — nothing to
      // forward to the controller. Just record the binding.
      return;
    }
    logger.warn({
      message:
        "WebSocket bridge: agent did not send WebSocketConnectRecord first; " +
        "binding endpoint ID from regular Record's from_id",
      endpointId: fromId,
      recordTypeCase: decoded.record_type?.case ?? "unknown",
      remoteAddress: state.remoteAddress,
    });
    // Fall through and forward this Record like any other.
  }

  const endpointId = state.endpointId;
  if (!endpointId) return; // unreachable but keeps TS happy
  const subject = fromMtpSubject("ws", endpointId);
  natsModule.publishPersistent(subject, bytes).catch((err) => {
    logger.error({
      message: "WS->NATS publish failed",
      subject,
      endpointId,
      exception: err as Error,
    });
  });
}

function attachConnection(ws: WebSocket, req: http.IncomingMessage): void {
  const remoteAddress =
    (req.socket && req.socket.remoteAddress) || undefined;
  const state: ConnState = { ws, remoteAddress };
  connections.add(state);

  logger.info({
    message: "WebSocket bridge connection opened",
    remoteAddress,
    subprotocol: ws.protocol || "(none)",
  });

  ws.on("message", (data, isBinary) => {
    // USP frames are required to be binary. Reject text frames per RFC 6455
    // / TR-369 §8.4.
    if (!isBinary) {
      logger.warn({
        message: "WebSocket bridge ignoring non-binary frame",
        endpointId: state.endpointId,
        remoteAddress,
      });
      return;
    }
    let bytes: Uint8Array;
    if (data instanceof Buffer) {
      bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else if (Array.isArray(data)) {
      // ws can deliver fragmented payloads as Buffer[]
      const total = data.reduce((n, b) => n + b.byteLength, 0);
      const joined = Buffer.concat(data, total);
      bytes = new Uint8Array(
        joined.buffer,
        joined.byteOffset,
        joined.byteLength,
      );
    } else if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else {
      bytes = new Uint8Array(Buffer.from(data as unknown as string));
    }
    try {
      handleBinaryMessage(state, bytes);
    } catch (err) {
      logger.error({
        message: "WebSocket bridge error handling binary message",
        endpointId: state.endpointId,
        remoteAddress,
        exception: err as Error,
      });
    }
  });

  ws.on("error", (err) => {
    logger.error({
      message: "WebSocket bridge connection error",
      endpointId: state.endpointId,
      remoteAddress,
      exception: err,
    });
  });

  ws.on("close", (code, reason) => {
    connections.delete(state);
    if (state.endpointId) {
      // Only clear the mapping if we still own it. A racing replace from
      // setEndpointForConn may already have pointed it at a new connection.
      if (endpointToConn.get(state.endpointId) === state)
        endpointToConn.delete(state.endpointId);
    }
    logger.info({
      message: "WebSocket bridge connection closed",
      endpointId: state.endpointId,
      remoteAddress,
      code,
      reason: reason?.toString?.() || "",
    });
  });
}

function makeHandleProtocols(subprotocol: string) {
  // ws's handleProtocols receives a Set<string> in modern versions. We
  // tolerate both Set and Array forms.
  return function handleProtocols(
    protocols: Set<string> | string[],
  ): string | false {
    const list: string[] = Array.isArray(protocols)
      ? protocols
      : Array.from(protocols);
    if (list.includes(subprotocol)) return subprotocol;
    logger.warn({
      message: "WebSocket bridge rejecting handshake: subprotocol mismatch",
      requested: list,
      expected: subprotocol,
    });
    return false;
  };
}

export async function start(opts: WsBridgeOptions): Promise<void> {
  if (started) return;
  started = true;

  logger.info({
    message: "WebSocket bridge starting",
    port: opts.port,
    host: opts.host,
    path: opts.path,
    subprotocol: opts.subprotocol,
    tls: !!(opts.sslCert && opts.sslKey),
  });

  // Create the HTTP(S) server first so the WebSocketServer can attach to it.
  if (opts.sslCert && opts.sslKey) {
    const cert = readFileIfSet(opts.sslCert);
    const key = readFileIfSet(opts.sslKey);
    httpServer = https.createServer({ cert, key });
  } else {
    httpServer = http.createServer();
  }

  // Reject non-WebSocket HTTP requests with a 426. This mirrors RFC 6455
  // guidance and keeps `curl` output sensible.
  httpServer.on("request", (req, res) => {
    res.writeHead(426, { "Content-Type": "text/plain", Upgrade: "websocket" });
    res.end("Upgrade Required\n");
  });

  wss = new WebSocketServer({
    server: httpServer,
    path: opts.path,
    handleProtocols: makeHandleProtocols(opts.subprotocol) as never,
  });

  wss.on("connection", (ws, req) => {
    attachConnection(ws, req);
  });

  wss.on("error", (err) => {
    logger.error({
      message: "WebSocket bridge server error",
      exception: err,
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      reject(err);
    };
    httpServer!.once("error", onError);
    httpServer!.listen(opts.port, opts.host, () => {
      httpServer!.off("error", onError);
      resolve();
    });
  });

  logger.info({
    message: "WebSocket bridge listening",
    port: opts.port,
    host: opts.host,
    path: opts.path,
  });

  // Subscribe (JetStream) to outgoing controller->MTP messages.
  const outSubject = fromControllerWildcard("ws");
  await natsModule.subscribeJetStream(
    outSubject,
    "usp-ws",
    "usp-ws",
    async (msg) => {
      try {
        const parsed = parseSubject(msg.subject);
        const endpointId = parsed?.endpointId;
        if (!endpointId) {
          logger.warn({
            message:
              "Dropping outgoing WS message: cannot parse endpoint ID",
            subject: msg.subject,
          });
          msg.ack();
          return;
        }
        const conn = endpointToConn.get(endpointId);
        if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
          // WebSocket sessions are tied to the worker that owns the live
          // socket. If we don't have one locally, the agent simply isn't
          // reachable through this worker — there's no point letting
          // JetStream redeliver to the same consumer group repeatedly, so
          // ack and drop. Cross-worker routing is documented as a known
          // limitation.
          logger.warn({
            message:
              "WebSocket bridge: no live connection for endpoint; dropping outgoing message",
            subject: msg.subject,
            endpointId,
          });
          msg.ack();
          return;
        }
        await new Promise<void>((resolve, reject) => {
          conn.ws.send(msg.data, { binary: true }, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        msg.ack();
      } catch (err) {
        logger.error({
          message: "NATS->WS dispatch failed",
          subject: msg.subject,
          exception: err as Error,
        });
        // Ack to avoid a redelivery loop on a structural failure.
        try {
          msg.ack();
        } catch {
          /* ignore */
        }
      }
    },
  );

  logger.info({
    message: "WebSocket bridge subscribed to NATS outgoing subject",
    subject: outSubject,
  });
}

export async function stop(): Promise<void> {
  if (!started) return;
  started = false;

  // Close all live WS connections first so clients get a clean Close frame.
  for (const state of connections) {
    try {
      state.ws.close(1001, "Server shutting down");
    } catch {
      /* ignore */
    }
  }
  connections.clear();
  endpointToConn.clear();

  if (wss) {
    await new Promise<void>((resolve) => {
      wss!.close(() => resolve());
    });
    wss = null;
  }
  if (httpServer) {
    await new Promise<void>((resolve) => {
      httpServer!.close(() => resolve());
    });
    httpServer = null;
  }
  logger.info({ message: "WebSocket bridge stopped" });
}

// Exposed for tests / introspection.
export function _getConnectionCount(): number {
  return connections.size;
}

export function _getEndpointCount(): number {
  return endpointToConn.size;
}
