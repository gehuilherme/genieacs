STOMP MTP
=========

This page documents the STOMP Message Transfer Protocol implementation
in GenieACS. It covers the wire-level behaviour of
``genieacs-usp-stomp``, the destination layout it expects on the
broker, the STOMP frame headers it relies on, and the configuration
surface exposed through environment variables.

Overview
--------

In TR-369 Issue 1 Amendment 2 §8.3, **STOMP 1.2** is defined as one of
the three normative MTPs. GenieACS plays the **Controller** role and
connects as a **client** to an external STOMP broker — there is no
embedded broker. The broker is a deployment decision: any STOMP 1.2
implementation works (see :ref:`tested-stomp-brokers`), and the dev
stack ships ActiveMQ Classic purely as a convenience.

Key properties:

- **STOMP version**: 1.2 only. 1.1 is accepted on the wire if the broker
  insists, but the controller advertises ``accept-version: 1.2``.
- **Direction**: GenieACS is always the STOMP client. The broker is
  bring-your-own.
- **Connection lifetime**: one persistent connection per
  ``genieacs-usp-stomp`` worker, managed by ``stompit.ConnectFailover``
  with exponential backoff (1s → 30s).
- **Acknowledgement mode**: ``client-individual`` — every inbound
  MESSAGE is acked or nacked explicitly once the bridge has confirmed
  the JetStream publish, giving at-least-once delivery semantics
  end-to-end.

.. _tested-stomp-brokers:

Tested brokers
--------------

The MTP is tested against the following broker versions. Anything that
implements STOMP 1.2 to spec should work; these are the implementations
exercised by the project's CI:

.. list-table::
  :header-rows: 1
  :widths: 30 24 46

  * - Broker
    - Version
    - Notes
  * - Apache ActiveMQ Classic
    - 5.15 / 5.18
    - **Recommended** broker for STOMP deployments. Default broker in
      the dev stack.
  * - RabbitMQ + ``rabbitmq_stomp``
    - 3.12+
    - Tested. Requires the STOMP plugin to be enabled
      (``rabbitmq-plugins enable rabbitmq_stomp``).
  * - Apache ActiveMQ Artemis
    - 2.x
    - Compatible; tune ``acceptors`` to expose ``stomp`` on the
      configured port.

Destination layout
------------------

USP over STOMP uses two classes of destination: a single **controller
destination** for inbound traffic, and one **agent destination** per
Endpoint ID for outbound traffic. Both classes share a common
configurable prefix.

Controller destination
~~~~~~~~~~~~~~~~~~~~~~

The controller subscribes to a single destination on which every Agent
publishes its outgoing USP Records:

.. code-block:: text

  ${USP_STOMP_DEST_PREFIX}/controller

Default: ``/queue/genieacs-usp/controller``.

Multiple ``genieacs-usp-stomp`` workers share this destination through
the JetStream queue group ``usp-stomp``: only one worker delivers any
given MESSAGE to NATS, regardless of how many STOMP subscribers the
broker fans the message out to. (Workers using the same NATS durable
will dedupe at the JetStream layer.)

Agent destination
~~~~~~~~~~~~~~~~~

Outbound messages from GenieACS are SENT to a per-agent destination
parameterised by Endpoint ID:

.. code-block:: text

  ${USP_STOMP_DEST_PREFIX}/agent/<endpointId>

Default example:
``/queue/genieacs-usp/agent/oui::000000-AB-STOMPTEST``.

The Endpoint ID is left unescaped in the destination so that
off-the-shelf USP Agents (notably ``obuspa``) can subscribe to it
directly without needing to know GenieACS-specific encoding rules.

Agent-side configuration
~~~~~~~~~~~~~~~~~~~~~~~~

For an Agent to interoperate with GenieACS over STOMP, its
``Device.STOMP.Connection.{i}.`` instance must connect to the broker
and the matching ``Device.LocalAgent.MTP.{i}.`` must designate the
controller's destination. The minimal Agent-side data model setup is:

