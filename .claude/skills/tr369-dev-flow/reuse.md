# Reuse — what already exists in GenieACS

USP code MUST reuse these existing modules. If you find yourself reimplementing
one of them for USP, stop and use the existing module instead.

## Path & Expression

- **`lib/common/path.ts`** — `Path` class with cached parsing, wildcards (`*`),
  aliases (`[Device.ModelName="X"]`). Already handles USP path syntax — USP uses
  the same syntax as CWMP for parameter paths. NEVER write a new path parser.
- **`lib/common/expression/`** — full expression engine (parser, normalize,
  synth, evaluate, pagination). Reuse for any path/filter logic in USP,
  including `_protocol='usp'` filters in views.

## Type coercion

- **`lib/common/xsd.ts`** (extracted in PR1 from `lib/soap.ts:171-201`) —
  coerces xsd:string, xsd:int, xsd:unsignedInt, xsd:boolean, xsd:dateTime,
  xsd:base64, xsd:hexBinary. Both SOAP and USP MUST call this — do not
  duplicate.

## Device data & sessions

- **`lib/types.ts`** — `DeviceData`, `PathSet`, `VersionedMap`, `Attributes`.
  Protocol-agnostic. Reuse directly.
- **`lib/session.ts`** — the **declarations** machinery (declare/clear/refresh)
  and preset matching. `lib/usp/session.ts` calls into these, never reimplements
  them.
- **`lib/sandbox.ts`** — provisions/presets/virtual-parameters runtime. Reuse
  without modification.
- **`lib/device.ts`** — device.set / device.clear / device.refresh helpers.
  These mutate `DeviceData` regardless of source protocol.

## Tasks / Faults / Operations

- **`lib/db/types.ts`** — the existing `Task` union. ADD `TaskOperate`,
  `TaskAddSubscription`, `TaskRemoveSubscription` to it (additive). ADD optional
  `protocol?: 'cwmp' | 'usp'` to `TaskBase`. NEVER create a separate `usp_tasks`
  collection.
- **`Fault` interface** — reuse as-is. USP errors translate into the same fault
  docs.
- **`Operation` interface** — reuse for USP Operate.

## NBI

- **`lib/nbi.ts`** — the existing `POST /devices/<id>/tasks` endpoint accepts
  USP tasks too once `TaskBase.protocol` exists. NEVER add `/usp/*` parallel
  endpoints.

## UI

- **`lib/bundle-views.ts` + `ui/views.ts`** — the JSX views system. New USP
  views go in `seed/usp-*.jsx` and ship via the existing `views` collection.
  NEVER add a parallel UI framework.
- **`lib/query.ts`** — smart-query expression compiler. `_protocol = 'usp'`
  already works as a filter.
- **`ui/app.ts`** — route registration. Add `/usp-devices` and
  `/usp-devices/:id` here, using the same `RouteResolver` pattern as existing
  pages.

## Config

- **`lib/config.ts`** — all `USP_*` and `NATS_*` keys flow through here.
  Defaults + types declared in one place. Per-device overrides work for USP keys
  automatically.

## Build

- **`build/build.ts`** — the `services` array on line ~291. Add the 4 new
  binaries there. Do not invent a separate build pipeline for USP.

## What you should NOT reuse / DO NOT touch

- **`lib/soap.ts`** — CWMP-specific SOAP parser. USP uses protobuf, not SOAP.
  Only edit it to extract the xsd coercion into `lib/common/xsd.ts` (additive —
  soap.ts still imports it after).
- **`lib/cwmp.ts`** — CWMP state machine. USP has a separate dispatcher in
  `lib/usp/dispatcher.ts`. Read it for inspiration only.
- **`lib/connection-request.ts`** — CWMP-specific connection request
  (HTTP/UDP/XMPP). USP uses pub/sub via MTP; no connection requests needed.
