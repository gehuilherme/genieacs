Subscriptions
=============

USP Subscriptions are the mechanism by which an Agent (CPE) is told
*which* events the Controller (GenieACS) wants to hear about. They are
defined by TR-369 §7.7 and modelled on the Agent as instances of
``Device.LocalAgent.Subscription.{i}.``. GenieACS automatically installs
a small set of default Subscriptions on every USP device it sees, and
exposes additional NBI tasks for managing custom Subscriptions.

Overview
--------

Per TR-369 §7.7, a Subscription on an Agent ties together:

- A **NotifType** — the kind of event to report (``Boot``,
  ``ValueChange``, ``ObjectCreation``, ``ObjectDeletion``,
  ``OperationComplete``, ``Event``, ``OnBoardRequest``, ``Periodic``).
- A **ReferenceList** — the data-model paths whose values, lifetime, or
  operations are being watched.
- A **Recipient** — the Controller to which Notifications are sent.
  GenieACS sets this to its own ``Device.LocalAgent.Controller.{i}.``
  entry.
- A **Persistent** flag — whether the Agent should keep the Subscription
  across reboots and factory state changes.

Once enabled (``Device.LocalAgent.Subscription.{i}.Enable = true``), the
Agent emits ``Notify`` Messages every time the watched event fires. The
Notifications arrive at GenieACS over the same MTP the Agent uses for
other traffic and surface as parameter updates in the device document.

Auto-installed defaults
-----------------------

The first time a GenieACS controller worker sees an Endpoint, the file
``lib/usp/subscriptions.ts`` is called by ``lib/usp/notify.ts`` from the
``Boot`` handler and queues two ``addSubscription`` tasks against
``Device.LocalAgent.Subscription.``:

.. list-table::
  :header-rows: 1
  :widths: 22 22 40 16

  * - NotifType
    - ReferenceList
    - Purpose
    - Persistent
  * - ``Boot``
    - ``Device.DeviceInfo.``
    - Surface every Agent boot together with the most-relevant
      ``Device.DeviceInfo.*`` snapshot. Equivalent to the CWMP
      ``1 BOOT`` Inform.
    - ``true``
  * - ``ValueChange``
    - ``Device.DeviceInfo.SoftwareVersion``
    - Notify on firmware changes so that the device document reflects
      the running image without polling.
    - ``true``

Both Subscriptions are marked ``Persistent: true`` so they survive the
Agent's own reboots — there is no need for GenieACS to re-install them
on every reconnect.

The bookkeeping for these defaults lives in ``_usp.subscriptionIds`` on
the device document; logical names are ``__boot`` and ``__softwareVersion``.
If a worker is restarted between the ``Add`` Request and the Agent's
``AddResp``, the next ``Boot`` Notification will re-detect the missing
Subscription and re-issue the task — the installer is idempotent.

Custom subscriptions via NBI
----------------------------

Operators can add their own Subscriptions through the NBI. The task
shape is the same as any other USP-only task; only ``name`` differs.

.. code-block:: bash

  curl -s -X POST \
    -H 'Content-Type: application/json' \
    -d '{
          "name": "addSubscription",
          "notificationType": "ValueChange",
          "referenceList": ["Device.WiFi.SSID.1.SSID"],
          "persistent": true
        }' \
    http://localhost:7557/devices/os--ARRIS-12AB34-SN9876/tasks

The task is translated into a USP ``Add`` Message that creates a new
``Device.LocalAgent.Subscription.`` instance with ``Enable=true``,
``NotifType=ValueChange``, the supplied ``ReferenceList`` and
``Recipient`` pointing at the GenieACS Controller entry. See
:doc:`rpc-mapping` for the full message-level encoding.

Optionally a ``logicalName`` field can be passed; GenieACS records the
Agent-side instance id in ``_usp.subscriptionIds[<logicalName>]`` so
operators can later remove the Subscription by name without bookkeeping.

Removal
-------

Subscriptions are removed with ``removeSubscription``:

.. code-block:: bash

  curl -s -X POST \
    -H 'Content-Type: application/json' \
    -d '{
          "name": "removeSubscription",
          "subscriptionId": "42"
        }' \
    http://localhost:7557/devices/os--ARRIS-12AB34-SN9876/tasks

