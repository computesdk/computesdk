# Installation

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

## Platform SDK

For Node.js applications:

```bash
npm install computesdk @computesdk/platform
```

The SDK connects to the hosted platform. You do not need to install individual provider adapters. Follow the [Platform SDK quickstart](sdk-quick-start.md) for authentication and a runnable example.

## Direct provider SDKs

For applications that call provider APIs themselves, see [direct provider setup](../providers/getting-started.md). These credentials and client-side routing are independent of the hosted platform.

Building this repository from source requires Node.js 22.19.0 or later and pnpm 9 or later. Those are contributor requirements; check the requirements of each published package you install.
