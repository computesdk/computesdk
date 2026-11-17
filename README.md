[![rgstr](https://rgstr.org/registry/computesdk/badge.svg?proof=rgstr_nm3kilaba5cfkkxo2lkh)](https://rgstr.org/registry/computesdk)
[![rgstr](https://rgstr.org/registry/@computesdk/cli/badge.svg?proof=rgstr_un7pznm3kwv3xsaokzu4)](https://rgstr.org/registry/@computesdk/cli)

<div align="center">
  <img src="https://logos.computesdk.com/api/svg/computesdk/bounded/logo-light?v=ff5c23fc46" alt="ComputeSDK" width="300" />
</div>

<div align="center">
  <strong>One router for sandboxes and Actions.</strong>
</div>

<div align="center">

[![npm version](https://badge.fury.io/js/computesdk.svg)](https://badge.fury.io/js/computesdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Documentation](https://img.shields.io/badge/docs-computesdk.com-blue)](https://docs.computesdk.com)

</div>

---

## ComputeSDK

ComputeSDK is one router for sandboxes and Actions. Run agent code and GitHub workflows across compute providers through one integration. Let ComputeSDK route, choose a provider, or set a fallback order. Use the **CLI** from your terminal and the **TypeScript SDK** from your application or agent.

- **Run commands and work with files** in cloud sandboxes from your terminal or TypeScript application.
- **Sync local projects** to a sandbox for remote development and execution.
- **Route compute centrally** using managed compute, your organization's provider keys, or both.
- **Manage your organization** through one dashboard for credentials, credits and sandbox activity.

[Open the dashboard](https://platform.computesdk.com) · [Read the docs](https://docs.computesdk.com)

## Start on a provider

Create a sandbox on a specific provider through ComputeSDK:

```bash
npm create modal@latest
# Or: npm create e2b@latest
```

These starters install or upgrade the ComputeSDK CLI when needed, sign you in and create a sandbox pinned to that provider. They use your organization's managed-compute or BYOK routing. See [sandbox providers](docs/providers/README.md) for setup and cleanup.

## Start with the CLI

```bash
npm install -g @computesdk/cli
compute login
compute sandboxes route
compute new
compute exec echo hello
compute destroy
```

[Other installation options](docs/getting-started/installation.md) include macOS/Linux and Windows installers. Creation requires available credit or a configured BYOK route. Sandboxes keep running and billing until destroyed or their lifetime expires.

## Build with the TypeScript SDK

```bash
npm install computesdk @computesdk/platform
export COMPUTE_API_KEY="your_org_api_key"
```

```typescript
import { compute } from 'computesdk';
import { platform } from '@computesdk/platform';

const sdk = compute({ provider: platform({}) });
const sandbox = await sdk.instances.create({ size: 'small' });
try {
  const result = await sandbox.runCommand('echo hello');
  console.log(result.stdout);
} finally {
  await sandbox.destroy();
}
```

Follow the [complete runnable SDK quickstart](docs/getting-started/sdk-quick-start.md) to create an API key and run this from Node.js. See [routing and BYOK](docs/guides/routing.md) to choose account modes and understand billing.

## Go further

| Task | Guide |
| --- | --- |
| Send a local project to a sandbox | [Project sync](docs/cli/project-sync.md) |
| Configure managed compute and BYOK | [Routing and billing](docs/guides/routing.md) |
| Use the SDK in an application or agent | [TypeScript SDK](docs/sdk/README.md) |
| Run workflows on sandbox providers | [Actions](docs/platform/actions.md) |
| Connect an AI assistant | [MCP server](docs/platform/mcp.md) |

## Open-source SDK and contributing

For direct vendor integrations, provider development and repository contribution instructions, see the [open-source SDK guide](OPEN_SOURCE.md). Individual adapters are documented in [their GitHub packages](https://github.com/computesdk/computesdk/tree/main/packages).

## Community and support

[GitHub Discussions](https://github.com/computesdk/computesdk/discussions) · [GitHub Issues](https://github.com/computesdk/computesdk/issues)

## License

[MIT](LICENSE)
