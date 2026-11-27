# @computesdk/platinum

[Platinum](https://www.platinum.dev) provider for ComputeSDK - microVM sandboxes created through the [`@platinum-dev/sdk`](https://www.npmjs.com/package/@platinum-dev/sdk) client, with CPU and memory chosen per create.

## Installation & Setup

```bash
npm install @computesdk/platinum
```

Create an API key in the [Platinum dashboard](https://platinum.dev/dashboard#apikeys) (or with `pt login`) and add it to a `.env` file:

```bash
PLATINUM_API_KEY=your_platinum_api_key
```

`PT_TOKEN`, the variable the Platinum SDK and CLI read, is accepted as a fallback.

## Usage

```typescript
import { platinum } from '@computesdk/platinum';

const compute = platinum({ apiKey: process.env.PLATINUM_API_KEY });

// Boots Platinum's default template (`pt-base`) unless you name one
const sandbox = await compute.instances.create({ templateId: 'csdk-node22', sizeClass: 'md' });

const result = await sandbox.runCommand('node -v');
console.log(result.stdout, result.exitCode);

await sandbox.destroy();
```

## Configuration

```typescript
interface PlatinumConfig {
  /** Platinum API key - if not provided, will fallback to PLATINUM_API_KEY, then PT_TOKEN */
  apiKey?: string;
  /** API base URL - defaults to PLATINUM_API_URL / PT_API_URL, then https://api.platinum.dev */
  apiUrl?: string;
  /** Template to boot when a create names neither `templateId` nor `image` */
  template?: string;
  /** How long create waits for the sandbox to reach `running`, in ms (default 60000) */
  timeout?: number;
}
```

## Create Options

| Option | Maps to | Notes |
|---|---|---|
| `templateId` | `template` | Template name or `tpl_…` id. Falls back to `config.template`, then Platinum's `pt-base`. |
| `image` | `image.base_image` | Inline image, built in your org on first use and cached after. Pin a tag (`node:22-slim`). |
| `sizeClass` | `cpu`, `ram_mb` | `sm` 1/2048, `md` 2/4096, `lg` 4/8192, `xl` 8/16384 (vCPU/MiB). Works with any template. `xs` and `2xl` are `unknown`. |
| `envs` | `env` | Environment variables set at boot. |
| `name`, `metadata` | `name`, `metadata` | `name` must be unique among the org's live sandboxes. |
| `cpu`, `ram_mb`, `disk_gb`, `region`, `pool`, `pool_fallback`, `auto_stop_minutes`, `auto_archive_days`, `auto_delete_days`, `backup_interval_min` | same | Passed through to `POST /v1/sandboxes`. |

Create resolves once the sandbox is `running`.

## Node.js template

`pt-base` does not include Node.js. Build a template from a pinned Node image once per organization and pass its name as `templateId`:

```bash
pt template build csdk-node22 --image node:22-slim --entrypoint none --cpu 1 --ram 1024 --wait
```

Platinum enforces template minimums on `cpu` and `ram_mb`, so keep the template's defaults at or below the smallest size you request.

## Features

- **Commands** run through Platinum's exec API, with `cwd`, `env`, `timeout` and background commands. A single exec is capped at 85 s; longer work belongs in a background command.
- **Filesystem** uses ComputeSDK's shell implementation over `runCommand`.
- **`getUrl()`** exposes the port and returns its preview URL. The URL carries its access token.
- **`list()`** returns the organization's sandboxes that are not deleted.

## Limitations

- `snapshotId` is rejected: Platinum restores snapshots with the SDK's `sandbox.clone()`, not at create.
- Create-time `volumes` are rejected; mount Platinum volumes with the Platinum SDK.
- Platinum sandboxes have no fixed lifetime, so `getInfo().timeout` is `0`. They keep running until destroyed or stopped by their lifecycle timers.
- Per-sandbox and per-organization CPU/RAM caps depend on the organization's tier. A create over a cap is refused.
