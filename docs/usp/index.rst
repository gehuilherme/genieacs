TR-369 (USP) Support
====================

TR-369, also known as the User Services Platform (USP), is the Broadband
Forum's successor to TR-069/CWMP. It defines a protobuf-based control
protocol that runs over modern transports (MQTT, WebSocket, STOMP, CoAP)
and is designed for IoT-scale deployments and post-CWMP CPE management.

GenieACS supports TR-369 as a **parallel protocol** to TR-069: USP devices
live in the same ``devices`` collection, share the same provisions,
presets, virtual parameters and expression engine, and can be managed
through the same NBI API. The two stacks run side by side and CPEs may
even speak both protocols at once.

.. toctree::
  :caption: TR-369 (USP):
  :maxdepth: 2

  overview
  architecture
  data-model
  configuration
  quick-start
  mtp/mqtt
  mtp/websocket
  mtp/stomp
  rpc-mapping
  subscriptions
  ui-views
  troubleshooting
  extending-mtp
