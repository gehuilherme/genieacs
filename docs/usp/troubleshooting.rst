Troubleshooting
===============

This page lists the most common failure modes in the USP stack and the
exact commands to diagnose each one. It assumes the dev stack from
``deploy/docker-compose.dev.yaml`` is running; adapt the service names
to your deployment.

Device doesn't appear in /usp-devices
-------------------------------------

When an Agent has been pointed at GenieACS but never shows up in the
UI's ``/usp-devices`` list, walk down the pipeline.

**1. Is there a device document at all?**

.. code-block:: bash

  docker compose exec mongo mongosh genieacs --quiet --eval \
    'db.devices.find({_protocol: "usp"}, {_id: 1, _lastInform: 1, "_usp.endpointId": 1}).limit(20).toArray()'

If the collection is empty for ``_protocol: 'usp'`` the controller has
never reconciled a Notification — the problem is upstream of MongoDB.

**2. Is anything reaching NATS from the MTPs?**

.. code-block:: bash

  docker compose exec nats nats sub 'genieacs.usp.v1.from-mtp.>'

Trigger a fresh Boot from the Agent (reboot the CPE or restart obuspa).
If no message appears, the MTP service is not bridging — jump to the
per-MTP sections below.

**3. Is the controller consuming?**

.. code-block:: bash

  docker compose logs --tail=200 genieacs-usp-controller

Look for ``USP Notify <NotifType> from <endpointId>`` log lines. If the
``from-mtp`` subject has traffic but the controller logs nothing, the
JetStream consumer is stuck — restart the controller workers.

**4. Per-MTP broker connectivity.**

- **MQTT**: ``docker compose exec mosquitto mosquitto_sub -V mqttv5 -t '$SYS/broker/clients/connected' -C 1``
  should show at least the controller plus your Agent. If the count is
  ``1`` only, the Agent is not authenticated or is connecting to the
  wrong host.
- **WebSocket**: ``curl -i -N -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: AAAAAAAAAAAAAAAAAAAAAA==' -H 'Sec-WebSocket-Protocol: v1.usp' http://localhost:7560/``
  should respond ``101 Switching Protocols`` with
  ``Sec-WebSocket-Protocol: v1.usp``.
- **STOMP**: check the broker's web admin (ActiveMQ ``:8161``) for the
  ``genieacs-usp-stomp`` connection and the SUBSCRIBE on the
  configured destination.

Tasks never complete (stuck in "processing")
--------------------------------------------

A queued NBI task that never transitions to ``done`` or ``fault`` is
almost always one of: (a) the Agent never received it, (b) the Agent
responded but the response never reached GenieACS, or (c) the
controller crashed mid-flight.

**1. Check the device's faults.**

.. code-block:: bash

  docker compose exec mongo mongosh genieacs --quiet --eval \
    'db.faults.find({device: "<endpointId>"}).pretty()'

A ``USP RPC timeout`` fault usually means the Agent never replied.

**2. Check controller logs.**

.. code-block:: bash

  docker compose logs --tail=500 genieacs-usp-controller | grep -E 'USP RPC|timeout|<task_id>'

Each outbound ``Operate`` / ``Get`` / ``Set`` logs its ``msg_id``. A
matching ``response`` line should appear within ``USP_REQUEST_TIMEOUT``
(default 30 s).

**3. Confirm the outbound subject has a subscriber.**

.. code-block:: bash

  docker compose exec nats nats sub 'genieacs.usp.v1.to-mtp.>'

Re-trigger the task. If the message appears on the bus but no MTP
service consumes it, the MTP-specific queue group is dead — restart
that MTP service. A common cause is a misnamed ``preferredMtp`` on the
device document (``_usp.preferredMtp``) pointing at an MTP that isn't
running.

**4. Subscribe to the reply inbox for one message.**

.. code-block:: bash

  docker compose exec nats nats sub 'genieacs.usp.v1.reply.<msg_id>'

If you see no reply within the timeout, the Agent has not produced a
Response Record — collect Agent-side traces.

MQTT: agent connects to broker but messages don't bridge
--------------------------------------------------------

Symptom: ``$SYS/broker/clients/connected`` shows the Agent online but
``genieacs.usp.v1.from-mtp.mqtt.>`` is silent.

**Check the topic prefix.** The Agent must publish to a topic that
matches ``USP_MQTT_TOPIC_PREFIX`` (default ``usp/endpoint/``). Inspect
what the Agent is sending:

.. code-block:: bash

  docker compose exec mosquitto mosquitto_sub -V mqttv5 -t '#' -F '%t %P' -v

Each ``PUBLISH`` should carry an ``usp-endpoint-id`` MQTT v5 user
property. If the user property is missing, the MQTT MTP cannot derive
the Endpoint ID and silently drops the frame.

If you control the Agent's config, verify:

- ``Device.LocalAgent.MTP.{i}.MQTT.TopicPath`` matches the prefix.
- ``Device.LocalAgent.MTP.{i}.MQTT.PublishQoS`` is ``1`` (QoS 0 is
  accepted but lossy).
- The CONNECT packet sends the Endpoint ID as a user property on every
  PUBLISH; older obuspa builds omit this on retained messages.

WebSocket: connection drops immediately
---------------------------------------

Symptom: Agent's CONNECT log line is followed within ~100 ms by a
``WebSocket closed (1002 protocol error)`` or similar.

**Subprotocol negotiation.** USP mandates the ``v1.usp`` subprotocol
during the WebSocket upgrade handshake (TR-369 §8.5). The
``Sec-WebSocket-Protocol: v1.usp`` request header must be echoed in the
``101`` response. If your Agent advertises another subprotocol (e.g.
``v1.bbf.usp.msg``), it will be rejected by ``genieacs-usp-ws``.

