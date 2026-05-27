Architecture
============

The GenieACS USP stack is a small set of cooperating microservices that
sit alongside the existing CWMP stack. They share MongoDB and Redis with
the rest of GenieACS, but introduce **NATS JetStream** as a new internal
message bus.

Process layout
--------------

Four new binaries are added in PR1. Each one follows the same
``cluster.fork()`` pattern as ``bin/genieacs-cwmp.ts``: a primary
process owns the listening socket / external connection and dispatches
work to worker processes.

- **genieacs-usp-controller** — the protocol-agnostic brain. Subscribes
  to ``genieacs.usp.v1.from-mtp.>`` on NATS, decodes USP Records and
  Messages, resolves the Endpoint ID to a device document, and drives
  ``lib/usp/session.ts``. Polls the ``tasks`` collection for devices
  whose ``_protocol`` is ``usp`` or ``both`` and translates queued
  tasks into outbound USP Messages.

- **genieacs-usp-mqtt** — MQTT v5 client bridge. Connects to an
  external MQTT broker (Mosquitto, EMQX, HiveMQ, NanoMQ — bring your
  own), subscribes to the configured topic prefix, and bridges traffic
  to and from NATS subjects.

- **genieacs-usp-ws** — WebSocket **server**. Listens on
  ``USP_WS_PORT``, negotiates the ``v1.usp`` subprotocol during the
  HTTP upgrade, and bridges each socket to NATS. A worker-affinity
  table is broadcast over NATS so any worker can route outbound
  messages to the worker that holds the socket.

- **genieacs-usp-stomp** — STOMP 1.2 client. Connects to an external
  STOMP broker (e.g. ActiveMQ), SUBSCRIBEs to the configured
  destinations, and bridges traffic to and from NATS.

Message flow (inbound)
----------------------

When an Agent sends a Record to GenieACS:

1. The Agent transmits a serialized ``Record`` over its MTP (MQTT
   PUBLISH, WebSocket frame, or STOMP SEND).
2. The corresponding MTP service (``genieacs-usp-mqtt``, ``-ws`` or
   ``-stomp``) receives the frame, peels off the MTP envelope, and
   publishes the raw protobuf bytes to
   ``genieacs.usp.v1.from-mtp.<mtp>.<endpointId>`` with JetStream
   acknowledgement.
3. ``genieacs-usp-controller`` workers join a NATS queue group on that
   subject. One worker picks up the message, decodes the ``Record``,
   then decodes the inner ``Msg``.
4. The controller resolves ``record.from_id`` to a MongoDB device
   document, creating or reconciling it as needed (see
   :doc:`data-model`).
5. Notifications are dispatched to ``lib/usp/notify.ts`` which writes
   into the device data using the same declaration engine as CWMP.
   Once the document is updated, the existing **presets and
   provisions** machinery runs automatically.
6. The JetStream message is acknowledged. Responses to outstanding
   requests are routed by ``msg_id`` to a pending-promise table on the
   controller.

Message flow (outbound)
-----------------------

When the NBI or the UI enqueues a task for a USP device:

1. ``POST /devices/<id>/tasks`` writes a task document, as for CWMP.
2. The controller poller picks up tasks whose target device has
   ``_protocol`` in ``['usp','both']``.
3. ``lib/usp/rpc.ts`` ``taskToMsg`` translates the task into a USP
   ``Msg`` (``getParameterValues`` → ``Get``, ``setParameterValues``
   → ``Set`` grouped by ``obj_path``, ``reboot`` → ``Operate
   Device.Reboot()``, and so on).
4. The controller wraps the ``Msg`` in a ``Record``, registers
   ``{msg_id → Promise}`` in the inbox, and publishes the encoded
   bytes on
   ``genieacs.usp.v1.to-mtp.<preferredMtp>.<endpointId>``.
5. The matching MTP service consumes the message, formats the MTP
   envelope (MQTT topic + response-topic, WS frame, STOMP destination),
   and sends it to the Agent.
6. When the Agent's response Record arrives back, it traverses the
   inbound flow above. The dispatcher correlates by ``msg_id``,
   resolves the pending promise, and marks the task ``done`` or
   ``fault``.

