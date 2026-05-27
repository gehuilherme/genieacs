export const VALID_PARAM_TYPES = new Set([
  "xsd:int",
  "xsd:unsignedInt",
  "xsd:boolean",
  "xsd:string",
  "xsd:dateTime",
  "xsd:base64",
  "xsd:hexBinary",
]);

export function parseBool(v: string): boolean | null {
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return null;
}

export interface CoerceResult {
  value: string | number | boolean;
  ok: boolean;
}

export function coerce(value: string, valueType: string): CoerceResult {
  if (valueType === "xsd:boolean") {
    const parsed = parseBool(value);
    if (parsed == null) return { value, ok: false };
    return { value: parsed, ok: true };
  }
  if (valueType === "xsd:int" || valueType === "xsd:unsignedInt") {
    const parsed = parseInt(value);
    if (isNaN(parsed)) return { value, ok: false };
    return { value: parsed, ok: true };
  }
  if (valueType === "xsd:dateTime") {
    const parsed = Date.parse(value);
    if (isNaN(parsed)) return { value, ok: false };
    return { value: parsed, ok: true };
  }
  return { value, ok: true };
}
