---
name: tr369-dev-flow
description:
  Use when working on TR-369 (USP) integration into GenieACS — touching
  lib/usp/, lib/mtp/, bin/genieacs-usp-*, seed/usp-*, proto/usp/, or deploy/ for
  USP. Codifies the locked architecture, PR phasing, reuse rules, and scope
  guardrails so the project doesn't drift like the previous (rolled-back)
  attempt.
---

# TR-369 dev flow

This skill is the source of truth for **how** TR-369/USP support is being added
to GenieACS. Before writing or modifying code in any of the trigger paths, read
the relevant section below.

## Locked architecture

See `project_tr369_genieacs.md` in memory for the authoritative list. Summary:

| Decision     | Choice                                                                              |
| ------------ | ----------------------------------------------------------------------------------- |
| Topology     | Microservices: 4 new binaries (`genieacs-usp-controller`, `-mqtt`, `-ws`, `-stomp`) |
| Internal bus | NATS JetStream, subject prefix `genieacs.usp.v1.*`                                  |
| Data model   | Shared `devices` collection + `_protocol` discriminator + `_usp` subdoc             |
| MTPs in MVP  | MQTT v5 + WebSocket (`v1.usp` subprotocol) + STOMP 1.2                              |
| MQTT broker  | Bring-your-own (external)                                                           |
| UI           | Dedicated `/usp-devices` list + device page with Discovery/RPC tabs                 |
| Tests / E2E  | Docker compose with Mosquitto + NATS + obuspa                                       |

**Never propose changes to these without explicit user OK.** The previous
attempt was rolled back because architecture drift happened mid-stream.

## Companion files

- [scope.md](scope.md) — what's in, what's out, with rationale
- [reuse.md](reuse.md) — list of GenieACS modules that MUST be reused (never
  re-implemented)
- [phases.md](phases.md) — PR1-PR6 breakdown, definition of done per PR
- [testing.md](testing.md) — docker compose commands for dev + E2E
- [bbf-refs.md](bbf-refs.md) — pointers to the TR-369 spec paragraphs that
  govern each piece

## When invoked

1. Identify which PR phase the current task belongs to (see phases.md).
2. Check scope.md — is the task in scope? If borderline, ask the user before
   coding.
3. Check reuse.md — does this duplicate something GenieACS already has? If yes,
   redirect to the existing module.
4. After implementing, verify via testing.md commands.

## Plan reference

Full implementation plan:
`C:\Users\Guivq\.claude\plans\esque-a-tudo-que-j-snazzy-waterfall.md`