.. code-block:: text

  Device.STOMP.Connection.1.Host             = <broker host>
  Device.STOMP.Connection.1.Port             = 61613      # or 61614 for TLS
  Device.STOMP.Connection.1.VirtualHost      = "/"
  Device.STOMP.Connection.1.EnableEncryption = false
  Device.STOMP.Connection.1.Enable           = true

  Device.LocalAgent.MTP.1.Enable             = true
  Device.LocalAgent.MTP.1.Protocol           = STOMP
  Device.LocalAgent.MTP.1.STOMP.Reference    = Device.STOMP.Connection.1
  Device.LocalAgent.MTP.1.STOMP.Destination  =
        /queue/genieacs-usp/agent/<EndpointID>

  Device.LocalAgent.Controller.1.MTP.1.Protocol        = STOMP
  Device.LocalAgent.Controller.1.MTP.1.STOMP.Reference = Device.STOMP.Connection.1
  Device.LocalAgent.Controller.1.MTP.1.STOMP.Destination =
        /queue/genieacs-usp/controller

The ``obuspa`` agent shipped in the e2e profile is preconfigured this
way; see ``deploy/obuspa/factory-reset-stomp.txt`` for the reference
configuration file.

Header conventions
------------------

TR-369 §8.3 requires the sender's Endpoint ID to be carried as a STOMP
header on every MESSAGE and SEND frame.

``usp-endpoint-id``
  The Endpoint ID of the sender. ``genieacs-usp-stomp`` reads it from
  inbound MESSAGE frames to populate the
  ``genieacs.usp.v1.from-mtp.stomp.<endpointId>`` NATS subject without
  decoding the Record body, and writes it on every outbound SEND frame
  for symmetry. Frames without this header are NACKed with a warning
  log entry.

``content-type``
  Always ``application/octet-stream`` on outbound SEND frames. (The
  TR-369 informative ``application/vnd.bbf.usp.msg`` value is also
  accepted on inbound MESSAGE frames; the bridge does not inspect the
  body so the precise MIME type is irrelevant in practice.)

``content-length``
  Set on outbound frames so the broker correctly frames the binary
  protobuf body without scanning for the NULL terminator.

``destination``
  Set to the controller or agent destination, see above.

Configuration
-------------

The STOMP MTP is configured via environment variables. As with the
rest of GenieACS, supply them with the ``GENIEACS_`` prefix.

.. list-table::
  :header-rows: 1
  :widths: 30 12 18 40

  * - Variable
    - Type
    - Default
    - Description
  * - ``USP_STOMP_URL``
    - string
    - unset
    - Broker connection URL. ``stomp://`` for plain TCP, ``stomp+ssl://``
      for TLS. If unset, ``genieacs-usp-stomp`` idles. Example:
      ``stomp://activemq:61613``.
  * - ``USP_STOMP_USERNAME``
    - string
    - unset
    - Login passed in the CONNECT frame ``login`` header. Leave unset
      for anonymous brokers. Example: ``genieacs``.
  * - ``USP_STOMP_PASSWORD``
    - string
    - unset
    - Passcode passed in the CONNECT frame ``passcode`` header.
      Example: ``s3cret``.
  * - ``USP_STOMP_DEST_PREFIX``
    - string
    - ``/queue/genieacs-usp``
    - Common prefix for the controller and agent destinations. Use
      ``/topic/...`` if the broker should fan out, or ``/queue/...`` for
      point-to-point semantics. Example: ``/queue/acs-usp``.
  * - ``USP_STOMP_WORKER_PROCESSES``
    - integer
    - ``1``
    - Number of worker processes to fork in ``genieacs-usp-stomp``.
      Each worker maintains its own STOMP connection.

TLS setup
---------

TLS is enabled by switching ``USP_STOMP_URL`` to the ``stomp+ssl://``
scheme. ``stompit`` honours the standard Node.js TLS environment
(``NODE_EXTRA_CA_CERTS``, ``NODE_TLS_REJECT_UNAUTHORIZED``) so the same
mechanisms used elsewhere in GenieACS apply here.

