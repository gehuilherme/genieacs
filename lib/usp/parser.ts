import { randomBytes } from "node:crypto";
import {
  RecordType,
  NoSessionContextRecordType,
  MsgType,
  HeaderType,
  BodyType,
  RequestType,
  ResponseType,
  NotifyType,
  GetType,
  GetRespType,
  SetType,
  SetRespType,
  AddType,
  AddRespType,
  DeleteType,
  DeleteRespType,
  OperateType,
  OperateRespType,
  GetInstancesType,
  GetInstancesRespType,
  GetSupportedDMType,
  GetSupportedDMRespType,
  ErrorType,
  HeaderMsgType,
} from "./proto/index.ts";

export interface DecodedRecord {
  version: string;
  to_id: string;
  from_id: string;
  payload_security: string;
  record_type:
    | { case: "no_session_context"; payload: Uint8Array }
    | { case: "session_context"; raw: object }
    | { case: "websocket_connect" }
    | { case: "mqtt_connect"; subscribed_topic: string }
    | { case: "stomp_connect"; subscribed_destination: string }
    | { case: "disconnect"; raw: object }
    | { case: "uds_connect" }
    | null;
}

export interface DecodedMsg {
  msg_id: string;
  msg_type: string;
  body: {
    request?: object;
    response?: object;
    error?: object;
  };
}

export function decodeRecord(bytes: Uint8Array): DecodedRecord {
  const record = RecordType.decode(bytes) as unknown as Record<string, unknown>;
  const obj = RecordType.toObject(
    record as unknown as protobuf.Message,
    {
      bytes: Array,
      enums: String,
      longs: String,
      defaults: false,
      arrays: true,
      objects: true,
    },
  ) as Record<string, unknown>;

  let record_type: DecodedRecord["record_type"] = null;
  if (obj.no_session_context) {
    const payload = (obj.no_session_context as { payload?: Uint8Array }).payload;
    record_type = {
      case: "no_session_context",
      payload: payload ?? new Uint8Array(),
    };
  } else if (obj.session_context) {
    record_type = { case: "session_context", raw: obj.session_context as object };
  } else if (obj.websocket_connect) {
    record_type = { case: "websocket_connect" };
  } else if (obj.mqtt_connect) {
    const m = obj.mqtt_connect as { subscribed_topic?: string };
    record_type = {
      case: "mqtt_connect",
      subscribed_topic: m.subscribed_topic ?? "",
    };
  } else if (obj.stomp_connect) {
    const m = obj.stomp_connect as { subscribed_destination?: string };
    record_type = {
      case: "stomp_connect",
      subscribed_destination: m.subscribed_destination ?? "",
    };
  } else if (obj.disconnect) {
    record_type = { case: "disconnect", raw: obj.disconnect as object };
  } else if (obj.uds_connect) {
    record_type = { case: "uds_connect" };
  }

  return {
    version: (obj.version as string) ?? "",
    to_id: (obj.to_id as string) ?? "",
    from_id: (obj.from_id as string) ?? "",
    payload_security: (obj.payload_security as string) ?? "PLAINTEXT",
    record_type,
  };
}

export function encodeNoSessionContextRecord(
  fromId: string,
  toId: string,
  innerMsgBytes: Uint8Array,
): Uint8Array {
  const noSession = NoSessionContextRecordType.create({ payload: innerMsgBytes });
  const record = RecordType.create({
    version: "1.3",
    to_id: toId,
    from_id: fromId,
    payload_security: 0,
    no_session_context: noSession,
  });
  return RecordType.encode(record).finish();
}

export function decodeMsg(bytes: Uint8Array): DecodedMsg {
  const msg = MsgType.decode(bytes);
  const obj = MsgType.toObject(msg, {
    bytes: Array,
    enums: String,
    longs: String,
    defaults: false,
    arrays: true,
    objects: true,
  }) as { header?: { msg_id?: string; msg_type?: string }; body?: DecodedMsg["body"] };
  return {
    msg_id: obj.header?.msg_id ?? "",
    msg_type: obj.header?.msg_type ?? "ERROR",
    body: obj.body ?? {},
  };
}

