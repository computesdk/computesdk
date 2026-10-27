---
name: computesdk-sdk
description: Write code that drives ComputeSDK sandboxes — the hosted platform via `@computesdk/platform`, or BYOK with the `computesdk` SDK plus a provider package. Use when the user wants a script or app that controls sandboxes outside ChatGPT.
---

# Driving ComputeSDK sandboxes from code

Two paths, depending on who provides the compute.

## First-party: `@computesdk/platform`

`npm install computesdk @computesdk/platform` — the provider talks to the
hosted platform (the same API the `compute` CLI uses), authenticated with an
org API key or a `compute login` session:

```typescript
import { compute } from 'computesdk';
import { platform } from '@computesdk/platform';

compute.setConfig({ provider: platform({ apiKey: process.env.COMPUTE_API_KEY }) });

// Creates are idempotent — the SDK mints an idempotency key per call
const sandbox = await compute.sandbox.create({ label: 'my-job', timeout: 30 * 60 * 1000 });

// Run a command (buffered; ~290s cap — longer work uses { background: true })
const { stdout, stderr, exitCode } = await sandbox.runCommand('python -c "print(1+1)"');

// Files (absolute paths, ~4 MB per call)
await sandbox.filesystem.writeFile('/tmp/out.txt', stdout);
const entries = await sandbox.filesystem.readdir('/tmp');

// Always clean up — wrap real programs in try/finally
await sandbox.destroy();
```

Auth precedence: `apiKey` > `COMPUTE_API_KEY` > `BENCHMARKS_PLATFORM_API_KEY`
> a `compute login` session (needs `@benchsdk/cli` installed). Hosted
sandboxes place on the org's provider order — market by default, the org's
own provider keys when `providerOrder` names them; see the package README for
`size`/`maxPrice`/`orderType` and the market error codes
(`insufficient_credits`, `no_market_capacity`, …) on `err.code`.

## BYOK: the `computesdk` SDK + provider package

`npm install computesdk` + a provider package, e.g. `@computesdk/e2b`:

```typescript
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

compute.setConfig({ provider: e2b({ apiKey: process.env.E2B_API_KEY }) });

const sandbox = await compute.sandbox.create();
const result = await sandbox.runCommand('python -c "print(\'Hello\')"');
await sandbox.filesystem.writeFile('/tmp/out.txt', result.stdout);
await sandbox.destroy();
```

Other providers swap in the same way (`@computesdk/modal`,
`@computesdk/blaxel`, `@computesdk/namespace`, `@computesdk/tensorlake`,
`@computesdk/archil`, …) — but each takes its own config fields (Modal uses
`tokenId`/`tokenSecret`; blaxel wants `apiKey` + `workspace`; namespace a
`token`). Check the provider's package for its config shape.

## Rules for generated code

- Read keys from the environment (`COMPUTE_API_KEY` — the same env var the
  `compute` CLI uses — provider env vars) —
  never write a key, token, or secret into generated source.
- Always destroy sandboxes — `DELETE /sandboxes/{id}` or `sandbox.destroy()`,
  in try/finally for real programs.
- `runCommand`/commands return stdout, stderr, and an exit code — check the
  exit code before treating output as success.
