Configuration
=============

The USP stack is configured through the same environment-variable
mechanism as the rest of GenieACS (see :ref:`environment-variables`).
This page documents the keys that ship with PR1 — the bus and the
controller itself. Per-MTP configuration lands in later PRs as each
transport is wired up.

All USP keys must, like the rest of GenieACS, be prefixed with
``GENIEACS_`` when supplied through the environment.

Bus (NATS)
----------

GenieACS uses NATS JetStream as the internal message bus between the
controller and the MTP services. A single NATS server (or cluster) is
shared by every USP binary.

.. list-table::
  :header-rows: 1
  :widths: 26 18 56

  * - Variable
    - Default
    - Description
  * - ``NATS_URL``
    - ``nats://127.0.0.1:4222``
    - Connection URL of the NATS server. Comma-separated list for a
      cluster.
  * - ``NATS_USER``
    - unset
    - Username for NATS authentication. Leave unset if the server
      allows anonymous connections.
  * - ``NATS_PASSWORD``
    - unset
    - Password for NATS authentication.
  * - ``NATS_STREAM_NAME``
    - ``GENIEACS_USP``
    - Name of the JetStream stream used for ``from-mtp.>`` and
      ``to-mtp.>`` subjects. The controller creates the stream on
      first start if it does not exist.

Controller
----------

These keys configure ``genieacs-usp-controller`` itself.

.. list-table::
  :header-rows: 1
  :widths: 32 16 52

  * - Variable
    - Default
    - Description
  * - ``USP_CONTROLLER_WORKER_PROCESSES``
    - ``0``
    - Number of worker processes to fork inside the controller. ``0``
      means one worker per CPU core.
  * - ``USP_RPC_TIMEOUT``
    - ``30000``
    - Time in milliseconds to wait for an Agent response before
      marking the task as faulted.
  * - ``USP_DEFAULT_MTP``
    - ``mqtt``
    - MTP to prefer when a device exposes more than one and no
      ``preferredMtp`` is recorded on the device document. Valid
      values: ``mqtt``, ``ws``, ``stomp``.

MQTT MTP
--------

GenieACS is an MQTT v5 **client** to an external broker (Mosquitto,
EMQX, HiveMQ — bring-your-own). The full discussion of topic layout,
QoS and TLS lives on the :doc:`mtp/mqtt` page; the keys are summarised
here for quick reference.

.. list-table::
  :header-rows: 1
  :widths: 34 18 48

  * - Variable
    - Default
    - Description
  * - ``USP_MQTT_URL``
    - ``mqtt://127.0.0.1:1883``
    - Broker connection URL. Use ``mqtts://`` for TLS.
  * - ``USP_MQTT_CLIENT_ID``
    - ``genieacs-usp-mqtt``
    - MQTT client identifier (a per-worker suffix is appended
      automatically).
  * - ``USP_MQTT_USERNAME``
    - unset
    - Username for broker authentication.
  * - ``USP_MQTT_PASSWORD``
    - unset
    - Password for broker authentication.
  * - ``USP_MQTT_TOPIC_PREFIX``
    - ``genieacs/usp/v1``
    - Prefix for the controller topic
      (``<prefix>/controller``) and the per-agent topics
      (``<prefix>/agent/<endpointId>``).
  * - ``USP_MQTT_KEEPALIVE``
    - ``60``
    - MQTT keepalive interval, in seconds.
  * - ``USP_MQTT_RECONNECT_PERIOD``
    - ``5000``
    - Delay between reconnect attempts, in milliseconds.
  * - ``USP_MQTT_WORKER_PROCESSES``
    - ``0``
    - Number of worker processes to fork. ``0`` means one per CPU
      core.
  * - ``USP_MQTT_TLS_CA``
    - unset
    - Path to a PEM-encoded CA certificate (or bundle) used to verify
      the broker.
  * - ``USP_MQTT_TLS_CERT``
    - unset
    - Path to a PEM-encoded client certificate for mutual TLS.
  * - ``USP_MQTT_TLS_KEY``
    - unset
    - Path to the PEM-encoded private key matching
      ``USP_MQTT_TLS_CERT``.
  * - ``USP_MQTT_TLS_REJECT_UNAUTHORIZED``
    - ``true``
    - Reject the broker certificate if it cannot be verified. Set to
      ``false`` only for development against self-signed brokers.