**Path mismatch.** ``USP_WS_PATH`` (default ``/usp``) must equal the
path component of the Agent's URL (``ws://acs.example/usp``). A
mismatch surfaces as a ``404`` before the upgrade even starts.

Quick probe:

.. code-block:: bash

  curl -i -N \
    -H 'Connection: Upgrade' \
    -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' \
    -H 'Sec-WebSocket-Key: AAAAAAAAAAAAAAAAAAAAAA==' \
    -H 'Sec-WebSocket-Protocol: v1.usp' \
    http://localhost:7560/usp

The response must be ``HTTP/1.1 101 Switching Protocols`` and contain
``Sec-WebSocket-Protocol: v1.usp``.

STOMP: subscription not created
-------------------------------

Symptom: The STOMP MTP logs ``connected`` but never logs
``SUBSCRIBE ack``, and no traffic flows.

**Destination prefix.** ``USP_STOMP_DESTINATION_PREFIX`` must match
what the Agent publishes to. The default is ``/queue/usp/``.

**Broker ACLs.** Most STOMP brokers (ActiveMQ Artemis, RabbitMQ STOMP
plugin) ship with ACLs that reject anonymous SUBSCRIBE on arbitrary
destinations. Check the broker's authorization log:

.. code-block:: bash

  docker compose logs activemq | grep -iE 'permission|denied|policy'

Grant the controller user read on the SUBSCRIBE destination and write
on the publish destination, or use a development broker with
``anonymousAccessAllowed=true``.

**STOMP version.** GenieACS speaks STOMP 1.2 only. Brokers that fall
back to 1.0 or 1.1 will be rejected during ``CONNECT``.

Notify subscriptions not firing
-------------------------------

Symptom: device document exists, MTP traffic is healthy for explicit
RPCs, but ``ValueChange`` Notifications never arrive.

**1. Did the default-Subscription installer succeed?**

.. code-block:: bash

  docker compose exec mongo mongosh genieacs --quiet --eval \
    'db.tasks.find({device: "<endpointId>", name: "addSubscription"}).pretty()'

If the tasks are still ``pending`` or in ``fault``, the Subscription
was never installed on the Agent. The controller logs will explain why
(usually ``USP RPC timeout`` or an Agent-side parameter error).

**2. Is the Subscription Enabled on the Agent?**

Trigger a ``refreshObject`` for the Subscription tree:

.. code-block:: bash

  curl -s -X POST \
    -H 'Content-Type: application/json' \
    -d '{"name": "refreshObject", "objectName": "Device.LocalAgent.Subscription."}' \
    http://localhost:7557/devices/<endpointId>/tasks

Then inspect the device document — every
``Device.LocalAgent.Subscription.{i}.Enable`` must be ``true`` and
``NotifType``/``ReferenceList`` must match what you expected.

**3. Recipient correctness.**

The Subscription's ``Recipient`` must point at the GenieACS
Controller's own ``Device.LocalAgent.Controller.{i}.`` entry. A wrong
``Recipient`` causes the Agent to silently route Notifications to a
different (possibly non-existent) Controller.

See :doc:`subscriptions` for the full lifecycle.

Useful commands cheat-sheet
---------------------------

The one-liners you'll reach for first.

**MongoDB.**

.. code-block:: bash

  # All USP devices, oldest first
  docker compose exec mongo mongosh genieacs --quiet --eval \
    'db.devices.find({_protocol: "usp"}, {_id: 1, _lastInform: 1}).sort({_lastInform: 1}).limit(20).toArray()'

  # Show the _usp subdoc for one device
  docker compose exec mongo mongosh genieacs --quiet --eval \
    'db.devices.findOne({_id: "<endpointId>"}, {_usp: 1, _protocol: 1, _lastInform: 1})'

  # Faults for a device
  docker compose exec mongo mongosh genieacs --quiet --eval \
    'db.faults.find({device: "<endpointId>"}).pretty()'

  # Pending tasks for a device
  docker compose exec mongo mongosh genieacs --quiet --eval \
    'db.tasks.find({device: "<endpointId>"}).pretty()'

**NATS.**

.. code-block:: bash

  # Watch every inbound USP Record
  docker compose exec nats nats sub 'genieacs.usp.v1.from-mtp.>'

  # Watch every outbound USP Record
  docker compose exec nats nats sub 'genieacs.usp.v1.to-mtp.>'

  # Watch presence / notify fanout
  docker compose exec nats nats sub 'genieacs.usp.v1.conn.>'
  docker compose exec nats nats sub 'genieacs.usp.v1.notify.>'

  # JetStream consumer state
  docker compose exec nats nats consumer report

**MQTT.**

.. code-block:: bash

  # Mirror every MQTT topic with v5 user properties
  docker compose exec mosquitto mosquitto_sub -V mqttv5 -t '#' -F '%t %P' -v

  # Publish a synthetic Record (debug only)
  docker compose exec mosquitto mosquitto_pub -V mqttv5 \
    -t 'usp/endpoint/os::ARRIS-12AB34-SN9876' -f /tmp/record.bin \
    -D PUBLISH user-property usp-endpoint-id os::ARRIS-12AB34-SN9876

**Redis.**

.. code-block:: bash

  # Inspect controller's session keys
  docker compose exec redis redis-cli --scan --pattern 'usp:session:*'

  # Read one session
  docker compose exec redis redis-cli GET 'usp:session:<endpointId>'
