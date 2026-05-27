WebSocket MTP
=============

This page documents the WebSocket Message Transfer Protocol implementation
in GenieACS. It covers the wire-level behaviour of
``genieacs-usp-ws``, the subprotocol negotiation it enforces during the
HTTP upgrade, the handling of the ``WebSocketConnectRecord`` that
identifies the Agent, and the configuration surface exposed through
environment variables.

Overview
--------

TR-369 §8.4 defines a WebSocket MTP layered on top of RFC 6455. GenieACS
plays the **Controller** role and runs a WebSocket **server**:
``genieacs-usp-ws`` listens on a configurable port and Agents open
outbound connections to it. There is no controller-initiated dial-out;
Agents are always the initiators, which lets them traverse NAT and
firewalls just like browser clients do.

Key properties:

- **Transport**: standard RFC 6455 WebSocket framing. Plain HTTP/1.1
  upgrade on ``ws://`` or TLS on ``wss://``.
- **Subprotocol**: ``v1.usp`` (TR-369 §8.4.1). The handshake fails if
  the Agent does not offer it. The optional ``v1.usp.error``
  subprotocol may be advertised by Agents that want to fall back to a
  diagnostic channel — GenieACS does not negotiate it in PR3.
- **Framing**: binary frames only. Each frame is a single USP Record
  serialised as Protocol Buffers. Text frames are dropped with a
  warning.
- **First record**: the Agent's first frame is expected to be a
  ``WebSocketConnectRecord`` (TR-369 §8.4.2) whose ``from_id`` carries
  the Endpoint ID. GenieACS uses that ID to bind the live socket to
  the device document and to route outbound RPCs.

Subprotocol negotiation
-----------------------

During the HTTP upgrade the Agent sends a
``Sec-WebSocket-Protocol: v1.usp`` header (and optionally
``v1.usp.error``). The ``ws`` server is configured with a
``handleProtocols`` callback that:

1. Receives the set of subprotocols offered by the client.
2. Returns the value of ``USP_WS_SUBPROTOCOL`` if it appears in the
   set, which causes ``ws`` to echo the choice back in the
   ``Sec-WebSocket-Protocol`` response header.
3. Returns ``false`` otherwise, which causes the handshake to be
   aborted with HTTP ``400 Bad Request``.

The default is ``v1.usp``. Deployments that need to test custom
subprotocols (or coexist with future TR-369 revisions) can override
this with the ``USP_WS_SUBPROTOCOL`` environment variable.

WebSocketConnectRecord handling
-------------------------------

Per TR-369 §8.4.2, the first USP Record an Agent sends after a
successful upgrade is a ``WebSocketConnectRecord``. It carries no inner
USP Msg — its only role is to identify the Agent's Endpoint ID through
the Record's ``from_id`` field.

``genieacs-usp-ws`` keeps a per-connection state object
``{ ws, endpointId? }`` and decodes the first binary frame with
``decodeRecord`` from ``lib/usp/parser.ts``. The decision tree is:

- ``record_type.case === "websocket_connect"`` — set
  ``endpointId = record.from_id``, log at ``info``, and **do not**
  forward the record to NATS. It carries no controller-bound payload.
- Any other record type with a non-empty ``from_id`` — set
  ``endpointId = record.from_id``, log a ``warn`` that the Agent
  skipped the WebSocketConnectRecord, then forward the record as if it
  had arrived in steady state. This is a tolerant behaviour intended
  to keep interoperability with field Agents that don't strictly
  follow §8.4.2.
- Parse failure or empty ``from_id`` — drop the frame with a warning.
  The connection stays open so the Agent can retry.

Once an Endpoint ID is bound, the connection is recorded in an
``endpointId -> ws`` map used for outbound dispatch. If a new
connection claims an Endpoint ID that is already bound to a different
socket, the older socket is closed with code ``1012 (Service Restart)``
and the new one takes over. This matches the spirit of TR-369 §8.4.3,
which requires the controller to drop stale sessions on reconnect.

Connection lifecycle
--------------------

A typical exchange looks like this:

1. **HTTP upgrade.** The Agent issues ``GET /usp`` with
   ``Upgrade: websocket``, ``Sec-WebSocket-Version: 13`` and
   ``Sec-WebSocket-Protocol: v1.usp``. The server replies ``101
   Switching Protocols`` and echoes the subprotocol.
2. **WebSocketConnectRecord.** The Agent sends a single binary frame
   carrying a USP Record with ``record_type: websocket_connect`` and
   ``from_id`` set to its Endpoint ID. GenieACS binds the Endpoint ID
   to the socket.
3. **Steady state.** Agent-initiated Notifies and Responses arrive as
   binary frames; they are forwarded to
   ``genieacs.usp.v1.from-mtp.ws.<encodedEndpointId>`` via NATS
   JetStream (``publishPersistent``). Controller-initiated Requests
   are pulled from ``genieacs.usp.v1.to-mtp.ws.<encodedEndpointId>``
   and written back to the socket as binary frames.