``subscriptionId`` is either the numeric Agent-side instance index (as
listed under ``Device.LocalAgent.Subscription.{i}.``) or the
``logicalName`` recorded at creation time. The controller resolves the
name through ``_usp.subscriptionIds`` and issues a USP ``Delete`` on
``Device.LocalAgent.Subscription.<i>.``.

Removing one of the auto-installed defaults is allowed but discouraged:
GenieACS will recreate it on the next ``Boot`` if the corresponding
``_usp.subscriptionIds`` entry has been cleared.

Notification types supported
----------------------------

GenieACS understands the full set of TR-369 NotifTypes. Inbound handling
is implemented in ``lib/usp/notify.ts``.

.. list-table::
  :header-rows: 1
  :widths: 22 78

  * - NotifType
    - GenieACS behaviour on receipt
  * - ``Boot``
    - First contact triggers default-Subscription installation. Updates
      ``_lastInform`` and ``_usp.lastNotify``. The reported parameter
      bundle is fed into the declaration engine so ``Device.DeviceInfo.*``
      reflects the freshly booted state.
  * - ``ValueChange``
    - Looks up the changed path, writes the new ``value`` and
      ``valueTimestamp`` into ``DeviceData`` and re-runs preset
      evaluation.
  * - ``OnBoardRequest``
    - Treated as a first-contact event for new Endpoints — auto-creates
      the device document and runs the default-Subscription installer.
  * - ``Periodic``
    - Updates ``_lastInform``. Useful as a heartbeat; no other state is
      changed.
  * - ``OperationComplete``
    - Correlated by ``command_key`` to the in-flight NBI task and used
      to resolve asynchronous ``Operate`` calls (``Reboot``, ``Download``
      and similar).
  * - ``Event``
    - Generic Agent event. Recorded on ``_usp.lastNotify`` for visibility
      in the UI's Discovery tab; no state mutation by default.

How notifications surface in GenieACS
-------------------------------------

The inbound flow for a Notification is identical to other USP Messages:

1. An MTP service (``genieacs-usp-mqtt``, ``-ws`` or ``-stomp``) receives
   the wire frame, extracts the Record payload, and publishes the bytes
   to ``genieacs.usp.v1.from-mtp.<mtp>.<endpointId>`` on NATS.
2. ``lib/usp/dispatcher.ts`` in the controller worker decodes the
   ``Record`` and ``Msg``, classifies it as a ``Notify``, and forwards
   it to ``lib/usp/notify.ts``.
3. ``notify.ts`` updates ``_usp.lastNotify`` with the NotifType and
   timestamp, then converts the carried parameter values into a
   declaration batch against the shared session engine. The same code
   paths used by CWMP ``Inform`` handling apply: presets re-evaluate,
   provisions run, virtual parameters update.
4. The Subscription's ``SubscriptionID`` (the value carried in the
   Notification body, **not** the instance index) is recorded so that
   the UI's Discovery tab can show which Subscription produced the
   event.

Pitfalls
--------

- **Subscriptions live on the Agent.** They are *agent-side* state, not
  Controller-side state. Wiping ``_usp.subscriptionIds`` on the device
  document only loses GenieACS's bookmark; the Subscription itself is
  still active on the CPE until explicitly deleted with
  ``removeSubscription``.
- **Persistent flag is critical.** If the Agent is configured with
  ``Persistent=false``, every reboot will require GenieACS to recreate
  the Subscription. The auto-installed defaults set ``Persistent=true``
  precisely to avoid that.
- **Enable must be true.** A Subscription with ``Enable=false`` is
  inert. If you create one manually via ``setParameterValues`` rather
  than ``addSubscription``, remember to set ``Enable=true`` in the same
  batch; the ``addSubscription`` task does it automatically.
- **One Subscription per logical event.** Creating duplicate
  Subscriptions with the same NotifType and ReferenceList is allowed
  but causes the Agent to emit two Notifications per event. The
  declaration engine deduplicates the resulting parameter writes but
  the extra traffic is wasted.
- **Per-device only.** USP has no concept of "Subscriptions for all
  devices". A preset that needs notification-driven behaviour must
  install its Subscription on every matching device — typically via a
  provision script that issues ``addSubscription`` when the watched
  parameters are first declared.
