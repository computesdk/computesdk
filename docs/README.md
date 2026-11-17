---
description: One router for sandboxes and Actions. Run agent code and GitHub workflows; ComputeSDK handles the compute.
---

# ComputeSDK

One router for sandboxes and Actions. Run agent code and GitHub workflows across
compute providers. Let ComputeSDK choose, pick a provider, or set a fallback
order through the same integration.

Start with managed compute; you do not need a vendor account or provider key.
Bring your own keys whenever you want more control.

## Start with an interface

Choose the interface that fits your workflow. All five use the same ComputeSDK
routing, organization and billing.

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
{% tab title="TypeScript SDK" %}

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
{% tab title="Actions" %}

[Connect a repository](platform/actions.md#setup) and enable a workflow such as
`.github/workflows/hello.yml`:

```yaml
name: Hello ComputeSDK
on: workflow_dispatch
jobs:
  hello:
    runs-on: ubuntu-latest
    steps:
      - run: echo hello
```

Run it from the dashboard, or dispatch it with the CLI:

```bash
compute actions dispatch myorg/myrepo --workflow hello.yml --ref main
```

Actions provisions compute for the job. Follow its steps, logs and result in
the dashboard. [Actions guide](platform/actions.md).

{% endtab %}
{% tab title="MCP" %}

[Connect Claude, ChatGPT or another MCP client](platform/mcp.md) to:

```text
https://platform.computesdk.com/mcp
```

Then ask your assistant:

```text
Create a ComputeSDK sandbox, run echo hello, show me the output,
and destroy the sandbox when done.
```

[MCP setup and permissions](platform/mcp.md).

{% endtab %}
{% tab title="REST API" %}

Set `COMPUTE_API_KEY` to your [organization API key](getting-started/authentication.md),
then create a sandbox:

```bash
curl --fail-with-body https://platform.computesdk.com/api/v1/sandboxes \
  -H "Authorization: Bearer $COMPUTE_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Copy `sandbox.id` from the response into `SANDBOX_ID`, then run a command and
release the compute:

```bash
SANDBOX_ID="<sandbox.id from the response>"
curl --fail-with-body "https://platform.computesdk.com/api/v1/sandboxes/$SANDBOX_ID/commands" \
  -H "Authorization: Bearer $COMPUTE_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{"command":"echo hello"}'
curl --fail-with-body -X DELETE "https://platform.computesdk.com/api/v1/sandboxes/$SANDBOX_ID" \
  -H "Authorization: Bearer $COMPUTE_API_KEY"
```

Destroy the sandbox even if your command fails. [REST API reference](platform/api-reference.md#sandboxes).

{% endtab %}
{% endtabs %}

## Build with sandboxes

A [sandbox](platform/sandboxes.md) is the environment where your code runs.

| I want to… | Guide |
| --- | --- |
| Run code, tests or agent tools | [Run commands](guides/commands.md) |
| Read, write, upload or download files | [Work with files](guides/files.md) |
| Send a local project to a sandbox | [Project sync](cli/project-sync.md) |
| Start a server and share a URL | [Preview an application](guides/previews.md) |
| Reconnect, control lifetime or clean up | [Sandbox lifecycle](guides/lifecycle.md) |
| Choose where compute runs | [Providers](providers/README.md) and [routing](guides/routing.md) |

## Manage compute

The [platform overview](platform/README.md) covers providers, routing and account
management. [Open the dashboard](https://platform.computesdk.com) to manage resources and
account settings. See [pricing and billing](guides/billing.md) for credits,
compute rates and cleanup. A sandbox keeps running until destroyed or its
lifetime expires.