4. **Close.** Either side may send a close frame. ``genieacs-usp-ws``
   removes the socket from the endpoint map and logs the close code
   and reason. There is no per-Endpoint last-will record in PR3 —
   liveness is observed indirectly through the device document's
   ``_usp.lastInform``.

Non-binary frames (text or control frames carrying USP-looking data)
are dropped with a warning. WebSocket pings are answered automatically
by the ``ws`` library and require no application-level handling.

TLS setup
---------

TLS is enabled by setting both ``USP_WS_SSL_CERT`` and
``USP_WS_SSL_KEY`` to PEM-encoded files. When either is set,
``genieacs-usp-ws`` creates an ``https.createServer`` underneath the
WebSocket server; Agents must connect with the ``wss://`` scheme.

- ``USP_WS_SSL_CERT`` — path to the server certificate. If the
  certificate is signed by an intermediate CA, concatenate the
  intermediate(s) into the same file (server cert first).
- ``USP_WS_SSL_KEY`` — path to the private key matching the
  certificate.

GenieACS does not validate client certificates by default. Mutual TLS
(client-cert auth as a coarse Agent gate) is on the roadmap but not
implemented in PR3; deployments that need it should run a reverse
proxy (Nginx, HAProxy, Envoy) in front of ``genieacs-usp-ws`` and let
the proxy terminate mTLS.

When running under Docker, mount the certificates into the
``genieacs-usp-ws`` container and point the variables at the
in-container paths:

.. code-block:: yaml

  genieacs-usp-ws:
    image: genieacs:dev
    environment:
      GENIEACS_USP_WS_PORT: 8443
      GENIEACS_USP_WS_SSL_CERT: /run/secrets/ws-server.pem
      GENIEACS_USP_WS_SSL_KEY: /run/secrets/ws-server.key
    volumes:
      - ./certs/server.pem:/run/secrets/ws-server.pem:ro
      - ./certs/server.key:/run/secrets/ws-server.key:ro

Configuration
-------------

The WebSocket MTP is configured via environment variables. As with the
rest of GenieACS, supply them with the ``GENIEACS_`` prefix.

.. list-table::
  :header-rows: 1
  :widths: 28 12 12 48

  * - Variable
    - Type
    - Default
    - Description
  * - ``USP_WS_PORT``
    - integer
    - ``0``
    - TCP port the WebSocket server listens on. ``0`` disables the
      bridge (the binary starts and idles). Example: ``8080`` for
      ``ws://``, ``8443`` for ``wss://``.
  * - ``USP_WS_INTERFACE``
    - string
    - ``::``
    - Bind address. ``::`` listens on all IPv4 and IPv6 interfaces.
      Use ``127.0.0.1`` to restrict to localhost (e.g. behind a
      reverse proxy). Example: ``0.0.0.0``.
  * - ``USP_WS_PATH``
    - string
    - ``/usp``
    - HTTP path the upgrade is accepted on. Requests to any other
      path are answered with ``426 Upgrade Required``. Example:
      ``/tr369``.
  * - ``USP_WS_SUBPROTOCOL``
    - string
    - ``v1.usp``
    - Subprotocol token negotiated during the handshake. Per TR-369
      §8.4.1 this must remain ``v1.usp`` for interoperability; the
      override exists for testing only.
  * - ``USP_WS_SSL_CERT``
    - path
    - unset
    - Path to a PEM-encoded server certificate. When set together
      with ``USP_WS_SSL_KEY``, the server runs over TLS. Example:
      ``/etc/genieacs/ws/server.pem``.
  * - ``USP_WS_SSL_KEY``
    - path
    - unset
    - Path to the PEM-encoded private key matching
      ``USP_WS_SSL_CERT``. Example: ``/etc/genieacs/ws/server.key``.
  * - ``USP_WS_WORKER_PROCESSES``
    - integer
    - ``0``
    - Number of worker processes to fork in ``genieacs-usp-ws``.
      ``0`` means one per CPU core. See
      :ref:`ws-multi-worker` for the routing implications.

.. _ws-multi-worker:

Multi-worker considerations
---------------------------

Each WebSocket connection is owned by exactly one worker process — the
one whose ``accept()`` won the upgrade race for that TCP socket. The
mapping ``endpointId -> ws`` is in-process and **not** shared across
workers, which has one important consequence: an outbound RPC for
Endpoint ID *E* can only be delivered if the JetStream consumer that
picks the message up runs in the same worker that holds *E*'s socket.

In PR3 there is no cross-worker routing. The JetStream durable
consumer ``usp-ws`` uses a queue group also named ``usp-ws``, so each
outgoing message is delivered to **one** worker; if that worker
doesn't have the live socket, the message is acked and dropped with a
``WebSocket bridge: no live connection for endpoint`` warning. In
single-worker deployments (the default in the dev stack) this is a
non-issue.

The practical workarounds today are:

