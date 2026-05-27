import type { MtpKind } from "../usp/types.ts";

export type { MtpKind };

// The contract every MTP bridge service implements.
// Each MTP service translates between its native transport and NATS.
export interface MtpBridge {
  readonly kind: MtpKind;
  start(): Promise<void>;
  stop(): Promise<void>;
}

// Headers passed alongside MTP messages on NATS.
export interface MtpMessageHeaders {
  mtp: MtpKind;
  receivedAt: string; // ISO-8601
  endpointId: string; // decoded (not subject-encoded) for convenience
  // mqtt-specific (when present)
  mqttResponseTopic?: string;
  mqttCorrelationData?: string;
  // ws-specific
  wsConnId?: string;
  wsWorkerId?: number;
  // stomp-specific
  stompReplyTo?: string;
}

// A queue-group name used by all workers of the same MTP service.
export type QueueGroup = "usp-controller" | "usp-mqtt" | "usp-ws" | "usp-stomp";

// Connectivity event payload.
export interface ConnEvent {
  mtp: MtpKind;
  endpointId: string;
  state: "online" | "offline";
  ts: string; // ISO-8601
}
