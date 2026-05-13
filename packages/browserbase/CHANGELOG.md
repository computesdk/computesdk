# @computesdk/browserbase

## 0.3.4

### Patch Changes

- Updated dependencies [aa4ca58]
  - computesdk@4.0.0
  - @computesdk/provider@2.0.0

## 0.3.3

### Patch Changes

- 3ef4817: Add `@computesdk/hyperbrowser` browser provider and relax `BrowserSession.connectUrl` for list summaries.

  **`@computesdk/hyperbrowser`** (new package)

  - Wraps `@hyperbrowser/sdk` via the `defineBrowserProvider` factory, parallel to `@computesdk/browserbase`.
  - Implements session lifecycle (`create / getById / list / destroy / getConnectUrl`) using `wsEndpoint` as the connect URL, and maps `active/closed/error` to standard `running/completed/failed` statuses.
  - Maps session options: `stealth → useStealth`, `proxies (true | ProxyConfig[]) → useProxy / proxyServer / proxyCountry / proxyState / proxyCity` (Hyperbrowser supports a single proxy per session — first `ProxyConfig` wins), `viewport → screen`, `recording → enableWebRecording`, `logging → enableLogCapture`, `profileId → profile.{id, persistChanges}`, `region → region`, `timeout (sec) → timeoutMinutes`. `keepAlive` and `userMetadata` have no native equivalent.
  - Profiles: full CRUD via `client.profiles.*`.
  - Extensions: `create` materializes `Uint8Array`/`string` payloads to a temp file (the SDK only accepts `filePath`); `get` filters `client.extensions.list()`; `delete` throws because Hyperbrowser exposes no delete endpoint.
  - Logs: `client.sessions.eventLogs.list` mapped to `BrowserLog` (`captcha_error → error`, others → `info`).
  - Recordings: combines `getRecordingURL` and `getRecording` into a single `BrowserRecording` (`format: 'rrweb'`).

  **`@computesdk/provider`** (breaking type relaxation)

  - `BrowserSession.connectUrl` is now optional (`string | undefined`). Always populated by `create()` and `getById()`; may be omitted on entries returned by `list()` when the underlying provider's list endpoint doesn't include it. Callers needing a connectable URL for a listed session should use `provider.getConnectUrl(sessionId)`.
  - `BrowserSessionMethods.list` return type relaxed accordingly. `create` and `getById` continue to require `connectUrl: string`.
  - Consumers reading `session.connectUrl` directly may need to add a null check, e.g. `session.connectUrl?.startsWith('wss://')`.

  **`@computesdk/browserbase`** and **`@computesdk/kernel`**

  - No code change; both already populate `connectUrl` on every session method, so they satisfy the looser type. Patch bumps track the upstream provider relaxation.

- Updated dependencies [3ef4817]
- Updated dependencies [371f667]
  - @computesdk/provider@1.4.0
  - computesdk@3.0.0

## 0.3.2

### Patch Changes

- Updated dependencies [a321f01]
  - computesdk@2.6.0
  - @computesdk/provider@1.3.0

## 0.3.1

### Patch Changes

- Updated dependencies [7c53d28]
  - @computesdk/provider@1.2.0

## 0.3.0

### Minor Changes

- 3e6a91a: Add browser provider abstraction and Browserbase provider

  - Add `BrowserProvider` interface and `defineBrowserProvider()` factory to `@computesdk/provider` for building cloud browser providers, parallel to the existing sandbox provider pattern
  - Ship `@computesdk/browserbase` as the first browser provider, wrapping the `@browserbasehq/sdk` with support for session lifecycle, profiles (contexts), extensions, logs, and recordings
  - Add `runBrowserProviderTestSuite()` to `@computesdk/test-utils` for integration testing browser providers
  - Register `browserbase` in `BROWSER_PROVIDER_AUTH` and related config maps in `computesdk`

### Patch Changes

- 3e6a91a: Fix file type mismatch in @computesdk/browserbase package.json

  - Correct `main` to point to `./dist/index.cjs` (CommonJS) instead of `./dist/index.js`
  - Correct `module` to point to `./dist/index.js` (ESM) instead of `./dist/index.mjs`
  - Update `exports` map to match the corrected entry points

- 9a2eab9: Bump @computesdk/browserbase to 0.2.1
- Updated dependencies [3e6a91a]
  - @computesdk/provider@1.1.0
  - computesdk@2.5.4

## 0.2.0

### Minor Changes

- 9a312d2: Add browser provider abstraction and Browserbase provider

  - Add `BrowserProvider` interface and `defineBrowserProvider()` factory to `@computesdk/provider` for building cloud browser providers, parallel to the existing sandbox provider pattern
  - Ship `@computesdk/browserbase` as the first browser provider, wrapping the `@browserbasehq/sdk` with support for session lifecycle, profiles (contexts), extensions, logs, and recordings
  - Add `runBrowserProviderTestSuite()` to `@computesdk/test-utils` for integration testing browser providers
  - Register `browserbase` in `BROWSER_PROVIDER_AUTH` and related config maps in `computesdk`

### Patch Changes

- 9a312d2: Fix file type mismatch in @computesdk/browserbase package.json

  - Correct `main` to point to `./dist/index.cjs` (CommonJS) instead of `./dist/index.js`
  - Correct `module` to point to `./dist/index.js` (ESM) instead of `./dist/index.mjs`
  - Update `exports` map to match the corrected entry points

- Updated dependencies [9a312d2]
  - @computesdk/provider@1.1.0
  - computesdk@2.5.4

## 0.2.0

### Minor Changes

- b34d97f: Add browser provider abstraction and Browserbase provider

  - Add `BrowserProvider` interface and `defineBrowserProvider()` factory to `@computesdk/provider` for building cloud browser providers, parallel to the existing sandbox provider pattern
  - Ship `@computesdk/browserbase` as the first browser provider, wrapping the `@browserbasehq/sdk` with support for session lifecycle, profiles (contexts), extensions, logs, and recordings
  - Add `runBrowserProviderTestSuite()` to `@computesdk/test-utils` for integration testing browser providers
  - Register `browserbase` in `BROWSER_PROVIDER_AUTH` and related config maps in `computesdk`

### Patch Changes

- Updated dependencies [b34d97f]
  - @computesdk/provider@1.1.0
  - computesdk@2.5.4
