// USP device listing page.
//
// Lists all devices known to the controller whose _protocol is "usp" or
// "both" (i.e. devices that have been seen via a USP MTP). Devices are still
// stored in the shared `devices` collection alongside CWMP devices; the
// _protocol discriminator and the _usp subdocument distinguish them.
//
// Columns: device id (link to the USP detail page), USP endpoint id, vendor
// info, software version, preferred MTP, last inform timestamp, plus per-MTP
// connection status badges (mqtt / ws / stomp).

const devices = new Signal.State(null);

// Filter for USP-capable devices. `_protocol` and `_usp.*` are top-level
// fields on the device document and are projected through to view scripts
// (see lib/ui/db.ts).
const USP_FILTER = "_protocol = 'usp' OR _protocol = 'both'";

const FIVE_MINUTES = 5 * 60 * 1000;

const timestamp = (d) => {
  if (!d) return "";
  const t = d instanceof Date ? +d : typeof d === "number" ? d : Date.parse(d);
  if (!t || isNaN(t)) return "";
  return new Date(t).toLocaleString();
};

const mtpBadge = (label, state) => {
  const ok = !!state?.connected;
  return (
    <span
      class={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium mr-1 ${
        ok
          ? "bg-green-100 text-green-800 ring-1 ring-green-200"
          : "bg-stone-100 text-stone-500 ring-1 ring-stone-200"
      }`}
      title={
        state?.lastSeen
          ? `${label}: last seen ${timestamp(state.lastSeen)}`
          : `${label}: never connected`
      }
    >
      <span class="font-mono mr-1">{ok ? "✓" : "✗"}</span>
      {label}
    </span>
  );
};

const preferredBadge = (mtp) => {
  if (!mtp)
    return <span class="text-xs text-stone-400 italic">none</span>;
  const colors = {
    mqtt: "bg-blue-100 text-blue-800 ring-blue-200",
    ws: "bg-purple-100 text-purple-800 ring-purple-200",
    stomp: "bg-amber-100 text-amber-800 ring-amber-200",
  };
  return (
    <span
      class={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ring-1 ${
        colors[mtp] || "bg-stone-100 text-stone-700 ring-stone-200"
      }`}
    >
      {mtp.toUpperCase()}
    </span>
  );
};

const tableBody = new Signal.Computed(() => {
  const rows = devices.get();
  if (!rows)
    return (
      <tr>
        <td
          class="bg-stripes text-sm font-medium text-center text-stone-500 p-4"
          colspan="8"
        >
          Loading...
        </td>
      </tr>
    );
  if (!rows.length)
    return (
      <tr>
        <td
          class="bg-stripes text-sm font-medium text-center text-stone-500 p-4"
          colspan="8"
        >
          No USP devices
        </td>
      </tr>
    );

  return rows.map((d) => {
    const usp = d["_usp"] || {};
    const deviceId = d["DeviceID.ID"] || d["_id"];
    const lastInform = d["Events.Inform"] ?? d["_lastInform"];
    return (
      <tr key={deviceId} class="border-b border-stone-200">
        <td class="whitespace-nowrap pl-6 pr-3 py-3 text-sm font-medium text-cyan-700 hover:text-cyan-900">
          <a href={`#!/devices/${encodeURIComponent(deviceId)}`}>
            {deviceId}
          </a>
        </td>
        <td class="whitespace-nowrap px-3 py-3 text-sm font-mono text-stone-900">
          {usp.endpointId || ""}
        </td>
        <td class="whitespace-nowrap px-3 py-3 text-sm text-stone-900">
          {d["Device.DeviceInfo.Manufacturer"] || ""}
        </td>
        <td class="whitespace-nowrap px-3 py-3 text-sm text-stone-900">
          {d["Device.DeviceInfo.ProductClass"] || ""}
        </td>
        <td class="whitespace-nowrap px-3 py-3 text-sm text-stone-900">
          {d["Device.DeviceInfo.SoftwareVersion"] || ""}
        </td>
        <td class="whitespace-nowrap px-3 py-3 text-sm">
          {preferredBadge(usp.preferredMtp)}
        </td>
        <td class="whitespace-nowrap px-3 py-3 text-sm">
          {mtpBadge("mqtt", usp.mqtt)}
          {mtpBadge("ws", usp.ws)}
          {mtpBadge("stomp", usp.stomp)}
        </td>
        <td class="whitespace-nowrap px-3 py-3 pr-6 text-sm text-stone-500 tabular-nums">
          {timestamp(lastInform)}
        </td>
      </tr>
    );
  });
});

const totalCount = new Signal.State(0);
const mqttCount = new Signal.State(0);
const wsCount = new Signal.State(0);
const stompCount = new Signal.State(0);

// @ts-expect-error: top-level return (script is wrapped in a function at runtime)
return (
  <>
    <do-fetch
      arg={{ resource: "devices", filter: USP_FILTER, freshness: FIVE_MINUTES }}
      res={devices}
    />
    <do-count
      arg={{ resource: "devices", filter: USP_FILTER }}
      res={totalCount}
    />
    <do-count
      arg={{
        resource: "devices",
        filter: `(${USP_FILTER}) AND _usp.mqtt.connected = true`,
      }}
      res={mqttCount}
    />
    <do-count
      arg={{
        resource: "devices",
        filter: `(${USP_FILTER}) AND _usp.ws.connected = true`,
      }}
      res={wsCount}
    />
    <do-count
      arg={{
        resource: "devices",
        filter: `(${USP_FILTER}) AND _usp.stomp.connected = true`,
      }}
      res={stompCount}
    />
    <div class="p-4">
      <div class="flex items-baseline justify-between mb-4">
        <h1 class="text-2xl font-semibold text-stone-800">USP Devices</h1>
        <span class="text-sm text-stone-500">
          Total: <span class="font-medium text-stone-700">{totalCount}</span>
          {" · "}MQTT online:{" "}
          <span class="font-medium text-stone-700">{mqttCount}</span>
          {" · "}WS online:{" "}
          <span class="font-medium text-stone-700">{wsCount}</span>
          {" · "}STOMP online:{" "}
          <span class="font-medium text-stone-700">{stompCount}</span>
        </span>
      </div>
      <div class="shadow overflow-hidden rounded-lg w-full bg-white">
        <table class="min-w-full divide-y divide-stone-200">
          <thead class="bg-stone-50">
            <tr>
              <th class="py-3.5 text-left text-sm font-semibold text-stone-500 pl-6 pr-3">
                Device
              </th>
              <th class="py-3.5 text-left text-sm font-semibold text-stone-500 px-3">
                Endpoint ID
              </th>
              <th class="py-3.5 text-left text-sm font-semibold text-stone-500 px-3">
                Manufacturer
              </th>
              <th class="py-3.5 text-left text-sm font-semibold text-stone-500 px-3">
                Product class
              </th>
              <th class="py-3.5 text-left text-sm font-semibold text-stone-500 px-3">
                Software version
              </th>
              <th class="py-3.5 text-left text-sm font-semibold text-stone-500 px-3">
                Preferred MTP
              </th>
              <th class="py-3.5 text-left text-sm font-semibold text-stone-500 px-3">
                MTP status
              </th>
              <th class="py-3.5 text-left text-sm font-semibold text-stone-500 px-3 pr-6">
                Last inform
              </th>
            </tr>
          </thead>
          <tbody class="bg-white">{tableBody}</tbody>
        </table>
      </div>
    </div>
  </>
);