When pointing at a self-signed broker certificate for development,
mount the CA file into the container and export
``NODE_EXTRA_CA_CERTS``:

.. code-block:: yaml

  genieacs-usp-stomp:
    image: genieacs:dev
    environment:
      GENIEACS_USP_STOMP_URL: stomp+ssl://broker.example.net:61614
      NODE_EXTRA_CA_CERTS: /run/secrets/stomp-ca.pem
    volumes:
      - ./certs/ca.pem:/run/secrets/stomp-ca.pem:ro

The default broker port for STOMP-over-TLS is **61614**; if your
broker exposes TLS on a different port, include it explicitly in the
URL.

Troubleshooting
---------------

Controller doesn't receive messages
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Symptoms: the Agent appears to publish but the device never appears
under ``?query={"_protocol":"usp"}``.

Checks, in order:

1. On ActiveMQ Classic, open the web console at
   ``http://activemq:8161`` and confirm the ``genieacs-usp/controller``
   queue exists and shows Enqueued > 0. If the queue is empty, the
   Agent is misconfigured; verify
   ``Device.LocalAgent.Controller.{i}.MTP.{i}.STOMP.Destination``.
2. ``genieacs-usp-stomp`` logs ``MESSAGE dropping without usp-endpoint-id``
   when the Agent omits the required header. Make sure the Agent's
   STOMP stack is on TR-369 §8.3-compliant firmware; ``obuspa`` 9.x
   and above sets the header.
3. If the broker is RabbitMQ, confirm the ``rabbitmq_stomp`` plugin is
   enabled. ``rabbitmq-plugins list`` should show
   ``[E*] rabbitmq_stomp`` (enabled).
4. Check broker-side ACLs. ActiveMQ Classic's
   ``conf/activemq.xml`` may restrict SEND/SUBSCRIBE on the configured
   queue prefix.

Agent doesn't receive responses
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Symptoms: NBI tasks remain ``pending`` until they fault on
``USP_RPC_TIMEOUT``.

Checks:

1. Confirm the Agent's SUBSCRIBE on
   ``${USP_STOMP_DEST_PREFIX}/agent/<EndpointID>`` is established. The
   ActiveMQ console shows subscribers per destination; RabbitMQ's
   management UI shows ``stomp-subscription-...`` queues.
2. Verify the Endpoint ID parsed by GenieACS matches what the Agent
   uses to subscribe. The device document's ``_usp.endpointId`` is
   authoritative.
3. The bridge logs ``STOMP bridge not connected; deferring outgoing
   message`` when its STOMP connection is down. JetStream will redeliver
   once the bridge reconnects, but if you see this message for minutes
   the broker is unreachable.

Connect loop / authentication failures
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Symptoms: ``STOMP bridge connect error`` repeats in the logs every few
seconds.

Checks:

1. Confirm the ``USP_STOMP_URL`` host:port is reachable from the
   container. ``nc -vz activemq 61613`` from inside the
   ``genieacs-usp-stomp`` container should succeed.
2. Verify credentials. ActiveMQ Classic rejects bad ``login`` /
   ``passcode`` with an ERROR frame; RabbitMQ closes the TCP socket
   abruptly.
3. For TLS endpoints, confirm the certificate chain. ``openssl s_client
   -connect broker:61614 -showcerts`` from a workstation should show
   a valid chain. Mismatches between the URL host and the certificate
   CN/SAN raise ``Hostname/IP does not match certificate's altnames``.

Reference
---------

- Broadband Forum **TR-369 Issue 1 Amendment 2**, section **8.3** —
  the normative description of the STOMP MTP, destination conventions
  and header usage.
- `STOMP 1.2 specification <https://stomp.github.io/stomp-specification-1.2.html>`_
  — the underlying wire protocol.
- :doc:`../configuration` — the compact configuration reference.
- :doc:`../rpc-mapping` — how NBI tasks become USP Messages once they
  reach the MTP.
