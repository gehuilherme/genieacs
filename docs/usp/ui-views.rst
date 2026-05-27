UI Views for USP
================

GenieACS ships a small set of server-stored JSX views specifically for
the TR-369 (USP) half of the controller. They live in the ``views``
collection alongside the CWMP-oriented views and are bundled at start-up
by ``lib/bundle-views.ts``. This page covers the USP-specific pages,
how they fit together, and how to extend or override them.

Pages and views
---------------

.. list-table::
  :header-rows: 1
  :widths: 22 22 56

  * - Route
    - View
    - Purpose
  * - ``/usp-devices``
    - ``usp-devices``
    - Listing page for USP-capable devices. Counts (total, MQTT/WS/STOMP
      online) at the top, per-device row below with endpoint id, vendor,
      software version, preferred MTP, per-MTP connection badges, last
      inform timestamp.
  * - ``/usp-devices/<deviceId>``
    - ``usp-device``
    - Detail page for one device. Adds a three-tab navigation —
      Overview, Discovery, RPC — over the same ``devices`` document
      schema that CWMP uses.
  * - Embedded
    - ``usp-discovery``
    - Discovery tab content. Lazily-expanded data-model tree with
      Refresh / Discover buttons at object level.
  * - Embedded
    - ``usp-rpc``
    - RPC console tab content. Form-driven submission of any of
      Get / Set / Add / Delete / Operate / GetInstances / GetSupportedDM.
  * - Dashboard widget
    - ``usp-overview``
    - Compact pie-style breakdown of USP devices by MTP connection state.
      Drop ``<usp-overview />`` into the dashboard view to include it.

Listing page filters
--------------------

The list page (``seed/usp-devices.jsx``) filters the shared ``devices``
collection on the top-level ``_protocol`` discriminator:

.. code-block:: text

  _protocol = 'usp' OR _protocol = 'both'

The four counters in the page header reuse this filter with additional
conjunctions on the ``_usp.<mtp>.connected`` boolean:

- Total: the bare protocol filter above.
- MQTT online: ``... AND _usp.mqtt.connected = true``
- WS online: ``... AND _usp.ws.connected = true``
- STOMP online: ``... AND _usp.stomp.connected = true``

Clicking a counter on the dashboard widget (``usp-overview``) jumps to
``/devices/?filter=...`` with the appropriate expression URL-encoded so
the same filters are sharable.

Device detail tabs
------------------

Selecting a row opens ``usp-device``. The page header shows the USP
endpoint id (or device id when the endpoint id is not yet known) plus
the canonical device id underneath. Below the header is a tab strip with
three tabs:

Overview
~~~~~~~~

Renders three sections from the device document:

- **USP info**: endpoint identity (scheme/vendor/OUI/serial decomposed
  from ``_usp.endpointParts``), preferred MTP, supported MTPs, last
  Notify type and timestamp.
- **MTP status**: a card per MTP (MQTT, WebSocket, STOMP) showing
  connection state, last-seen timestamp, agent/controller topics or
  connection identifiers, and the destination/remote address when known.
- **TR-181 Overview**: when the device's data model has been discovered,
  the existing ``device-page-tr181`` view is composed in to reuse the
  CWMP-side overview. If no TR-181 data model has been seen yet, a
  placeholder is shown instead.

Discovery
~~~~~~~~~

A lazily-expanded tree of the device's data model rooted at ``Device.``.
Nodes are taken from the keys already on the device document (the
controller persists them as ``Device.X[:object|:writable|:type|...]``).
Only branches the user has expanded are rendered — the full TR-181 tree
is far too large to draw at once.

Each object row carries two buttons:

- **Refresh** — submits a ``refreshObject`` task for that path. The
  USP controller translates this into a partial-path ``Get`` and
  refreshes the cached values.
- **Discover** — submits a ``getSupportedDM`` task for that path,
  asking the agent for the schema (parameters / commands / events).
  The response is merged into the device document and the tree fills in
  on the next reactive tick.

