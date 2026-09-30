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

const sandbox = await compute.sandbox.create({
  templateId: 'base-small',
})

const result = await sandbox.runCommand('echo "Hello from GravixLayer!"')
console.log(result.stdout)

await sandbox.destroy()
```

`templateId` selects an existing template. To start from a snapshot, pass
`snapshotId` instead (not both). `image` is not accepted; build a template from
an image with `template.create({ name, fromImage })` and pass its name as
`templateId`. Create a snapshot with
`compute.snapshot.create(sandboxId, { name: 'my-snapshot' })` — a name is
required. Building a new template needs `fromImage` or `dockerfile` on
`template.create`; pick an existing template with `templateId` on sandbox create.

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
