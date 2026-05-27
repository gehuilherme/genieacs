# AGENTS.md — GenieACS

GenieACS is a TR-069 Auto Configuration Server for remote management of CPE
devices (routers, modems, gateways). TypeScript codebase compiled with esbuild,
backed by MongoDB.

## Architecture Overview

Four services share a single MongoDB instance:

- **CWMP** (port 7547) — TR-069 protocol handler; manages device sessions
- **NBI** (port 7557) — Northbound REST API for external consumers
- **FS** (port 7567) — File server for firmware/config (GridFS-backed)
- **UI** (port 3000) — Web interface (Koa backend + Mithril.js SPA frontend)

Key subsystems: expression engine (`lib/common/expression/`) compiles a
Lisp-like DSL used for queries, config, and authorization; session engine
(`lib/session.ts`) drives CWMP interactions via declarations rather than
imperative RPCs; sandbox (`lib/sandbox.ts`) runs user-defined provision scripts
in `vm.Script` with deterministic replay.

Read `ARCHITECTURE.md` for a full map of the codebase when working on unfamiliar
areas. It covers service boundaries, the expression pipeline, the path system,
the CWMP session state machine, the database layer, and architectural
invariants.

## Project Structure

- `lib/` — Core server-side logic
- `lib/common/` — Shared code (runs in both Node.js and browser)
- `lib/db/` — MongoDB database layer
- `lib/ui/` — UI backend helpers
- `lib/usp/` — TR-369 (USP) controller logic (see below)
- `lib/mtp/` — USP Message Transfer Protocol bridges (see below)
- `ui/` — Frontend SPA (Mithril.js)
- `bin/` — Service entry points (CWMP + NBI + FS + UI + 4 USP services)
- `build/` — Build scripts (esbuild pipeline)
- `test/` — Unit tests (node:test)
- `docs/` — User docs (Sphinx/reStructuredText)
- `public/` — Static assets (favicon, logo)

### USP (`lib/usp/`, `lib/mtp/`)

`lib/usp/` holds the protocol-agnostic USP controller logic. It is invoked by
`bin/genieacs-usp-controller.ts` and consumes USP Records from NATS regardless
of which MTP they arrived on. Key files:

- `parser.ts` — protobuf encode/decode for USP Records and Messages.
- `dispatcher.ts` — classifies inbound Messages (Notify / Response / Error)
  and routes them to the right handler.
- `rpc.ts` — `taskToMsg` translates NBI tasks (`getParameterValues`,
  `setParameterValues`, `operate`, `addSubscription`, etc.) into outbound USP
  Messages. The inverse direction lives in `notify.ts` and the response
  branches of `dispatcher.ts`.
- `notify.ts` — handles `Notify` Messages; on the first `Boot` from an
  Endpoint it calls `subscriptions.ts` to install defaults.
- `subscriptions.ts` — auto-installs `Device.LocalAgent.Subscription.*` for
  `Boot` and `ValueChange` on first contact; also resolves `logicalName`
  bookkeeping in `_usp.subscriptionIds`.
- `poller.ts` — watches the `tasks` collection for USP-bound work and feeds it
  through `rpc.ts`.
- `subjects.ts` — the canonical NATS subject builders
  (`genieacs.usp.v1.from-mtp.<mtp>.<endpointId>`, etc.).
- `nats.ts` — shared NATS JetStream client used by every USP service.

`lib/mtp/` holds the wire-protocol bridges. Each file is a thin adapter that
bridges its MTP to the NATS subjects above and decodes the BBF-defined
Endpoint-ID transport for that MTP (MQTT v5 user property, WebSocket
subprotocol, STOMP header). Files: `mqtt.ts`, `ws.ts`, `stomp.ts`.

**Reuse rule.** USP code reuses session/sandbox/declarations from CWMP — do
not duplicate. The session engine in `lib/session.ts`, the sandbox in
`lib/sandbox.ts`, the path system in `lib/common/`, presets, provisions,
virtual parameters and the entire `lib/db/` layer are protocol-agnostic and
must not be re-implemented in `lib/usp/`. If you find yourself writing
something that looks like a parallel declaration engine or a parallel device
loader, stop and reuse the existing one. See `docs/usp/architecture.rst` for
the architectural rationale.

## Build / Lint / Test Commands

```bash
npm run build # Production build (esbuild pipeline -> dist/)
NODE_ENV=development npm run build # Dev build (no minification)
npm run lint # Prettier + ESLint + tsc --noEmit in parallel
npm test # Compile tests with esbuild, run with node --test
```

### Running a Single Test File

```bash
esbuild --log-level=warning --bundle --platform=node --target=node18 \
  --packages=external --sourcemap=inline --outdir=test test/path.ts \
  && node --test --enable-source-maps test/path.js \
  && rm test/path.js
```

### Running a Single Test Case

```bash
esbuild --log-level=warning --bundle --platform=node --target=node18 \
  --packages=external --sourcemap=inline --outdir=test test/path.ts \
  && node --test --enable-source-maps --test-name-pattern="^parse$" test/path.js \
  && rm test/path.js
```

### Lint Sub-commands

```bash
prettier --prose-wrap always --write .
eslint 'bin/*.ts' 'lib/**/*.ts' 'ui/**/*.ts' 'test/**/*.ts' 'build/**/*.ts'
tsc --noEmit
```

## Before Committing

Read `CONTRIBUTING.md` and ensure your changes comply with it. In particular:

- Run `npm run lint` and `npm test` and fix any failures.
- Follow the code style, naming, import, and comment conventions documented
  there.
- Use the Conventional Commits format for commit messages.
