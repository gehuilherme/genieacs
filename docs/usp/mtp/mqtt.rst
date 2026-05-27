MQTT MTP
========

This page documents the MQTT Message Transfer Protocol implementation
in GenieACS. It covers the wire-level behaviour of
``genieacs-usp-mqtt``, the topic layout it expects on the broker, the
MQTT v5 properties it relies on, and the configuration surface
exposed through environment variables.

Overview
--------

In TR-369, MQTT is the most widely deployed MTP. GenieACS plays the
**Controller** role and connects as a **client** to an external MQTT
broker — there is no embedded broker. The broker is a deployment
decision: any MQTT v5 broker works (see :ref:`tested-brokers`),
and the dev stack ships Mosquitto purely as a convenience.

Key properties:

- **MQTT version**: v5 only. v3.1.1 is not supported because USP
  requires the ``Response Topic``, ``Correlation Data`` and
  ``User Properties`` features that only v5 defines.
- **Direction**: GenieACS is always the MQTT client. The broker is
  bring-your-own.
- **Connection lifetime**: one persistent session per
  ``genieacs-usp-mqtt`` worker. ``cleanStart=false`` is used so that
  retained subscriptions survive worker restarts.
- **Last Will**: the controller publishes a presence record on
  disconnect via the broker's Will message, so Agents observe
  controller loss without waiting for an RPC timeout.

.. _tested-brokers:

Tested brokers
--------------

The MTP is tested against the following broker versions. Anything that
implements MQTT v5 to spec should work; these are the implementations
exercised by the project's CI:

.. list-table::
  :header-rows: 1
  :widths: 30 24 46

  * - Broker
    - Version
    - Notes
  * - Eclipse Mosquitto
    - 2.x
    - Default broker in the dev stack. Recommended for development.
  * - EMQX
    - 5.x
    - Tested against the open-source build. Cluster-friendly.
  * - HiveMQ Community / 4
    - 4.x
    - Tested against the community edition.

NanoMQ, VerneMQ and AWS IoT Core have been used by community
deployments but are not part of the test matrix.

Topic layout
------------

USP over MQTT uses two classes of topic: a single **controller topic**
for inbound traffic, and one **agent topic** per Endpoint ID for
outbound traffic. Both classes share a common configurable prefix.

Controller topic
~~~~~~~~~~~~~~~~

The controller subscribes to a single topic on which every Agent
publishes its outgoing USP Records:

.. code-block:: text

  ${USP_MQTT_TOPIC_PREFIX}/controller

Default: ``genieacs/usp/v1/controller``.

Multiple ``genieacs-usp-mqtt`` workers share this subscription through
the MQTT v5 **shared subscription** prefix ``$share/genieacs/`` — the
broker load-balances messages across the workers.

Agent topic
~~~~~~~~~~~

Outbound messages from GenieACS are published to a per-agent topic
parameterised by Endpoint ID:

.. code-block:: text

  ${USP_MQTT_TOPIC_PREFIX}/agent/<endpointId>

Default example: ``genieacs/usp/v1/agent/os::ARRIS-12AB34-SN9876``.

The Endpoint ID is left unescaped in the topic so that off-the-shelf
USP Agents (notably ``obuspa``) can subscribe to it directly without
needing to know GenieACS-specific encoding rules.

Agent-side configuration
~~~~~~~~~~~~~~~~~~~~~~~~

For an Agent to interoperate with GenieACS over MQTT, its
``Device.MQTT.Client.{i}.`` instance must publish to the controller
topic and subscribe to its own agent topic. The minimal Agent-side
data model setup is:

.. code-block:: text

  Device.MQTT.Client.1.BrokerAddress         = <broker host>
  Device.MQTT.Client.1.BrokerPort            = 1883      # or 8883 for TLS
  Device.MQTT.Client.1.ProtocolVersion       = 5.0
  Device.MQTT.Client.1.CleanSession          = false
  Device.MQTT.Client.1.Subscription.1.Topic  = genieacs/usp/v1/agent/<EndpointID>
  Device.MQTT.Client.1.Subscription.1.QoS    = 1

  Device.LocalAgent.MTP.1.Enable             = true
  Device.LocalAgent.MTP.1.Protocol           = MQTT
  Device.LocalAgent.MTP.1.MQTT.Reference     = Device.MQTT.Client.1
  Device.LocalAgent.MTP.1.MQTT.ResponseTopicConfigured =
        genieacs/usp/v1/agent/<EndpointID>

The ``obuspa`` agent shipped in the e2e profile is preconfigured this
way; see ``deploy/obuspa/`` for the reference configuration file.

QoS strategy
------------

GenieACS publishes and subscribes at **QoS 1** in both directions.

