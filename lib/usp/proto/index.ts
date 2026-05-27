import * as protobuf from "protobufjs";
import uspMsgSchema from "../../../proto/usp/usp-msg-1-3.proto";
import uspRecordSchema from "../../../proto/usp/usp-record-1-3.proto";

const root = new protobuf.Root();
protobuf.parse(uspMsgSchema, root, { keepCase: true });
protobuf.parse(uspRecordSchema, root, { keepCase: true });
root.resolveAll();

export const RecordType = root.lookupType("usp_record.Record");
export const NoSessionContextRecordType = root.lookupType(
  "usp_record.NoSessionContextRecord",
);
export const SessionContextRecordType = root.lookupType(
  "usp_record.SessionContextRecord",
);
export const WebSocketConnectRecordType = root.lookupType(
  "usp_record.WebSocketConnectRecord",
);
export const MQTTConnectRecordType = root.lookupType(
  "usp_record.MQTTConnectRecord",
);
export const STOMPConnectRecordType = root.lookupType(
  "usp_record.STOMPConnectRecord",
);
export const DisconnectRecordType = root.lookupType(
  "usp_record.DisconnectRecord",
);

export const MsgType = root.lookupType("usp.Msg");
export const HeaderType = root.lookupType("usp.Header");
export const BodyType = root.lookupType("usp.Body");
export const RequestType = root.lookupType("usp.Request");
export const ResponseType = root.lookupType("usp.Response");
export const ErrorType = root.lookupType("usp.Error");

export const GetType = root.lookupType("usp.Get");
export const GetRespType = root.lookupType("usp.GetResp");
export const SetType = root.lookupType("usp.Set");
export const SetRespType = root.lookupType("usp.SetResp");
export const AddType = root.lookupType("usp.Add");
export const AddRespType = root.lookupType("usp.AddResp");
export const DeleteType = root.lookupType("usp.Delete");
export const DeleteRespType = root.lookupType("usp.DeleteResp");
export const OperateType = root.lookupType("usp.Operate");
export const OperateRespType = root.lookupType("usp.OperateResp");
export const NotifyType = root.lookupType("usp.Notify");
export const NotifyRespType = root.lookupType("usp.NotifyResp");
export const GetInstancesType = root.lookupType("usp.GetInstances");
export const GetInstancesRespType = root.lookupType("usp.GetInstancesResp");
export const GetSupportedDMType = root.lookupType("usp.GetSupportedDM");
export const GetSupportedDMRespType = root.lookupType("usp.GetSupportedDMResp");

const MsgTypeEnum = root.lookupEnum("usp.Header.MsgType").values;

export const HeaderMsgType = MsgTypeEnum as Record<string, number>;

export { root };
