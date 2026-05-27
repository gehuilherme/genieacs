// USP device detail page.
//
// Displays USP-specific information for a single device split across three
// tabs:
//   - Overview: endpoint identity, preferred MTP, per-MTP connection state,
//     last Notify, plus the standard TR-181 Device.DeviceInfo overview
//     parameters.
//   - Discovery: lazily expanded data-model tree, with buttons to refresh
//     subtrees and request schema discovery via GetSupportedDM. Implemented
//     in the `usp-discovery` view.
//   - RPC: interactive console to submit ad-hoc USP RPCs (Get/Set/Add/
//     Delete/Operate/GetInstances/GetSupportedDM). Implemented in the
//     `usp-rpc` view.
//
// Attributes:
//   deviceId - Device identifier string

const deviceId = node.attributes.deviceId.get();
const devices = new Signal.State(null);
const activeTab = new Signal.State("overview");

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "discovery", label: "Discovery" },
  { id: "rpc", label: "RPC" },
];

const tabStrip = new Signal.Computed(() => {
  const active = activeTab.get();
  return (
    <nav class="border-b border-stone-200 -mx-4 px-4">
      <ul class="flex space-x-6 text-sm font-medium">
        {TABS.map((t) => (
          <li>
            <button
              type="button"
              onclick={() => activeTab.set(t.id)}
              class={`px-1 py-3 border-b-2 transition-colors ${
                active === t.id
                  ? "border-cyan-600 text-cyan-700"
                  : "border-transparent text-stone-500 hover:text-stone-700 hover:border-stone-300"
              }`}
            >
              {t.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
});

const timeAgo = (ts) => {
  if (!ts) return "";
  const t = ts instanceof Date ? +ts : typeof ts === "number" ? ts : Date.parse(ts);
  if (!t || isNaN(t)) return "";
  const units = [
    { label: "year", ms: 31536000000 },
    { label: "month", ms: 2592000000 },
    { label: "day", ms: 86400000 },
    { label: "hour", ms: 3600000 },
    { label: "minute", ms: 60000 },
    { label: "second", ms: 1000 },
  ];
  let diff = Date.now() - t;
  if (diff < 0) return new Date(t).toLocaleString();
  const parts = [];
  for (const { label, ms } of units) {
    if (diff >= ms) {
      const n = Math.floor(diff / ms);
      diff %= ms;
      parts.push(`${n} ${label}${n > 1 ? "s" : ""}`);
      if (parts.length === 2) break;
    }
  }
  return `${new Date(t).toLocaleString()} (${parts.join(" ") || "just now"}${parts.length ? " ago" : ""})`;
};

const formatTimestamp = (ts) => {
  if (!ts) return "";
  const t = ts instanceof Date ? +ts : typeof ts === "number" ? ts : Date.parse(ts);
  if (!t || isNaN(t)) return "";
  return new Date(t).toLocaleString();
};

const statusBadge = (label, ok) => (
  <span
    class={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
      ok
        ? "bg-green-100 text-green-800 ring-1 ring-green-200"
        : "bg-stone-100 text-stone-500 ring-1 ring-stone-200"
    }`}
  >
    <span class="font-mono mr-1">{ok ? "✓" : "✗"}</span>
    {label}
  </span>
);

const infoRow = (label, value) => (
  <tr class="border-b border-stone-200">
    <th class="text-sm font-medium text-stone-500 text-left px-6 py-3 align-top w-48">
      {label}
    </th>
    <td class="text-sm text-stone-900 px-6 py-3">
      {value || <span class="text-stone-400 italic">—</span>}
    </td>
  </tr>
);

const mtpCard = (label, state) => {
  if (!state) {
    return (
      <div class="bg-white shadow rounded-lg p-4">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-sm font-semibold text-stone-700 uppercase">
            {label}
          </h3>
          {statusBadge("not configured", false)}
        </div>
        <p class="text-xs text-stone-400 italic">
          No state recorded for this MTP.
        </p>
      </div>
    );
  }
  return (
    <div class="bg-white shadow rounded-lg p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold text-stone-700 uppercase">{label}</h3>
        {statusBadge(state.connected ? "connected" : "disconnected", !!state.connected)}
      </div>
      <dl class="text-xs space-y-1">
        <div class="flex justify-between gap-2">
          <dt class="text-stone-500">Last seen</dt>
          <dd
            class="text-stone-900 text-right"
            title={timeAgo(state.lastSeen)}
          >
            {formatTimestamp(state.lastSeen)}
          </dd>
        </div>
        {state.agentTopic && (
          <div class="flex justify-between gap-2">
            <dt class="text-stone-500">Agent topic</dt>
            <dd class="text-stone-900 font-mono text-right break-all">
              {state.agentTopic}
            </dd>
          </div>
        )}
        {state.controllerTopic && (
          <div class="flex justify-between gap-2">
            <dt class="text-stone-500">Controller topic</dt>
            <dd class="text-stone-900 font-mono text-right break-all">
              {state.controllerTopic}
            </dd>
          </div>
        )}
        {state.connId && (
          <div class="flex justify-between gap-2">
            <dt class="text-stone-500">Connection id</dt>
            <dd class="text-stone-900 font-mono text-right break-all">
              {state.connId}
            </dd>
          </div>
        )}
        {state.remoteAddress && (
          <div class="flex justify-between gap-2">
            <dt class="text-stone-500">Remote address</dt>
            <dd class="text-stone-900 font-mono text-right">
              {state.remoteAddress}
            </dd>
          </div>
        )}
        {state.destination && (
          <div class="flex justify-between gap-2">
            <dt class="text-stone-500">Destination</dt>
            <dd class="text-stone-900 font-mono text-right break-all">
              {state.destination}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
};

const page = new Signal.Computed(() => {
  const list = devices.get();
  if (!list)
    return (
      <div class="p-4 text-sm text-stone-500">Loading USP device…</div>
    );
  const device = list[0];
  if (!device)
    return (
      <div class="p-4">
        <h1 class="text-2xl font-semibold text-stone-800">USP Device</h1>
        <p class="mt-4 text-sm text-stone-500">
          Device <span class="font-mono">{deviceId}</span> not found.
        </p>
      </div>
    );

  const usp = device["_usp"] || {};
  const parts = usp.endpointParts || {};
  const title = usp.endpointId || deviceId;

  const overviewBody = (
    <div class="space-y-6">
      <section>
        <h2 class="text-lg font-semibold text-stone-700 mb-3">USP info</h2>
        <table class="table-auto bg-white shadow rounded-lg divide-y divide-stone-200 w-max max-w-full">
          <tbody>
            {infoRow("Endpoint ID", usp.endpointId)}
            {infoRow("Scheme", parts.scheme)}
            {infoRow("Vendor", parts.vendor)}
            {infoRow("OUI", parts.oui)}
            {infoRow("Serial", parts.serial)}
            {infoRow(
              "Preferred MTP",
              usp.preferredMtp ? usp.preferredMtp.toUpperCase() : null,
            )}
            {infoRow(
              "Supported MTPs",
              Array.isArray(usp.supportedMtps) && usp.supportedMtps.length
                ? usp.supportedMtps.map((m) => m.toUpperCase()).join(", ")
                : null,
            )}
            {infoRow(
              "Last Notify type",
              usp.lastNotify?.type,
            )}
            {infoRow(
              "Last Notify time",
              usp.lastNotify?.ts ? formatTimestamp(usp.lastNotify.ts) : null,
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h2 class="text-lg font-semibold text-stone-700 mb-3">MTP status</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          {mtpCard("MQTT", usp.mqtt)}
          {mtpCard("WebSocket", usp.ws)}
          {mtpCard("STOMP", usp.stomp)}
        </div>
      </section>

      <section>
        <h2 class="text-lg font-semibold text-stone-700 mb-3">
          TR-181 Overview
        </h2>
        {device["Device:object"] ? (
          <device-page-tr181 device={device} />
        ) : (
          <div class="bg-white shadow rounded-lg p-4 text-sm text-stone-500">
            No TR-181 data model has been discovered for this device yet.
          </div>
        )}
      </section>
    </div>
  );

  const tabBody = new Signal.Computed(() => {
    const active = activeTab.get();
    if (active === "discovery")
      return <usp-discovery deviceId={deviceId} device={device} />;
    if (active === "rpc") return <usp-rpc deviceId={deviceId} />;
    return overviewBody;
  });

  return (
    <div class="p-4 space-y-6">
      <div>
        <h1 class="text-2xl font-semibold text-stone-800 break-all">{title}</h1>
        <p class="text-sm text-stone-500 mt-1">
          Device id:{" "}
          <span class="font-mono text-stone-700">{deviceId}</span>
        </p>
      </div>

      {tabStrip}
      {tabBody}
    </div>
  );
});

// @ts-expect-error: top-level return (script is wrapped in a function at runtime)
return (
  <>
    <do-fetch
      arg={{ resource: "devices", filter: `DeviceID.ID = "${deviceId}"` }}
      res={devices}
    />
    {page}
  </>
);