WebSocket MTP
-------------

``genieacs-usp-ws`` is a WebSocket **server** that Agents connect to
with the ``v1.usp`` subprotocol defined in TR-369 §8.4. The full
discussion of subprotocol negotiation, the ``WebSocketConnectRecord``,
TLS and multi-worker routing lives on the :doc:`mtp/websocket` page;
the keys are summarised here for quick reference.

.. list-table::
  :header-rows: 1
  :widths: 34 18 48

  * - Variable
    - Default
    - Description
  * - ``USP_WS_PORT``
    - ``0``
    - TCP port the WebSocket server listens on. ``0`` disables the
      bridge entirely (the binary starts and idles). Example:
      ``8080`` for ``ws://``, ``8443`` for ``wss://``.
  * - ``USP_WS_INTERFACE``
    - ``::``
    - Bind address. ``::`` listens on all IPv4 and IPv6 interfaces;
      ``127.0.0.1`` restricts to localhost (typically when a reverse
      proxy terminates TLS on the public interface).
  * - ``USP_WS_PATH``
    - ``/usp``
    - HTTP path the upgrade is accepted on. Requests to any other
      path are rejected with ``426 Upgrade Required``.
  * - ``USP_WS_SUBPROTOCOL``
    - ``v1.usp``
    - Subprotocol token negotiated during the WebSocket handshake.
      TR-369 §8.4.1 mandates ``v1.usp``; the override exists for
      testing only.
  * - ``USP_WS_SSL_CERT``
    - unset
    - Path to a PEM-encoded server certificate. Setting both this
      and ``USP_WS_SSL_KEY`` switches the bridge to ``wss://``.
  * - ``USP_WS_SSL_KEY``
    - unset
    - Path to the PEM-encoded private key matching
      ``USP_WS_SSL_CERT``.
  * - ``USP_WS_WORKER_PROCESSES``
    - ``0``
    - Number of worker processes to fork inside the bridge. ``0``
      means one per CPU core. Note that WebSocket connections are
      not shared across workers — see :ref:`ws-multi-worker`.

STOMP MTP
---------

GenieACS is a STOMP 1.2 **client** to an external broker (ActiveMQ
Classic recommended; RabbitMQ with the ``rabbitmq_stomp`` plugin and
ActiveMQ Artemis also tested — bring-your-own). The full discussion of
destination layout, header conventions and TLS lives on the
:doc:`mtp/stomp` page; the keys are summarised here for quick reference.

.. list-table::
  :header-rows: 1
  :widths: 32 16 52

  * - Variable
    - Default
    - Description
  * - ``USP_STOMP_URL``
    - unset
    - Broker connection URL. ``stomp://`` for plain TCP,
      ``stomp+ssl://`` for TLS. If unset, ``genieacs-usp-stomp`` idles.
      Example: ``stomp://activemq:61613``.
  * - ``USP_STOMP_USERNAME``
    - unset
    - Login passed in the CONNECT frame ``login`` header.
  * - ``USP_STOMP_PASSWORD``
    - unset
    - Passcode passed in the CONNECT frame ``passcode`` header.
  * - ``USP_STOMP_DEST_PREFIX``
    - ``/queue/genieacs-usp``
    - Common prefix for the controller destination
      (``<prefix>/controller``) and the per-agent destinations
      (``<prefix>/agent/<endpointId>``).
  * - ``USP_STOMP_WORKER_PROCESSES``
    - ``1``
    - Number of worker processes to fork. Each worker maintains its
      own STOMP connection.
