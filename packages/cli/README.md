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
compute actions …               # Actions API — repos, workflows, dispatch, runs, schedule, logs, vault (see below)
compute market …                # buy and sell on the compute market (cap, bids, credits, listings)
compute sandboxes …             # platform sandbox control plane
compute bench …                 # benchmarks CLI (run, auth, org, results, …)
compute providers               # sandbox provider credential status
compute org list                # your organizations (* = active)
compute org use <slug>          # switch the stored login's active org
compute org current / whoami    # current user + active org (an API key: its org)
```

All platform commands accept `--api-key` / `COMPUTE_API_KEY` and fall back to
the stored OAuth credentials. `COMPUTE_PLATFORM_URL` sets the platform URL.

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

## compute actions runs

`compute actions runs` lists the newest 100 runs across every repo, or one
repo with `compute actions runs <owner/repo>`. Archived and reliability runs
are hidden unless asked for. The filters map onto the
`/api/v1/actions/runs` query and work on every view below:

| Flag | Query |
|---|---|
| `--status <s...>` | `status` (passed, failed, running, cancelled, none) |
| `--branch <b...>` | `branch` |
| `--event <e...>` | `event` (push, pull_request, schedule, workflow_dispatch) |
| `--workflow <path\|name...>` | `workflow`; names and file names (`ci.yml`) resolve to paths through the workflow catalog |
| `--search <text>` | `q` (title, ref, SHA prefix, workflow, `#run` or `#PR` number) |
| `--archived` | `archived=only` |
| `--reliability` | `reliability=1` |

```bash
compute actions runs --event pull_request --archived --json
compute actions runs days --status failed                 # 2026-09-21  3 runs, newest day first
compute actions runs --day 2026-09-21 --time-zone UTC     # one page; prints the --cursor for the next
compute actions runs --day 2026-09-21 --all --json        # every page: {runs, nextCursor: null}
compute actions runs archive <run-id> <run-id> -y         # owner/admin; all or nothing
compute actions runs unarchive <run-id> -y
```

`--json` prints the run array, `{runs, nextCursor}` with `--day`, `{days}`
for `runs days`, and `{archived, archivedAt}` for archive and unarchive.
Archive and unarchive ask for confirmation on a terminal; elsewhere they need
`-y` and exit 1 without it. When an id is unknown or another org's, nothing
changes and the command prints the ids it could not find and exits 1.

## compute actions workflows

`compute actions workflows` lists the workflows that can run now, across every
repo or one (`compute actions workflows <owner/repo>`), with each one's
controls and latest run:

```
● enabled  acme/widgets  .github/workflows/ci.yml (CI)  order: inherits  snapshots: dynamic  last: passed 3h ago
○ disabled (user)  acme/widgets  .github/workflows/nightly.yml (Nightly)  order: vercel  snapshots: 3  last: never
○ repo disabled  acme/legacy  .github/workflows/build.yml (Build)  order: inherits  snapshots: dynamic  last: never
```

`--all` adds the workflows that cannot run now (user-disabled, or on a
disabled repo). `--ref <ref>` (with a repo) also lists the workflow files only
that branch or tag has, with their inputs (`target* (required)`,
`suite default=dax`); `compute actions dispatch <repo> --workflow <path> --ref <ref>`
dispatches one of those by path when the catalog has no match.

```bash
compute actions workflows acme/widgets --all --json                    # {workflows}
compute actions workflows local/fixture --ref feature-ref --json       # {workflows, refOnly}
compute actions workflows disable acme/widgets ci.yml -y               # owner/admin
compute actions workflows enable acme/widgets "Nightly" -y
compute actions workflows set acme/widgets ci.yml --order market,vercel --snapshot-cap 3 -y
compute actions workflows set acme/widgets ci.yml --inherit-order --dynamic-snapshots -y
```

`<workflow>` is a path, name, file name or id, matched against every
workflow of the repo (disabled ones included). `--inherit-order` makes the
workflow follow the org order and `--dynamic-snapshots` puts it back on the
dynamic snapshot pool; `--snapshot-cap 0` turns snapshots off. `--json` prints
the `PATCH /api/v1/actions/workflows` result (`repoFullName, path, enabled,
userDisabledAt, providerOrder, snapshotCap`). Enable, disable and set ask for
confirmation on a terminal; elsewhere they need `-y` and exit 1 without it.

## Actions schedule

```bash
compute actions schedule                         # now through seven days later, local timezone
compute actions schedule --repo acme/widgets --tz America/Chicago
compute actions schedule --reliability            # only reliability runs and scheduled fires
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
Reliability activity is hidden by default. `--reliability` shows only reliability
runs and workflows, matching the dashboard toggle; pagination hints retain it.
Incomplete counts produce a warning to choose a smaller window.

`--repo` takes `owner/repo`; `--workflow` takes file paths, not display names, and
is repeatable. `--event` and `--status` accept multiple values. Status filters
are conclusions (`passed`, `failed`, `running`, `cancelled`, `none`) and exclude
upcoming fires. `--limit` pages actual runs (default 100, maximum 500).
When another page exists, copy the printed `--cursor` command: it preserves the
resolved window, timezone and filters, including a leading `compute --org <slug>`
override (a command-local `--org` takes precedence). Credentials are never printed; reuse the
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

## compute bench

`compute bench …` runs the benchmarks CLI (`bench`) in-process: the same
commands, flags and output as `bench …`. This release bundles
`@benchsdk/runner` 0.8.3 with `@benchsdk/cli` 0.9.3 (`compute bench --version`
prints the bench CLI version), which adds `bench fork`, `bench runs run-again`
and the result filters `--participant`, `--since`, `--until`, `--day`, `--tz`
and `--source-org`.

compute's settings are forwarded to bench:

| compute | bench | |
|---|---|---|
| `COMPUTE_PLATFORM_URL` | `BENCHMARKS_PLATFORM_URL` | only when `BENCHMARKS_PLATFORM_URL` is unset |
| `COMPUTE_API_KEY` | `BENCHMARKS_PLATFORM_API_KEY` | only when `BENCHMARKS_PLATFORM_API_KEY` is unset |
| `compute --org <slug> bench …`, else `COMPUTE_ORG` | `--org <slug>` | only when the bench command has no `--org` of its own; not added to `run` / `check` |

```bash
COMPUTE_API_KEY=bp_… compute bench runs list my-benchmark --json
COMPUTE_ORG=acme compute bench auth status --json      # same as: compute bench --org acme auth status
```

`compute whoami` and `compute org current` also read `COMPUTE_API_KEY`. An
org API key has no user, so they print the key's organization and
`API key (no user identity)` (with `--json`: `"user": null`,
`"credential": "api_key"`).

## Command manifest

`cli-manifest.json` (shipped in the package) lists every `compute` command:
its canonical path, alias spellings, arguments and flags, plus the global
flags and the `@benchsdk/runner` / `@benchsdk/cli` versions behind
`compute bench …`. The bench commands themselves are described by the bench
manifest in `@benchsdk/runner`. The benchmarks platform vendors both files
to check that the commands its API surface map names exist.

The hidden `compute __manifest` command prints the manifest (`--released`
marks it as describing a published version; `--check <file>` exits 1 when
`<file>` is out of date, ignoring a vendored `source.ref`). After adding,
renaming or removing commands or flags, regenerate the committed file:

```bash
pnpm --filter @computesdk/cli run manifest   # builds, then writes cli-manifest.json
```

`src/__tests__/manifest.test.ts` fails when the committed file differs from
the built CLI's output.

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
