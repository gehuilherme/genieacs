import * as db from "../db/db.ts";
import * as logger from "../logger.ts";

/**
 * Convert a fully-qualified parameter path (e.g. "Device.DeviceInfo.Manufacturer")
 * into the Mongo dot-notation update fragments that GenieACS's nested-doc
 * convention requires:
 *   <leaf>._value, <leaf>._type, <leaf>._timestamp, plus optional <leaf>._writable
 * plus parent `_object: true` markers for every intermediate segment.
 *
 * If `writable` is undefined, we DO NOT touch `_writable` — preserves a value
 * previously written by GetSupportedDM. Pass an explicit boolean to overwrite.
 *
 * Mutates the supplied `set` map.
 */
export function pathToSet(
  set: Record<string, unknown>,
  path: string,
  value: unknown,
  type: string | undefined,
  ts: Date,
  writable?: boolean,
): void {
  const segments = path.split(".").filter((s) => s.length > 0);
  if (segments.length === 0) return;

  // Parent object markers
  for (let i = 1; i < segments.length; i++) {
    const objPath = segments.slice(0, i).join(".");
    set[`${objPath}._object`] = true;
    set[`${objPath}._timestamp`] = ts;
  }

  const leaf = segments.join(".");
  set[`${leaf}._value`] = value;
  set[`${leaf}._timestamp`] = ts;
  if (type !== undefined) set[`${leaf}._type`] = type;
  if (writable !== undefined) set[`${leaf}._writable`] = writable;
}

interface ResolvedPathResult {
  resolved_path?: string;
  result_params?: Record<string, string>;
}
interface ReqPathResult {
  requested_path?: string;
  err_code?: number;
  err_msg?: string;
  resolved_path_results?: ResolvedPathResult[];
}
interface GetRespBody {
  req_path_results?: ReqPathResult[];
}

/**
 * Persist the contents of a USP GetResp into the device's Mongo doc.
 * Each (resolved_path, param_name) pair becomes a single Mongo dot-notation
 * write; intermediate object markers are added so flattenDevice() exposes
 * the new params and the UI's data-model tree renders them.
 */
export async function persistGetResp(
  endpointId: string,
  getResp: GetRespBody,
  ts: Date = new Date(),
): Promise<number> {
  const set: Record<string, unknown> = {};
  let paramCount = 0;
  let errorCount = 0;

  for (const req of getResp.req_path_results ?? []) {
    if (req.err_code && req.err_code !== 0) {
      errorCount++;
      logger.warn({
        message: "USP GetResp req_path error",
        requested_path: req.requested_path,
        err_code: req.err_code,
        err_msg: req.err_msg,
      });
      continue;
    }
    for (const res of req.resolved_path_results ?? []) {
      const base = (res.resolved_path ?? "").replace(/\.$/, "");
      for (const [paramName, paramValue] of Object.entries(
        res.result_params ?? {},
      )) {
        // USP Get returns values as strings. Type + writability come from
        // GetSupportedDM (different RPC). We pass `undefined` for both so
        // schema-cached values from a prior/concurrent GetSupportedDM persist
        // survive; the UI falls back to displaying the raw string value when
        // _type is missing.
        const fullPath = base ? `${base}.${paramName}` : paramName;
        pathToSet(set, fullPath, paramValue, undefined, ts);
        paramCount++;
      }
    }
  }

  if (paramCount === 0) {
    logger.info({
      message: "USP GetResp had no params to persist",
      endpointId,
      errorCount,
    });
    return 0;
  }

  await db.collections.devices.updateOne(
    { "_usp.endpointId": endpointId } as never,
    { $set: set } as never,
  );

  logger.info({
    message: "USP GetResp persisted",
    endpointId,
    paramCount,
    errorCount,
  });
  return paramCount;
}

interface ObjectResult {
  obj_path?: string;
  err_code?: number;
  err_msg?: string;
  unique_keys?: Record<string, string>;
}
interface InstanceReqPathResult {
  requested_path?: string;
  err_code?: number;
  err_msg?: string;
  curr_insts?: ObjectResult[];
}
interface GetInstancesRespBody {
  req_path_results?: InstanceReqPathResult[];
}

