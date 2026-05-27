RPC Mapping
===========

GenieACS NBI tasks for USP devices use the same
``POST /devices/<id>/tasks`` endpoint as CWMP devices. The controller's
``lib/usp/rpc.ts`` ``taskToMsg`` function translates each task into one
of the USP Message types defined by TR-369. This page documents the
full mapping, with a curl example for every task and notes on the
non-trivial cases.

Mapping table
-------------

.. list-table::
  :header-rows: 1
  :widths: 30 22 48

  * - NBI task name
    - USP Msg type
    - Notes
  * - ``getParameterValues``
    - ``Get``
    - One ``Get`` Request carrying every requested path.
  * - ``setParameterValues``
    - ``Set``
    - Values are grouped by ``obj_path``; one ``UpdateObject`` per
      object instance inside a single ``Set`` Request.
  * - ``addObject``
    - ``Add``
    - One ``CreateObject`` entry; ``allow_partial`` defaults to
      ``false``.
  * - ``deleteObject``
    - ``Delete``
    - ``allow_partial`` defaults to ``false``; multi-path deletion
      reuses the same Request.
  * - ``refreshObject``
    - ``GetInstances``
    - ``first_level_only`` is ``false`` so the Agent returns all
      descendant instances of the requested ``obj_paths``.
  * - ``reboot``
    - ``Operate``
    - Command path ``Device.Reboot()``. ``send_resp = true``.
  * - ``factoryReset``
    - ``Operate``
    - Command path ``Device.FactoryReset()``. ``send_resp = true``.
  * - ``download``
    - ``Operate``
    - Command path
      ``Device.LocalAgent.Controller.{i}.Download()``; ``input_args``
      carry ``url``, ``filetype`` (and optionally ``username``,
      ``password``, ``checksum_algorithm``, ``checksum``).
  * - ``operate`` *(USP-only)*
    - ``Operate``
    - Generic command. ``command`` is the absolute path of the
      operation; ``input_args`` is forwarded verbatim. Use this for
      any vendor-specific operation that is not modelled by a
      first-class task.
  * - ``addSubscription`` *(USP-only)*
    - ``Add``
    - Creates ``Device.LocalAgent.Subscription.{i}.``. Required
      params: ``Recipient``, ``NotifType``, ``ReferenceList``.
  * - ``removeSubscription`` *(USP-only)*
    - ``Delete``
    - Deletes ``Device.LocalAgent.Subscription.{i}.`` by instance
      id or by logical name resolved through
      ``_usp.subscriptionIds``.

Task examples
-------------

Every example assumes a USP device with id
``os--ARRIS-12AB34-SN9876`` and the NBI on ``http://localhost:7557``.

getParameterValues
~~~~~~~~~~~~~~~~~~

.. code-block:: bash

  curl -s -X POST \
    -H 'Content-Type: application/json' \
    -d '{
          "name": "getParameterValues",
          "parameterNames": [
            "Device.DeviceInfo.SoftwareVersion",
            "Device.WiFi.SSID.1.SSID"
          ]
        }' \
    http://localhost:7557/devices/os--ARRIS-12AB34-SN9876/tasks

USP Message produced (decoded):

.. code-block:: text

  Get {
    param_paths: [
      "Device.DeviceInfo.SoftwareVersion",
      "Device.WiFi.SSID.1.SSID"
    ]
  }

setParameterValues
~~~~~~~~~~~~~~~~~~

.. code-block:: bash

  curl -s -X POST \
    -H 'Content-Type: application/json' \
    -d '{
          "name": "setParameterValues",
          "parameterValues": [
            ["Device.WiFi.SSID.1.SSID",         "guest",   "xsd:string"],
            ["Device.WiFi.SSID.1.Enable",       true,      "xsd:boolean"],
            ["Device.WiFi.AccessPoint.1.SSIDReference",
             "Device.WiFi.SSID.1",              "xsd:string"]
          ]
        }' \
    http://localhost:7557/devices/os--ARRIS-12AB34-SN9876/tasks

USP Message produced (decoded):

.. code-block:: text

  Set {
    allow_partial: false,
    update_objs: [
      { obj_path: "Device.WiFi.SSID.1.",
        param_settings: [
          { param: "SSID",   value: "guest", required: true },
          { param: "Enable", value: "true",  required: true }
        ] },
      { obj_path: "Device.WiFi.AccessPoint.1.",
        param_settings: [
          { param: "SSIDReference",
            value: "Device.WiFi.SSID.1", required: true }
        ] }
    ]
  }

See :ref:`set-grouping` below for the grouping rules.

addObject
~~~~~~~~~

