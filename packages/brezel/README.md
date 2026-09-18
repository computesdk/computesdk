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
