# Installation

Install the CLI for terminal workflows or the TypeScript SDK for Node.js applications. Both connect to your ComputeSDK organization. Create an account at [platform.computesdk.com](https://platform.computesdk.com), then follow the [authentication guide](authentication.md) to sign in or create an API key.

## Provider starters

With Node.js 22 or later, start on a specific provider in one command:

```bash
npm create modal@latest
```

The starter offers to install or upgrade the CLI, authenticates with ComputeSDK and creates a sandbox. See [Start on a provider](../providers/getting-started.md) for what it does and how to clean up.

## CLI

On macOS or Linux:

```bash
curl -fsSL https://computesdk.com/install | sh
```

On Windows, run in PowerShell:

```powershell
irm https://computesdk.com/install.ps1 | iex
```

Or install the npm package with Node.js and npm:

```bash
npm install -g @computesdk/cli
```

Open a new terminal if the installer updated your PATH, then verify:

```bash
compute --version
compute --help
```

The binary is `compute`. Continue with the [CLI quickstart](quick-start.md). To update, rerun your installer or, for an npm installation, run `npm install -g @computesdk/cli@latest`. Avoid mixing installation methods if your shell finds an older binary first.

## TypeScript SDK

For Node.js applications:

```bash
npm install computesdk @computesdk/platform
```

The SDK connects to the hosted platform. You do not need to install individual provider adapters. Follow the [TypeScript SDK quickstart](sdk-quick-start.md) for authentication and a runnable example.
