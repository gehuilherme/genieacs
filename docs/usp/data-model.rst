Device Data Model
=================

USP and CWMP devices share the same MongoDB ``devices`` collection.
Identity is reconciled across the two protocols whenever possible so
that a dual-stack CPE shows up as a single document in GenieACS.

Discriminator field
-------------------

Every device document carries a ``_protocol`` field that takes one of
three values:

- ``cwmp`` — TR-069 only. This is the default for any document that
  pre-dates the USP stack and the value set on every existing document
  by the migration step.
- ``usp`` — TR-369 only. The device has never been seen over CWMP.
- ``both`` — the document has been reconciled across both protocols.
  The same physical CPE has been observed speaking CWMP **and** USP,
  and either stack may issue operations against it.

Example fragments:

.. code-block:: javascript

  // Pure CWMP device, unchanged by the migration
  {
    "_id": "202BC1-BM632w-000000",
    "_protocol": "cwmp",
    "DeviceID": { "OUI": "202BC1", "SerialNumber": "000000", ... }
  }

  // Pure USP device, _id derived from the URL-safe Endpoint ID
  {
    "_id": "os--ARRIS-12AB34-SN9876",
    "_protocol": "usp",
    "_usp": { "endpointId": "os::ARRIS-12AB34-SN9876", ... }
  }

  // Dual-stack device, originally CWMP, later seen on USP too
  {
    "_id": "202BC1-BM632w-000000",
    "_protocol": "both",
    "DeviceID": { "OUI": "202BC1", "SerialNumber": "000000", ... },
    "_usp": { "endpointId": "oui::202BC1-BM632w-000000", ... }
  }

NBI queries can filter on this discriminator directly, e.g.
``?query={"_protocol":"usp"}`` or
``?query={"_protocol":{"$in":["usp","both"]}}``.

_usp subdocument
----------------

When ``_protocol`` is ``usp`` or ``both`` the document carries a
``_usp`` subdocument that captures USP-specific state. The TypeScript
shape (declared in ``lib/usp/types.ts``) is:

.. code-block:: typescript

  export interface UspMtpState {
    connected: boolean;
    lastSeen: Date;
    agentTopic?: string;        // MQTT only — topic the agent listens on
    controllerTopic?: string;   // MQTT only — topic GenieACS publishes to
    workerId?: number;          // WebSocket only — which worker owns the socket
    connId?: string;            // WebSocket only — internal connection id
    destination?: string;       // STOMP only — destination this agent uses
  }

  export interface UspDeviceSubdoc {
    endpointId: string;                              // "scheme::vendor-oui-serial"
    endpointParts: {
      scheme: string;
      vendor: string;
      oui?: string;
      serial: string;
    };
    supportedMtps: ("mqtt" | "ws" | "stomp")[];
    preferredMtp?: "mqtt" | "ws" | "stomp";
    mqtt?: UspMtpState;
    ws?: UspMtpState;
    stomp?: UspMtpState;
    lastNotify?: {
      type: string;             // "Boot", "ValueChange", "Periodic", ...
      ts: Date;
      refList?: string;         // Subscription.ReferenceList that triggered it
    };
    subscriptionIds?: Record<string, string>;        // logical name → instance id
  }

The controller picks ``preferredMtp`` as the first connected MTP, with
tiebreak order ``mqtt > ws > stomp``. The per-MTP ``UspMtpState`` blocks
are written by the corresponding MTP service whenever a connection
changes state.

Endpoint ID
-----------

A USP Endpoint ID is the globally unique identifier of an Agent (or
Controller). The TR-369 v1.3 syntax is::

  <scheme>::<vendor>-<oui>-<serial>

where ``<scheme>`` declares how to interpret the rest of the string.
GenieACS parses the following schemes out of the box:

- ``oui::000000-AB-1234`` — OUI-based, the most common form for CPE.
- ``os::ARRIS-12AB34-SN9876`` — vendor-defined, used when OUI is not
  the canonical identifier (e.g. legacy ONTs).
- ``imei::123456789012345`` — IMEI-based, used for cellular gateways.
  In this scheme the body after ``::`` is a single token, not a
  hyphenated triple.

Unknown schemes are accepted: parsing falls back to ``{scheme, vendor:
'unknown', serial: <raw body>}`` so that the device can still be stored
even if it uses an exotic identifier.

Reconciliation with CWMP devices
--------------------------------

When the controller sees a USP Endpoint ID for the first time it runs
the reconciliation algorithm in ``lib/usp/endpoint.ts``:

1. Parse ``endpointId`` into ``{scheme, vendor, oui, serial}``.
2. Query the ``devices`` collection for a document matching
   ``DeviceID.OUI == oui`` and ``DeviceID.SerialNumber == serial``,
   using the existing expression engine.
3. **Match found.** The existing ``_id`` (the CWMP-style
   ``OUI-ProductClass-Serial``) is preserved. The document is updated
   with ``$set: { _protocol: 'both', _usp: { ... } }``. CWMP wins for
   the document identity.
4. **No match.** A new document is created. Its ``_id`` is the
   Endpoint ID with ``::`` replaced by ``--`` (NATS- and URL-safe),
   and ``_protocol`` is set to ``usp``.

This rule means dual-stack CPEs never end up as two separate
documents, and pure-USP devices land on a stable, deterministic
``_id``.

Migration
---------

For deployments upgrading from a CWMP-only GenieACS, a one-off CLI
script — ``bin/genieacs-migrate`` — backfills ``_protocol: 'cwmp'`` on
every existing device document. Run it once after upgrading and before
starting the USP stack:

.. code-block:: bash

  genieacs-migrate

The script is idempotent: documents that already carry a ``_protocol``
field are left alone.
