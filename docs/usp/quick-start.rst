Quick Start
===========

This guide walks through bringing up the full GenieACS stack — CWMP and
USP — on a developer workstation using the Docker Compose files shipped
under ``deploy/``. By the end you will have a real ``obuspa`` Agent
talking MQTT to GenieACS, a device document in MongoDB, and the UI
served at http://localhost:3000.

Prerequisites
-------------

- **Docker** 24+ with the Compose v2 plugin (``docker compose`` as a
  subcommand, not the legacy ``docker-compose``).
- Roughly **2 GB of free disk** for the images (``mongo``,
  ``eclipse-mosquitto``, ``nats``, ``redis``, the GenieACS image, and
  ``obuspa`` for the end-to-end profile).
- A free TCP port on the host for each exposed service (see the table
  below). Stop any local Mosquitto, MongoDB or Redis before starting.

Bring up the stack
------------------

The dev compose file boots every GenieACS USP binary plus its dependencies
by default. CWMP listeners are opt-in via ``--profile cwmp-only``:

.. code-block:: bash

  cd deploy
  docker compose -f docker-compose.dev.yaml up
  # add --profile cwmp-only to also start genieacs-cwmp + genieacs-fs

The following ports are exposed on the host:

.. list-table::
  :header-rows: 1
  :widths: 22 14 64

  * - Service
    - Port
    - Purpose
  * - genieacs-cwmp
    - ``7547``
    - CWMP / TR-069 ACS endpoint.
  * - genieacs-nbi
    - ``7557``
    - Northbound REST API (used by the rest of this guide).
  * - genieacs-fs
    - ``7567``
    - File server for CWMP downloads.
  * - genieacs-ui
    - ``3000``
    - Web UI.
  * - genieacs-usp-ws
    - ``8080``
    - WebSocket MTP listener.
  * - mosquitto
    - ``1883``
    - MQTT broker used by the USP MQTT MTP.
  * - nats
    - ``4222`` / ``8222``
    - NATS JetStream bus / monitoring HTTP.
  * - mongo
    - ``27017``
    - MongoDB.
  * - redis
    - ``6379``
    - Redis.

Leave the ``up`` command running in this terminal — it streams logs from
every container. Open a second terminal for the steps below.

Verify NATS and Mosquitto
-------------------------

Confirm the bus and the broker are healthy before introducing an Agent.

NATS exposes a monitoring endpoint on port ``8222``:

.. code-block:: bash

  curl -s http://localhost:8222/varz | head

Or, using the ``nats`` CLI inside the container:

.. code-block:: bash

  docker compose -f docker-compose.dev.yaml exec nats \
    nats --server nats://127.0.0.1:4222 stream ls

You should see the ``GENIEACS_USP`` JetStream stream listed.

For Mosquitto, subscribe to the USP topic prefix and watch traffic:

.. code-block:: bash

  docker compose -f docker-compose.dev.yaml exec mosquitto \
    mosquitto_sub -h 127.0.0.1 -p 1883 -t 'genieacs/usp/v1/#' -v

Leave this subscription running in its own terminal — you will see
USP Records flow through as soon as the Agent connects.

Spin up the obuspa agent
------------------------

The end-to-end overlay adds a real ``obuspa`` Agent configured to talk
MQTT to the broker that the dev stack just brought up:

.. code-block:: bash

  docker compose -f docker-compose.dev.yaml \
                 -f docker-compose.e2e.yaml \
                 --profile e2e \
                 up obuspa-mqtt

Within a few seconds the Agent connects, sends a ``Boot`` Notification
on its agent topic, and GenieACS reconciles the Endpoint ID into a
``devices`` document. The ``mosquitto_sub`` window above will print the
exchange.

Confirm the device shows up
---------------------------

Query the NBI for devices whose ``_protocol`` is ``usp``:

.. code-block:: bash

  curl -s 'http://localhost:7557/devices?query=%7B%22_protocol%22%3A%22usp%22%7D' \
       | python -m json.tool

Expected response (truncated):

.. code-block:: json

  [
    {
      "_id": "os--ARRIS-12AB34-SN9876",
      "_protocol": "usp",
      "_usp": {
        "endpointId": "os::ARRIS-12AB34-SN9876",
        "endpointParts": {
          "scheme": "os",
          "vendor": "ARRIS",
          "oui": "12AB34",
          "serial": "SN9876"
        },
        "supportedMtps": ["mqtt"],
        "preferredMtp": "mqtt",
        "mqtt": {
          "connected": true,
          "lastSeen": "2026-05-26T12:34:56.000Z",
          "agentTopic": "genieacs/usp/v1/agent/os::ARRIS-12AB34-SN9876",
          "controllerTopic": "genieacs/usp/v1/controller"
        },
        "lastNotify": {
          "type": "Boot",
          "ts": "2026-05-26T12:34:56.000Z"
        }
      }
    }
  ]

Capture the ``_id`` value — every subsequent NBI call uses it.

Send your first Get task
------------------------

The NBI for USP devices is identical to CWMP: ``POST /devices/<id>/tasks``
with a JSON body. The same task names work; behind the scenes the
controller translates them into USP Messages (see
:doc:`rpc-mapping`).

.. code-block:: bash

  DEVICE_ID='os--ARRIS-12AB34-SN9876'

  TASK_ID=$(curl -s -X POST \
    -H 'Content-Type: application/json' \
    -d '{
          "name": "getParameterValues",
          "parameterNames": [
            "Device.DeviceInfo.ManufacturerOUI",
            "Device.DeviceInfo.SerialNumber",
            "Device.DeviceInfo.SoftwareVersion"
          ]
        }' \
    "http://localhost:7557/devices/${DEVICE_ID}/tasks" \
    | python -c 'import json,sys;print(json.load(sys.stdin)["_id"])')

  echo "Task ID: $TASK_ID"

Poll the task until it reaches the ``done`` state:

.. code-block:: bash

  curl -s "http://localhost:7557/tasks/${TASK_ID}" | python -m json.tool

A successful response carries ``"status": "done"`` and the resolved
parameter values are now part of the device document, fetchable with:

.. code-block:: bash

  curl -s "http://localhost:7557/devices/${DEVICE_ID}" \
       | python -m json.tool

Open the UI
-----------

Browse to http://localhost:3000/usp-devices. The dashboard lists every
USP-capable device, the MTP it is currently connected over, and the
timestamp of its last Notification. Clicking the device opens the same
inspector that CWMP devices use — provisions, presets, virtual
parameters and faults behave identically.

Cleanup
-------

Stop every container and drop the persistent volumes (MongoDB data,
JetStream storage) with:

.. code-block:: bash

  docker compose -f docker-compose.dev.yaml down -v

If the e2e overlay was used, include it in the ``down`` command so the
``obuspa`` containers are torn down as well:

.. code-block:: bash

  docker compose -f docker-compose.dev.yaml \
                 -f docker-compose.e2e.yaml down -v