export function encodeMsg(
  msgId: string,
  msgTypeName: string,
  body: Record<string, unknown>,
): Uint8Array {
  const typeValue = HeaderMsgType[msgTypeName];
  if (typeValue === undefined)
    throw new Error(`Unknown USP msg_type: ${msgTypeName}`);

  const header = HeaderType.create({ msg_id: msgId, msg_type: typeValue });
  const msgBody = BodyType.create(body);
  const msg = MsgType.create({ header, body: msgBody });
  return MsgType.encode(msg).finish();
}

export function newMsgId(): string {
  return randomBytes(8).toString("hex");
}

// Build a Get request body
export function buildGetBody(paramPaths: string[]): Record<string, unknown> {
  const get = GetType.create({ param_paths: paramPaths });
  const request = RequestType.create({ get });
  return { request };
}

// Build a Set request body
export interface SetParam {
  param: string;
  value: string;
  required?: boolean;
}
export function buildSetBody(
  objPath: string,
  params: SetParam[],
): Record<string, unknown> {
  const set = SetType.create({
    update_objs: [
      {
        obj_path: objPath,
        param_settings: params.map((p) => ({
          param: p.param,
          value: p.value,
          required: p.required ?? true,
        })),
      },
    ],
    allow_partial: false,
  });
  const request = RequestType.create({ set });
  return { request };
}

// Build an Operate request body
export function buildOperateBody(
  command: string,
  inputArgs?: Record<string, string>,
): Record<string, unknown> {
  const operate = OperateType.create({
    command,
    command_key: "",
    send_resp: true,
    input_args: inputArgs ?? {},
  });
  const request = RequestType.create({ operate });
  return { request };
}

// Build an Add request body
export function buildAddBody(
  objPath: string,
  paramSettings: SetParam[],
): Record<string, unknown> {
  const add = AddType.create({
    create_objs: [
      {
        obj_path: objPath,
        param_settings: paramSettings.map((p) => ({
          param: p.param,
          value: p.value,
          required: p.required ?? true,
        })),
      },
    ],
    allow_partial: false,
  });
  const request = RequestType.create({ add });
  return { request };
}

// Build a Delete request body
export function buildDeleteBody(objPaths: string[]): Record<string, unknown> {
  const del = DeleteType.create({ obj_paths: objPaths, allow_partial: false });
  const request = RequestType.create({ delete: del });
  return { request };
}

// Build a GetInstances request body
export function buildGetInstancesBody(
  objPaths: string[],
  firstLevelOnly = false,
): Record<string, unknown> {
  const gi = GetInstancesType.create({
    obj_paths: objPaths,
    first_level_only: firstLevelOnly,
  });
  const request = RequestType.create({ get_instances: gi });
  return { request };
}

// Build a GetSupportedDM request body
export function buildGetSupportedDMBody(
  objPaths: string[],
  firstLevelOnly = false,
  returnCommands = true,
  returnEvents = true,
  returnParams = true,
): Record<string, unknown> {
  const gsdm = GetSupportedDMType.create({
    obj_paths: objPaths,
    first_level_only: firstLevelOnly,
    return_commands: returnCommands,
    return_events: returnEvents,
    return_params: returnParams,
  });
  const request = RequestType.create({ get_supported_dm: gsdm });
  return { request };
}

// Silence unused warnings for response types — they're exported so external
// consumers can decode/inspect responses if needed.
void GetRespType;
void SetRespType;
void AddRespType;
void DeleteRespType;
void OperateRespType;
void GetInstancesRespType;
void GetSupportedDMRespType;
void NotifyType;
void ErrorType;
void ResponseType;
