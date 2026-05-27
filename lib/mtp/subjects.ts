import type { MtpKind } from "../usp/types.ts";

export const SUBJECT_PREFIX = "genieacs.usp.v1";

// Characters allowed to pass through encoding unchanged. NATS subject tokens
// must avoid '.', '*', '>', '+', whitespace, and other control characters. We
// also reserve ':' and '\' because they appear in real-world endpoint IDs and
// other deployment scenarios. '%' is reserved as the percent-encoding escape.
const SAFE_CHAR = /^[A-Za-z0-9\-_]$/;

/**
 * Encode an Endpoint ID into a single NATS-safe subject token.
 * Percent-encodes ':', '.', '*', '>', '+', any whitespace, and any non-ASCII
 * or otherwise unsafe characters. Allowed characters: A-Z, a-z, 0-9, '-', '_'.
 */
export function encodeEndpointId(endpointId: string): string {
  let out = "";
  // Use a TextEncoder so that multi-byte UTF-8 characters round-trip correctly.
  const bytes = new TextEncoder().encode(endpointId);
  for (const b of bytes) {
    const ch = String.fromCharCode(b);
    if (SAFE_CHAR.test(ch)) out += ch;
    else out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/**
 * Reverse of encodeEndpointId.
 */
export function decodeEndpointId(token: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === "%") {
      const hex = token.slice(i + 1, i + 3);
      if (!/^[0-9A-Fa-f]{2}$/.test(hex))
        throw new Error(`Invalid percent-encoding in subject token: ${token}`);
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(ch.charCodeAt(0));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

export function fromMtpSubject(mtp: MtpKind, endpointId: string): string {
  return `${SUBJECT_PREFIX}.from-mtp.${mtp}.${encodeEndpointId(endpointId)}`;
}

export function toMtpSubject(mtp: MtpKind, endpointId: string): string {
  return `${SUBJECT_PREFIX}.to-mtp.${mtp}.${encodeEndpointId(endpointId)}`;
}

export function connSubject(
  mtp: MtpKind,
  endpointId: string,
  state: "online" | "offline",
): string {
  return `${SUBJECT_PREFIX}.conn.${mtp}.${encodeEndpointId(endpointId)}.${state}`;
}

export function replySubject(msgId: string): string {
  return `${SUBJECT_PREFIX}.reply.${msgId}`;
}

export function notifySubject(endpointId: string): string {
  return `${SUBJECT_PREFIX}.notify.${encodeEndpointId(endpointId)}`;
}

export function endpointLookupSubject(endpointId: string): string {
  return `${SUBJECT_PREFIX}.endpoint-lookup.${encodeEndpointId(endpointId)}`;
}

/**
 * Wildcard for the controller to subscribe to all incoming MTP traffic.
 * Returns "genieacs.usp.v1.from-mtp.>"
 */
export function fromMtpWildcard(): string {
  return `${SUBJECT_PREFIX}.from-mtp.>`;
}

/**
 * Wildcard for an MTP service to subscribe to outgoing messages for its kind.
 * e.g. fromControllerWildcard("mqtt") -> "genieacs.usp.v1.to-mtp.mqtt.>"
 */
export function fromControllerWildcard(mtp: MtpKind): string {
  return `${SUBJECT_PREFIX}.to-mtp.${mtp}.>`;
}

export interface ParsedSubject {
  kind: "from-mtp" | "to-mtp" | "conn" | "reply" | "notify" | "endpoint-lookup";
  mtp?: MtpKind;
  endpointId?: string;
  msgId?: string;
  state?: "online" | "offline";
}

const VALID_MTPS = new Set<MtpKind>(["mqtt", "ws", "stomp"]);

function isMtpKind(value: string): value is MtpKind {
  return VALID_MTPS.has(value as MtpKind);
}

/**
 * Parse a subject back into its components. Returns null if the subject
 * doesn't match a known pattern.
 */
export function parseSubject(subject: string): ParsedSubject | null {
  const tokens = subject.split(".");
  // All known subjects start with "genieacs.usp.v1." (3 tokens of prefix).
  if (tokens.length < 4) return null;
  if (
    tokens[0] !== "genieacs" ||
    tokens[1] !== "usp" ||
    tokens[2] !== "v1"
  )
    return null;

  const kind = tokens[3];
  try {
    switch (kind) {
      case "from-mtp":
      case "to-mtp": {
        if (tokens.length !== 6) return null;
        const mtp = tokens[4];
        if (!isMtpKind(mtp)) return null;
        return {
          kind,
          mtp,
          endpointId: decodeEndpointId(tokens[5]),
        };
      }
      case "conn": {
        if (tokens.length !== 7) return null;
        const mtp = tokens[4];
        if (!isMtpKind(mtp)) return null;
        const state = tokens[6];
        if (state !== "online" && state !== "offline") return null;
        return {
          kind: "conn",
          mtp,
          endpointId: decodeEndpointId(tokens[5]),
          state,
        };
      }
      case "reply": {
        if (tokens.length !== 5) return null;
        return { kind: "reply", msgId: tokens[4] };
      }
      case "notify": {
        if (tokens.length !== 5) return null;
        return {
          kind: "notify",
          endpointId: decodeEndpointId(tokens[4]),
        };
      }
      case "endpoint-lookup": {
        if (tokens.length !== 5) return null;
        return {
          kind: "endpoint-lookup",
          endpointId: decodeEndpointId(tokens[4]),
        };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