- Run ``USP_WS_WORKER_PROCESSES=1`` (the simplest option for small
  deployments).
- Front multiple workers with a sticky load balancer that hashes on
  the source IP or on the Endpoint ID extracted from a
  pre-handshake header. The load balancer must keep an Agent pinned
  to the same worker for the lifetime of the WebSocket connection.

Cross-worker routing — broadcasting outgoing messages on a worker-
internal NATS subject so the worker that owns the socket can pick
them up — is on the roadmap for a future PR and intentionally out of
scope here.

Troubleshooting
---------------

Handshake rejected with HTTP 400
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Symptoms: the Agent log shows ``WebSocket handshake failed`` /
``HTTP/1.1 400`` immediately after connecting; ``genieacs-usp-ws``
logs ``rejecting handshake: subprotocol mismatch``.

Checks:

1. Confirm the Agent advertises ``v1.usp`` in
   ``Sec-WebSocket-Protocol``. ``obuspa`` does this automatically when
   ``Device.LocalAgent.MTP.{i}.Protocol`` is set to ``WebSocket``.
2. Verify ``USP_WS_SUBPROTOCOL`` matches. The default ``v1.usp`` is
   the correct value for all production deployments; only change it
   in test environments.
3. Capture the upgrade exchange with ``tcpdump -A -s 0 port 8080`` or
   ``wireshark`` and check both directions.

Handshake succeeds but no device appears
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Symptoms: ``genieacs-usp-ws`` logs ``connection opened`` but no
``WebSocketConnectRecord`` warning or info follows; the device never
appears under ``?query={"_protocol":"usp"}``.

Checks:

1. The Agent may be sending text frames instead of binary frames.
   Look for ``ignoring non-binary frame`` in the bridge log. Switch
   the Agent to binary mode (this is non-configurable on conformant
   Agents — it usually means the framing layer is broken).
2. The Agent may be sending the WebSocketConnectRecord with an empty
   ``from_id``. Check the Agent's ``Device.LocalAgent.EndpointID``;
   it must be a non-empty string of the form
   ``oui::<MAC-with-dashes>`` or ``self::<vendor-specific>``.
3. The Agent may be skipping the connect record entirely. The bridge
   tolerates this and logs ``agent did not send WebSocketConnectRecord
   first``; if you see that warning the device should still be
   created on the next regular Notify.

Outbound messages dropped
~~~~~~~~~~~~~~~~~~~~~~~~~

Symptoms: NBI tasks fault on ``USP_RPC_TIMEOUT`` and the bridge logs
``no live connection for endpoint; dropping outgoing message``.

Checks:

1. The Agent's WebSocket connection has dropped without the
   controller noticing yet. Watch the bridge log for the matching
   ``connection closed`` line. Some NATs and firewalls silently drop
   idle connections — increase
   ``Device.WebSocket.Server.{i}.KeepAliveInterval`` on the Agent
   side so the WebSocket layer issues pings frequently enough.
2. The outgoing message arrived on a worker that does not own the
   socket. See :ref:`ws-multi-worker`. Either pin to a single worker
   or front the bridge with a sticky load balancer.
3. The Endpoint ID encoded in the NATS subject does not match what
   the Agent sent. The device document's ``_usp.endpointId`` is
   authoritative; if it disagrees with the value in
   ``Device.LocalAgent.EndpointID`` on the Agent side, the Agent has
   been reflashed with a new identity and the device document needs
   to be recreated.

TLS handshake failures
~~~~~~~~~~~~~~~~~~~~~~

Symptoms: the Agent log shows ``SSL handshake failed`` /
``certificate verify failed``; ``genieacs-usp-ws`` logs
``ECONNRESET`` or ``write EPROTO``.

Checks:

1. Confirm ``USP_WS_SSL_CERT`` contains the full chain — server
   certificate first, then any intermediates. ``openssl s_client
   -connect <host>:<port> -showcerts`` should list every certificate
   the browser/Agent needs to verify.
2. Verify the certificate's ``CN`` or ``Subject Alternative Name``
   matches the host name the Agent connects to. The Agent uses
   ``Device.WebSocket.Server.{i}.Host`` for SNI; a mismatch raises
   ``Hostname/IP does not match certificate's altnames``.
3. For self-signed deployments, install the CA on the Agent side by
   importing it into the Agent's trust store. Disabling certificate
   validation is **not** supported by GenieACS — terminate TLS at a
   reverse proxy if you need that escape hatch.

Reference
---------

- Broadband Forum **TR-369 Issue 1 Amendment 2**, section **8.4** —
  the normative description of the WebSocket MTP, including
  subprotocol negotiation (§8.4.1) and the WebSocketConnectRecord
  semantics (§8.4.2).
- :rfc:`6455` — the WebSocket Protocol.
- :doc:`../configuration` — the compact configuration reference.
- :doc:`../rpc-mapping` — how NBI tasks become USP Messages once they
  reach the MTP.