.. code-block:: bash

  curl -s -X POST \
    -H 'Content-Type: application/json' \
    -d '{
          "name": "addObject",
          "objectName": "Device.WiFi.SSID."
        }' \
    http://localhost:7557/devices/os--ARRIS-12AB34-SN9876/tasks

USP Message produced (decoded):

.. code-block:: text

  Add {
    allow_partial: false,
    create_objs: [
      { obj_path: "Device.WiFi.SSID.", param_settings: [] }
    ]
  }

The newly created instance id is returned on the Add Response and
written back into the device document by the dispatcher.

deleteObject
~~~~~~~~~~~~

.. code-block:: bash

  curl -s -X POST \
    -H 'Content-Type: application/json' \
    -d '{
          "name": "deleteObject",
          "objectName": "Device.WiFi.SSID.3."
        }' \
    http://localhost:7557/devices/os--ARRIS-12AB34-SN9876/tasks

USP Message produced (decoded):

.. code-block:: text

  Delete {
    allow_partial: false,
    obj_paths: ["Device.WiFi.SSID.3."]
  }

refreshObject
~~~~~~~~~~~~~

.. code-block:: bash

  curl -s -X POST \
    -H 'Content-Type: application/json' \
    -d '{
          "name": "refreshObject",
          "objectName": "Device.WiFi.SSID."
        }' \
    http://localhost:7557/devices/os--ARRIS-12AB34-SN9876/tasks

USP Message produced (decoded):

.. code-block:: text

  GetInstances {
    obj_paths: ["Device.WiFi.SSID."],
    first_level_only: false
  }

reboot
~~~~~~

.. code-block:: bash

  curl -s -X POST \
    -H 'Content-Type: application/json' \
    -d '{"name": "reboot"}' \
    http://localhost:7557/devices/os--ARRIS-12AB34-SN9876/tasks

USP Message produced (decoded):

.. code-block:: text

  Operate {
    command: "Device.Reboot()",
    command_key: "<task _id>",
    send_resp: true,
    input_args: {}
  }

factoryReset
~~~~~~~~~~~~

.. code-block:: bash

  curl -s -X POST \
    -H 'Content-Type: application/json' \
    -d '{"name": "factoryReset"}' \
    http://localhost:7557/devices/os--ARRIS-12AB34-SN9876/tasks

USP Message produced (decoded):

.. code-block:: text

  Operate {
    command: "Device.FactoryReset()",
    command_key: "<task _id>",
    send_resp: true,
    input_args: {}
  }

download
~~~~~~~~

.. code-block:: bash

  curl -s -X POST \
    -H 'Content-Type: application/json' \
    -d '{
          "name": "download",
          "fileType": "1 Firmware Upgrade Image",
          "url": "https://files.example.net/firmware/r5.bin",
          "username": "fw",
          "password": "s3cret"
        }' \
    http://localhost:7557/devices/os--ARRIS-12AB34-SN9876/tasks

USP Message produced (decoded):

.. code-block:: text

  Operate {
    command: "Device.LocalAgent.Controller.1.Download()",
    command_key: "<task _id>",
    send_resp: true,
    input_args: {
      "URL":      "https://files.example.net/firmware/r5.bin",
      "Username": "fw",
      "Password": "s3cret",
      "FileType": "1 Firmware Upgrade Image"
    }
  }

The Controller instance index (``.1`` above) is resolved from
``_usp.endpointParts`` and the Agent's Subscription table; see
:doc:`data-model`.

operate (generic)
~~~~~~~~~~~~~~~~~

.. code-block:: bash

  curl -s -X POST \
    -H 'Content-Type: application/json' \
    -d '{
          "name": "operate",
          "command": "Device.IP.Diagnostics.IPPing()",
          "inputArgs": {
            "Host":            "example.net",
            "NumberOfRepetitions": 5
          },
          "sync": false
        }' \
    http://localhost:7557/devices/os--ARRIS-12AB34-SN9876/tasks

USP Message produced (decoded):

.. code-block:: text

  Operate {
    command: "Device.IP.Diagnostics.IPPing()",
    command_key: "<task _id>",
    send_resp: true,
    input_args: {
      "Host":               "example.net",
      "NumberOfRepetitions": "5"
    }
  }

addSubscription
~~~~~~~~~~~~~~~

.. code-block:: bash

  curl -s -X POST \
    -H 'Content-Type: application/json' \
    -d '{
          "name": "addSubscription",
          "notifType": "ValueChange",
          "referenceList": "Device.WiFi.SSID.1.SSID",
          "recipient": "Device.LocalAgent.Controller.1.",
          "logicalName": "wifi-ssid-watch"
        }' \
    http://localhost:7557/devices/os--ARRIS-12AB34-SN9876/tasks

USP Message produced (decoded):

