# compute

## Overview

`compute` is ComputeSDK's unified entrypoint for managing sandboxes across one or more providers. There are two import styles you can use:

1. **Direct provider mode** — import a provider package (e.g. `@computesdk/e2b`) and use the returned instance as your compute object. Best for single-provider apps.
2. **Core `compute` from `computesdk`** — import `compute` from the `computesdk` package and configure it with one or more provider instances. Best when you want resilient routing, round-robin load balancing, or a single module-level entrypoint that multiple files share.

Both modes expose the same shape: `compute.sandbox.*` for sandbox lifecycle and operations, and `compute.snapshot.*` for snapshot management (when supported by the provider).

Every provider package depends on `computesdk`, so it is always installed alongside them — the choice between the two modes is purely about what you import.

## Installation

Install the provider packages you need. `computesdk` is pulled in automatically as a dependency of every provider package, so you don't need to list it separately (though listing it explicitly is harmless and makes the intent clear when you use the `compute` import).

```bash
# Single provider — computesdk is installed transitively
npm install @computesdk/e2b

# Multiple providers
npm install @computesdk/e2b @computesdk/modal

# Explicit (equivalent to the above, just makes the dependency visible)
npm install computesdk @computesdk/e2b @computesdk/modal
```

## Provider Credentials

Each provider reads its own environment variables. See the [installation guide](../getting-started/installation.md) for the full list or the individual provider reference pages under `/docs/providers`.

```bash
# Example: E2B
E2B_API_KEY=your_e2b_api_key

# Example: Modal
MODAL_TOKEN_ID=your_modal_token_id
MODAL_TOKEN_SECRET=your_modal_token_secret
```

---

## Direct Provider Mode

Call the provider factory with credentials and use the returned object as your `compute` instance. This is the fastest path for a single-provider app.

```typescript
import { e2b } from '@computesdk/e2b';

const compute = e2b({ apiKey: process.env.E2B_API_KEY });

const sandbox = await compute.sandbox.create();
const result = await sandbox.runCommand('echo "Hello!"');
console.log(result.stdout);
await sandbox.destroy();
```

**Notes:**
- Every provider factory (`e2b`, `modal`, `vercel`, `daytona`, etc.) returns an object with the same shape.
- Swapping providers is usually a one-line change: replace the import and factory call.
- No core `computesdk` import is required in this mode.

<br/>

---

## Core `compute` Mode

Import `compute` from `computesdk` and register one or more providers. The same `compute` singleton is used throughout your app.

### Single Provider

```typescript
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

compute.setConfig({
  provider: e2b({ apiKey: process.env.E2B_API_KEY }),
});

const sandbox = await compute.sandbox.create();
await sandbox.runCommand('echo "Hello!"');
await sandbox.destroy();
```

### Multi-Provider

Pass a `providers` array to configure several providers under the same `compute` entrypoint:

```typescript
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { modal } from '@computesdk/modal';

compute.setConfig({
  providers: [
    e2b({ apiKey: process.env.E2B_API_KEY }),
    modal({
      tokenId: process.env.MODAL_TOKEN_ID,
      tokenSecret: process.env.MODAL_TOKEN_SECRET,
    }),
  ],
  providerStrategy: 'priority', // 'priority' (default) or 'round-robin'
  fallbackOnError: true,        // default: true
});

// Uses the configured strategy
const sandbox = await compute.sandbox.create();

// Override for one call
const gpuSandbox = await compute.sandbox.create({ provider: 'modal' });
```

### Callable Form

You can also call `compute(config)` to get a new, isolated instance without touching the singleton — useful for request-scoped configuration, testing, or running multiple independent configurations side by side.

```typescript
import { compute } from 'computesdk';
import { vercel } from '@computesdk/vercel';

const scoped = compute({
  provider: vercel({
    token: process.env.VERCEL_TOKEN,
    teamId: process.env.VERCEL_TEAM_ID,
    projectId: process.env.VERCEL_PROJECT_ID,
  }),
});

const sandbox = await scoped.sandbox.create();
```

<br/>

---

## `compute.setConfig(config)`

Configure the module-level `compute` singleton.

**Parameters:**

- `config` (ExplicitComputeConfig, required):
  - `provider` (DirectProvider, optional) — single primary provider
  - `providers` (DirectProvider[], optional) — ordered list of providers
  - `providerStrategy` (`'priority' | 'round-robin'`, optional) — default `'priority'`
  - `fallbackOnError` (boolean, optional) — default `true`

