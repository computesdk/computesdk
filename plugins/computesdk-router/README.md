# ComputeSDK Router — ChatGPT plugin

A developer tool for running code in any sandbox provider, with a live
bidding option for the best price. This directory is the **plugin package**
(ChatGPT Agent Plugins format): manifest, MCP server mapping, skills, and
assets. The MCP server itself lives in the platform and serves
`https://platform.computesdk.com/mcp`; ChatGPT authenticates to it via
OAuth discovery — nothing to configure client-side.

## Contents

- `plugin.json` — Agent Plugins manifest (`computesdk-router`), with the
  `com.openai.interface` block ChatGPT reads for the directory listing.
  `@plugin-creator` adds the `com.openai.apps` mapping (`./.app.json`)
  when you give it the registered connector ID.
- `mcp.json` — maps the plugin to the platform MCP server
  (`streamable-http`). No `headers` — auth comes from OAuth.
- `skills/sandboxes/` — workflow skill teaching the model the tool surface.
- `skills/computesdk-sdk/` — guidance for generating SDK code.
- `assets/` — icon/logo/screenshots (placeholder art; replace with the real
  assets from the design team before submission).

## Local install (development)

Register the plugin in your personal marketplace file,
`~/.agents/plugins/marketplace.json` (for a repo marketplace, use
`$REPO_ROOT/.agents/plugins/marketplace.json` and keep plugins under
`$REPO_ROOT/plugins/`):

```json
{
  "name": "local-plugins",
  "plugins": [
    {
      "name": "computesdk-router",
      "source": { "source": "local", "path": "./plugins/computesdk-router" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Developer Tools"
    }
  ]
}
```

`source.path` is `./`-prefixed relative to the marketplace root. Then
restart the ChatGPT desktop app, open the Plugins Directory, choose your
marketplace, and install.

## Testing in ChatGPT developer mode

1. Enable developer mode in ChatGPT → Settings → Security and login →
   Developer mode.
2. Go to `chatgpt.com/plugins`, click **+**, choose **Create MCP App**,
   and register the server at `https://platform.computesdk.com/mcp`.
   Complete the OAuth sign-in (pick the ComputeSDK org to bill).
3. Copy the connection's technical ID — `plugin_asdk_app…` — from the
   browser URL after ChatGPT creates it.
4. Give the ID to `@plugin-creator` (Work mode) or `$plugin-creator`
   (Codex): it wires the registered server into this package via
   `extensions.com.openai.apps` → `./.app.json` and can create a personal
   marketplace entry for testing. Don't hand-edit the app mapping.
5. In a chat with the connector enabled, exercise the flow: create →
   write_file → run_command → sandbox_url → destroy.

## Publishing

- **Workspace**: publish the plugin to your ChatGPT workspace from the
  plugin settings once the connector ID is wired in — workspace users get
  it without developer mode.
- **Public submission**: submit through the developer portal (Upload new
  or existing plugin → ZIP). Required by the submission rules:
  - Five positive test cases (scenario, user prompt, expected tools,
    expected result) and three negative test cases (where the plugin
    should refuse, clarify, or fall back safely) — the create/run/url/
    destroy flows above are the obvious positives.
  - A demo-recording URL showing the main use cases.
  - `privacyPolicyURL`, `termsOfServiceURL`, `websiteURL`, and a support
    URL on live pages (coordinate with the dotcom site; the privacy
    policy must cover data collected, purposes, recipients, and
    retention).
  - Domain verification: a `/.well-known/openai-apps-challenge` token
    hosted on the MCP host.
  - Every MCP tool must set `readOnlyHint`, `openWorldHint`, and
    `destructiveHint` with a justification each — enforced server-side
    on the platform `/mcp`.
  - Real icon/logo assets — placeholder art cannot be submitted.
    Screenshots only if the plugin ships UI (not in v1).

## Follow-ups

- Panel UI: not in v1. The platform `/mcp` is tools-only; adding an MCP
  Apps resource (`resources/read` + `_meta.ui.resourceUri`) to it would
  enable a sidebar sandboxes panel.
