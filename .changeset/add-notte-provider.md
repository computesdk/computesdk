---
"@computesdk/notte": minor
---

Add `@computesdk/notte` browser provider for cloud browser sessions powered by Notte (https://notte.cc). Wraps `notte-sdk` via the `defineBrowserProvider` factory, parallel to `@computesdk/kernel` and `@computesdk/browserbase`.

- Session lifecycle: `create / getById / list / destroy / getConnectUrl` via `notte-sdk`'s `sessionStart / sessionStatus / listSessions / sessionStop` helpers. `connectUrl` returns Notte's CDP WebSocket endpoint with a short-lived JWT (not the API key) — does not require the same "treat as secret" handling as anchorbrowser/steel.
- Profiles: `create / get / list / delete` via `profileCreate / profileGet / profileList / profileDelete`.
- Maps session options: `viewport → viewport_width/viewport_height`, `timeout (sec) → max_duration_minutes`, `proxies (true | ProxyConfig[]) → proxies`, `profileId → profile.{id, persist:true}`. `stealth`, `keepAlive`, `recording`, `logging`, `userMetadata`, `extensionIds` have no direct Notte equivalent yet.
- Auth via `NOTTE_API_KEY` env var or explicit `apiKey` config; base URL configurable via `NOTTE_API_URL` or `baseUrl`.
