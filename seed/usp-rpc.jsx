// USP RPC console — submit ad-hoc tasks against a single USP device.
//
// Renders a form whose shape depends on the selected USP command, then
// POSTs a task via the standard `do-task` primitive. The same task names
// already understood by GenieACS (`getParameterValues`,
// `setParameterValues`, `addObject`, `deleteObject`, `operate`,
// `getInstances`, `getSupportedDM`) are reused — the USP controller
// translates them into the corresponding USP Messages, so this console
// works against both `_protocol = "usp"` and `_protocol = "both"`
// devices.
//
// After submission the most recent task `_id`, status and any fault are
// shown; status is refreshed by polling the /tasks endpoint with a
// filtered <do-fetch> retriggered on a setInterval.
//
// Attributes:
//   deviceId - Device identifier string

const deviceId = node.attributes.deviceId.get();

const COMMANDS = [
  { id: "getParameterValues", label: "Get" },
  { id: "setParameterValues", label: "Set" },
  { id: "addObject", label: "Add" },
  { id: "deleteObject", label: "Delete" },
  { id: "operate", label: "Operate" },
  { id: "getInstances", label: "GetInstances" },
  { id: "getSupportedDM", label: "GetSupportedDM" },
];

const command = new Signal.State("getParameterValues");
const taskCmd = new Signal.State(null);
const taskStatus = new Signal.State(null);
const lastTask = new Signal.State(null);
const taskPollTrigger = new Signal.State(0);
const taskFetched = new Signal.State(null);
const formError = new Signal.State(null);

// Form fields per command — held in plain object refs so we can read
// the current values out of input nodes via DOM (no two-way binding).
const fields = {
  getPaths: new Signal.State(
    "Device.DeviceInfo.SoftwareVersion\nDevice.DeviceInfo.SerialNumber",
  ),
  setRows: new Signal.State([
    { path: "", value: "", type: "xsd:string" },
  ]),
  addObject: new Signal.State("Device.WiFi.SSID."),
  addRows: new Signal.State([{ path: "", value: "", type: "xsd:string" }]),
  delPaths: new Signal.State(""),
  opCmd: new Signal.State("Device.Reboot()"),
  opArgs: new Signal.State([{ key: "", value: "" }]),
  giPaths: new Signal.State("Device.WiFi.SSID."),
  giFirstLevel: new Signal.State(false),
  gsPaths: new Signal.State("Device."),
  gsFirstLevel: new Signal.State(false),
  gsCommands: new Signal.State(true),
  gsEvents: new Signal.State(true),
  gsParams: new Signal.State(true),
};

const XSD_TYPES = [
  "xsd:string",
  "xsd:boolean",
  "xsd:int",
  "xsd:unsignedInt",
  "xsd:long",
  "xsd:unsignedLong",
  "xsd:dateTime",
  "xsd:base64",
  "xsd:hexBinary",
];

const splitLines = (s) =>
  s
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

const inputCls =
  "block w-full text-sm rounded border-stone-300 focus:ring-cyan-500 focus:border-cyan-500 font-mono px-2 py-1 border";

const labelCls = "block text-xs font-medium text-stone-600 mb-1";

const sectionCls = "space-y-3";

// --- Set / Add: table editor for [path, value, type] rows. ---
const renderKvtTable = (sig) => {
  const rows = sig.get();
  return (
    <div class="space-y-2">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs text-stone-500 uppercase">
            <th class="pr-2 py-1 font-medium">Path</th>
            <th class="pr-2 py-1 font-medium">Value</th>
            <th class="pr-2 py-1 font-medium w-40">Type</th>
            <th class="w-8" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr>
              <td class="pr-2 py-1">
                <input
                  type="text"
                  value={r.path}
                  oninput={(e) => {
                    const next = rows.slice();
                    next[i] = { ...next[i], path: e.target.value };
                    sig.set(next);
                  }}
                  placeholder="Device.WiFi.SSID.1.SSID"
                  class={inputCls}
                />
              </td>
              <td class="pr-2 py-1">
                <input
                  type="text"
                  value={r.value}
                  oninput={(e) => {
                    const next = rows.slice();
                    next[i] = { ...next[i], value: e.target.value };
                    sig.set(next);
                  }}
                  class={inputCls}
                />
              </td>
              <td class="pr-2 py-1">
                <select
                  value={r.type}
                  onchange={(e) => {
                    const next = rows.slice();
                    next[i] = { ...next[i], type: e.target.value };
                    sig.set(next);
                  }}
                  class={inputCls}
                >
                  {XSD_TYPES.map((t) => (
                    <option value={t}>{t}</option>
                  ))}
                </select>
              </td>
              <td class="py-1 text-center">
                <button
                  type="button"
                  onclick={() => sig.set(rows.filter((_, j) => j !== i))}
                  class="text-stone-400 hover:text-red-600 text-lg"
                  title="Remove row"
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onclick={() =>
          sig.set([...rows, { path: "", value: "", type: "xsd:string" }])
        }
        class="text-xs font-medium text-cyan-700 hover:text-cyan-900"
      >
        + Add row
      </button>
    </div>
  );
};

