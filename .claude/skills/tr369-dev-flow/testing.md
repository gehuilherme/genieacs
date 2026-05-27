# Testing — dev & E2E commands

## Local build (no docker)

```bash
npm install
npm run build                # full build (USP .proto schemas embedded via esbuild text loader; no protoc required)
npm run lint                 # zero warnings before commit
npm test                     # node --test against test/*.test.ts
```

## Docker dev stack (PR1+)

```bash
cd deploy
docker compose -f docker-compose.dev.yaml up                       # default = full stack
docker compose -f docker-compose.dev.yaml up mongo nats mosquitto  # infra only
docker compose -f docker-compose.dev.yaml --profile cwmp-only up   # CWMP-only deployment
docker compose -f docker-compose.dev.yaml --profile usp-only up    # USP-only deployment
docker compose -f docker-compose.dev.yaml logs -f genieacs-usp-controller
docker compose -f docker-compose.dev.yaml down -v                  # full reset (drops volumes)
```

## E2E with obuspa agent (PR2+)

```bash
cd deploy
docker compose -f docker-compose.dev.yaml -f docker-compose.e2e.yaml --profile e2e up
# obuspa-mqtt, obuspa-ws, obuspa-stomp join the stack; each sends Boot Notify on its MTP
```

## Inspecting the running stack

```bash
# Mongo — devices and tasks
docker compose exec mongo mongosh genieacs --eval 'db.devices.find({_protocol:"usp"}).limit(5).pretty()'
docker compose exec mongo mongosh genieacs --eval 'db.tasks.find().sort({timestamp:-1}).limit(10).pretty()'
docker compose exec mongo mongosh genieacs --eval 'db.faults.find().pretty()'

# NATS — subjects, streams, KV
docker compose exec nats nats stream ls
docker compose exec nats nats sub 'genieacs.usp.v1.>' &     # tail all USP traffic
docker compose exec nats nats stream info GENIEACS_USP

# Mosquitto — MQTT traffic
docker compose exec mosquitto mosquitto_sub -h localhost -t 'genieacs/usp/v1/#' -v
```

## Sending a task via NBI

```bash
# Find device id
curl -s http://localhost:7557/devices?query='{"_protocol":"usp"}' | jq '.[0]._id'

# Send Get
curl -X POST http://localhost:7557/devices/<id>/tasks \
  -H 'Content-Type: application/json' \
  -d '{"name":"getParameterValues","parameterNames":["Device.DeviceInfo.SoftwareVersion"]}'

# Send Set
curl -X POST http://localhost:7557/devices/<id>/tasks \
  -H 'Content-Type: application/json' \
  -d '{"name":"setParameterValues","parameterValues":[["Device.ManagementServer.PeriodicInformInterval", 60, "xsd:unsignedInt"]]}'

# Send Reboot (translates to USP Operate Device.Reboot())
curl -X POST http://localhost:7557/devices/<id>/tasks \
  -H 'Content-Type: application/json' \
  -d '{"name":"reboot"}'
```

## Unit test conventions

- Files in `test/usp-*.test.ts` use Node's native runner (`node --test`).
- Mock NATS via a fake transport that exposes `subscribe()` / `publish()` and
  records emitted messages — see `test/usp-dispatcher.test.ts`.
- Proto round-trip tests use a frozen set of fixtures in `test/fixtures/usp/`.
- Endpoint ID parser tests include adversarial inputs (`os::vendor-mac`,
  `imei::123456789`, `proto::vendor::oui::sn` malformed, etc).

## When a test fails or device doesn't show

See `docs/usp/troubleshooting.rst` (PR6). Common checks:

1. Mongo: device document exists?
   `db.devices.findOne({"_usp.endpointId":"<id>"})`
2. NATS: stream `GENIEACS_USP` has pending messages?
   `nats stream info GENIEACS_USP`
3. MQTT: broker reachable from controller?
   `docker compose exec genieacs-usp-mqtt nc -zv mosquitto 1883`
4. WS: subprotocol negotiated? Look for `Sec-WebSocket-Protocol: v1.usp` in
   upgrade
5. STOMP: destination subscribed? Check broker admin console
