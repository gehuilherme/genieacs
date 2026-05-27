# obuspa fixtures

This directory will hold factory-reset fixtures and certificate material for
the OB-USP-A agents used by the end-to-end test stack
(`deploy/docker-compose.e2e.yaml`).

The fixtures will be filled out across the next three PRs:

- **PR2 (MQTT MTP)** -- `obuspa-mqtt.txt`: agent provisioned to talk to the
  in-stack Mosquitto broker on `genieacs/usp/v1/*` topics.
- **PR3 (WebSocket MTP)** -- `obuspa-ws.txt`: agent provisioned to connect to
  `ws://genieacs-usp-ws:8080/usp` with the `v1.usp` subprotocol.
- **PR4 (STOMP MTP)** -- `obuspa-stomp.txt`: agent provisioned to connect to
  an external STOMP broker (ActiveMQ).

All fixtures will be adapted from the existing factory-reset dumps in
`oktopus/agent/` (upstream OB-USP-A) and trimmed to the minimum data-model
state required to exercise the GenieACS USP controller.

Until those PRs land these files do not exist, and the `e2e` profile in
`docker-compose.e2e.yaml` cannot start. The compose syntax remains valid
either way.