// --- Operate: key=value args table. ---
const renderKvTable = (sig) => {
  const rows = sig.get();
  return (
    <div class="space-y-2">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs text-stone-500 uppercase">
            <th class="pr-2 py-1 font-medium">Key</th>
            <th class="pr-2 py-1 font-medium">Value</th>
            <th class="w-8" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr>
              <td class="pr-2 py-1">
                <input
                  type="text"
                  value={r.key}
                  oninput={(e) => {
                    const next = rows.slice();
                    next[i] = { ...next[i], key: e.target.value };
                    sig.set(next);
                  }}
                  class={inputCls}
                />
              </td>
              <td class="pr-2 py-1">
                <input
                  type="text"
                  value={r.value}
                  oninput={(e) => {
                    const next = rows.slice();
                    next[i] = { ...next[i], value: e.target.value };
                    sig.set(next);
                  }}
                  class={inputCls}
                />
              </td>
              <td class="py-1 text-center">
                <button
                  type="button"
                  onclick={() => sig.set(rows.filter((_, j) => j !== i))}
                  class="text-stone-400 hover:text-red-600 text-lg"
                  title="Remove row"
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onclick={() => sig.set([...rows, { key: "", value: "" }])}
        class="text-xs font-medium text-cyan-700 hover:text-cyan-900"
      >
        + Add arg
      </button>
    </div>
  );
};

const form = new Signal.Computed(() => {
  const c = command.get();
  if (c === "getParameterValues") {
    return (
      <div class={sectionCls}>
        <label class={labelCls}>
          Parameter paths (one per line)
        </label>
        <textarea
          rows="6"
          class={inputCls}
          value={fields.getPaths.get()}
          oninput={(e) => fields.getPaths.set(e.target.value)}
        />

      </div>
    );
  }
  if (c === "setParameterValues") {
    return (
      <div class={sectionCls}>
        <label class={labelCls}>Parameter values</label>
        {renderKvtTable(fields.setRows)}
      </div>
    );
  }
  if (c === "addObject") {
    return (
      <div class={sectionCls}>
        <label class={labelCls}>Object path (multi-instance)</label>
        <input
          type="text"
          value={fields.addObject.get()}
          oninput={(e) => fields.addObject.set(e.target.value)}
          placeholder="Device.WiFi.SSID."
          class={inputCls}
        />
        <label class={labelCls}>Initial parameter values</label>
        {renderKvtTable(fields.addRows)}
      </div>
    );
  }
  if (c === "deleteObject") {
    return (
      <div class={sectionCls}>
        <label class={labelCls}>
          Object instance path(s) (one per line)
        </label>
        <textarea
          rows="4"
          class={inputCls}
          placeholder="Device.WiFi.SSID.3"
          value={fields.delPaths.get()}
          oninput={(e) => fields.delPaths.set(e.target.value)}
        />
      </div>
    );
  }
  if (c === "operate") {
    return (
      <div class={sectionCls}>
        <label class={labelCls}>Command path</label>
        <input
          type="text"
          value={fields.opCmd.get()}
          oninput={(e) => fields.opCmd.set(e.target.value)}
          placeholder="Device.Reboot()"
          class={inputCls}
        />
        <label class={labelCls}>Input arguments</label>
        {renderKvTable(fields.opArgs)}
      </div>
    );
  }
  if (c === "getInstances") {
    return (
      <div class={sectionCls}>
        <label class={labelCls}>
          Object paths (one per line)
        </label>
        <textarea
          rows="4"
          class={inputCls}
          placeholder="Device.WiFi.SSID."
          value={fields.giPaths.get()}
          oninput={(e) => fields.giPaths.set(e.target.value)}
        />
        <label class="flex items-center text-xs text-stone-700">
          <input
            type="checkbox"
            checked={fields.giFirstLevel.get()}
            onchange={(e) => fields.giFirstLevel.set(e.target.checked)}
            class="mr-2"
          />
          first_level_only
        </label>
      </div>
    );
  }
  if (c === "getSupportedDM") {
    return (
      <div class={sectionCls}>
        <label class={labelCls}>
          Object paths (one per line)
        </label>
        <textarea
          rows="4"
          class={inputCls}
          placeholder="Device."
          value={fields.gsPaths.get()}
          oninput={(e) => fields.gsPaths.set(e.target.value)}
        />
        <div class="flex flex-wrap gap-x-4 gap-y-2 text-xs text-stone-700">
          <label class="flex items-center">
            <input
              type="checkbox"
              checked={fields.gsFirstLevel.get()}
              onchange={(e) => fields.gsFirstLevel.set(e.target.checked)}
              class="mr-2"
            />
            first_level_only
          </label>
          <label class="flex items-center">
            <input
              type="checkbox"
              checked={fields.gsCommands.get()}
              onchange={(e) => fields.gsCommands.set(e.target.checked)}
              class="mr-2"
            />
            return_commands
          </label>
          <label class="flex items-center">
            <input
              type="checkbox"
              checked={fields.gsEvents.get()}
              onchange={(e) => fields.gsEvents.set(e.target.checked)}
              class="mr-2"
            />
            return_events
          </label>
          <label class="flex items-center">
            <input
              type="checkbox"
              checked={fields.gsParams.get()}
              onchange={(e) => fields.gsParams.set(e.target.checked)}
              class="mr-2"
            />
            return_params
          </label>
        </div>
      </div>
    );
  }
  return null;
});