At least one of `provider` or `providers` must be supplied. When both are provided, `provider` is treated as the first provider, and duplicates (by `.name`) are removed from `providers`.

**Returns:** `void`

**Examples:**

```typescript
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { modal } from '@computesdk/modal';

// Single provider
compute.setConfig({
  provider: e2b({ apiKey: process.env.E2B_API_KEY }),
});

// Multi-provider with priority routing + failover
compute.setConfig({
  providers: [
    e2b({ apiKey: process.env.E2B_API_KEY }),
    modal({
      tokenId: process.env.MODAL_TOKEN_ID,
      tokenSecret: process.env.MODAL_TOKEN_SECRET,
    }),
  ],
  providerStrategy: 'priority',
  fallbackOnError: true,
});

// Multi-provider with round-robin load balancing
compute.setConfig({
  providers: [
    e2b({ apiKey: process.env.E2B_API_KEY }),
    modal({
      tokenId: process.env.MODAL_TOKEN_ID,
      tokenSecret: process.env.MODAL_TOKEN_SECRET,
    }),
  ],
  providerStrategy: 'round-robin',
});

// Primary + fallback pool
compute.setConfig({
  provider: e2b({ apiKey: process.env.E2B_API_KEY }),       // primary
  providers: [                                               // fallbacks
    modal({
      tokenId: process.env.MODAL_TOKEN_ID,
      tokenSecret: process.env.MODAL_TOKEN_SECRET,
    }),
  ],
});
```

**Notes:**
- Re-calling `setConfig` replaces the prior configuration and resets internal routing state (round-robin cursor, sandbox-to-provider affinity cache).
- Providers are deduplicated by their `name` property, so the same provider registered twice is only called once.

<br/>

---

## Provider Selection Strategies

When more than one provider is configured, ComputeSDK picks which one to use per call based on `providerStrategy`.

### `priority` (default)

Providers are tried in the order you passed them. The first successful one handles the call. If `fallbackOnError` is `true`, failures cascade to the next provider.

```typescript
compute.setConfig({
  providers: [e2b({...}), modal({...})],
  providerStrategy: 'priority',
  fallbackOnError: true,
});

// Tries e2b first; falls back to modal only if e2b throws
await compute.sandbox.create();
```

Use when you have a preferred provider and want the others purely as a safety net.

### `round-robin`

New sandboxes rotate through providers in order. Good for distributing load evenly across providers with similar capability profiles.

```typescript
compute.setConfig({
  providers: [e2b({...}), modal({...})],
  providerStrategy: 'round-robin',
});

await compute.sandbox.create(); // e2b
await compute.sandbox.create(); // modal
await compute.sandbox.create(); // e2b
```

Failover via `fallbackOnError` still applies: if the round-robin pick fails, the next provider is tried.

<br/>

---

## `fallbackOnError`

Controls whether `create` tries the next provider after a failure.

- `true` (default) — on failure, move to the next candidate and keep going until one succeeds or all fail
- `false` — the first failure throws immediately

```typescript
compute.setConfig({
  providers: [e2b({...}), modal({...})],
  fallbackOnError: false,
});

// If e2b throws, the error propagates — modal is never tried
await compute.sandbox.create();
```

**Notes:**
- When a caller specifies `{ provider: 'modal' }` explicitly, `fallbackOnError` is ignored for that call — the target provider is the only one tried.
- Failover only applies to `create`. Operations on an existing sandbox (`destroy`, snapshot work) use provider affinity instead — see below.

<br/>

---

## Per-Call Provider Override

Most `compute.sandbox.*` methods accept an optional `provider` field to target a specific provider by name, bypassing the strategy:

```typescript
// Force this sandbox onto Modal, regardless of strategy
const gpuSandbox = await compute.sandbox.create({ provider: 'modal' });

// Target a specific provider for a snapshot
const snap = await compute.snapshot.create(sandboxId, { provider: 'e2b' });
```

The override must match a configured provider's `.name` exactly. If not, a descriptive error is thrown listing the configured providers.

<br/>

---

## Provider Affinity

For sandboxes created through `compute`, the owning provider is tracked internally. Operations that act on an existing sandbox prefer the owning provider first:

- `compute.sandbox.destroy(sandboxId)`
- `compute.sandbox.getById(sandboxId)`
- `compute.snapshot.create(sandboxId, options)`
- `compute.snapshot.delete(snapshotId)`

