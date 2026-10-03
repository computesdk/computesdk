---
name: computesdk-sdk
description: Write code that drives ComputeSDK sandboxes — the hosted REST API for first-party use, or the `computesdk` TypeScript SDK with BYOK provider packages. Use when the user wants a script or app that controls sandboxes outside ChatGPT.
---

# Driving ComputeSDK sandboxes from code

Two paths, depending on who provides the compute.

## First-party: hosted REST API

The `computesdk` SDK has no gateway transport — programmatic use of hosted
sandboxes goes through the REST API (the same one the `compute` CLI uses),
authenticated with an org API key:

```typescript
const BASE = 'https://platform.computesdk.com/api/v1';
const headers = {
  authorization: `Bearer ${process.env.COMPUTESDK_API_KEY}`,
  'content-type': 'application/json',
};
const api = (path: string, init?: RequestInit) =>
  fetch(`${BASE}${path}`, { ...init, headers }).then((r) => {
    if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${path}: ${r.status}`);
    return r.json();
  });

// Create
const { id } = await api('/sandboxes', {
  method: 'POST',
  body: JSON.stringify({ label: 'my-job', timeoutMs: 30 * 60 * 1000 }),
});

// Run a command (buffered; ~290s cap)
const { stdout, stderr, exitCode } = await api(`/sandboxes/${id}/commands`, {
  method: 'POST',
  body: JSON.stringify({ command: 'python -c "print(1+1)"' }),
});

// Files (absolute paths)
await api(`/sandboxes/${id}/files?path=/tmp/out.txt`, {
  method: 'POST',
  body: JSON.stringify({ content: stdout }),
});
const listing = await api(`/sandboxes/${id}/files?path=/tmp`);

// Always clean up — wrap real programs in try/finally
await api(`/sandboxes/${id}`, { method: 'DELETE' });
```

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

- Read keys from the environment (`COMPUTESDK_API_KEY`, provider env vars) —
  never write a key, token, or secret into generated source.
- Always destroy sandboxes — `DELETE /sandboxes/{id}` or `sandbox.destroy()`,
  in try/finally for real programs.
- `runCommand`/commands return stdout, stderr, and an exit code — check the
  exit code before treating output as success.
