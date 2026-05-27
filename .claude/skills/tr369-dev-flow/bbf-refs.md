# BBF / TR-369 references

Pointers to the relevant parts of the TR-369 specification (Broadband Forum).
The actual PDFs aren't redistributable — fetch from
https://www.broadband-forum.org/ if needed.

## Spec versions

- **TR-369 Issue 1 Amendment 2 (v1.3)** — what we implement. Proto files in
  `proto/usp/` come from this version.
- **TR-369 Issue 1 Amendment 1 (v1.2)** — Oktopus's MQTT adapter uses this. We
  do NOT support v1.2 in MVP.
- **TR-181 Issue 2 (Device:2)** — the data model. USP and CWMP share it for
  modern devices.

## Key sections (TR-369 v1.3)

| Topic                                                                                | Section                                              |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| USP architecture overview                                                            | §3                                                   |
| Record + Msg structure                                                               | §6.1, §6.2                                           |
| Message types (Get, Set, Add, Delete, Operate, GetSupportedDM, GetInstances, Notify) | §7                                                   |
| Path expressions (wildcards, instance refs, search expressions)                      | §7.6                                                 |
| Subscriptions (Subscription.{i})                                                     | §7.7                                                 |
| MTP general requirements                                                             | §8                                                   |
| **MQTT MTP**                                                                         | §8.2 — topics, MQTT v5 Properties, response routing  |
| **WebSocket MTP**                                                                    | §8.4 — subprotocol `v1.usp`, connect record, framing |
| **STOMP MTP**                                                                        | §8.3 — destinations, headers                         |
| CoAP MTP (out of scope)                                                              | §8.5                                                 |
| Error codes                                                                          | §A.2                                                 |
| E2E security (sender_cert)                                                           | §9 (deferred)                                        |

## Proto schemas

- **`usp-msg.proto`** — message types and their bodies. v1.3 source: BBF,
  distributed via TR-369 archive.
- **`usp-record.proto`** — transport wrapper, supports SessionContextRecord,
  NoSessionContextRecord, WebSocketConnectRecord, MQTTConnectRecord,
  STOMPConnectRecord, DisconnectRecord.

Both files carry a BBF copyright header that MUST be preserved in `proto/usp/`.

## Reference implementations consulted

- **OB-USP-AGENT (obuspa)** — https://github.com/BroadbandForum/obuspa — the
  canonical agent. We use prebuilt images for E2E.
- **Oktopus** (Apache-2.0) — https://github.com/OktopUSP/oktopus — used as
  architecture reference for MTP separation. NOT lifted (different language,
  different license; only `.proto` files and topic naming conventions are
  reused).

## TR-181 data model paths we expect from agents

Required during Boot Notify:

- `Device.DeviceInfo.Manufacturer`
- `Device.DeviceInfo.ProductClass`
- `Device.DeviceInfo.SerialNumber`
- `Device.DeviceInfo.SoftwareVersion`
- `Device.DeviceInfo.HardwareVersion`
- `Device.LocalAgent.EndpointID`
- `Device.LocalAgent.MTP.{i}.*` (which MTPs the agent speaks)

Required for ACS-driven config:

- `Device.LocalAgent.Subscription.{i}.*` (we install these on first contact)
- `Device.LocalAgent.Controller.{i}.*` (agent's view of us)