Leaf rows render the path segment, the cached value, an ``xsd:*`` type
badge and an RO/RW writability badge — matching the conventions used
elsewhere in the GenieACS UI (see ``seed/parameter.jsx``).

RPC
~~~

An interactive console for submitting ad-hoc USP RPCs. The command
selector switches between seven forms:

.. list-table::
  :header-rows: 1
  :widths: 22 24 54

  * - Command
    - Task name
    - Inputs
  * - Get
    - ``getParameterValues``
    - Multi-line textbox of parameter paths.
  * - Set
    - ``setParameterValues``
    - Editable table of ``(path, value, type)`` rows.
  * - Add
    - ``addObject``
    - Object path plus an editable table of initial
      ``(path, value, type)`` rows.
  * - Delete
    - ``deleteObject``
    - One or more instance paths.
  * - Operate
    - ``operate``
    - Command path (e.g. ``Device.Reboot()``) and a key/value table for
      input arguments.
  * - GetInstances
    - ``getInstances``
    - Object paths plus ``first_level_only`` checkbox.
  * - GetSupportedDM
    - ``getSupportedDM``
    - Object paths plus ``first_level_only`` /  ``return_commands`` /
      ``return_events`` / ``return_params`` checkboxes.

The Submit button posts to ``POST /devices/<deviceId>/tasks`` via the
``<do-task arg=... commit={true}>`` primitive — the same path used for
CWMP tasks. After submission the panel shows the created task ``_id``,
its current status and any fault. Status is polled from ``/tasks``
every 3 seconds until the task is removed from the queue.

Overriding or extending the views
---------------------------------

The seed views are inserted into the ``views`` collection at install
time by ``lib/init.ts``. Editing them at runtime is straightforward: the
``views`` resource is a regular GenieACS NBI resource, and the same
permissions apply as for ``presets`` or ``provisions``.

Replace an entire view:

.. code-block:: bash

  # Pipe a modified usp-discovery.jsx into the views collection.
  curl -X PUT \
       -H 'Content-Type: application/json' \
       --data-binary @./my-usp-discovery.jsx \
       'http://localhost:7557/views/usp-discovery'

Or do it from inside the UI as an admin: navigate to the Admin → Views
page and edit the script for the view in question. The next page render
picks up the new bundle. Validation against the JSX dialect is done by
``lib/bundle-views.ts::validateViewScript`` and surfaces any syntax
errors back to the editor before the document is saved.

A few constraints to keep in mind when authoring a replacement:

- The script body is wrapped in a ``function(node, setTimeout, setInterval, Date)`` —
  the JSX file should ``return`` a ``ViewNode`` (or a signal of one) as
  its last statement; see ``seed/views.d.ts`` for the available globals.
- Composed views are looked up by element name: ``<usp-discovery .../>``
  resolves to the view stored under ``_id: "usp-discovery"`` if it
  exists, otherwise it falls through to a plain DOM element with that
  tag name.
- Only the ``do-*`` primitives (``do-fetch``, ``do-task``, ``do-count``,
  ``do-notify``, ``do-delete``, ``do-ping``, ``do-yaml-stringify``,
  ``do-update-tags``) reach the network or the task queue. Stick to
  these — direct ``fetch()`` is intentionally not exposed.

Source files
------------

The unmodified seed views live in the ``seed/`` directory of the
GenieACS source tree:

- ``seed/usp-devices.jsx`` — the list page.
- ``seed/usp-device.jsx`` — the per-device detail page with the
  Overview / Discovery / RPC tab strip.
- ``seed/usp-discovery.jsx`` — the Discovery tab body.
- ``seed/usp-rpc.jsx`` — the RPC console tab body.
- ``seed/usp-overview.jsx`` — the dashboard widget.

These are the canonical starting points for downstream customisation:
copy the file, change what you need, and ``PUT`` the result into the
``views`` collection under the same ``_id`` to override the shipped
defaults.
