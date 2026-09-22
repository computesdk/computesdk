# Adding a New Browser Provider

This guide walks you through creating a new **browser provider** package for ComputeSDK.

A browser provider manages cloud browser sessions — it creates a remote browser and
hands back a CDP/WebSocket `connectUrl` that the caller drives with Playwright,
Puppeteer, or another CDP client. This is different from a **sandbox provider**, which
runs shell commands in an isolated environment (see [ADD-PROVIDER.md](ADD-PROVIDER.md)).
If your service runs code in a sandbox rather than hosting a browser, you want that
guide instead.

Browser providers are built with `defineBrowserProvider` from `@computesdk/provider`
and expose `methods.session` (instead of `methods.sandbox`). Reference packages:
[packages/browserbase](packages/browserbase), [packages/browseruse](packages/browseruse),
[packages/kernel](packages/kernel), [packages/steel](packages/steel).

## Before You Start

- **Node.js** >= 18 and **pnpm** >= 9 are required
- Familiarize yourself with the provider you're integrating (API docs, SDK, auth model)
- Confirm the provider exposes a way to connect to the live browser (a CDP/WebSocket
  URL, or a session whose URL can be derived). A browser provider without a connectable
  URL isn't useful to callers.

### Scope: no core SDK changes

A provider PR adds a provider. It must not modify the SDK core. Confine your changes to
these paths:

| Path | What goes there |
|---|---|
| `packages/my-browser/` | Your entire provider package |
| `.changeset/<slug>.md` | Your changeset (§7) |

**Do not touch** anything else — in particular:

- `packages/computesdk/` and `packages/provider/` — the SDK core and provider framework.
  If your provider can't be expressed with the existing `defineBrowserProvider`
  interface, that's a framework gap: open an issue describing what you need, and don't
  work around it by editing core in your PR.
- Other providers' packages, shared tooling, root configs (`tsconfig.json`,
  `pnpm-workspace.yaml`, CI workflows), and lockfile edits beyond what `pnpm install`
  produces for your own package.

A PR that changes core alongside a new provider will be asked to split into two.

> **Note on docs:** unlike sandbox providers, browser providers are not currently
> listed in the root `README.md` provider table or in the GitBook docs under
> `docs/providers/` — those cover sandbox providers today. Browser packages carry their
> own runnable `example-<name>.ts` at the package root instead (see §6). Only add a
> docs page if a maintainer asks for one.

## 1. Scaffold the Package

Create a new directory under `packages/`:

```
packages/my-browser/
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── src/
    ├── index.ts
    └── __tests__/
        └── index.test.ts
```

Optional but common:

- `example-<name>.ts` — a runnable Playwright/Puppeteer example (§6)
- `vitest.config.ts` + `vitest.setup.ts` — only needed if you want tests to load a
  repo-root `.env` for credentials (see `packages/steel`); vitest runs fine without a
  config file

### package.json

Browser provider packages are ESM-first: `"type": "module"`, with `main` pointing at
the CJS build and `module` at the ESM build.

```json
{
  "name": "@computesdk/my-browser",
  "version": "0.1.0",
  "description": "My Browser provider for ComputeSDK - cloud browser sessions powered by My Browser",
  "author": "Your Name",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "clean": "rimraf dist",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest watch",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint"
  },
  "keywords": [
    "computesdk",
    "my-browser",
    "browser",
    "headless",
    "playwright",
    "provider"
  ],
  "dependencies": {
    "@computesdk/provider": "workspace:*",
    "computesdk": "workspace:*",
    "my-browser-sdk": "^1.0.0"
  },
  "devDependencies": {
    "@computesdk/test-utils": "workspace:*",
    "@types/node": "^20.0.0",
    "@vitest/coverage-v8": "^1.0.0",
    "eslint": "^8.37.0",
    "rimraf": "^5.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/computesdk/computesdk.git",
    "directory": "packages/my-browser"
  },
  "homepage": "https://www.computesdk.com",
  "bugs": {
    "url": "https://github.com/computesdk/computesdk/issues"
  }
}
```

