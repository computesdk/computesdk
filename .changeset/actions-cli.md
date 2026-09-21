---
"@computesdk/cli": patch
---

Add `compute actions` command group — drive the benchmarks-platform Actions v1 API end-to-end:

- `actions dispatch <repo> --workflow <path|name> [--ref <ref>] [--inputs k=v...]` — resolves the workflow via `/workflows`, dispatches, prints run id + dashboard URL
- `actions runs <repo> [--status ...] [--branch ...]` — recent run list
- `actions run <run-id>` — full detail incl. jobs, provider:region placement, placement attempts
- `actions logs <run-id> [--job] [--step] [--follow]` — byte-offset resumable slices; `--follow` uses SSE (single job) or the multiplexed run stream (all jobs), resuming cursors on reconnect
- `actions cancel|rerun <run-id>`
- `actions artifacts <run-id> [--job] [--out <dir>]` — list or download

Auth via `COMPUTE_API_KEY` or `--api-key`; `--base-url` overrides the platform.computesdk.com default; every subcommand supports `--json`.

Fold the bench CLI under compute: `compute bench <args>` dispatches to `@benchsdk/runner`'s `run()`, covering the full `bench` surface (`run`, `check`, `auth`, `org`, `benchmarks`, `runs`, `results`, `iterations`, `artifacts`, `logs`, `export`) — one implementation, both bins.

Also fixes `@computesdk/cli` failing to start at all: `providers.ts` imported `PROVIDER_NAMES`/`isProviderAuthComplete`/etc. from `computesdk`, which no longer exports them — provider detection is now env-var based, and `installer.ts` had an undefined `resolveApiKey` reference.
