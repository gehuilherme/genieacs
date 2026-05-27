# Scope — TR-369 integration

## In scope (MVP, PRs 1-6)

- USP Msg + Record encoding/decoding at **TR-369 v1.3**
- **MQTT v5** MTP (client to external broker)
- **WebSocket** MTP (server, subprotocol `v1.usp`, RFC 6455)
- **STOMP 1.2** MTP (client to external broker)
- USP RPCs: Get, Set, Add, Delete, Operate, GetInstances, GetSupportedDM, Notify
- Subscriptions (auto-install `Device.LocalAgent.Subscription.*` for
  Boot/ValueChange on first contact)
- Endpoint ID parsing and CWMP↔USP device reconciliation (same Mongo doc when
  OUI+Serial match)
- Reuse of GenieACS sandbox, presets, provisions, virtual parameters,
  expressions, paths, tasks, faults — **no duplication**
- Dedicated UI: `/usp-devices` list + `/usp-devices/:id` page with Overview /
  Discovery / RPC tabs
- Docker compose dev environment (Mongo + Redis + NATS + Mosquitto + 4 USP
  binaries + 5 CWMP binaries)
- E2E with obuspa (BBF reference agent) against all 3 MTPs
- Sphinx docs under `docs/usp/`

## Out of scope (explicitly deferred)

- **CoAP MTP** — defer to post-MVP. Different transport (UDP), different error
  handling.
- **HTTP/2 MTP** — defer. Less common in practice.
- **USP Bulk Data Collection (TR-157 / TR-181 Device.BulkData)** — defer; large
  work area.
- **USP Software Modules** — defer.
- **USP firmware over USP (not download via HTTP/CoAP)** — defer.
- **Multi-tenant ACL** — single-tenant per deployment (GenieACS's existing
  model).
- **USP Federation / Proxy** — single-controller for now.
- **E2E Security with sender_cert validation** — TLS-only in MVP, no per-message
  cert pinning.
- **USP Service Element discovery** — manual broker/MTP config for now.
- **Embedded MQTT broker** — BYO only.
- **Migrating to NATS for CWMP** — CWMP keeps its current HTTP-only flow.

## When in doubt

If a task seems borderline:

1. Check the plan file
   (`C:\Users\Guivq\.claude\plans\esque-a-tudo-que-j-snazzy-waterfall.md`)
2. If still unclear, ask the user via `AskUserQuestion` before coding
3. Do not silently expand scope — that's what caused the previous rollback
