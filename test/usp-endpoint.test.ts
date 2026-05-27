import test from "node:test";
import assert from "node:assert";
import {
  parseEndpointId,
  endpointIdToDocId,
  cwmpReconciliationFilter,
} from "../lib/usp/endpoint.ts";

void test("parseEndpointId: oui scheme", () => {
  const raw = "oui::000000-AB-1234";
  const parts = parseEndpointId(raw);
  assert.strictEqual(parts.scheme, "oui");
  assert.strictEqual(parts.vendor, "000000");
  assert.strictEqual(parts.oui, "000000");
  assert.strictEqual(parts.serial, "AB-1234");
  assert.strictEqual(parts.raw, raw);
});

void test("parseEndpointId: os scheme", () => {
  const raw = "os::ARRIS-12AB34-SN9876";
  const parts = parseEndpointId(raw);
  assert.strictEqual(parts.scheme, "os");
  assert.strictEqual(parts.vendor, "ARRIS");
  assert.strictEqual(parts.oui, "12AB34");
  assert.strictEqual(parts.serial, "SN9876");
  assert.strictEqual(parts.raw, raw);
});

void test("parseEndpointId: imei has no vendor/oui", () => {
  const raw = "imei::123456789012345";
  const parts = parseEndpointId(raw);
  assert.strictEqual(parts.scheme, "imei");
  assert.strictEqual(parts.vendor, undefined);
  assert.strictEqual(parts.oui, undefined);
  assert.strictEqual(parts.serial, "123456789012345");
  assert.strictEqual(parts.raw, raw);
});

void test("parseEndpointId: generic proto with non-hex middle segment", () => {
  // Middle segment "OUI" is not 6 hex chars, so oui is undefined and serial
  // gets the rest after vendor.
  const raw = "proto::vendor-OUI-serial-with-dashes";
  const parts = parseEndpointId(raw);
  assert.strictEqual(parts.scheme, "proto");
  assert.strictEqual(parts.vendor, "vendor");
  assert.strictEqual(parts.oui, undefined);
  assert.strictEqual(parts.serial, "OUI-serial-with-dashes");
  assert.strictEqual(parts.raw, raw);
});

void test("parseEndpointId: generic proto with hex middle segment picks oui", () => {
  const raw = "proto::vendor-ABCDEF-serial-with-dashes";
  const parts = parseEndpointId(raw);
  assert.strictEqual(parts.scheme, "proto");
  assert.strictEqual(parts.vendor, "vendor");
  assert.strictEqual(parts.oui, "ABCDEF");
  assert.strictEqual(parts.serial, "serial-with-dashes");
});

void test("parseEndpointId: multiple '::' uses the first as separator", () => {
  const raw = "os::ARRIS-12AB34-SN::EXTRA";
  const parts = parseEndpointId(raw);
  assert.strictEqual(parts.scheme, "os");
  assert.strictEqual(parts.vendor, "ARRIS");
  assert.strictEqual(parts.oui, "12AB34");
  assert.strictEqual(parts.serial, "SN::EXTRA");
});

void test("parseEndpointId: empty string throws", () => {
  assert.throws(() => parseEndpointId(""));
});

void test("parseEndpointId: missing '::' throws", () => {
  assert.throws(() => parseEndpointId("os-ARRIS-12AB34-SN9876"));
});

void test("parseEndpointId: only '::' with nothing after throws", () => {
  assert.throws(() => parseEndpointId("os::"));
});

void test("endpointIdToDocId replaces '::' with '-'", () => {
  assert.strictEqual(
    endpointIdToDocId("os::ARRIS-12AB34-SN9876"),
    "os-ARRIS-12AB34-SN9876",
  );
});

void test("endpointIdToDocId replaces every '::' occurrence", () => {
  assert.strictEqual(
    endpointIdToDocId("os::ARRIS-12AB34-SN::EXTRA"),
    "os-ARRIS-12AB34-SN-EXTRA",
  );
});

void test("endpointIdToDocId also strips '/'", () => {
  assert.strictEqual(
    endpointIdToDocId("os::ARRIS/12AB34-SN9876"),
    "os-ARRIS-12AB34-SN9876",
  );
});

void test("cwmpReconciliationFilter for oui-form Endpoint ID", () => {
  const parts = parseEndpointId("oui::000000-AB-1234");
  const filter = cwmpReconciliationFilter(parts);
  assert.deepStrictEqual(filter, {
    "DeviceID.OUI": "000000",
    "DeviceID.SerialNumber": "AB-1234",
  });
});

void test("cwmpReconciliationFilter for os-form Endpoint ID", () => {
  const parts = parseEndpointId("os::ARRIS-12AB34-SN9876");
  const filter = cwmpReconciliationFilter(parts);
  assert.deepStrictEqual(filter, {
    "DeviceID.OUI": "12AB34",
    "DeviceID.SerialNumber": "SN9876",
  });
});

void test("cwmpReconciliationFilter returns null for imei", () => {
  const parts = parseEndpointId("imei::123456789012345");
  assert.strictEqual(cwmpReconciliationFilter(parts), null);
});

void test("cwmpReconciliationFilter returns null when oui is missing", () => {
  const parts = parseEndpointId("proto::vendor-OUI-serial-with-dashes");
  assert.strictEqual(cwmpReconciliationFilter(parts), null);
});