// USP ParamValueType (proto enum) -> xsd:* string. Used by GetSupportedDM persist.
const PARAM_TYPE_TO_XSD: Record<string, string> = {
  PARAM_BASE_64: "xsd:base64",
  PARAM_BOOLEAN: "xsd:boolean",
  PARAM_DATE_TIME: "xsd:dateTime",
  PARAM_DECIMAL: "xsd:decimal",
  PARAM_HEX_BINARY: "xsd:hexBinary",
  PARAM_INT: "xsd:int",
  PARAM_LONG: "xsd:long",
  PARAM_STRING: "xsd:string",
  PARAM_UNSIGNED_INT: "xsd:unsignedInt",
  PARAM_UNSIGNED_LONG: "xsd:unsignedLong",
};

interface SupportedParamResult {
  param_name?: string;
  access?: string; // "PARAM_READ_ONLY" | "PARAM_READ_WRITE" | "PARAM_WRITE_ONLY"
  value_type?: string;
}
interface SupportedObjectResult {
  supported_obj_path?: string;
  access?: string; // "OBJ_READ_ONLY" | "OBJ_ADD_DELETE" | "OBJ_ADD_ONLY" | "OBJ_DELETE_ONLY"
  is_multi_instance?: boolean;
  supported_params?: SupportedParamResult[];
}
interface ReqObjectResult {
  req_obj_path?: string;
  err_code?: number;
  err_msg?: string;
  supported_objs?: SupportedObjectResult[];
}
interface GetSupportedDMRespBody {
  req_obj_results?: ReqObjectResult[];
}

/**
 * Walk the device doc's nested tree to find every numeric instance path
 * matching the supplied template (e.g. `Device.WiFi.SSID.{i}`). Returns the
 * concrete instance paths actually present in the document.
 */
function findInstancePaths(
  device: Record<string, unknown>,
  templatePath: string,
): string[] {
  const segments = templatePath.split(".").filter(Boolean);
  let current: Record<string, unknown>[] = [{ __root: device, __path: "" } as never];

  for (const seg of segments) {
    const next: Record<string, unknown>[] = [];
    for (const node of current) {
      const tree = (node as { __root: Record<string, unknown> }).__root;
      const path = (node as { __path: string }).__path;
      if (!tree || typeof tree !== "object") continue;
      if (seg === "{i}") {
        for (const [k, v] of Object.entries(tree)) {
          if (/^\d+$/.test(k)) {
            next.push({
              __root: v as Record<string, unknown>,
              __path: path ? `${path}.${k}` : k,
            } as never);
          }
        }
      } else {
        const child = tree[seg];
        if (child !== undefined) {
          next.push({
            __root: child as Record<string, unknown>,
            __path: path ? `${path}.${seg}` : seg,
          } as never);
        }
      }
    }
    current = next;
    if (current.length === 0) return [];
  }
  return current.map((n) => (n as { __path: string }).__path);
}

/**
 * Persist the schema returned by a USP GetSupportedDM response: for every
 * supported param, set its `_writable` (true iff access is READ_WRITE or
 * WRITE_ONLY) and `_type` (mapped from USP ParamValueType to xsd:*). For
 * every supported object, set `_writable` (true if it accepts add/delete)
 * and the `_object: true` marker. Doesn't carry values — pair this with
 * a GetResp persist for the same path to populate the tree.
 *
 * Multi-instance schema (paths containing `{i}`) is expanded against every
 * concrete instance present in the device document, so writability/type
 * propagates to e.g. `Device.WiFi.SSID.1.SSID` and `.2.SSID` alike.
 */
