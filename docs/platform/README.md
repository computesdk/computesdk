---
description: Providers, routing, organizations and billing shared across every ComputeSDK interface.
---

# Platform overview

ComputeSDK routes sandbox requests and supported GitHub Actions workflows
across compute providers. Use one integration and one organization to manage
resources, credentials and billing.

## Sandboxes and interfaces

A [sandbox](sandboxes.md) is the environment where your code runs. Execute
commands, work with files and preview applications through the interface that
fits your workflow. The CLI, TypeScript SDK, Actions, MCP and REST API all use
the same compute routing, organization and billing.

Managed compute is the starting path. ComputeSDK handles provider accounts and
placement. Choose a provider or set preferences when you need more control;
optionally connect your own provider keys. Placement happens when a sandbox is
created. A running sandbox stays on its provider.

## Choose an interface

| Interface | Use it for |
| --- | --- |
| [CLI](../getting-started/quick-start.md) | Terminal workflows, projects, scripts and automation |
| [TypeScript SDK](../getting-started/sdk-quick-start.md) | Sandboxes in applications and agents with `compute.instances` |
| [Actions](actions.md) | Running supported GitHub workflows and inspecting their results |
| [REST API](api-reference.md) | HTTP integrations and organization resources |
| [MCP](mcp.md) | Giving an assistant access to ComputeSDK |
| [Dashboard](https://platform.computesdk.com) | Resources, routing, keys and billing |

## Organizations

Sandboxes, workflows, API keys and provider credentials belong to an
organization. Members collaborate through the dashboard; owners and admins
manage keys, connected repositories and billing in **Settings**.

The CLI guides interactive setup. Applications use an organization API key:
see [authentication](../getting-started/authentication.md).

## Manage your compute

- [Available providers](../providers/README.md)
- [Routing and provider selection](../guides/routing.md)
- [Pricing and billing](../guides/billing.md)
- [Sandbox lifecycle](../guides/lifecycle.md)
- [Run an Actions workflow](actions.md)
