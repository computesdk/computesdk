---
description: One router for sandboxes and Actions. Run agent code and GitHub workflows; ComputeSDK handles the compute.
---

# ComputeSDK

One router for sandboxes and Actions. Run agent code and GitHub workflows across
compute providers. Let ComputeSDK choose, pick a provider, or set a fallback
order through the same integration.

Start with managed compute; you do not need a vendor account or provider key.
Bring your own keys whenever you want more control.

## Run your first sandbox

{% tabs %}
{% tab title="CLI" %}

[Install the CLI](getting-started/installation.md#cli), then run:

```bash
compute new
compute exec echo hello
compute destroy
```

The CLI guides setup and selects your sandbox. [CLI quickstart](getting-started/quick-start.md).

{% endtab %}
{% tab title="TypeScript" %}

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.instances.create();
try {
  console.log((await sandbox.runCommand('echo hello')).stdout);
} finally {
  await sandbox.destroy();
}
```

Install `computesdk` and set `COMPUTE_API_KEY`.
[TypeScript quickstart](getting-started/sdk-quick-start.md).

{% endtab %}
{% endtabs %}

## Build with sandboxes

| I want to… | Guide |
| --- | --- |
| Run code, tests or agent tools | [Run commands](guides/commands.md) |
| Read, write, upload or download files | [Work with files](guides/files.md) |
| Send a local project to a sandbox | [Project sync](cli/project-sync.md) |
| Start a server and share a URL | [Preview an application](guides/previews.md) |
| Reconnect, control lifetime or clean up | [Sandbox lifecycle](guides/lifecycle.md) |
| Choose where compute runs | [Providers](providers/README.md) and [routing](guides/routing.md) |

## Run workflows and connect assistants

[Actions](platform/actions.md) runs supported GitHub Actions workflows through
the same router. Connect a repository, enable a workflow, then run and inspect
its steps, logs and artifacts.

[MCP](platform/mcp.md) lets an assistant create sandboxes, run commands and work
with files. Connect from Claude, ChatGPT or another MCP client.

[Open the dashboard](https://platform.computesdk.com) to manage resources and
account settings. See [pricing and billing](guides/billing.md) for credits,
compute rates and cleanup. A sandbox keeps running until destroyed or its
lifetime expires.
