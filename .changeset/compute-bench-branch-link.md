---
'@computesdk/cli': minor
---

`compute bench` exposes the newer bench commands: `benchmarks archive|restore|describe|mute|unmute|pause|resume`, `benchmarks list --status`, `runs archive|unarchive`, `runs feed|days|day`, `reliability`, `reliability cards`, `activity`, and `run-again [--wait]` / `run-again status` (the daily Run again, next to the released `runs run-again`). `cli-manifest.json` marks the bundled `@benchsdk/runner` / `@benchsdk/cli` with `"linked": true, "released": false` while they resolve to a local benchmarks checkout instead of an npm install.
