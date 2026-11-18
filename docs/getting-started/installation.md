# Installation

Install the CLI for terminal workflows or the TypeScript SDK for Node.js applications.

## Provider starters

With Node.js 22 or later, start on a specific provider in one command:

```bash
npm create modal
```

The starter guides you through setup and creates a sandbox. See [Start on a provider](../providers/getting-started.md) for what it does and how to clean up.

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

The binary is `compute`. Continue with the [CLI quickstart](quick-start.md). To update, rerun your installer or, for an npm installation, run `npm install -g @computesdk/cli`. Avoid mixing installation methods if your shell finds an older binary first.

## TypeScript SDK

For Node.js applications:

```bash
npm install computesdk
```

The SDK includes the ComputeSDK router by default. You do not need to install individual provider adapters. Follow the [TypeScript SDK quickstart](sdk-quick-start.md) for a runnable example.
