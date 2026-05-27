import {
  encodeMsg,
  encodeNoSessionContextRecord,
  newMsgId,
  buildGetBody,
  buildSetBody,
  buildOperateBody,
  buildAddBody,
  buildDeleteBody,
  buildGetInstancesBody,
  buildGetSupportedDMBody,
  SetParam,
} from "./parser.ts";
import type { Task } from "../db/types.ts";

export interface UspRpcRequest {
  msgId: string;
  msgType: string;
  recordBytes: Uint8Array;
}

const CONTROLLER_ID = "genieacs::usp-controller";

/**
 * For tasks that fetch values from the agent (refreshObject /
 * getParameterValues), emit a companion USP GetSupportedDM request so the
 * controller learns the data model schema (writability + xsd types) for the
 * paths in question. This information is what makes the UI's edit controls
 * activate for writable params.
 *
 * Returns null when the task type doesn't benefit from a schema fetch.
 */
export function taskToSchemaRpc(
  task: Task,
  endpointId: string,
): UspRpcRequest | null {
  let objPaths: string[];
  if (task.name === "refreshObject") {
    const p = task.objectName.endsWith(".")
      ? task.objectName
      : `${task.objectName}.`;
    objPaths = [p];
  } else if (task.name === "getParameterValues") {
    // Group the parameter paths by their containing object path
    const objs = new Set<string>();
    for (const p of task.parameterNames ?? []) {
      const lastDot = p.lastIndexOf(".");
      if (lastDot === -1) continue;
      objs.add(p.slice(0, lastDot + 1));
    }
    objPaths = [...objs];
  } else {
    return null;
  }
  if (objPaths.length === 0) return null;

  const msgId = newMsgId();
  const body = buildGetSupportedDMBody(objPaths, false, true, true, true);
  const msgBytes = encodeMsg(msgId, "GET_SUPPORTED_DM", body);
  const recordBytes = encodeNoSessionContextRecord(
    CONTROLLER_ID,
    endpointId,
    msgBytes,
  );
  return { msgId, msgType: "GET_SUPPORTED_DM", recordBytes };
}

export function taskToRpc(task: Task, endpointId: string): UspRpcRequest {
  const msgId = newMsgId();
  let body: Record<string, unknown>;
  let msgType: string;

  switch (task.name) {
    case "getParameterValues": {
      body = buildGetBody(task.parameterNames ?? []);
      msgType = "GET";
      break;
    }
    case "setParameterValues": {
      // Group params by their obj_path (everything up to the last '.')
      const groups = new Map<string, SetParam[]>();
      for (const [path, value] of task.parameterValues ?? []) {
        const lastDot = path.lastIndexOf(".");
        if (lastDot === -1) continue;
        const objPath = path.slice(0, lastDot + 1); // include trailing '.'
        const param = path.slice(lastDot + 1);
        if (!groups.has(objPath)) groups.set(objPath, []);
        groups.get(objPath)!.push({
          param,
          value: typeof value === "string" ? value : String(value),
          required: true,
        });
      }
      // For MVP: emit one Set with the first group. Multi-group Set is a future enhancement.
      const first = groups.entries().next();
      if (first.done) {
        body = buildSetBody("Device.", []);
      } else {
        const [objPath, params] = first.value as [string, SetParam[]];
        body = buildSetBody(objPath, params);
      }
      msgType = "SET";
      break;
    }
    case "refreshObject": {
      // GenieACS's refreshObject is "fetch all params under this object". USP
      // Get with a trailing-dot search path returns every param recursively in
      // a single round-trip — much more useful than GetInstances (which only
      // returns instance numbers without values).
      const objPath = task.objectName.endsWith(".")
        ? task.objectName
        : `${task.objectName}.`;
      body = buildGetBody([objPath]);
      msgType = "GET";
      break;
    }
    case "reboot": {
      body = buildOperateBody("Device.Reboot()");
      msgType = "OPERATE";
      break;
    }
    case "factoryReset": {
      body = buildOperateBody("Device.FactoryReset()");
      msgType = "OPERATE";
      break;
    }
    case "download": {
      const inputArgs: Record<string, string> = {
        FileType: task.fileType,
        URL: task.fileName,
      };
      if (task.targetFileName) inputArgs.TargetFileName = task.targetFileName;
      body = buildOperateBody(
        "Device.LocalAgent.Controller.1.Download()",
        inputArgs,
      );
      msgType = "OPERATE";
      break;
    }
    case "addObject": {
      const params: SetParam[] = (task.parameterValues ?? []).map(([p, v]) => ({
        param: p,
        value: typeof v === "string" ? v : String(v),
        required: true,
      }));
      body = buildAddBody(task.objectName, params);
      msgType = "ADD";
      break;
    }
    case "deleteObject": {
      body = buildDeleteBody([task.objectName]);
      msgType = "DELETE";
      break;
    }
    case "operate": {
      body = buildOperateBody(task.command, task.inputArgs);
      msgType = "OPERATE";
      break;
    }
    case "addSubscription": {
      const params: SetParam[] = [
        { param: "Enable", value: "true" },
        { param: "NotifType", value: task.notificationType },
        { param: "ReferenceList", value: task.referenceList.join(",") },
        { param: "Persistent", value: task.persistent ? "true" : "false" },
      ];
      body = buildAddBody("Device.LocalAgent.Subscription.", params);
      msgType = "ADD";
      break;
    }
    case "removeSubscription": {
      body = buildDeleteBody([
        `Device.LocalAgent.Subscription.${task.subscriptionId}.`,
      ]);
      msgType = "DELETE";
      break;
    }
    case "provisions": {
      throw new Error("USP devices do not support 'provisions' tasks directly");
    }
    default: {
      const _exhaustive: never = task as never;
      throw new Error(`Unhandled task type: ${JSON.stringify(_exhaustive)}`);
    }
  }

  const msgBytes = encodeMsg(msgId, msgType, body);
  const recordBytes = encodeNoSessionContextRecord(
    CONTROLLER_ID,
    endpointId,
    msgBytes,
  );

  return { msgId, msgType, recordBytes };
}
