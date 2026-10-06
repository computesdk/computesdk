---
"@computesdk/cli": minor
---

Add `compute org` and a one-off org override.

- `compute org list` / `compute org use <slug>` / `compute org current` (alias:
  `compute whoami`), backed by `GET`/`POST /api/v1/organizations` and
  `GET /api/v1/me` via `@benchsdk/cli` — mirrors `bench org`. The active org is
  stored per user and client on the platform, so `org use` applies everywhere
  the login is shared.
- `--org <slug>` (root flag, or on any `sandboxes` / `actions` / `market`
  subcommand) and the `COMPUTE_ORG` env var send `X-Org-Slug` on requests.
  Precedence: `--org` > `COMPUTE_ORG` > the stored login's org. The platform
  ignores the header for org API keys.
- `compute login` now prints the active org after authenticating:
  "Logged in as you@… — active org: acme (change with `compute org use <slug>`)".

Requires `@benchsdk/cli@^0.7.1` (org/credentials helpers are exported there).
