# @computesdk/runtime

[Runtime](https://withruntime.com) provider for ComputeSDK. Each sandbox is a
Firecracker microVM with its own Linux kernel and disk, driven through
Runtime's TypeScript SDK, [`withruntime`](https://www.npmjs.com/package/withruntime).

```bash
pnpm add computesdk @computesdk/runtime
```

Requires Node.js 22 or later.

```ts
import { createCompute } from 'computesdk'
import { runtime } from '@computesdk/runtime'

const compute = createCompute({
  providers: {
    runtime: runtime({ apiKey: process.env.RUNTIME_API_KEY }),
  },
})

const sandbox = await compute.sandbox.create({ provider: 'runtime' })
const result = await sandbox.runCommand('node --version')
console.log(result.stdout)
await sandbox.destroy()
```

Get a key at <https://withruntime.com/account/keys>, or run
`npx withruntime login` once on a machine and the provider uses the key it
saves.

## Configuration

| Option              | Environment variable | Description                                                                                         |
| ------------------- | -------------------- | --------------------------------------------------------------------------------------------------- |
| `apiKey`            | `RUNTIME_API_KEY`    | Runtime API key.                                                                                    |
| `baseUrl`           | `RUNTIME_API_URL`    | API origin. Defaults to `https://api.withruntime.com`.                                              |
| `create`            | —                    | Defaults for every create: `image`, `region`, `vcpu`, `memoryMiB`, `diskMiB`, `funding`, `network`. |
| `previewVisibility` | —                    | `private` (default) or `public`, for `getUrl`.                                                      |
| `previewTtlSeconds` | —                    | How long a private preview's token lasts, 60 s to 7 days. Defaults to one day.                      |

`create` takes `templateId` (a Runtime image), `snapshotId`, `name`,
`metadata` (stored as labels), `timeout`, `vcpus`, `memoryMiB`, `diskMiB` and
`envs`. `sandbox.getInstance()` returns the `withruntime` sandbox for anything
else Runtime offers: processes, terminals, previews, network rules, desktop
and more.
