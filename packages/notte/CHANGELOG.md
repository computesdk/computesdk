# @computesdk/notte

## 0.3.0

### Minor Changes

- baf1ac3: Add `@computesdk/notte` browser provider for cloud browser sessions powered by Notte (https://notte.cc). Wraps `notte-sdk` via the `defineBrowserProvider` factory, parallel to `@computesdk/kernel` and `@computesdk/browserbase`.

  - Session lifecycle: `create / getById / list / destroy / getConnectUrl` via `notte-sdk`'s `sessionStart / sessionStatus / listSessions / sessionStop` helpers. `connectUrl` returns Notte's CDP WebSocket endpoint with a short-lived JWT (not the API key) — does not require the same "treat as secret" handling as anchorbrowser/steel.
  - Profiles: `create / get / list / delete` via `profileCreate / profileGet / profileList / profileDelete`.
  - Maps session options: `viewport → viewport_width/viewport_height`, `timeout (sec) → max_duration_minutes`, `profileId → profile.{id, persist:true}`. Proxies are mapped two ways: `boolean` toggles Notte's default proxy pool; `ProxyConfig[]` is mapped via the first element only (Notte's runtime accepts a single proxy per session — multi-element arrays return HTTP 500; matches `@computesdk/hyperbrowser`'s "first ProxyConfig wins" convention). Per-element mapping: entries with a `server` URL become Notte `ExternalProxy` (server/username/password forwarded); entries without a `server` use Notte's managed pool with `geolocation.country` (lossy: ComputeSDK `type` discriminator, sub-country geolocation, and `domainPattern` are dropped because Notte doesn't model them). `type: 'custom'` without a `server` throws. `stealth`, `keepAlive`, `recording`, `logging`, `userMetadata`, `extensionIds` have no direct Notte equivalent yet.
  - Auth via `NOTTE_API_KEY` env var or explicit `apiKey` config; base URL configurable via `NOTTE_API_URL` or `baseUrl`.