Affinity is **preferred, not exclusive**: if the owning provider fails, ComputeSDK falls through to the other configured providers.

**Caveats:**
- Affinity is kept in an in-memory map that is reset every time `setConfig` is called.
- Sandbox IDs minted outside the current `compute` instance (e.g., from a different process, or fetched via raw SDK) have no recorded affinity — every configured provider is probed.
- This means, in long-running processes, the happy path is one call to the owning provider; in fresh processes with only a stored ID, expect a probe across providers.

<br/>

---

## `compute.sandbox.*`

The full sandbox API is documented in [compute.sandbox](./compute.sandbox.md). Summary of available methods:

| Method | Purpose |
|--------|---------|
| `create(options?)` | Provision a new sandbox |
| `getById(sandboxId)` | Reconnect to an existing sandbox |
| `list()` | List active sandboxes (aggregated across providers in multi-provider mode) |
| `destroy(sandboxId)` | Tear down a sandbox |

All of these accept a `provider` override where applicable. See [Sandbox](./Sandbox.md) for the instance methods (`runCommand`, `filesystem.*`).

> **Reserved methods.** The TypeScript surface also declares `compute.sandbox.find`, `compute.sandbox.findOrCreate`, and `compute.sandbox.extendTimeout`. These are reserved for a future gateway / named-sandbox mode and are not implemented by the currently shipped provider packages — calling them today throws `Provider 'X' does not support …`. Don't rely on them in direct-mode code.

<br/>

---

## `compute.snapshot.*`

Available when at least one configured provider supports snapshots.

| Method | Purpose |
|--------|---------|
| `create(sandboxId, options?)` | Capture a snapshot of a running sandbox |
| `list()` | List snapshots across providers that support listing |
| `delete(snapshotId)` | Delete a snapshot |

```typescript
const sandbox = await compute.sandbox.create();
const snap = await compute.snapshot.create(sandbox.sandboxId, {
  name: 'post-setup',
  metadata: { owner: 'team-backend' },
});

const snapshots = await compute.snapshot.list();
await compute.snapshot.delete(snap.id);
```

**Notes:**
- `create` routes to the sandbox's owning provider first; otherwise tries any snapshot-capable provider.
- `delete` tracks the owning provider of each snapshot so deletes land on the right platform.
- If no configured provider supports snapshots, calls throw a descriptive error.

<br/>

---

## Error Handling

ComputeSDK surfaces descriptive, aggregated errors when all candidates fail:

```typescript
try {
  const sandbox = await compute.sandbox.create();
} catch (error) {
  // Example message:
  // Failed to create sandbox across 2 provider(s).
  //   - e2b: rate limited
  //   - modal: authentication failed
  console.error(error.message);
}
```

Common error cases:

- **No provider configured** — Call `compute.setConfig({ provider: ... })` or `compute.setConfig({ providers: [...] })` before any sandbox call.
- **`provider: 'foo'` override with no matching provider** — The error lists the configured provider names.
- **All providers failed** — The message includes one line per provider with its failure reason.

<br/>

---

## End-to-End Example

```typescript
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { modal } from '@computesdk/modal';

compute.setConfig({
  providers: [
    e2b({ apiKey: process.env.E2B_API_KEY }),
    modal({
      tokenId: process.env.MODAL_TOKEN_ID,
      tokenSecret: process.env.MODAL_TOKEN_SECRET,
    }),
  ],
  providerStrategy: 'priority',
  fallbackOnError: true,
});

async function runUserCode(userId: string, code: string) {
  const sandbox = await compute.sandbox.create({
    timeout: 5 * 60 * 1000,
    metadata: { userId },
    envs: { USER_ID: userId },
  });

  try {
    await sandbox.filesystem.writeFile('/tmp/main.py', code);
    const result = await sandbox.runCommand('python /tmp/main.py');
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      provider: sandbox.provider,
    };
  } finally {
    await sandbox.destroy();
  }
}
```

<br/>

---

## Related

- [compute.sandbox](./compute.sandbox.md) — sandbox lifecycle methods
- [Sandbox](./Sandbox.md) — sandbox instance methods (code, commands, filesystem, terminal)
- [Introduction](../getting-started/introduction.md) — high-level overview
- [Installation](../getting-started/installation.md) — provider setup and credentials
- [Quick Start](../getting-started/quick-start.md) — minimal end-to-end walkthrough