QoS 0 is rejected because USP requires reliable delivery for Set,
Add, Delete and Operate Messages; a dropped Request would leave the
NBI task hanging until ``USP_RPC_TIMEOUT`` expires. QoS 2 is not used:
the extra round trip provides no benefit because USP Messages carry
their own ``msg_id`` and the controller already deduplicates by it
through the NATS JetStream consumer.

MQTT v5 properties used
-----------------------

GenieACS relies on three v5-only properties:

``Response Topic``
  Set on every Request Record published to the agent topic. The
  Agent's USP stack honours it as the topic on which its Response
  Record must be published, which guarantees that replies land on the
  controller topic regardless of broker-side ACL details. Value:
  ``${USP_MQTT_TOPIC_PREFIX}/controller``.

``Correlation Data``
  Carries the USP ``msg_id`` of the request as a binary blob. The
  Agent echoes it back on the Response, and the controller uses it as
  a fast-path lookup key when JetStream replay is not desired.

``User Properties``
  Two user properties are attached to every PUBLISH:

  - ``usp-endpoint-id`` — the Endpoint ID of the sender. Used by
    ``genieacs-usp-mqtt`` to populate the
    ``genieacs.usp.v1.from-mtp.mqtt.<endpointId>`` NATS subject without
    decoding the Record body.
  - ``content-type`` — always ``application/vnd.bbf.usp.msg``. Used by
    brokers that route on payload content type, and as a sanity check
    on the receive side.

Configuration
-------------

The MQTT MTP is configured via environment variables. As with the
rest of GenieACS, supply them with the ``GENIEACS_`` prefix.

.. list-table::
  :header-rows: 1
  :widths: 28 12 12 48

  * - Variable
    - Type
    - Default
    - Description
  * - ``USP_MQTT_URL``
    - string
    - ``mqtt://127.0.0.1:1883``
    - Connection URL of the MQTT broker. ``mqtt://`` for plain TCP,
      ``mqtts://`` for TLS. Example: ``mqtts://broker.example.net:8883``.
  * - ``USP_MQTT_CLIENT_ID``
    - string
    - ``genieacs-usp-mqtt``
    - MQTT client identifier. A per-worker suffix is appended
      automatically when running with multiple workers. Example:
      ``acs-prod-eu1``.
  * - ``USP_MQTT_USERNAME``
    - string
    - unset
    - Username for broker authentication. Example: ``genieacs``.
  * - ``USP_MQTT_PASSWORD``
    - string
    - unset
    - Password for broker authentication. Example: ``s3cret``.
  * - ``USP_MQTT_TOPIC_PREFIX``
    - string
    - ``genieacs/usp/v1``
    - Common prefix for the controller and agent topics. Example:
      ``acs/usp``.
  * - ``USP_MQTT_KEEPALIVE``
    - integer (seconds)
    - ``60``
    - MQTT keepalive interval. Lower values detect dead connections
      faster at the cost of bandwidth. Example: ``30``.
  * - ``USP_MQTT_RECONNECT_PERIOD``
    - integer (ms)
    - ``5000``
    - Delay between reconnect attempts when the broker connection
      drops. Example: ``2000``.
  * - ``USP_MQTT_WORKER_PROCESSES``
    - integer
    - ``0``
    - Number of worker processes to fork in ``genieacs-usp-mqtt``.
      ``0`` means one per CPU core. Example: ``4``.
  * - ``USP_MQTT_TLS_CA``
    - path
    - unset
    - Path to a PEM-encoded CA certificate (or bundle) used to verify
      the broker's certificate. Example: ``/etc/genieacs/mqtt/ca.pem``.
  * - ``USP_MQTT_TLS_CERT``
    - path
    - unset
    - Path to a PEM-encoded client certificate for mutual TLS.
      Example: ``/etc/genieacs/mqtt/client.pem``.
  * - ``USP_MQTT_TLS_KEY``
    - path
    - unset
    - Path to the PEM-encoded private key matching ``USP_MQTT_TLS_CERT``.
      Example: ``/etc/genieacs/mqtt/client.key``.
  * - ``USP_MQTT_TLS_REJECT_UNAUTHORIZED``
    - boolean
    - ``true``
    - Reject the broker's certificate when it cannot be verified
      against the trust store. Set to ``false`` only for development
      against self-signed brokers. Example: ``false``.

TLS setup
---------

TLS is enabled implicitly by switching ``USP_MQTT_URL`` to the
``mqtts://`` scheme (or pointing at a broker port that only accepts
TLS, typically ``8883``). The three ``USP_MQTT_TLS_*`` path variables
control trust and client identity:

- ``USP_MQTT_TLS_CA`` — verifies the **broker** certificate. Required
  for any TLS deployment; without it Node's default CA store is used
  which may not contain the broker's issuer.
