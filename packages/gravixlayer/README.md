# @computesdk/gravixlayer

[GravixLayer](https://gravixlayer.ai) provider for ComputeSDK — cloud runtimes
with a native filesystem API, live command streaming, port publishing, templates,
and snapshots.

```bash
npm install @computesdk/gravixlayer
```

Requires Node.js 18 or later.

```ts
import { gravixlayer } from '@computesdk/gravixlayer'

const compute = gravixlayer({
  apiKey: process.env.GRAVIXLAYER_API_KEY,
})

const sandbox = await compute.sandbox.create({
  templateId: 'base-small',
})
const result = await sandbox.runCommand('node --version')
console.log(result.stdout)
await sandbox.destroy()
```

Get an API key at <https://gravixlayer.ai>. The TypeScript SDK is
[`gravixlayer`](https://www.npmjs.com/package/gravixlayer); product docs live at
<https://docs.gravixlayer.ai>.

## Configuration

| Option       | Environment variable    | Description                                      |
| ------------ | ----------------------- | ------------------------------------------------ |
| `apiKey`     | `GRAVIXLAYER_API_KEY`   | GravixLayer API key (required).                  |
| `baseUrl`    | `GRAVIXLAYER_BASE_URL`  | API origin. Defaults to `https://api.gravixlayer.ai`. |
| `cloud`      | `GRAVIXLAYER_CLOUD`     | Cloud for runtime and template placement. Defaults to `aws`. |
| `region`     | `GRAVIXLAYER_REGION`    | Region for runtime and template placement. Defaults to `us-east-1`. |
| `timeout`    | —                       | Request timeout in milliseconds.                 |
| `maxRetries` | —                       | Retry budget. Defaults to `0`.                   |
| `http2`      | —                       | Use HTTP/2. Defaults to `true`.                  |

`create` takes `templateId` (an existing template), or `snapshotId`, plus
`envs`, `timeout`, `metadata`, `cloud`, and `region`. Omitting `templateId`
boots `base-small`. Omitting `cloud` and `region` uses `aws` and `us-east-1`.
Sizing comes from the template. `sandbox.getInstance()` returns the GravixLayer
`Runtime` handle for filesystem, services, and other SDK APIs.

Snapshots require a `name` on `snapshot.create`. Template builds need
`fromImage` or `dockerfile` on `template.create`; select an existing template
with `templateId` when creating a sandbox.
