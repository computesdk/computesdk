/**
 * The plugin's sidebar panel — the "app" surface in ChatGPT.
 *
 * Served as an MCP Apps UI resource (text/html;profile=mcp-app) and attached
 * to tools via `openai/outputTemplate`. Talks back to the plugin through the
 * MCP Apps host bridge: JSON-RPC over postMessage (ui/initialize, tools/call,
 * ui/notifications/tool-result).
 */

export const PANEL_URI = 'ui://computesdk/panel';

export const PANEL_MIME = 'text/html;profile=mcp-app';

export const PANEL_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>ComputeSDK Router</title>
<style>
:root { color-scheme: light dark; }
body {
  margin: 0; padding: 16px;
  font-family: "Inter", system-ui, -apple-system, sans-serif;
  font-size: 14px;
}
h2 { margin: 0 0 4px; font-size: 16px; }
.sub { color: #6b7280; font-size: 12px; margin-bottom: 14px; }
ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
li {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 10px;
  background: rgba(128,128,128,.12);
}
li .id { font-family: ui-monospace, monospace; font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; }
li .state { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: rgba(34,197,94,.18); color: #16a34a; }
button {
  border: none; border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: 600;
  cursor: pointer;
}
button.destroy { background: rgba(239,68,68,.15); color: #dc2626; }
button.refresh { background: #111bf5; color: #fff; margin-top: 12px; }
.empty { color: #6b7280; padding: 24px 0; text-align: center; }
.error { color: #dc2626; font-size: 12px; margin-top: 10px; }
</style>
</head>
<body>
<main>
  <h2>Sandboxes</h2>
  <div class="sub">ComputeSDK Router &mdash; running and recent environments</div>
  <ul id="list"></ul>
  <div id="empty" class="empty" hidden>No sandboxes yet &mdash; ask ChatGPT to run something.</div>
  <div id="err" class="error"></div>
  <button class="refresh" id="refresh">Refresh</button>
</main>
<script>
const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const errEl = document.getElementById("err");

let rpcId = 0;
const pending = new Map();
const rpcNotify = (method, params) =>
  window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
const rpcRequest = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++rpcId;
    pending.set(id, { resolve, reject });
    window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
  });

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  const msg = event.data;
  if (!msg || msg.jsonrpc !== "2.0") return;
  if (typeof msg.id === "number" && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    return;
  }
  if (msg.method === "ui/notifications/tool-result") refresh();
});

const callTool = (name, args) => rpcRequest("tools/call", { name, arguments: args });

function render(sandboxes) {
  listEl.innerHTML = "";
  emptyEl.hidden = sandboxes.length > 0;
  for (const sb of sandboxes) {
    const li = document.createElement("li");
    const meta = sb.metadata || {};
    const id = document.createElement("span");
    id.className = "id";
    const label = meta.label || sb.id || sb.sandbox_id || "?";
    id.textContent = label;
    id.title = (sb.id || sb.sandbox_id) + " · " + (meta.gatewayProvider || "unplaced") + (meta.costUsd != null ? " · $" + Number(meta.costUsd).toFixed(4) : "");
    const state = document.createElement("span");
    state.className = "state";
    state.textContent = meta.gatewayStatus || sb.status || sb.state || "running";
    const kill = document.createElement("button");
    kill.className = "destroy";
    kill.textContent = "Destroy";
    kill.onclick = async () => {
      kill.disabled = true;
      try {
        await callTool("destroy_sandbox", { provider: "computesdk", sandbox_id: sb.id || sb.sandbox_id });
        refresh();
      } catch (e) { errEl.textContent = String(e.message || e); }
    };
    li.append(id, state, kill);
    listEl.appendChild(li);
  }
}

async function refresh() {
  errEl.textContent = "";
  try {
    const res = await callTool("list_sandboxes", { provider: "computesdk", label_prefix: "chatgpt-plugin" });
    render(res?.structuredContent?.sandboxes || []);
  } catch (e) {
    errEl.textContent = String(e.message || e);
  }
}

const bridgeReady = rpcRequest("ui/initialize", {
  appInfo: { name: "computesdk-panel", version: "0.1.0" },
  appCapabilities: {},
  protocolVersion: "2026-01-26",
}).then(() => rpcNotify("ui/notifications/initialized", {}));

document.getElementById("refresh").onclick = () => bridgeReady.then(refresh);
bridgeReady.then(refresh);
</script>
</body>
</html>`;