- ``USP_MQTT_TLS_CERT`` and ``USP_MQTT_TLS_KEY`` — provide a **client**
  certificate for mutual TLS. Required only if the broker enforces
  mTLS; password-based clients can leave both unset.
- ``USP_MQTT_TLS_REJECT_UNAUTHORIZED`` — escape hatch for development.
  Keep at ``true`` in production.

When running under Docker, mount the certificates into the
``genieacs-usp-mqtt`` container and point the variables at the
in-container paths:

.. code-block:: yaml

  genieacs-usp-mqtt:
    image: genieacs:dev
    environment:
      GENIEACS_USP_MQTT_URL: mqtts://broker.example.net:8883
      GENIEACS_USP_MQTT_TLS_CA: /run/secrets/mqtt-ca.pem
      GENIEACS_USP_MQTT_TLS_CERT: /run/secrets/mqtt-client.pem
      GENIEACS_USP_MQTT_TLS_KEY: /run/secrets/mqtt-client.key
    volumes:
      - ./certs/ca.pem:/run/secrets/mqtt-ca.pem:ro
      - ./certs/client.pem:/run/secrets/mqtt-client.pem:ro
      - ./certs/client.key:/run/secrets/mqtt-client.key:ro

Troubleshooting
---------------

Controller doesn't receive messages
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Symptoms: the Agent appears to publish but the device never appears
under ``?query={"_protocol":"usp"}``.

Checks, in order:

1. ``mosquitto_sub -t 'genieacs/usp/v1/#' -v`` on the broker should
   show traffic on **both** the controller topic and the agent topic.
   If the controller topic is silent, the Agent is misconfigured;
   verify ``Device.LocalAgent.MTP.{i}.MQTT.ResponseTopicConfigured``.
2. Confirm the Agent is publishing **MQTT v5** packets and that the
   broker accepts v5 (some legacy Mosquitto builds default to v3.1.1
   only).
3. Check the broker ACL: the controller subscribes to the controller
   topic and to ``$share/genieacs/...``. Some brokers (notably EMQX
   with strict ACL) deny shared subscriptions unless explicitly
   allowed.
4. Look at ``genieacs-usp-mqtt`` logs for ``CONNACK`` reason codes.
   ``Not authorized`` indicates credentials; ``Server unavailable``
   indicates a broker-side rate limit or memory pressure.

Agent doesn't receive responses
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Symptoms: NBI tasks remain ``pending`` until they fault on
``USP_RPC_TIMEOUT``.

Checks:

1. Confirm the Agent's subscription on
   ``${USP_MQTT_TOPIC_PREFIX}/agent/<EndpointID>`` is established. In
   Mosquitto, ``mosquitto_sub -d`` on the broker host shows the
   ``SUBSCRIBE`` packets from each client.
2. Verify the Endpoint ID parsed by GenieACS matches what the Agent
   uses to subscribe. The device document's ``_usp.endpointId`` is
   authoritative.
3. The agent topic is **not** shared (``$share/...``) — every Agent
   has its own. If you see ``Subscription identifier in use`` errors
   in broker logs, two GenieACS deployments are pointing at the same
   broker with the same client ID. Pick distinct
   ``USP_MQTT_CLIENT_ID`` values.

TLS handshake failures
~~~~~~~~~~~~~~~~~~~~~~

Symptoms: ``genieacs-usp-mqtt`` logs ``Error: unable to verify the
first certificate`` or ``Error: self signed certificate in
certificate chain`` and the worker reconnects in a tight loop.

Checks:

1. Verify ``USP_MQTT_TLS_CA`` points at a PEM file readable by the
   container user. ``openssl x509 -in <ca.pem> -text -noout`` should
   describe the broker's issuer.
2. Confirm the broker's certificate ``CN`` or ``Subject Alternative
   Name`` matches the host used in ``USP_MQTT_URL``. Mismatches
   raise ``Hostname/IP does not match certificate's altnames``.
3. For mutual TLS, confirm the client certificate was signed by a CA
   the broker trusts. ``USP_MQTT_TLS_CERT`` and ``USP_MQTT_TLS_KEY``
   must be a matched pair — ``openssl x509 -noout -modulus -in
   client.pem | openssl md5`` and the same on ``client.key`` should
   yield identical hashes.
4. ``USP_MQTT_TLS_REJECT_UNAUTHORIZED=false`` is a development-only
   workaround. Never set it in production.

Reference
---------

- Broadband Forum **TR-369 Issue 1 Amendment 2**, section **8.2** —
  the normative description of the MQTT MTP, topic conventions, QoS
  rules and v5 property usage.
- :doc:`../configuration` — the compact configuration reference.
- :doc:`../rpc-mapping` — how NBI tasks become USP Messages once they
  reach the MTP.
