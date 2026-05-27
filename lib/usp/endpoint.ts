import type { EndpointIdParts } from "./types.ts";

const HEX6 = /^[0-9A-Fa-f]{6}$/;

/**
 * Parse a USP Endpoint ID into its parts.
 * Examples:
 *   "oui::000000-AB-1234"            -> {scheme:"oui", vendor:"000000", oui:"000000", serial:"AB-1234", raw}
 *   "os::ARRIS-12AB34-SN9876"        -> {scheme:"os", vendor:"ARRIS", oui:"12AB34", serial:"SN9876", raw}
 *   "imei::123456789012345"          -> {scheme:"imei", serial:"123456789012345", raw}
 *   "proto::vendor-oui-serial"       -> generic <scheme>::<vendor>-<oui>-<serial>
 * Throws on malformed input (missing "::" separator or empty serial).
 */
export function parseEndpointId(raw: string): EndpointIdParts {
  if (!raw) throw new Error("Endpoint ID is empty");

  const sep = raw.indexOf("::");
  if (sep < 0) throw new Error(`Endpoint ID missing "::" separator: ${raw}`);

  const scheme = raw.slice(0, sep);
  const rest = raw.slice(sep + 2);
  if (!scheme) throw new Error(`Endpoint ID has empty scheme: ${raw}`);
  if (!rest) throw new Error(`Endpoint ID has empty body: ${raw}`);

  // Schemes without structured dash-separated body (e.g. imei) or bodies that
  // don't contain a dash: the entire body is the serial.
  if (scheme === "imei" || !rest.includes("-")) {
    return { scheme, serial: rest, raw };
  }

  const segments = rest.split("-");

  if (scheme === "oui") {
    // The next 6 hex chars after "::" are the OUI. The vendor is the OUI for
    // this scheme; the remainder is the serial.
    const ouiCandidate = segments[0];
    if (HEX6.test(ouiCandidate) && segments.length >= 2) {
      return {
        scheme,
        vendor: ouiCandidate,
        oui: ouiCandidate,
        serial: segments.slice(1).join("-"),
        raw,
      };
    }
    // Malformed oui body: fall back to vendor=seg[0], serial=rest.
    return {
      scheme,
      vendor: segments[0],
      serial: segments.slice(1).join("-") || segments[0],
      raw,
    };
  }

  // For "os" and unknown schemes: treat as <vendor>-<oui-6hex>-<serial> if
  // there are at least 3 dash segments AND the middle segment is 6 hex chars;
  // otherwise vendor is segment 1, oui undefined, serial is the rest.
  if (segments.length >= 3 && HEX6.test(segments[1])) {
    return {
      scheme,
      vendor: segments[0],
      oui: segments[1],
      serial: segments.slice(2).join("-"),
      raw,
    };
  }

  return {
    scheme,
    vendor: segments[0],
    serial: segments.slice(1).join("-"),
    raw,
  };
}

/**
 * Convert an Endpoint ID into a Mongo-safe _id (no '::' or '/').
 * Replaces "::" with "-" and any subsequent "::" with "-" again, deterministic
 * and reversible enough for storage.
 */
export function endpointIdToDocId(raw: string): string {
  return raw.split("::").join("-").split("/").join("-");
}

/**
 * Given parsed parts, return a Mongo filter to find a matching CWMP device by
 * OUI+Serial. Returns null if reconciliation isn't possible (e.g., scheme is
 * "imei" or oui/serial missing). Filter format matches what GenieACS uses
 * elsewhere — fields are "DeviceID.OUI" and "DeviceID.SerialNumber".
 */
export function cwmpReconciliationFilter(
  parts: EndpointIdParts,
): Record<string, string> | null {
  if (!parts.oui || !parts.serial) return null;
  if (parts.scheme === "imei") return null;
  return {
    "DeviceID.OUI": parts.oui,
    "DeviceID.SerialNumber": parts.serial,
  };
}
