Overview
========

What is TR-369?
---------------

TR-369 is the Broadband Forum specification that defines the **User
Services Platform (USP)**, the evolution of TR-069/CWMP for the post-CWMP
era. It was designed from the ground up for IoT and modern device
management workloads: thousands of small, intermittently connected
devices, multiple controllers, push-style notifications, and lightweight
transports.

GenieACS targets **TR-369 v1.3 (Issue 1 Amendment 2)**. The Broadband
Forum-licensed ``.proto`` files describing the wire format live under
``proto/usp/`` in the source tree and are compiled to TypeScript with
``ts-proto``.

Core concepts
-------------

USP defines three roles, all of which appear in a GenieACS deployment:

USP Agent
~~~~~~~~~

The software running on the CPE (router, modem, ONT, IoT gateway). It
owns the device data model (typically TR-181) and answers messages from
Controllers. The Broadband Forum reference implementation is **obuspa**.

USP Controller
~~~~~~~~~~~~~~

The management entity that talks to Agents. **GenieACS plays the
Controller role.** A Controller sends Get/Set/Add/Delete/Operate
messages, subscribes to Notifications, and reconciles state to a backing
store (MongoDB in GenieACS).

MTP (Message Transfer Protocol)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The underlying transport used to ferry USP Records between Agent and
Controller. TR-369 v1.3 defines four standard MTPs: MQTT, WebSocket,
STOMP and CoAP. GenieACS implements the first three in its MVP; CoAP is
out of scope.

TR-069 versus TR-369
--------------------

The two protocols solve overlapping problems but with very different
designs:

.. list-table::
  :header-rows: 1
  :widths: 18 41 41

  * - Aspect
    - TR-069 (CWMP)
    - TR-369 (USP)
  * - Transport
    - SOAP over HTTP(S)
    - Protocol Buffers over MQTT, WebSocket, STOMP or CoAP
  * - Data model
    - TR-098 (Device-2 / InternetGatewayDevice)
    - TR-181 (Device-2 root)
  * - Trigger model
    - Polled: CPE sends an Inform on Boot, Periodic or 6 Connection
      Request
    - Push: long-lived MTP session with Notify messages driven by
      Subscription objects on the Agent
  * - Connectivity
    - Short HTTP request/response sessions
    - Persistent, often always-on
  * - Identity
    - OUI + ProductClass + SerialNumber
    - Endpoint ID (``scheme::vendor-oui-serial``)
  * - Encoding
    - XML
    - Protobuf (binary)

Glossary
--------

USP
  User Services Platform. The protocol defined by TR-369.

MTP
  Message Transfer Protocol. The transport that carries USP Records
  (MQTT, WebSocket, STOMP, CoAP).

Endpoint ID
  Globally unique string identifying an Agent or Controller. Format:
  ``<scheme>::<vendor>-<oui>-<serial>`` (see :doc:`data-model`).

Agent
  USP role implemented by the CPE. Owns the data model, responds to
  requests, emits Notifications.

Controller
  USP role implemented by GenieACS. Initiates operations against Agents
  and consumes their Notifications.

CR (Controller Role)
  Permissions a given Controller holds against a given Agent. Controlled
  by ``Device.LocalAgent.Controller.{i}`` on the Agent side.

CMP (USP Controller Message Pattern)
  Conventional request/response correlation by ``msg_id`` used inside an
  MTP session. GenieACS implements this with a NATS request/reply inbox
  keyed by ``msg_id``.

Subscription
  An object instance under ``Device.LocalAgent.Subscription.{i}`` that
  tells the Agent which Notifications to emit and to which Controller.

Notify
  An Agent-initiated message reporting an event. Common types include
  ``Boot``, ``ValueChange``, ``OperationComplete``, ``Periodic`` and
  ``OnBoardRequest``.

Boot
  A Notification emitted when the Agent (re)starts. Carries the
  ``ParameterMap`` of boot parameters and is the trigger for GenieACS to
  reconcile or create the device document.

ValueChange
  A Notification emitted when a parameter referenced by a Subscription
  changes value. Equivalent in spirit to the CWMP "4 VALUE CHANGE"
  event.