// Build the task body from the current form state.
const buildTask = () => {
  const c = command.get();
  if (c === "getParameterValues") {
    const names = splitLines(fields.getPaths.get());
    if (!names.length) {
      formError.set("Provide at least one parameter path.");
      return null;
    }
    return { name: c, device: deviceId, parameterNames: names };
  }
  if (c === "setParameterValues") {
    const rows = fields.setRows.get().filter((r) => r.path);
    if (!rows.length) {
      formError.set("Provide at least one parameter to set.");
      return null;
    }
    return {
      name: c,
      device: deviceId,
      parameterValues: rows.map((r) => [r.path, r.value, r.type]),
    };
  }
  if (c === "addObject") {
    const obj = fields.addObject.get().trim();
    if (!obj) {
      formError.set("Provide the object path.");
      return null;
    }
    const rows = fields.addRows.get().filter((r) => r.path);
    const t = { name: c, device: deviceId, objectName: obj };
    if (rows.length)
      t.parameterValues = rows.map((r) => [r.path, r.value, r.type]);
    return t;
  }
  if (c === "deleteObject") {
    const paths = splitLines(fields.delPaths.get());
    if (!paths.length) {
      formError.set("Provide at least one instance path.");
      return null;
    }
    // Multi-path delete is represented as multiple tasks — but our
    // <do-task> primitive only submits one task at a time. Submit the
    // first; the rest are deferred (queued via the form again).
    if (paths.length > 1)
      formError.set(
        `Only the first path will be submitted now (${paths.length} provided).`,
      );
    return { name: c, device: deviceId, objectName: paths[0] };
  }
  if (c === "operate") {
    const cmd = fields.opCmd.get().trim();
    if (!cmd) {
      formError.set("Provide the command path.");
      return null;
    }
    const args = fields.opArgs.get().filter((r) => r.key);
    const t = { name: c, device: deviceId, command: cmd };
    if (args.length) {
      t.inputArgs = {};
      for (const a of args) t.inputArgs[a.key] = a.value;
    }
    return t;
  }
  if (c === "getInstances") {
    const paths = splitLines(fields.giPaths.get());
    if (!paths.length) {
      formError.set("Provide at least one object path.");
      return null;
    }
    return {
      name: c,
      device: deviceId,
      objectName: paths[0],
      objectNames: paths,
      firstLevelOnly: fields.giFirstLevel.get(),
    };
  }
  if (c === "getSupportedDM") {
    const paths = splitLines(fields.gsPaths.get());
    if (!paths.length) {
      formError.set("Provide at least one object path.");
      return null;
    }
    return {
      name: c,
      device: deviceId,
      objectName: paths[0],
      objectNames: paths,
      firstLevelOnly: fields.gsFirstLevel.get(),
      returnCommands: fields.gsCommands.get(),
      returnEvents: fields.gsEvents.get(),
      returnParams: fields.gsParams.get(),
    };
  }
  return null;
};

