import test from "node:test";
import assert from "node:assert";
import {
  SUBJECT_PREFIX,
  encodeEndpointId,
  decodeEndpointId,
  fromMtpSubject,
  toMtpSubject,
  connSubject,
  replySubject,
  notifySubject,
  endpointLookupSubject,
  fromMtpWildcard,
  fromControllerWildcard,
  parseSubject,
} from "../lib/mtp/subjects.ts";

void test("encodeEndpointId round-trips canonical endpoint ID", () => {
  const id = "os::ARRIS-12AB34-SN9876";
  const encoded = encodeEndpointId(id);
  // None of the NATS-reserved separators must appear in the encoded token.
  assert.ok(!encoded.includes(":"), "encoded must not contain ':'");
  assert.ok(!encoded.includes("."), "encoded must not contain '.'");
  assert.ok(!encoded.includes("*"), "encoded must not contain '*'");
  assert.ok(!encoded.includes(">"), "encoded must not contain '>'");
  assert.ok(!encoded.includes("+"), "encoded must not contain '+'");
  assert.ok(!/\s/.test(encoded), "encoded must not contain whitespace");
  assert.strictEqual(decodeEndpointId(encoded), id);
});

void test("encodeEndpointId/decodeEndpointId round-trip adversarial inputs", () => {
  const cases = [
    "a:b.c*d>e+f",
    "  spaces  ",
    "unicode-é",
    "os::ARRIS-12AB34-SN9876",
    "trailing-dot.",
    ".leading-dot",
    "tab\tand\nnewline",
    "with%percent",
    "back\\slash",
    "all-safe_chars-123",
  ];
  for (const c of cases) {
    const enc = encodeEndpointId(c);
    assert.ok(!enc.includes("."), `encoded must not contain '.' for ${c}`);
    assert.ok(!enc.includes("*"), `encoded must not contain '*' for ${c}`);
    assert.ok(!enc.includes(">"), `encoded must not contain '>' for ${c}`);
    assert.ok(!enc.includes("+"), `encoded must not contain '+' for ${c}`);
    assert.ok(!enc.includes(":"), `encoded must not contain ':' for ${c}`);
    assert.ok(!/\s/.test(enc), `encoded must not contain whitespace for ${c}`);
    assert.strictEqual(decodeEndpointId(enc), c, `round-trip failed for ${c}`);
  }
});

void test("decodeEndpointId throws on invalid percent-escapes", () => {
  assert.throws(() => decodeEndpointId("bad%ZZescape"));
  assert.throws(() => decodeEndpointId("trailing%"));
});

void test("fromMtpSubject produces a NATS-safe subject", () => {
  const subject = fromMtpSubject("mqtt", "os::FOO-123456-XYZ");
  assert.ok(subject.startsWith("genieacs.usp.v1.from-mtp.mqtt."));
  const tokens = subject.split(".");
  assert.strictEqual(tokens.length, 6);
  const endpointToken = tokens[5];
  assert.ok(!endpointToken.includes(":"));
  assert.ok(!endpointToken.includes("."));
  assert.strictEqual(decodeEndpointId(endpointToken), "os::FOO-123456-XYZ");
});

void test("toMtpSubject round-trips through parseSubject", () => {
  const endpointId = "os::ARRIS-12AB34-SN9876";
  const subject = toMtpSubject("ws", endpointId);
  const parsed = parseSubject(subject);
  assert.deepStrictEqual(parsed, {
    kind: "to-mtp",
    mtp: "ws",
    endpointId,
  });
});

void test("fromMtpSubject round-trips through parseSubject", () => {
  const endpointId = "imei:359481234567890";
  const subject = fromMtpSubject("stomp", endpointId);
  const parsed = parseSubject(subject);
  assert.deepStrictEqual(parsed, {
    kind: "from-mtp",
    mtp: "stomp",
    endpointId,
  });
});

void test("connSubject round-trips for both states", () => {
  const endpointId = "os::ARRIS-12AB34-SN9876";
  for (const state of ["online", "offline"] as const) {
    const subject = connSubject("mqtt", endpointId, state);
    const parsed = parseSubject(subject);
    assert.deepStrictEqual(parsed, {
      kind: "conn",
      mtp: "mqtt",
      endpointId,
      state,
    });
  }
});

void test("replySubject round-trips through parseSubject", () => {
  const msgId = "deadbeefcafebabe";
  const subject = replySubject(msgId);
  assert.strictEqual(subject, `${SUBJECT_PREFIX}.reply.${msgId}`);
  const parsed = parseSubject(subject);
  assert.deepStrictEqual(parsed, { kind: "reply", msgId });
});

void test("notifySubject round-trips through parseSubject", () => {
  const endpointId = "os::ARRIS-12AB34-SN9876";
  const subject = notifySubject(endpointId);
  const parsed = parseSubject(subject);
  assert.deepStrictEqual(parsed, { kind: "notify", endpointId });
});

void test("endpointLookupSubject round-trips through parseSubject", () => {
  const endpointId = "oui:00256D::DEV-001";
  const subject = endpointLookupSubject(endpointId);
  const parsed = parseSubject(subject);
  assert.deepStrictEqual(parsed, { kind: "endpoint-lookup", endpointId });
});

void test("parseSubject returns null for unknown subjects", () => {
  assert.strictEqual(parseSubject("not.a.known.subject"), null);
  assert.strictEqual(parseSubject(""), null);
  assert.strictEqual(parseSubject("genieacs.usp.v1"), null);
  assert.strictEqual(parseSubject("genieacs.usp.v1.bogus.mqtt.token"), null);
  // Unknown MTP kind:
  assert.strictEqual(
    parseSubject("genieacs.usp.v1.from-mtp.coap.token"),
    null,
  );
  // Unknown conn state:
  assert.strictEqual(
    parseSubject("genieacs.usp.v1.conn.mqtt.token.unknown"),
    null,
  );
  // Wrong prefix:
  assert.strictEqual(
    parseSubject("acme.usp.v1.from-mtp.mqtt.token"),
    null,
  );
});

void test("fromMtpWildcard returns the expected literal", () => {
  assert.strictEqual(fromMtpWildcard(), "genieacs.usp.v1.from-mtp.>");
});

void test("fromControllerWildcard returns kind-scoped wildcard", () => {
  assert.strictEqual(
    fromControllerWildcard("mqtt"),
    "genieacs.usp.v1.to-mtp.mqtt.>",
  );
  assert.strictEqual(
    fromControllerWildcard("ws"),
    "genieacs.usp.v1.to-mtp.ws.>",
  );
  assert.strictEqual(
    fromControllerWildcard("stomp"),
    "genieacs.usp.v1.to-mtp.stomp.>",
  );
});
