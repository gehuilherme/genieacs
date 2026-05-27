Extending the MTP layer
=======================

The four MTPs shipped in the MVP — MQTT, WebSocket, STOMP and the
"local" in-process transport used by the tests — are not the end of the
list. TR-369 §8 deliberately makes MTPs pluggable, and GenieACS follows
that lead: each MTP is a small, isolated microservice that bridges
between its wire protocol and the NATS subjects consumed by the
controller. This page is the guide for adding a new MTP (e.g. CoAP,
HTTP/2, Unix Domain Sockets).

The MTP bridge contract
-----------------------

Every MTP service must implement the same two-direction NATS bridge:

.. code-block:: text

  Agent  ──(wire frames)──►  MTP bridge  ──►  genieacs.usp.v1.from-mtp.<mtp>.<endpointId>
  Agent  ◄──(wire frames)──  MTP bridge  ◄──  genieacs.usp.v1.to-mtp.<mtp>.<endpointId>

The bridge owns the wire protocol. It is responsible for:

1. Accepting incoming frames, extracting the **Endpoint ID** (from a
   header, MQTT v5 user property, STOMP frame header, CoAP option,
   subprotocol negotiation, etc.), and publishing the raw USP ``Record``
   protobuf bytes — **not** decoded — to
   ``genieacs.usp.v1.from-mtp.<mtp>.<endpointId>``.
2. Subscribing to ``genieacs.usp.v1.to-mtp.<mtp>.<endpointId>`` (or, for
   stateful MTPs, the broader ``genieacs.usp.v1.to-mtp.<mtp>.>`` with
   per-frame routing) and producing the corresponding wire frame.
3. Optionally publishing presence transitions to
   ``genieacs.usp.v1.conn.<mtp>.<endpointId>.<state>`` so the controller
   and UI can track liveness.

The bridge does **not** decode protobuf, look at MongoDB, or run any
session logic. That is the controller's job. Keeping bridges
protobuf-blind has two benefits: (a) the wire-format module can be
upgraded centrally and (b) bridges remain small enough to audit.

Bridges expose only two lifecycle entry points, mirroring
``lib/mtp/mqtt.ts``:

.. code-block:: typescript

  export function start(opts: MtpOptions): Promise<void>;
  export function stop(): Promise<void>;

``start()`` must be idempotent (safe to call after a previous ``stop()``)
and must propagate fatal errors so the cluster supervisor can restart
the worker.

Steps to add a new MTP
----------------------

The reference implementation to copy is ``lib/mtp/mqtt.ts`` paired with
``bin/genieacs-usp-mqtt.ts``. Adding a new MTP follows these steps in
order.

**1. Pick the MTP name in ``MtpKind``.**

Extend the discriminated union in ``lib/usp/types.ts``:

.. code-block:: typescript

  export type MtpKind = "mqtt" | "ws" | "stomp" | "coap";

The lowercase string is used verbatim as the second token in the NATS
subject (``genieacs.usp.v1.from-mtp.coap.<endpointId>``) and as the
suffix on environment variables (``USP_COAP_*``) and service names
(``genieacs-usp-coap``). Keep it short and lowercase.

**2. Create ``lib/mtp/<kind>.ts``.**

Mirror ``lib/mtp/mqtt.ts``. The module owns:

- A client (or server) for the wire protocol.
- A NATS connection (use the shared helpers in ``lib/usp/nats.ts``
  rather than connecting directly).
- The encode/decode of the MTP-specific envelope (topic structure for
  MQTT, frame headers for STOMP, options for CoAP) — but **not** the
  USP ``Record`` itself.
- Endpoint-ID extraction logic (see step 7).
- Worker-affinity bookkeeping for stateful transports (mirror the
  worker table used by ``lib/mtp/ws.ts``; stateless MTPs like CoAP
  can ignore this).

**3. Create ``bin/genieacs-usp-<kind>.ts``.**

Mirror ``bin/genieacs-usp-mqtt.ts``. The bin file:

- Reads config via ``lib/config.ts`` (``USP_<KIND>_*`` keys).
- Forks workers via ``cluster.fork()`` following the same pattern as
  every other GenieACS binary.
- In each worker, calls ``start(opts)`` from ``lib/mtp/<kind>.ts`` and
  installs SIGTERM/SIGINT handlers that invoke ``stop()``.

**4. Register the binary in the build system.**

Add the entry point to ``build/build.ts`` under the ``services`` array
and add it to the ``bin`` map in ``package.json``:

.. code-block:: json

  {
    "bin": {
      "genieacs-usp-coap": "dist/bin/genieacs-usp-coap.js"
    }
  }

**5. Add ``USP_<KIND>_*`` config keys in ``lib/config.ts``.**

At minimum every MTP needs:

.. list-table::
  :header-rows: 1
  :widths: 32 14 54

  * - Config key
    - Type
    - Purpose
  * - ``USP_<KIND>_ENABLED``
    - boolean
    - Allow operators to disable the MTP without removing the service.
  * - ``USP_<KIND>_LISTEN`` or ``USP_<KIND>_URL``
    - string
    - Bind address for server-style MTPs (CoAP, WS), broker URL for
      client-style MTPs (MQTT, STOMP).
  * - ``USP_<KIND>_WORKERS``
    - number
    - Cluster worker count.
  * - Auth / TLS keys
    - varies
    - Match the spec for the underlying protocol.

Use the ``cwmp`` config keys as the style reference — same prefix
conventions, same expression-based per-device override support.

**6. Add a service to ``deploy/docker-compose.dev.yaml``.**

A new service block, env-vars wired to the config keys above, and a
``depends_on: [nats]`` are usually all that is needed. If the wire
protocol requires a broker, add the broker image too.

**7. Decode the BBF-defined Endpoint-ID transport.**

This is the only part of the bridge that is genuinely MTP-specific.
TR-369 §8 defines how each MTP carries the Agent's Endpoint ID:

.. list-table::
  :header-rows: 1
  :widths: 18 82

  * - MTP
    - Endpoint-ID carrier
  * - MQTT v5
    - ``usp-endpoint-id`` user property on every PUBLISH (TR-369 §8.4).
  * - WebSocket
    - Selected subprotocol ``v1.usp`` plus the connect URL path; the
      Endpoint ID is exchanged in the first Record (TR-369 §8.5).
  * - STOMP 1.2
    - ``usp-endpoint-id`` header on every SEND frame (TR-369 §8.3).
  * - CoAP
    - URI-Path option ``usp/<endpointId>`` (TR-369 §8.2).

Implement the corresponding decoder in your bridge before forwarding
the Record to NATS. Reject frames that don't carry an Endpoint ID
rather than guessing — guessing breaks multi-tenant deployments where
multiple Agents share the same broker connection.

Reference
---------

- BBF TR-369 Issue 1 Amendment 2, §8 "Message Transfer Protocols"
- ``docs/usp/architecture.rst`` for the NATS subject conventions.
- ``lib/mtp/mqtt.ts`` and ``bin/genieacs-usp-mqtt.ts`` as the canonical
  reference implementation. CoAP and HTTP/2 should mirror its structure
  byte-for-byte where possible — the goal is to keep all four bridges
  recognisable as the same shape.
