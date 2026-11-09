# @computesdk/cli

The `compute` CLI for the ComputeSDK platform — Actions CI, the compute market,
sandboxes, and the benchmarks toolchain.

## Install

```bash
npm i -g @computesdk/cli        # or: pnpm dlx @computesdk/cli <cmd>
```

## Login

```bash
compute login                   # OAuth device flow → ~/.benchsdk/credentials.json
compute logout                  # clear stored credentials
compute --login / --logout      # same, as flags
```

Login uses the same OAuth device flow as `bench auth login` — every first-party
CLI shares one credential store (`~/.benchsdk/credentials.json`) and refresh
tokens renew automatically.

## Commands

```
compute actions …               # Actions API — repos, dispatch, runs, schedule, logs, vault
compute market …                # buy and sell on the compute market (cap, bids, credits, listings)
compute sandboxes …             # platform sandbox control plane
compute bench …                 # benchmarks CLI (run, auth, org, results, …)
compute providers               # sandbox provider credential status
compute org list                # your organizations (* = active)
compute org use <slug>          # switch the stored login's active org
compute org current / whoami    # current user + active org
```

All platform commands accept `--api-key` / `COMPUTE_API_KEY` and fall back to
the stored OAuth credentials.

The active org comes from the stored login (`compute org use` changes it —
it's per user, so every CLI on every machine sees the switch). For a one-off
override, pass `--org <slug>` (on the root command or any `sandboxes` /
`actions` / `market` subcommand) or set `COMPUTE_ORG`; it sends `X-Org-Slug`
on the request. Precedence: `--org` > `COMPUTE_ORG` > the stored login's org.
The platform ignores the header for org API keys.

For `compute sandboxes exec` and `compute sandboxes spawn`, everything after
the command's first word goes to the sandbox untouched — flags like `uname
-a` or `node -e` are not CLI options. Pass CLI options (`--json`,
`--timeout-ms`, `--cwd`, `-e/--env`, `--stdin`, `--org`) before the command;
a bare `--` before the command is optional but supported.

```bash
compute sandboxes exec sb1 uname -a
compute sandboxes spawn sb1 --cwd /app -e NODE_ENV=production -- npm run dev
```

## Actions schedule

```bash
compute actions schedule                         # now through seven days later, local timezone
compute actions schedule --repo acme/widgets --tz America/Chicago
compute actions schedule --from 2026-11-01T00:00:00Z --to 2026-11-08T00:00:00Z \
  --workflow .github/workflows/ci.yml --workflow .github/workflows/nightly.yml
compute actions schedule --event push --status failed --limit 50 --json
```

Reads `GET /api/v1/actions/schedule`. `--from` is inclusive and `--to` exclusive;
the maximum window is 45 days. If `--to` is omitted it is seven days after
`--from` (or now). `--tz` is an IANA zone, defaults to the local zone, and controls
display times and API day buckets. Invalid zones fall back to UTC on the API.

Human output lists upcoming fires with their workflow, repository and cron
description, then past runs with event and status. Upcoming previews contain at
most 100 fires per schedule; `+N more` reports the remainder in the window.
Incomplete counts produce a warning to choose a smaller window.

`--repo` takes `owner/repo`; `--workflow` takes file paths, not display names, and
is repeatable. `--event` and `--status` accept multiple values. Status filters
are conclusions (`passed`, `failed`, `running`, `cancelled`, `none`) and exclude
upcoming fires. `--limit` pages actual runs (default 100, maximum 500).
When another page exists, copy the printed `--cursor` command: it preserves the
resolved window, timezone and filters. Credentials are never printed; reuse the
same API-key environment or supply the same `--api-key` separately.

`--json` returns the complete API response, including `days`, `runs`, `upcoming`,
`nextCursor`, and truncation/count flags, without human headings or hints.

## Managed-agent persistence

`compute agents run <agent>` starts a conversation. On platforms with managed
Archil storage, the first run provisions the agent's disk automatically.
After its turn finishes, `compute agents stop <sessionId>` flushes storage and
releases compute. Resume that conversation, including Pi history and workspace:

```sh
compute agents run my-agent --resume <sessionId>
compute agents run my-agent "Continue the task" --resume <sessionId>
```

Resume preserves the session ID and event journal but acquires a new sandbox.
Only one session per agent can be active at a time. Legacy sessions without
persistent state cannot be recovered retroactively. Requires the platform's
managed-volume/resume API; no account storage credentials are needed in the CLI.

## Migrating from @computesdk/cli 1.x

v2 removes the legacy console authentication and its commands:

- **Removed commands**: `compute create`, `compute sandbox`, `compute connect`,
  `compute workspace`, `compute run`, and the interactive REPL. Sandbox
  management moved to `compute sandboxes`, which drives the platform's
  `/api/v1/sandboxes` API.
- **Auth**: `compute login` no longer opens a browser flow against
  console.computesdk.com or writes `~/.computesdk/credentials.json` — that
  credential store is gone. `compute login` now runs the platform's OAuth
  device flow and writes `~/.benchsdk/credentials.json` (the same store `bench
  auth login` uses). Run `compute login` once after upgrading.
- `compute providers` is unchanged.
