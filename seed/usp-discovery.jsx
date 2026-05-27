// USP discovery tab — lazily-expanded data model tree.
//
// Renders the cached data model from the GenieACS device document as a
// collapsible tree rooted at `Device.`. Children are pulled from the keys
// already on the device document; expanding a node that has no cached
// children offers two ways to populate it:
//
//   - "Discover schema" submits a `getSupportedDM` task — the USP
//     controller translates this into a `GetSupportedDM` USP Message and
//     persists the returned params/commands/events onto the device.
//   - "Refresh subtree" submits a `refreshObject` task which the
//     controller maps to a partial-path `Get` against the device,
//     refreshing live values.
//
// Each visible row shows: path segment, value (for leaf params), the
// xsd:* type, and a writable badge. The whole tree is not rendered at
// once — only branches the user has expanded.
//
// Attributes:
//   deviceId - Device identifier string
//   device   - Optional cached device document; if omitted the tab will
//              fetch it itself.

const deviceId = node.attributes.deviceId.get();
const deviceAttr = node.attributes.device?.get();
const devicesSig = new Signal.State(deviceAttr ? [deviceAttr] : null);
const taskCmd = new Signal.State(null);
const taskStatus = new Signal.State(null);
const expanded = new Signal.State(new Set(["Device."]));

const ROOT = "Device.";

const TYPE_COLORS = {
  "xsd:string": "bg-stone-100 text-stone-700",
  "xsd:boolean": "bg-amber-100 text-amber-800",
  "xsd:int": "bg-blue-100 text-blue-800",
  "xsd:unsignedInt": "bg-blue-100 text-blue-800",
  "xsd:long": "bg-blue-100 text-blue-800",
  "xsd:unsignedLong": "bg-blue-100 text-blue-800",
  "xsd:dateTime": "bg-purple-100 text-purple-800",
  "xsd:base64": "bg-pink-100 text-pink-800",
  "xsd:hexBinary": "bg-pink-100 text-pink-800",
};