const submit = () => {
  formError.set(null);
  const t = buildTask();
  if (!t) return;
  // Capture submission timestamp; we tail tasks newer than now-2s to
  // surface the just-created task by polling.
  lastTask.set({ submittedAt: Date.now(), name: t.name });
  taskCmd.set({ ...t, commit: true });
};

// Polling: every 3s, bump taskPollTrigger; do-fetch arg is computed
// from it so the query re-runs.
setInterval(() => taskPollTrigger.set(taskPollTrigger.get() + 1), 3000);

const pollArg = new Signal.Computed(() => {
  const lt = lastTask.get();
  taskPollTrigger.get(); // dep
  if (!lt) return null;
  return {
    resource: "tasks",
    filter: `device = "${deviceId}" AND name = "${lt.name}"`,
  };
});

const recentTaskRow = new Signal.Computed(() => {
  const lt = lastTask.get();
  if (!lt) return null;
  const all = taskFetched.get() || [];
  // Pick the task with the latest timestamp matching this command name.
  const candidates = all
    .filter(
      (t) =>
        !lt.submittedAt ||
        !t.timestamp ||
        +t.timestamp >= lt.submittedAt - 5000,
    )
    .sort((a, b) => (+b.timestamp || 0) - (+a.timestamp || 0));
  return candidates[0] || null;
});

const submitStatus = new Signal.Computed(() => {
  const s = taskStatus.get();
  const t = recentTaskRow.get();
  if (!s && !t) return null;
  const tone =
    s === "fault" || s === "stale" || t?.fault
      ? "bg-red-50 text-red-800 ring-red-200"
      : s === "done" || (t && !t.fault)
        ? "bg-green-50 text-green-800 ring-green-200"
        : "bg-amber-50 text-amber-800 ring-amber-200";
  return (
    <div class={`px-4 py-3 rounded ring-1 text-sm space-y-1 ${tone}`}>
      <div>
        Submission:{" "}
        <span class="font-mono font-semibold">{s || "—"}</span>
      </div>
      {t && (
        <>
          <div>
            Task <span class="font-mono">{t._id}</span> (
            <span class="font-mono">{t.name}</span>)
          </div>
          {t.timestamp && (
            <div class="text-xs">
              Queued at {new Date(+t.timestamp).toLocaleString()}
            </div>
          )}
          {t.fault && (
            <div class="text-xs font-mono break-all">
              fault: {t.fault.code || ""} {t.fault.message || ""}
            </div>
          )}
        </>
      )}
    </div>
  );
});

// @ts-expect-error: top-level return (script is wrapped in a function at runtime)
return (
  <>
    <do-task arg={taskCmd} res={taskStatus} />
    <do-fetch arg={pollArg} res={taskFetched} />
    <div class="bg-white shadow rounded-lg p-4 space-y-4">
      <div class="flex items-baseline justify-between">
        <h2 class="text-lg font-semibold text-stone-700">RPC Console</h2>
        <span class="text-xs text-stone-500">
          Device <span class="font-mono">{deviceId}</span>
        </span>
      </div>

      <div>
        <label class={labelCls}>Command</label>
        <select
          value={command}
          onchange={(e) => {
            command.set(e.target.value);
            formError.set(null);
          }}
          class={inputCls}
        >
          {COMMANDS.map((c) => (
            <option value={c.id}>
              {c.label} ({c.id})
            </option>
          ))}
        </select>
      </div>

      {form}

      {new Signal.Computed(() => {
        const err = formError.get();
        return err ? (
          <div class="text-xs text-amber-700 bg-amber-50 ring-1 ring-amber-200 rounded px-3 py-2">
            {err}
          </div>
        ) : null;
      })}

      <div class="flex items-center justify-end space-x-2 border-t border-stone-200 pt-3">
        <button
          type="button"
          onclick={submit}
          class="px-3 py-1.5 text-sm font-medium rounded text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500"
        >
          Submit task
        </button>
      </div>

      {submitStatus}
    </div>
    <p class="text-xs text-stone-400 italic mt-3">
      Tasks are persisted on the device's queue. Status is polled every 3s
      from /tasks. Use the Discovery tab to inspect the resulting data
      model changes.
    </p>
  </>
);