If your example file uses Playwright or `dotenv`, add `playwright-core` and `dotenv` to
`dependencies` (that's what `@computesdk/browserbase` does) or `devDependencies`.

### tsconfig.json

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### tsup.config.ts

```typescript
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
})
```

The `pnpm-workspace.yaml` already includes `packages/*`, so your new package is
automatically part of the workspace.

## 2. Implement the Provider

Use `defineBrowserProvider` from `@computesdk/provider`. It takes two type parameters —
`TSession` (your provider's native session/browser object) and `TConfig` (your
configuration type) — and an object with your provider name and method implementations.

```typescript
// src/index.ts
import MyBrowser from 'my-browser-sdk';
import { defineBrowserProvider } from '@computesdk/provider';

import type { CreateBrowserSessionOptions } from '@computesdk/provider';

/**
 * My Browser-specific configuration options
 */
export interface MyBrowserConfig {
  /** My Browser API key — falls back to MY_BROWSER_API_KEY env var */
  apiKey?: string;
}

/** The native session object returned by the provider SDK */
type MyBrowserSession = /* your SDK's session type */;

/**
 * Resolve config values from explicit config or environment variables
 */
function resolveConfig(config: MyBrowserConfig) {
  const apiKey =
    config.apiKey ||
    (typeof process !== 'undefined' && process.env?.MY_BROWSER_API_KEY) ||
    '';

  if (!apiKey) {
    throw new Error(
      `Missing My Browser API key. Provide 'apiKey' in config or set MY_BROWSER_API_KEY environment variable. ` +
      `Get your API key from https://my-browser.com/settings`
    );
  }

  return { apiKey };
}

function createClient(config: MyBrowserConfig): MyBrowser {
  const { apiKey } = resolveConfig(config);
  return new MyBrowser({ apiKey });
}

/** Adapt to your SDK: a typed NotFoundError, a `status` on the error object, etc. */
function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status: number }).status === 404
  );
}

export const myBrowser = defineBrowserProvider<MyBrowserSession, MyBrowserConfig>({
  name: 'my-browser',
  methods: {
    session: {
      create: async (config, options) => {
        const client = createClient(config);
        const session = await client.sessions.create(mapSessionOptions(options));
        return {
          session,
          sessionId: session.id,
          connectUrl: session.connectUrl,
        };
      },

      getById: async (config, sessionId) => {
        const client = createClient(config);
        try {
          const session = await client.sessions.retrieve(sessionId);
          return {
            session,
            sessionId: session.id,
            connectUrl: session.connectUrl,
          };
        } catch (error) {
          // Only translate the provider's not-found response into null —
          // rethrow auth, throttling, and network errors so callers can tell
          // "session doesn't exist" apart from "provider call failed".
          if (isNotFoundError(error)) return null;
          throw error;
        }
      },

      list: async (config) => {
        const client = createClient(config);
        const sessions = await client.sessions.list();
        return sessions.map((session) => ({
          session,
          sessionId: session.id,
          connectUrl: session.connectUrl,
        }));
      },

      destroy: async (config, sessionId) => {
        const client = createClient(config);
        await client.sessions.delete(sessionId);
      },

      getConnectUrl: async (config, sessionId) => {
        const client = createClient(config);
        const session = await client.sessions.retrieve(sessionId);
        return session.connectUrl;
      },
    },
  },
});
```

Unlike sandbox providers, the config type is a plain interface — it does not extend a
shared `ProviderConfig`.

## 3. Session Methods

`methods.session` is the one required block. All five methods must be implemented:

| Method | Signature | Description |
|---|---|---|
| `create` | `(config, options?) => Promise<{ session, sessionId, connectUrl, status? }>` | Create a new browser session |
| `getById` | `(config, sessionId) => Promise<{ session, sessionId, connectUrl, status? } \| null>` | Get a session by ID; return `null` when not found |
| `list` | `(config) => Promise<Array<{ session, sessionId, connectUrl?, status? }>>` | List active sessions |
| `destroy` | `(config, sessionId) => Promise<void>` | Terminate a session |
| `getConnectUrl` | `(config, sessionId) => Promise<string>` | Get the CDP/WebSocket URL for a session |

### Return shape

Each session method returns the **native** session object plus normalized fields:

- `session` — the provider SDK's session/browser object, passed through untouched.
  Callers can reach it via `session.getInstance()`.
- `sessionId` — the provider's session identifier.
- `connectUrl` — a `wss://` (or `https://`) URL the caller can hand to
  `chromium.connectOverCDP()` or equivalent. Required on `create`/`getById`; **optional
  on `list` entries** — if the provider's list endpoint omits it, leave it out and
  callers will use `provider.getConnectUrl(sessionId)` instead.