const typeBadge = (type) => {
  if (!type) return null;
  const cls = TYPE_COLORS[type] || "bg-stone-100 text-stone-700";
  const short = type.startsWith("xsd:") ? type.slice(4) : type;
  return (
    <span
      class={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono ${cls}`}
      title={type}
    >
      {short}
    </span>
  );
};

const writableBadge = (writable) =>
  writable ? (
    <span
      class="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-800"
      title="Parameter is writable"
    >
      RW
    </span>
  ) : (
    <span
      class="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-stone-100 text-stone-500"
      title="Parameter is read-only"
    >
      RO
    </span>
  );

const toggle = (path) => {
  const next = new Set(expanded.get());
  if (next.has(path)) next.delete(path);
  else next.add(path);
  expanded.set(next);
};

// Returns immediate children of `path` based on cached document keys.
// A "child" is any key whose path starts with `path` and whose next dot
// is the last separator before the suffix. Returns sorted array of
// fully-qualified child paths (object paths end in `.`).
const childrenOf = (device, path) => {
  const children = new Set();
  const prefix = path; // already ends in "."
  for (const key of Object.keys(device)) {
    if (!key.startsWith(prefix)) continue;
    if (key.endsWith(":object")) {
      // "Device.WiFi:object" -> path "Device.WiFi"
      const rawPath = key.slice(0, -7);
      if (!rawPath.startsWith(prefix)) continue;
      const rest = rawPath.slice(prefix.length);
      if (!rest) continue;
      // Direct child segment only (no further dot)
      const dot = rest.indexOf(".");
      if (dot === -1) children.add(`${prefix}${rest}.`);
      continue;
    }
    if (key.includes(":")) continue;
    const rest = key.slice(prefix.length);
    if (!rest) continue;
    const dot = rest.indexOf(".");
    if (dot === -1) {
      // Leaf parameter directly under `path`
      children.add(`${prefix}${rest}`);
    }
    // If there's a deeper dot but no :object marker, it'll show up via
    // the marker case above — skip here.
  }
  return [...children].sort();
};

// Render a single row + (if expanded) its children recursively.
const renderNode = (device, fullPath, depth) => {
  const isObject = fullPath.endsWith(".");
  const segment = isObject
    ? fullPath.slice(fullPath.lastIndexOf(".", fullPath.length - 2) + 1, -1) +
      "."
    : fullPath.slice(fullPath.lastIndexOf(".") + 1);
  const objectKey = isObject ? fullPath.slice(0, -1) : fullPath;
  const writable = device[`${objectKey}:writable`];
  const type = device[`${fullPath}:type`];
  const value = isObject ? null : device[fullPath];
  const isOpen = expanded.get().has(fullPath);
  const indent = depth * 16;

  const rows = [];
  rows.push(
    <div
      key={fullPath}
      class="flex items-center py-1 hover:bg-stone-50 border-b border-stone-100"
      style={`padding-left: ${indent + 8}px;`}
    >
      {isObject ? (
        <button
          type="button"
          onclick={() => toggle(fullPath)}
          class="w-4 text-stone-500 hover:text-stone-700 font-mono text-xs flex-shrink-0"
          title={isOpen ? "Collapse" : "Expand"}
        >
          {isOpen ? "▾" : "▸"}
        </button>
      ) : (
        <span class="w-4 flex-shrink-0" />
      )}
      <span
        class={`font-mono text-xs flex-shrink-0 ${
          isObject ? "text-cyan-700 font-medium" : "text-stone-900"
        }`}
      >
        {segment}
      </span>
      {!isObject && value !== undefined && value !== null && (
        <span
          class="ml-3 text-xs text-stone-600 truncate max-w-md font-mono"
          title={String(value)}
        >
          = {String(value)}
        </span>
      )}
      <span class="ml-auto flex items-center space-x-1 pr-2">
        {!isObject && typeBadge(type)}
        {!isObject && writableBadge(writable)}
        {isObject && (
          <>
            <button
              type="button"
              onclick={() =>
                taskCmd.set({
                  name: "refreshObject",
                  device: deviceId,
                  objectName: fullPath.slice(0, -1),
                })
              }
              class="px-2 py-0.5 text-[10px] font-medium rounded bg-cyan-50 text-cyan-700 hover:bg-cyan-100"
              title="Refresh subtree (refreshObject)"
            >
              Refresh
            </button>
            <button
              type="button"
              onclick={() =>
                taskCmd.set({
                  name: "getSupportedDM",
                  device: deviceId,
                  objectName: fullPath.slice(0, -1),
                  firstLevelOnly: false,
                  returnCommands: true,
                  returnEvents: true,
                  returnParams: true,
                })
              }
              class="px-2 py-0.5 text-[10px] font-medium rounded bg-purple-50 text-purple-700 hover:bg-purple-100"
              title="Discover schema (getSupportedDM)"
            >
              Discover
            </button>
          </>
        )}
      </span>
    </div>,
  );

  if (isObject && isOpen) {
    const kids = childrenOf(device, fullPath);
    if (!kids.length) {
      rows.push(
        <div
          key={`${fullPath}:empty`}
          class="text-xs text-stone-400 italic border-b border-stone-100 py-1"
          style={`padding-left: ${indent + 32}px;`}
        >
          No cached children — use Discover or Refresh.
        </div>,
      );
    } else {
      for (const k of kids) rows.push(renderNode(device, k, depth + 1));
    }
  }
  return rows;
};

const tree = new Signal.Computed(() => {
  const list = devicesSig.get();
  if (!list)
    return (
      <div class="p-4 text-sm text-stone-500">Loading data model…</div>
    );
  const device = list[0];
  if (!device)
    return (
      <div class="p-4 text-sm text-stone-500">
        Device <span class="font-mono">{deviceId}</span> not found.
      </div>
    );
  // Make `expanded` reactive
  expanded.get();
  return (
    <div class="bg-white shadow rounded-lg overflow-hidden">
      <div class="px-3 py-2 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
        <span class="text-xs font-semibold text-stone-600 uppercase tracking-wide">
          Data model tree
        </span>
        <div class="space-x-2">
          <button
            type="button"
            onclick={() =>
              taskCmd.set({
                name: "refreshObject",
                device: deviceId,
                objectName: "Device",
              })
            }
            class="px-2 py-1 text-xs font-medium rounded bg-cyan-50 text-cyan-700 hover:bg-cyan-100"
            title="Refresh entire Device. subtree"
          >
            Refresh all
          </button>
          <button
            type="button"
            onclick={() =>
              taskCmd.set({
                name: "getSupportedDM",
                device: deviceId,
                objectName: "Device.",
                firstLevelOnly: false,
                returnCommands: true,
                returnEvents: true,
                returnParams: true,
              })
            }
            class="px-2 py-1 text-xs font-medium rounded bg-purple-50 text-purple-700 hover:bg-purple-100"
            title="Discover entire schema"
          >
            Discover all
          </button>
        </div>
      </div>
      <div class="overflow-y-auto" style="max-height: 600px;">
        {renderNode(device, ROOT, 0)}
      </div>
    </div>
  );
});

const taskBanner = new Signal.Computed(() => {
  const s = taskStatus.get();
  if (!s) return null;
  const tone =
    s === "fault" || s === "stale"
      ? "bg-red-50 text-red-800 ring-red-200"
      : s === "done"
        ? "bg-green-50 text-green-800 ring-green-200"
        : "bg-amber-50 text-amber-800 ring-amber-200";
  return (
    <div
      class={`mb-3 px-3 py-2 rounded text-xs ring-1 ${tone}`}
    >
      Task status: <span class="font-mono font-semibold">{s}</span>
    </div>
  );
});

// @ts-expect-error: top-level return (script is wrapped in a function at runtime)
return (
  <>
    {!deviceAttr && (
      <do-fetch
        arg={{ resource: "devices", filter: `DeviceID.ID = "${deviceId}"` }}
        res={devicesSig}
      />
    )}
    <do-task arg={taskCmd} res={taskStatus} />
    {taskBanner}
    {tree}
    <p class="text-xs text-stone-400 italic mt-3">
      Tree is rendered from the cached device document. Use Discover to
      populate missing branches.
    </p>
  </>
);
