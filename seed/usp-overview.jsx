// USP overview widget for the dashboard.
//
// Displays a compact breakdown of USP-capable devices by MTP connection
// state: how many are currently online via MQTT, WebSocket or STOMP, and
// how many are completely offline. Counts are read with <do-count>; the
// totals are independent (a device with both MQTT and WS connected counts
// toward both).
//
// Drop this into a dashboard view like:
//   <usp-overview />

const USP_FILTER = "_protocol = 'usp' OR _protocol = 'both'";

const slices = [
  {
    label: "MQTT online",
    color: "#3182bd",
    filter: `(${USP_FILTER}) AND _usp.mqtt.connected = true`,
  },
  {
    label: "WebSocket online",
    color: "#9e9ac8",
    filter: `(${USP_FILTER}) AND _usp.ws.connected = true`,
  },
  {
    label: "STOMP online",
    color: "#fdae6b",
    filter: `(${USP_FILTER}) AND _usp.stomp.connected = true`,
  },
  {
    label: "Offline",
    color: "#d9d9d9",
    filter: `(${USP_FILTER}) AND _usp.mqtt.connected != true AND _usp.ws.connected != true AND _usp.stomp.connected != true`,
  },
].map((s) => ({ ...s, count: new Signal.State(0) }));

const totalCount = new Signal.State(0);

// @ts-expect-error: top-level return (script is wrapped in a function at runtime)
return (
  <div class="p-4 bg-white shadow rounded-lg sm:p-6 sm:px-8">
    <do-count
      arg={{ resource: "devices", filter: USP_FILTER }}
      res={totalCount}
    />
    {slices.map((s) => (
      <do-count
        arg={{ resource: "devices", filter: s.filter }}
        res={s.count}
      />
    ))}
    <h2 class="text-lg font-semibold text-stone-700 truncate mb-4 text-center">
      USP Devices
    </h2>
    <table class="table text-sm w-full">
      <tbody>
        {slices.map((s) => (
          <tr>
            <td>
              <span
                class="inline-block w-3 h-3 border border-stone-200 mr-2 align-middle"
                style={{ "background-color": s.color }}
              />
              <span class="align-middle">{s.label}</span>
            </td>
            <td class="text-right tabular-nums">
              <a
                class="text-cyan-700 hover:text-cyan-900 font-medium"
                href={`#!/devices/?filter=${encodeURIComponent(s.filter)}`}
              >
                {s.count}
              </a>
            </td>
          </tr>
        ))}
        <tr class="border-t border-stone-200">
          <td class="pt-2 font-medium">Total USP devices</td>
          <td class="pt-2 text-right tabular-nums font-medium">
            <a
              class="text-cyan-700 hover:text-cyan-900"
              href={`#!/devices/?filter=${encodeURIComponent(USP_FILTER)}`}
            >
              {totalCount}
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
);
