---
description: >-
  GravixLayer provider for ComputeSDK — cloud runtimes with a native filesystem,
  live command streaming, port publishing, templates, and snapshots.
layout:
  width: default
  title:
    visible: true
  description:
    visible: false
  tableOfContents:
    visible: true
  outline:
    visible: true
  pagination:
    visible: true
  metadata:
    visible: true
  tags:
    visible: true
  actions:
    visible: true
---

# GravixLayer

[GravixLayer](https://gravixlayer.ai) provider for ComputeSDK — cloud runtimes with a native filesystem API, live command streaming, port publishing, templates, and snapshots.

## Lifecycle

`pause()`/`resume()` preserve memory and processes. Snapshot capabilities declare rootfs and memory preservation with the source kept. Restore with `snapshotId`; see [snapshot semantics and cleanup](../reference/compute.md#snapshot-capabilities).

## Installation & Setup

```bash
npm install @computesdk/gravixlayer
```

Add your GravixLayer API key to a `.env` file:

```bash
GRAVIXLAYER_API_KEY=your_gravixlayer_api_key
```

Optional:

```bash
GRAVIXLAYER_BASE_URL=https://api.gravixlayer.ai
GRAVIXLAYER_CLOUD=aws
GRAVIXLAYER_REGION=us-east-1
```

Get your API key at [gravixlayer.ai](https://gravixlayer.ai). Product docs: [docs.gravixlayer.ai](https://docs.gravixlayer.ai).

## Usage

```typescript
import { gravixlayer } from '@computesdk/gravixlayer'

const compute = gravixlayer({
  apiKey: process.env.GRAVIXLAYER_API_KEY,
})

const sandbox = await compute.instances.create({
  templateId: 'base-small',
})

const result = await sandbox.runCommand('echo "Hello from GravixLayer!"')
console.log(result.stdout)

await sandbox.destroy()
```

`templateId` selects an existing template. To start from a snapshot, pass
`snapshotId` instead (not both). `image` is a template name: the template
built from that image, e.g. `image: 'node:22'` boots the template named
`node:22`. Build it once with
`template.create({ name: 'node:22', fromImage: 'node:22' })`. Passing both
`image` and `templateId` with different names is a conflict, as is combining
a template source with `snapshotId`. Create a snapshot with
`compute.snapshot.create(instanceId, { name: 'my-snapshot' })` — a name is
required. Building a new template needs `fromImage` or `dockerfile` on
`template.create`; pick an existing template with `templateId` on sandbox create.

### Standard sizes

`sizeClass` requests an exact CPU/RAM tier. GravixLayer bakes resources into the
template at build time, so each standard size boots its own template:

```typescript
const sandbox = await compute.instances.create({ sizeClass: 'md' })
```

| `sizeClass` | Template |
| --- | --- |
| `xs` | `base-xsmall` |
| `sm` | `base-small` |
| `md` | `base-medium` |
| `lg` | `base-large` |
| `xl` | `base-xlarge` |
| `2xl` | `base-2xlarge` |

The `base-*` templates are
platform-provided; `scripts/provider-setup.mjs gravixlayer` builds them on
deployments where they are absent. Override the tier names with `sizeTemplates`
in the provider config. `sizeClass` cannot be combined with `templateId`,
`image`, `snapshotId`, or `sandboxId`.

### Configuration Options

```typescript
interface GravixLayerConfig {
  /** GravixLayer API key - if not provided, will use GRAVIXLAYER_API_KEY env var */
  apiKey?: string
  /** API base URL - if not provided, will use GRAVIXLAYER_BASE_URL env var */
  baseUrl?: string
  /** Default cloud - if not provided, will use GRAVIXLAYER_CLOUD env var */
  cloud?: string
  /** Default region - if not provided, will use GRAVIXLAYER_REGION env var */
  region?: string
  /** Request timeout in milliseconds */
  timeout?: number
  /** Retry budget. Defaults to 0 */
  maxRetries?: number
  /** Use HTTP/2. Defaults to true */
  http2?: boolean
  /** Template name to boot per standard `sizeClass`; defaults to GRAVIXLAYER_SIZE_TEMPLATES */
  sizeTemplates?: Partial<Record<InstanceSizeClass, string>>
}
```

| Option | Environment variable | Description |
| --- | --- | --- |
| `apiKey` | `GRAVIXLAYER_API_KEY` | GravixLayer API key (required) |
| `baseUrl` | `GRAVIXLAYER_BASE_URL` | API origin |
| `cloud` | `GRAVIXLAYER_CLOUD` | Default cloud for placement |
| `region` | `GRAVIXLAYER_REGION` | Default region for placement |
| `timeout` | — | Request timeout in milliseconds |
| `maxRetries` | — | Retry budget (default `0`) |
| `http2` | — | Use HTTP/2 (default `true`) |
| `sizeTemplates` | — | Per-tier template names for `sizeClass` (defaults to `base-*`) |