export async function persistGetSupportedDMResp(
  endpointId: string,
  resp: GetSupportedDMRespBody,
  ts: Date = new Date(),
): Promise<number> {
  // Read the current device so we can expand {i} placeholders to real instance
  // numbers (Mongo can't substitute placeholders in dot-notation $set keys).
  const device = await db.collections.devices.findOne(
    { "_usp.endpointId": endpointId } as never,
  );
  if (!device) {
    logger.warn({
      message: "USP GetSupportedDMResp: device not found",
      endpointId,
    });
    return 0;
  }

  const set: Record<string, unknown> = {};
  let writeCount = 0;
  let errorCount = 0;

  // Helper that emits one schema entry (or many, if the template contains {i}).
  const emit = (
    templatePath: string,
    fields: { _writable?: boolean; _type?: string; _object?: boolean },
  ): number => {
    const cleanTemplate = templatePath.replace(/\.$/, "");
    const concretePaths = cleanTemplate.includes("{i}")
      ? findInstancePaths(device as Record<string, unknown>, cleanTemplate)
      : [cleanTemplate];
    let added = 0;
    for (const p of concretePaths) {
      // Ensure parent _object markers
      const segs = p.split(".").filter(Boolean);
      for (let i = 1; i < segs.length; i++) {
        const ancestor = segs.slice(0, i).join(".");
        if (set[`${ancestor}._object`] === undefined) {
          set[`${ancestor}._object`] = true;
          set[`${ancestor}._timestamp`] = ts;
        }
      }
      if (fields._object !== undefined) {
        set[`${p}._object`] = fields._object;
        set[`${p}._timestamp`] = ts;
      }
      if (fields._writable !== undefined) set[`${p}._writable`] = fields._writable;
      if (fields._type !== undefined) set[`${p}._type`] = fields._type;
      added++;
    }
    return added;
  };

  for (const req of resp.req_obj_results ?? []) {
    if (req.err_code && req.err_code !== 0) {
      errorCount++;
      logger.warn({
        message: "USP GetSupportedDMResp req_obj error",
        req_obj_path: req.req_obj_path,
        err_code: req.err_code,
        err_msg: req.err_msg,
      });
      continue;
    }
    for (const obj of req.supported_objs ?? []) {
      const objTemplate = (obj.supported_obj_path ?? "").replace(/\.$/, "");
      if (!objTemplate) continue;

      const objWritable =
        obj.access === "OBJ_ADD_DELETE" ||
        obj.access === "OBJ_ADD_ONLY" ||
        obj.access === "OBJ_DELETE_ONLY";

      // Emit the object marker itself
      emit(objTemplate, { _object: true, _writable: objWritable });

      for (const param of obj.supported_params ?? []) {
        if (!param.param_name) continue;
        const writable =
          param.access === "PARAM_READ_WRITE" ||
          param.access === "PARAM_WRITE_ONLY";
        const xsdType = PARAM_TYPE_TO_XSD[param.value_type ?? ""] ?? "xsd:string";
        writeCount += emit(`${objTemplate}.${param.param_name}`, {
          _writable: writable,
          _type: xsdType,
        });
      }
    }
  }

  if (writeCount === 0) {
    logger.info({
      message: "USP GetSupportedDMResp had no params to persist",
      endpointId,
      errorCount,
    });
    return 0;
  }

  // Also flag the device so ensureSchemaLoaded() knows a real schema fetch
  // has succeeded (vs. the partial _writable: false seeded by notify.ts).
  set["_usp.schemaLoadedAt"] = ts;

  await db.collections.devices.updateOne(
    { "_usp.endpointId": endpointId } as never,
    { $set: set } as never,
  );

  logger.info({
    message: "USP GetSupportedDMResp persisted",
    endpointId,
    paramCount: writeCount,
    errorCount,
  });
  return writeCount;
}

/**
 * Persist the contents of a USP GetInstancesResp: writes _object markers for
 * each instantiated object path. Doesn't carry values — only structure.
 */
export async function persistGetInstancesResp(
  endpointId: string,
  resp: GetInstancesRespBody,
  ts: Date = new Date(),
): Promise<number> {
  const set: Record<string, unknown> = {};
  let count = 0;

  for (const req of resp.req_path_results ?? []) {
    if (req.err_code && req.err_code !== 0) continue;
    for (const inst of req.curr_insts ?? []) {
      const objPath = (inst.obj_path ?? "").replace(/\.$/, "");
      if (!objPath) continue;
      const segments = objPath.split(".").filter(Boolean);
      for (let i = 1; i <= segments.length; i++) {
        const p = segments.slice(0, i).join(".");
        set[`${p}._object`] = true;
        set[`${p}._timestamp`] = ts;
      }
      // Persist unique keys as values under the instance path
      for (const [k, v] of Object.entries(inst.unique_keys ?? {})) {
        pathToSet(set, `${objPath}.${k}`, v, "xsd:string", ts, false);
      }
      count++;
    }
  }

  if (count === 0) return 0;

  await db.collections.devices.updateOne(
    { "_usp.endpointId": endpointId } as never,
    { $set: set } as never,
  );
  logger.info({
    message: "USP GetInstancesResp persisted",
    endpointId,
    instances: count,
  });
  return count;
}
