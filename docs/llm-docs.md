---
title: LLM documentation
description: Current CLI, Platform SDK and API entry points for AI assistants.
---

# LLM documentation

Start with the same supported paths as human readers:

- [CLI quickstart](getting-started/quick-start.md): install, sign in, inspect routing, create, execute and destroy.
- [Platform SDK quickstart](getting-started/sdk-quick-start.md): a complete Node.js/TypeScript application using `computesdk` and `@computesdk/platform`.
- [CLI automation](cli/automation.md): noninteractive auth, JSON Lines, errors and resumable user sign-in.
- [Routing and BYOK](guides/routing.md): account modes, provider selection and billing.
- [SDK reference](sdk/reference.md) and [REST reference](platform/api-reference.md): distinguish provider methods from HTTP routes.
- [MCP server](platform/mcp.md): OAuth authorization for assistants.
- [Direct providers](providers/README.md): vendor adapters for applications that manage provider credentials themselves.

[llms-small.txt](/llms-small.txt) and [llms-full.txt](/llms-full.txt) are publisher-provided documentation export links; this repository does not generate them. Check the version and linked API surface before relying on an export cached by an assistant; published package versions and deployment availability can differ from repository source.

Use `compute --version` and command-specific `--help` to inspect the installed CLI. Provisioning can incur charges; a sandbox keeps running until destruction or lifetime expiry. Include cleanup and report any unconfirmed teardown.
