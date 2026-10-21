---
"@computesdk/provider": patch
"@computesdk/daytona": patch
---

Volume review fixes: `withVolumeSettle` reads attachment errors off plain API error objects (providers throw `{error: "..."}` as often as Errors, which stringified to `[object Object]` and skipped the settle retry); daytona `resolveDaytonaVolume` only falls back to an id scan on a real not-found — other `volume.get` failures (auth, 5xx) propagate instead of silently making delete a no-op.