- `status` — optional, mapped onto the standard
  `'created' | 'running' | 'completed' | 'failed' | 'timed_out'` union (defaults to
  `'running'` when omitted).

```typescript
function mapStatus(status: string): 'created' | 'running' | 'completed' | 'failed' | 'timed_out' {
  switch (status) {
    case 'RUNNING': return 'running';
    case 'COMPLETED': return 'completed';
    case 'FAILED':
    case 'ERROR': return 'failed';
    case 'TIMED_OUT': return 'timed_out';
    default: return 'created';
  }
}
```

### Mapping `CreateBrowserSessionOptions`

`create` receives a `CreateBrowserSessionOptions` with standardized fields:
`proxies`, `viewport`, `timeout`, `keepAlive`, `recording`, `logging`, `stealth`,
`profileId`, `extensionIds`, `region`, `userMetadata`. Map each one to your provider's
create-session params.

When an option can't be expressed in your provider's API, **warn once and move on** —
don't fail the call and don't silently drop it. `packages/kernel` has the pattern:

```typescript
const warnedUnsupported = new Set<string>();
function warnOnce(field: string, reason: string) {
  if (warnedUnsupported.has(field)) return;
  warnedUnsupported.add(field);
  console.warn(`[@computesdk/my-browser] '${field}' is ignored: ${reason}`);
}
```

## 4. Optional Method Groups

Everything under `methods` besides `session` is optional. The factory detects which
groups you implement and only exposes the corresponding managers on the provider
object — omit what your provider doesn't support rather than stubbing it.

| Group | Methods | What it covers |
|---|---|---|
| `profile` | `create`, `get`, `list`, `delete` | Persistent browser contexts/profiles (cookies, storage) — Browserbase "contexts", Kernel "profiles" |
| `extension` | `create`, `get`, `delete` | Uploading and managing browser extensions |
| `pool` | `create`, `get`, `list`, `acquire`, `release`, `delete` | Pre-warmed browser instances for instant acquisition |
| `logs` | `list(sessionId)` | Session log retrieval |
| `recording` | `get(sessionId)` | Session replay recordings (rrweb, mp4) |
| `page` | `navigate`, `screenshot`, `evaluate`, `getContent`, `pdf?` | Native page control without a CDP client |

Guidelines:

- **`getById`/`get` style reads should return `null` only for confirmed not-found
  responses.** Inspect the provider SDK's typed error or status code (e.g. a 404 or
  `NotFoundError`) and rethrow everything else — a blanket `catch { return null; }`
  makes auth failures and outages look like missing sessions.
- **`profile.list` may return `[]`** when the provider has no list endpoint; document
  that in the method.
