---
name: computesdk-sdk
description: Write code that uses the ComputeSDK TypeScript SDK (`computesdk` package) to create sandboxes, run commands, and manage files. Use when the user wants a script or app that controls sandboxes outside ChatGPT.
---

# Using the computesdk SDK

`npm install computesdk` (+ a provider package for BYOK, e.g. `@computesdk/e2b`).

Configure once via `compute.setConfig`, then all sandbox calls go through `compute.sandbox`.

## First-party (ComputeSDK gateway)

```typescript
import { compute } from 'computesdk';

compute.setConfig({
  provider: 'computesdk',
  apiKey: process.env.COMPUTESDK_API_KEY,
  computesdk: { computesdk_api_key: process.env.COMPUTESDK_API_KEY },
} as any);

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand('python -c "print(\'Hello World!\')"');
console.log(result.stdout);

await sandbox.filesystem.writeFile('/tmp/out.txt', result.stdout);
const text = await sandbox.filesystem.readFile('/tmp/out.txt');
await sandbox.filesystem.mkdir('/tmp/data');
await sandbox.filesystem.remove('/tmp/out.txt');

await sandbox.destroy();
```

## BYOK (the user's own provider account)

```typescript
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

compute.setConfig({ provider: e2b({ apiKey: process.env.E2B_API_KEY }) });
// same sandbox.create / runCommand / filesystem / destroy surface
```

## Rules for generated code

- Read keys from the environment (`COMPUTESDK_API_KEY`, provider env vars) — never write a key, token, or secret into generated source.
- Always `destroy()` sandboxes — wrap in try/finally for real programs.
- `runCommand` returns `{ stdout, stderr, exitCode }`; check the exit code before treating output as success.
- Other providers swap in the same way (`@computesdk/modal`, `@computesdk/blaxel`, `@computesdk/namespace`, `@computesdk/tensorlake`, `@computesdk/archil`, …).
