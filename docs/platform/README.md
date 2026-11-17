---
description: One router for sandboxes and Actions, available through the CLI, TypeScript SDK, REST API and MCP.
---

# ComputeSDK overview

ComputeSDK routes sandbox requests and supported GitHub Actions workflows
across compute providers. Use one integration and one organization to manage
resources, credentials and billing.

## Two ways to run

- **Sandboxes:** run agent code, tests and scripts; work with files; start a server and share a preview.
- **Actions:** connect a repository, run supported workflow YAML, inspect logs and rerun failures.

Managed compute is the starting path. ComputeSDK handles provider accounts and
placement. Choose a provider or set preferences when you need more control;
optionally connect your own provider keys. Placement happens when a sandbox is
created. A running sandbox stays on its provider.

## Choose an interface

| Interface | Use it for |
| --- | --- |
| [CLI](../getting-started/quick-start.md) | Terminal workflows, projects, scripts and automation |
| [TypeScript SDK](../getting-started/sdk-quick-start.md) | Sandboxes in applications and agents with `compute.instances` |
| [REST API](api-reference.md) | HTTP integrations and organization resources |
| [MCP](mcp.md) | Giving an assistant access to ComputeSDK |
| [Dashboard](https://platform.computesdk.com) | Resources, routing, keys and billing |

## Organizations

Sandboxes, workflows, API keys and provider credentials belong to an
organization. Members collaborate through the dashboard; owners and admins
manage keys, connected repositories and billing in **Settings**.

The CLI guides interactive setup. Applications use an organization API key:
see [authentication](../getting-started/authentication.md).

## Where next

- [Available providers](../providers/README.md)
- [Routing and provider selection](../guides/routing.md)
- [Pricing and billing](../guides/billing.md)
- [Sandbox lifecycle](../guides/lifecycle.md)
- [Run an Actions workflow](actions.md)
