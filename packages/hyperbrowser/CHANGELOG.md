# @computesdk/hyperbrowser

## 0.2.6

### Patch Changes

- 328da85: Preserve explicit `stealth: false` and `proxies: false` browser session options where provider APIs support them, and warn once when a provider cannot honor the option.

## 0.2.5

### Patch Changes

- Updated dependencies [607a11b]
  - computesdk@4.1.3
  - @computesdk/provider@2.1.3

## 0.2.4

### Patch Changes

- computesdk@4.1.2
- @computesdk/provider@2.1.2

## 0.2.3

### Patch Changes

- Updated dependencies [eca5ec2]
  - computesdk@4.1.1
  - @computesdk/provider@2.1.1

## 0.2.2

### Patch Changes

- Updated dependencies [cc79d78]
  - computesdk@4.1.0
  - @computesdk/provider@2.1.0

## 0.2.1

### Patch Changes

- Updated dependencies [aa4ca58]
  - computesdk@4.0.0
  - @computesdk/provider@2.0.0

## 0.2.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [3ef4817]
- Updated dependencies [371f667]
  - @computesdk/provider@1.4.0
  - computesdk@3.0.0