- **Extension uploads** take `CreateBrowserExtensionOptions.file` as
  `Uint8Array | string` — wrap it in a `Blob`/`File` for SDKs that expect a file object
  (see `browserbase`'s `extension.create`).
- **`page` is for providers with native page APIs.** Most providers don't need it —
  callers get `connectUrl` and drive the browser with Playwright themselves. Sessions
  on providers without `page` get a clear "use the connectUrl" error from
  `session.screenshot()`.

## 5. Write Tests

The `@computesdk/test-utils` package provides `runBrowserProviderTestSuite`, which
validates the full session lifecycle (create → getById → list → getConnectUrl →
destroy) against a real API. Create `src/__tests__/index.test.ts`:

```typescript
import { runBrowserProviderTestSuite } from '@computesdk/test-utils';
import { myBrowser } from '../index';

runBrowserProviderTestSuite({
  name: 'my-browser',
  provider: myBrowser({}),
  skipIntegration: !process.env.MY_BROWSER_API_KEY,
});
```

Integration tests are skipped without credentials — that's expected. The suite creates
one shared session to stay within provider rate limits.

For logic you can verify without network — especially option mapping — add a separate
unit test that mocks the provider SDK (see
`packages/kernel/src/__tests__/options.test.ts`):

```typescript
import { describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: 'session-id', connectUrl: 'wss://example' })),
}));

vi.mock('my-browser-sdk', () => ({
  default: class MyBrowser {
    sessions = { create: sdk.create };
  },
}));

import { myBrowser } from '../index';

describe('my-browser option mapping', () => {
  it('maps stealth and viewport to provider params', async () => {
    const provider = myBrowser({ apiKey: 'test' });
    await provider.session.create({ stealth: true, viewport: { width: 1920, height: 1080 } });
    expect(sdk.create).toHaveBeenCalledWith(/* expected provider params */);
  });
});
```

## 6. Add a Runnable Example

Browser packages ship a standalone `example-<name>.ts` at the package root showing the
end-to-end flow: create a session, connect over CDP, do something on the page, clean
up. See `packages/steel/example-steel.ts`:

```typescript
import { chromium, type Browser } from 'playwright-core';
import { myBrowser } from './src/index';
import 'dotenv/config';

async function main() {
  const mb = myBrowser({ apiKey: process.env.MY_BROWSER_API_KEY });

  const session = await mb.session.create();
  let browser: Browser | undefined;

  try {
    browser = await chromium.connectOverCDP(session.connectUrl!);

    const page = browser.contexts()[0]!.pages()[0]!;
    await page.goto('https://example.com');
  } finally {
    // Clean up independently: a failed connect still owes the provider a destroy,
    // and a failed browser.close() must not skip it either.
    await browser?.close().catch(() => {});
    await session.destroy();
  }
}

main().catch(console.error);
```

## 7. Add a Changeset

Releases are managed with [Changesets](https://github.com/changesets/changesets). Every
PR that adds or changes a published package needs one, or the package won't be
versioned and published.

Create `.changeset/<short-slug>.md` (any unique kebab-case filename works):

```markdown
---
"@computesdk/my-browser": patch
---

Add My Browser browser provider
```

### Bump type

**Never use `major`.** A new provider package is additive — it can't break existing
consumers — so a major bump is always wrong here.

| Bump | When |
|---|---|
| `patch` | **Default for a new provider package.** Use this unless a maintainer says otherwise. |
| `minor` | Only when a maintainer explicitly asks for it. |
| `major` | Never. |

List only the package your PR adds. Never list `computesdk` or `@computesdk/provider`:
a provider PR doesn't change them (see [Scope](#scope-no-core-sdk-changes)).

## 8. Build and Verify

```bash
# Install dependencies
pnpm install

# Build the full dependency chain (provider framework first, then your package)
pnpm run build

# Or build just your package (after dependencies are built)
pnpm --filter @computesdk/my-browser run build

# Type check
pnpm --filter @computesdk/my-browser run typecheck

# Lint
pnpm --filter @computesdk/my-browser run lint

# Run tests
pnpm --filter @computesdk/my-browser run test
```

## 9. Submit Your PR

Your PR should include:

- [ ] The new `packages/my-browser/` directory with all files listed above
- [ ] All five `session` methods implemented: `create`, `getById`, `list`, `destroy`,
      `getConnectUrl`
- [ ] `connectUrl` populated on `create`/`getById` results (a real `wss://`/`https://`
      URL a CDP client can connect to)
- [ ] Config validated early with a helpful error; env-var fallback supported
- [ ] Optional method groups only where the provider genuinely supports them
- [ ] Tests via `runBrowserProviderTestSuite`, plus unit tests for option mapping
- [ ] A runnable `example-<name>.ts`
- [ ] Passing `build`, `typecheck`, and `lint` checks
- [ ] A changeset in `.changeset/` with a `patch` bump — never `major`
- [ ] **No changes outside the allowed paths** — run `git diff --stat main` and confirm
      every file is in `packages/my-browser/` or `.changeset/`. No edits to
      `packages/computesdk/` or `packages/provider/`. See
      [Scope](#scope-no-core-sdk-changes).

## Best Practices

**Validate config early.** Check API keys exist and provide helpful setup instructions
in error messages — including where to get a key:

```typescript
if (!apiKey) {
  throw new Error(
    `Missing My Browser API key. Provide 'apiKey' in config or set MY_BROWSER_API_KEY environment variable. ` +
    `Get your API key from https://my-browser.com/settings`
  );
}
```

**Support env var fallbacks.** Accept config via constructor params and fall back to
environment variables. Guard the `process.env` access so the package doesn't blow up in
non-Node runtimes:

```typescript
const apiKey =
  config.apiKey ||
  (typeof process !== 'undefined' && process.env?.MY_BROWSER_API_KEY) ||
  '';
```

**Return `null`, don't throw, for missing resources.** `getById` and `profile.get` /
`extension.get` should return `null` for the provider's not-found response — and only
that response. Rethrow auth, throttling, and network errors so callers can distinguish
"doesn't exist" from "the API call failed":

```typescript
function isNotFoundError(error: unknown): boolean {
  // Adapt to your SDK: a typed NotFoundError, an HTTP status on the error object,
  // an error code — whatever the SDK actually exposes.
  return typeof error === 'object' && error !== null && 'status' in error && (error as { status: number }).status === 404;
}
```

**Map statuses, not just IDs.** Populate the `status` field when the provider exposes
lifecycle state, using the standard union.

**Warn, don't fail, on unexpressible options.** If `CreateBrowserSessionOptions` has a
field your provider can't honor (e.g. a proxy shape it doesn't support), `console.warn`
once and continue.

**Don't swallow errors on writes.** `create`, `destroy`, and the mutation methods
should let provider errors propagate (optionally wrapped in a clearer message) — only
reads use the catch-and-return-null pattern.

## Naming Conventions

| Item | Convention | Example |
|---|---|---|
| Package name | `@computesdk/{kebab-case}` | `@computesdk/my-browser` |
| Export name | camelCase, matches provider | `export const myBrowser = ...` |
| Config type | `{PascalCase}Config` | `MyBrowserConfig` |
| Directory | `packages/{kebab-case}` | `packages/my-browser` |
| Example file | `example-{kebab-case}.ts` | `example-my-browser.ts` |
| Env var | `{SCREAMING_SNAKE}_API_KEY` | `MY_BROWSER_API_KEY` |

## Reference Implementations

| Provider | Path | Notable for |
|---|---|---|
| Browserbase | [packages/browserbase](packages/browserbase) | Profiles (contexts), extensions, logs, recordings, proxy mapping |
| Browser Use | [packages/browseruse](packages/browseruse) | Profiles, recordings, proxy-country mapping |
| Kernel | [packages/kernel](packages/kernel) | Profiles, extensions, filesystem-backed logs, `warnOnce` pattern |
| Steel | [packages/steel](packages/steel) | Extensions, logs, recordings, `.env`-loading vitest setup |
| Hyperbrowser | [packages/hyperbrowser](packages/hyperbrowser) | All optional groups: profiles, extensions, logs, recordings |
| Notte | [packages/notte](packages/notte) | Minimal provider (sessions + profiles) |
| Anchor Browser | [packages/anchorbrowser](packages/anchorbrowser) | Profiles, extensions, recordings |

## Questions?

Open an issue at https://github.com/computesdk/computesdk/issues or check the
[@computesdk/provider README](packages/provider/README.md) for the full API reference —
the browser provider types live in
[`packages/provider/src/types/browser.ts`](packages/provider/src/types/browser.ts).
