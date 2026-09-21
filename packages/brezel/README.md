# @computesdk/brezel

[Brezel](https://github.com/infercrane/brezel) provider for ComputeSDK.

```bash
pnpm add computesdk @computesdk/brezel
```

```ts
import { createCompute } from 'computesdk'
import { brezel } from '@computesdk/brezel'

const compute = createCompute({
  providers: {
    brezel: brezel({
      baseUrl: 'https://brezel.example.com',
      apiKey: process.env.BREZEL_API_KEY,
      project: 'agents',
      environmentRevision: 'envr_qualified',
      allowInternet: true,
    }),
  },
})

const sandbox = await compute.sandbox.create({ provider: 'brezel' })
const result = await sandbox.runCommand('node --version')
console.log(result.stdout)
await sandbox.destroy()
```

The environment revision is immutable and should be created and qualified by
the Brezel operator before application or benchmark traffic uses it.

## Configuration

| Option | Environment variable | Description |
| --- | --- | --- |
| `apiKey` | `BREZEL_API_KEY` | Project-scoped service token. |
| `baseUrl` | `BREZEL_API_URL` | Public HTTPS endpoint. |
| `project` | `BREZEL_PROJECT_ID` | Brezel project boundary. |
| `environmentRevision` | `BREZEL_ENVIRONMENT_REVISION` | Default immutable environment revision. |
| `allowInternet` | `BREZEL_ALLOW_INTERNET` | Enables outbound internet access; defaults to `false`. |
| `apiTimeoutMs` | — | Management API timeout in milliseconds. |

Create-time environment variables and arbitrary images are intentionally not
accepted. Use command-level `env` values and a prequalified Brezel environment
revision instead.
