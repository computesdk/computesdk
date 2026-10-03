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
- `mcp.json` — maps the plugin to the platform MCP server
  (`streamable-http`). No `headers` — auth comes from OAuth.
- `skills/sandboxes/` — workflow skill teaching the model the tool surface.
- `skills/computesdk-sdk/` — guidance for generating SDK code.
- `assets/` — icon/logo/screenshots (placeholder art; replace with the real
  assets from the design team before submission).

## Local install (development)

Register the plugin folder in your local marketplace file,
`~/.agents/plugins/marketplace.json`:

```json
{
  "plugins": [
    { "path": "/absolute/path/to/computesdk/plugins/computesdk-router" }
  ]
}
```

Restart the agent/CLI and the plugin's skills become available locally.

## Testing in ChatGPT developer mode

1. Enable developer mode in ChatGPT → Settings → Connectors.
2. Add a custom MCP connector pointing at
   `https://platform.computesdk.com/mcp` and complete the OAuth sign-in
   (pick the ComputeSDK org to bill).
3. In a chat with the connector enabled, ask it to create a sandbox and
   run a command — exercise create → write_file → run_command →
   sandbox_url → destroy.
4. Once the connector works, register it in the plugin manifest: the
   developer-mode connector gets an id like `plugin_asdk_app…`. Put it in
   `plugin.json` under `apps.chatgpt.id` (replacing the
   `REGISTER_AFTER_PACKAGING` placeholder), or run the `@plugin-creator`
   tool to wire it automatically.

## Publishing

- **Workspace**: publish the plugin to your ChatGPT workspace from the
  plugin settings once the connector ID is wired in — workspace users get
  it without developer mode.
- **Public submission**: submit through the Plugin Creator / developer
  portal. Before submitting:
  - Replace `assets/` with real icon, logo, and screenshots — placeholder
    art cannot be submitted.
  - `privacyPolicyURL` and `termsOfServiceURL` must resolve to live pages
    (coordinate with the dotcom site; the privacy policy must cover data
    collected, purposes, recipients, and retention).
  - Provide the portal's required test cases (5 positive, 3 negative) —
    the create/run/url/destroy flows above are the obvious positives.

## Follow-ups

- Panel UI: not in v1. The platform `/mcp` is tools-only; adding an MCP
  Apps resource (`resources/read` + `_meta.ui.resourceUri`) to it would
  enable a sidebar sandboxes panel.
