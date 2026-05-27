export type MtpKind = "mqtt" | "ws" | "stomp";

export interface UspMtpState {
  connected: boolean;
  lastSeen: Date;
  // mqtt-specific
  agentTopic?: string;
  controllerTopic?: string;
  // ws-specific
  workerId?: number;
  connId?: string;
  remoteAddress?: string;
  // stomp-specific
  destination?: string;
}

export interface EndpointIdParts {
  scheme: string; // "oui", "os", "imei", etc.
  vendor?: string; // present for oui/os
  oui?: string; // 6-hex-char OUI when derivable
  serial: string; // the trailing serial number
  raw: string; // the full original string
}

export interface UspDeviceSubdoc {
  endpointId: string;
  endpointParts: EndpointIdParts;
  supportedMtps: MtpKind[];
  preferredMtp?: MtpKind;
  mqtt?: UspMtpState;
  ws?: UspMtpState;
  stomp?: UspMtpState;
  lastNotify?: { type: string; ts: Date; refList?: string };
  subscriptionIds?: Record<string, string>;
}

// MVP msg types — subset of USP v1.3 Msg.Header.MsgType enum
export type UspMsgType =
  | "GET"
  | "GET_RESP"
  | "SET"
  | "SET_RESP"
  | "ADD"
  | "ADD_RESP"
  | "DELETE"
  | "DELETE_RESP"
  | "OPERATE"
  | "OPERATE_RESP"
  | "NOTIFY"
  | "NOTIFY_RESP"
  | "GET_INSTANCES"
  | "GET_INSTANCES_RESP"
  | "GET_SUPPORTED_DM"
  | "GET_SUPPORTED_DM_RESP"
  | "ERROR";