.. code-block:: text

  Add {
    allow_partial: false,
    create_objs: [{
      obj_path: "Device.LocalAgent.Subscription.",
      param_settings: [
        { param: "NotifType",      value: "ValueChange",          required: true },
        { param: "ReferenceList",  value: "Device.WiFi.SSID.1.SSID", required: true },
        { param: "Recipient",      value: "Device.LocalAgent.Controller.1.", required: true },
        { param: "Enable",         value: "true",                 required: true },
        { param: "Persistent",     value: "true",                 required: false }
      ]
    }]
  }

On success the resulting instance id is recorded in
``_usp.subscriptionIds["wifi-ssid-watch"]`` so the same logical name
can be removed later without bookkeeping on the caller side.

removeSubscription
~~~~~~~~~~~~~~~~~~

.. code-block:: bash

  curl -s -X POST \
    -H 'Content-Type: application/json' \
    -d '{
          "name": "removeSubscription",
          "logicalName": "wifi-ssid-watch"
        }' \
    http://localhost:7557/devices/os--ARRIS-12AB34-SN9876/tasks

USP Message produced (decoded):

.. code-block:: text

  Delete {
    allow_partial: false,
    obj_paths: ["Device.LocalAgent.Subscription.7."]
  }

The instance index ``7`` above is resolved from
``_usp.subscriptionIds["wifi-ssid-watch"]``.

.. _set-grouping:

Notes on Set grouping
---------------------

USP ``Set`` Requests do not carry one parameter per entry; they carry
one ``UpdateObject`` per object instance, with a list of
``param_settings`` per object. The rpc-mapping layer must therefore
group the ``parameterValues`` array submitted to
``setParameterValues`` by their **object prefix**.

The grouping rules used by ``lib/usp/rpc.ts`` are:

1. For each ``[path, value, type]`` tuple in ``parameterValues``,
   split ``path`` into ``obj_path`` (everything up to and including
   the last ``.`` before the parameter name) and ``param``
   (the trailing segment).
2. Group tuples by ``obj_path``. Each group becomes one
   ``UpdateObject``.
3. Within a group, every entry is encoded as
   ``{ param, value: String(value), required: true }``.
4. The whole batch is sent as a single ``Set`` Request with
   ``allow_partial = false`` so that the entire change either applies
   or fails atomically.

The first ``.`` after the last hyphen-numbered instance must be
preserved: ``Device.WiFi.SSID.1.SSID`` splits as
``obj_path="Device.WiFi.SSID.1."`` and ``param="SSID"``, **not**
``obj_path="Device.WiFi."`` and ``param="SSID.1.SSID"``. The router
relies on the TR-181 convention that the trailing token after the
final dot is the parameter name.

If the Agent returns ``REGISTER_FAILURE`` for any individual entry,
the entire task is marked ``fault`` with the Agent's
``param_errs[]`` propagated into the task's ``fault`` document — the
same shape as a CWMP ``9003`` fault.

Notes on Operate semantics
--------------------------

``Operate`` is the most flexible USP Message type, and several
behavioural details apply to every task that uses it (``reboot``,
``factoryReset``, ``download``, ``operate``):

``send_resp``
  Set to ``true`` by default in ``lib/usp/rpc.ts``. The Agent is
  required to send an ``OperateResp`` once the operation accepts. If
  the task body carries ``"sendResp": false`` the controller still
  marks the NBI task ``done`` after the broker acknowledges the
  PUBLISH — useful for fire-and-forget commands where no response is
  expected.

Async vs sync operations
  USP commands are either **synchronous** (return their result inline
  on ``OperateResp``) or **asynchronous** (return only an
  ``OperationComplete`` Notification at a later time). The controller
  branches automatically: synchronous operations resolve the NBI task
  on the ``OperateResp``; asynchronous operations leave the task in
  ``processing`` state until a matching ``OperationComplete``
  Notification arrives. The matching key is ``command_key``, which
  is set to the NBI task's ``_id`` so correlation survives controller
  restarts.

``command_key``
  Every ``Operate`` Message carries the NBI task ``_id`` as the
  ``command_key``. This is the same identifier returned by the NBI
  ``POST /devices/<id>/tasks`` call, so polling
  ``GET /tasks/<task_id>`` is sufficient to discover the outcome of
  any operation — synchronous or asynchronous.

For ``Device.Reboot()`` and ``Device.FactoryReset()``, the Agent
typically sends the ``OperateResp`` and then disconnects from the
MTP. The next ``Boot`` Notification is taken as the operation's
completion signal even though no ``OperationComplete`` is emitted —
this matches the CWMP behaviour where a successful ``Reboot`` is
confirmed by the next ``1 BOOT`` Inform.