Bus subjects
------------

All NATS subjects use the prefix ``genieacs.usp.v1.``. Endpoint IDs are
URL-encoded so that the ``::`` separator does not collide with the
NATS subject token delimiter.

.. list-table::
  :header-rows: 1
  :widths: 32 22 22 24

  * - Subject pattern
    - Produced by
    - Consumed by
    - JetStream
  * - ``from-mtp.<mtp>.<endpointId>``
    - MTP services
    - Controller (queue group ``usp-controller``)
    - Yes; ack after processing
  * - ``to-mtp.<mtp>.<endpointId>``
    - Controller
    - MTP service for ``<mtp>`` (queue group ``usp-<mtp>``)
    - Yes
  * - ``conn.<mtp>.<endpointId>.<state>``
    - MTP services
    - Controller, UI presence projector
    - No (best-effort)
  * - ``reply.<msgId>``
    - Controller (inbox)
    - Originator of the request
    - No (native request/reply)
  * - ``notify.<endpointId>``
    - Controller
    - Webhook fanout, UI streams
    - No
  * - ``endpoint-lookup.<endpointId>``
    - MTP services
    - Controller (request/reply)
    - No

Reuse
-----

The single most important architectural fact about the USP stack is
that **almost nothing in GenieACS needed to be rewritten**. The
existing engine is already protocol-agnostic at the right layer:

- ``lib/sandbox.ts`` operates over ``DeviceData`` — paths, attributes,
  timestamps, versioned maps — and never inspects the protocol that
  produced those mutations. It runs presets and provisions for USP
  devices unmodified.
- ``lib/session.ts`` exposes the declaration engine that turns
  intent (read, write, refresh, instance create/delete) into the
  primitive operations that update ``DeviceData``.
- ``lib/common/path.ts`` and the expression parser already understand
  the wildcard, alias and instance reference syntax used by TR-181 and
  USP path expressions.
- ``virtual parameters``, ``provisions``, ``presets``, ``tasks`` and
  ``faults`` collections in MongoDB are reused as-is. A virtual
  parameter or preset written for a CWMP device works without changes
  against a USP device on the same schema.

The USP layer is therefore thin: it covers wire-format decoding,
endpoint reconciliation, MTP transport, and a thin "RPC translation"
shim that maps tasks to USP message types.

Diagram
-------

.. code-block:: text

                ┌──────────────────────────────────────────────────────┐
     USP Agent  │  obuspa / any TR-369 compliant CPE                   │
                └────┬──────────────┬────────────────┬─────────────────┘
                     │ MQTT v5      │ WebSocket      │ STOMP 1.2
                     ▼              ▼ v1.usp         ▼
                ┌──────────┐   ┌──────────┐    ┌──────────┐
                │mosquitto │   │ (direct  │    │  STOMP   │
                │ (extern) │   │  to ws)  │    │  broker  │
                └────┬─────┘   └────┬─────┘    └────┬─────┘
                     ▼              ▼               ▼
                ┌──────────┐   ┌──────────┐    ┌──────────┐
                │ -usp-mqtt│   │ -usp-ws  │    │-usp-stomp│   MTP services
                └────┬─────┘   └────┬─────┘    └────┬─────┘
                     └──────────────┴────────────────┘
                                    │  genieacs.usp.v1.from-mtp.>
                                    ▼
                           ┌─────────────────┐
                           │      NATS       │  JetStream
                           │   JetStream     │  + KV store
                           └────────┬────────┘
                                    │  genieacs.usp.v1.to-mtp.<mtp>.<id>
                                    ▼
                           ┌─────────────────┐
                           │ usp-controller  │ ── reuses ──┐
                           │ session         │             ▼
                           │ dispatcher      │     ┌────────────────┐
                           │ rpc / notify    │     │ lib/sandbox.ts │
                           └────────┬────────┘     │ lib/session.ts │
                                    │              │ presets/provs  │
                                    ▼              └────────┬───────┘
                           ┌─────────────────┐              │
                           │    MongoDB      │              │
                           │   devices       │◄─────────────┘
                           │   tasks/faults  │
                           └─────────────────┘
