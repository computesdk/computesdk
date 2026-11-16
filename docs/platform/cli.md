---
description: >-
  Install and use the `compute` CLI (@computesdk/cli) to drive the ComputeSDK
  Platform — Actions dispatch, run logs, artifacts, provider credentials,
  secrets and variables, connected repos, sandboxes, and the bench toolchain.
---

# CLI reference

## Install

```bash
pnpm dlx @computesdk/cli <cmd>   # zero-install, always latest
npm i -g @computesdk/cli         # or install once
```

The binary is `compute`. Pass `--json` on almost any platform command for machine-readable output. With `--json`, failures are written to stderr as a single JSON envelope and the process exits 1:

```json
{ "ok": false, "error": { "code": "forbidden", "message": "Owner or admin access required", "httpStatus": 403, "retryable": false } }
```

`code` is one of `bad_request`, `unauthenticated`, `forbidden`, `not_found`, `conflict`, `payload_too_large`, `rate_limited`, `server_error`, `http_error` (API responses — `httpStatus` is set), or `no_credentials`, `untrusted_host`, `untrusted_host_stored_auth`, `insecure_transport`, `invalid_argument`, `workflow_not_found`, `network`, `unknown` (raised locally — no `httpStatus`). `retryable` is `true` for 429/502/503/504 and network failures. `details` is present only when the API returned a `details` object.

## Version and availability

The sandbox onboarding and sync additions described here are an unreleased
source preview from [PR #1145](https://github.com/computesdk/computesdk/pull/1145).
They are not included in `@computesdk/cli` 2.6.13. This includes the root sandbox
command shortcuts, provider-first project creation, directory sync, automatic
sign-in during creation, resumable/JSON login, status diagnostics, and the new
execution options and run summaries. Installing the latest published package
does not yet provide these additions; no release version is confirmed here.
For 2.6.13, use the existing `compute instances` command paths and their `--help`.

Project sync also requires a platform deployment with managed sync snapshot
support. Hosted availability and retention configuration have not been verified;
source examples below do not establish deployment availability.

## Your first sandbox

```bash
compute new                 # browser sign-in if needed, then create a sandbox
compute exec echo hello     # run a command on the current sandbox
compute list
compute destroy             # destroy it and stop billing
```

Or use `compute run echo hello` to create a sandbox, execute a command and clean
up automatically. A normal `compute new` keeps the sandbox running until its
timeout or destruction. `compute -v` (or `compute --version`) prints the CLI version.

The current sandbox is saved per repository/directory and organization. An
explicit ID wins over `COMPUTE_INSTANCE`, which wins over the saved selection.
Use `compute use <id>` to select an existing sandbox. `compute new --no-use`
creates without changing the selection.

## Authentication

Auth resolves in this order: `--api-key` flag → `COMPUTE_API_KEY` env var → `BENCHMARKS_PLATFORM_API_KEY` (legacy) → stored platform OAuth credentials (`~/.benchsdk/credentials.json`, written by `compute login` or `compute bench auth login`; an expired access token is refreshed silently). Actions commands never start the login flow themselves; with no key anywhere they fail with `no_credentials`.

`compute login` runs the platform's OAuth device flow (the same one `bench auth login` uses) and writes to `~/.benchsdk/credentials.json`; `compute logout` clears it. `compute --login` / `compute --logout` are shortcuts for the same thing. It opens the verification URL in your browser and prints a URL and code as a
fallback. Use `compute login --no-browser` for manual sign-in. Press Ctrl-C to
cancel; expiry or denial explains how to retry.

Interactive `compute new`, `compute instances create`, and `compute run` start
this flow when the credential store is empty and no key was supplied, then
continue the original command after approval. `--no-browser` works on these
commands too. No browser is opened in CI, without a terminal, or with
`--json`/`--quiet`: missing credentials produce the existing `no_credentials`
error. Failed refreshes, existing sessions and explicit keys are never silently
replaced. Provisioning requests are not replayed after API failures.

After login the CLI prints the active org; `compute whoami` (or `compute org current`) shows it again via `GET /api/v1/me`.

### Organizations

```bash
compute org list          # your organizations (* = active)
compute org use <slug>    # switch the stored login's active org
compute org current       # current user + active org
```

The active org is stored per user and client on the platform, so `compute org use` applies to every machine sharing the login. A one-off override is `--org <slug>` (root flag, or on any `sandboxes` / `actions` / `market` subcommand) or the `COMPUTE_ORG` env var — it sends `X-Org-Slug` on the request, which the platform accepts for CLI logins (membership is checked) and ignores for org API keys. Precedence: `--org` > `COMPUTE_ORG` > the stored login's org.

The bearer key is only sent to `computesdk.com` and loopback hosts unless you pass `--allow-untrusted-host`, and only over HTTPS — plain `http://` is accepted for `localhost`/`127.0.0.1`/`::1` only. `--allow-untrusted-host` does not relax the HTTPS requirement, and it only applies to an explicit `--api-key` / `COMPUTE_API_KEY` / `BENCHMARKS_PLATFORM_API_KEY` credential: stored `compute bench auth login` credentials are never resolved or refreshed for a non-`computesdk.com`, non-loopback host (`untrusted_host_stored_auth`).

```bash
export COMPUTE_API_KEY="csdk_..."
compute actions runs myorg/myrepo
```

`--base-url` (or `COMPUTE_PLATFORM_URL` / `BENCHMARKS_PLATFORM_URL`) selects a different platform deployment. Default: `https://platform.computesdk.com`.

## `compute actions` — drive CI on the platform

```bash
# See what you can run
compute actions repos                          # org's connected repos
compute actions repos connect <clone-url>      # connect a generic git remote
compute actions repos enable <owner>/<repo>    # enable / disable scheduling
compute actions repos disable <owner>/<repo>

# Where Actions can place (order, act capability, key status)
compute actions providers                      # provider keys themselves: `compute byok` below

# Secrets and variables (owner/admin key required)
compute actions vault ls [--repo <owner>/<repo>] [--kind secret|variable]
compute actions vault set <name> [--repo] [--kind] [--revealable] [--description] [--labels a,b] [--from-file <path>]
compute actions vault get <name> [--repo] [--kind]
compute actions vault rm <name> [--repo] [--kind]

# Dispatch and follow runs
compute actions dispatch <repo> --workflow <path|name> [--ref] [--inputs k=v ...]
compute actions dispatch <repo> --workflow <path|name> --manual   # run even without workflow_dispatch (then no inputs)
compute actions runs <repo> [--status ...] [--branch ...]
compute actions history <repo> --workflow <path|name> [--branch] [--job] [--limit n]
compute actions run <run-id>                   # jobs, provider:region placement
compute actions summary <run-id>               # failure digest, redacted log tails
compute actions inspect <run-id>               # resolved image, caches, secrets, concurrency
compute actions logs <run-id> [--job] [--step <n|runner>] [--follow]
compute actions cancel <run-id>
compute actions rerun <run-id>
compute actions artifacts <run-id> [--job] [--out <dir>]
```

Notes:

* `--workflow` matches the full file path, the display name, or the workflow id — not the basename.
* `logs --follow` is resumable: it tracks byte offsets, so a reconnect picks up where it left off.
* `history` is how you tell a new failure from a flaky one — it reports per-job and per-step failure rates over a window of recent runs.
* `vault set` reads the value from stdin (or `--from-file`) and stores it exactly as read — no trimming, so `printf '%s' "$VALUE" | compute actions vault set NAME` avoids a trailing newline. Values are never accepted as arguments.
* `vault ls` prints names and metadata, never values. `vault get` prints a variable, or a secret created with `--revealable`; any other secret is `forbidden` — replace it instead of reading it. `--revealable` and `--labels` are fixed when the item is created.
* `vault set` and `vault get` only talk to `computesdk.com` and loopback hosts, even with `--allow-untrusted-host`.
* Run dashboard URLs look like `https://platform.computesdk.com/<org>/actions/runs/<runId>`.

## `compute bench` — the benchmarks toolchain

`compute bench` folds the full `@benchsdk/runner` bench binary under `compute`:

```bash
compute bench auth          # browser login / credential management
compute bench org           # organization info
compute bench benchmarks    # list benchmarks
compute bench runs          # list runs
compute bench runs run-again <benchmark-slug> <runId> [--wait] [--timeout <seconds>]
compute bench runs run-again-status <benchmark-slug> <runAgainId>
compute bench results       # query results
compute bench iterations    # per-iteration data
compute bench artifacts     # download run artifacts
compute bench logs          # run logs
compute bench export        # export results
compute bench run           # execute a benchmark run
compute bench check         # validate a benchmark definition
compute bench fork          # private tracked fork of a catalog benchmark
```

`compute bench runs list` and `compute bench results` narrow results with the same filters the REST routes accept:

* `--participant <slug[,slug]>` — only runs those participants were in, and only their rows
* `--steps <name[,name]|all>` — per-step overviews (`results` only)
* `--since` / `--until <YYYY-MM-DD | ISO | 24h | 7d | 2w>` — bounds on run creation time
* `--day <YYYY-MM-DD>` — one calendar day (sugar for `--since`/`--until`; can't be combined with them)
* `--tz <IANA>` — timezone for date-only bounds, defaults to the machine's zone
* `--source-org <slug>` — read another org's benchmark you can see (`~/` paths) when a bare slug is ambiguous

```bash
compute bench results dax --participant e2b --steps all --since 7d
compute bench runs list dax --participant e2b --day 2026-10-22
compute bench logs dax <runId> --participant e2b --max-lines 500
```

`--json` prints the raw API response, including the `filter` echo showing what the server applied.

## Sandboxes

Everyday commands live directly under `compute`: `list`, `get`, `use`, `exec`,
`run`, `serve`, `spawn`, `ps`, `logs`, `kill`, `wait`, `cp`, `url`, and `destroy`. The existing
`compute instances`, `compute sandboxes`, and `compute sbx` paths remain
compatible. Settings, billing and snapshots remain in those groups.

```bash
compute new                                    # place and select a sandbox
compute list                                   # list sandboxes
compute exec <id> uname -a                      # run a one-shot command
compute spawn <id> --cwd /app -e NODE_ENV=production npm run dev
compute ps <id>                                # detached processes
compute url <id> --port 3000                    # public URL for an exposed port
```

For `exec` and `spawn`, everything after the command's first word goes to the
sandbox untouched — flags like `uname -a` or `node -e` are not CLI options.
Pass CLI options (`--json`, `--timeout`/`--timeout-ms`, `--stream`, `--detach`, `--cwd`, `-e/--env`, `--stdin`,
`--org`) before the command; a bare `--` before the command is optional but
supported.

### Executing commands

```bash
compute exec "npm test"                            # one argument: shell command
compute exec node -v                               # multiple arguments: preserve argv
compute exec "echo hello && echo world"            # shell operators run remotely
compute exec --cwd /app --timeout 120 npm test
compute exec --stream "npm run build"              # follow output while it runs
compute exec --timeout 0 "long-running-command"    # no command time limit
compute exec --detach "npm run dev"                # return a background job ID
compute logs <sandbox-id> <job-id> --follow          # follow a detached job
```

Omit the sandbox ID to use the current selection, or place an explicit ID after
`exec`. A single command argument is interpreted by the remote shell; two or
more arguments are individually quoted, preserving spaces, quotes and shell
metacharacters literally. Use `bash -lc '...'` when you want an explicit shell.
The same command interpretation applies to `spawn`, which remains available.

`--timeout` accepts seconds; `--timeout-ms` remains compatible. Use one spelling
per invocation. Without either flag, the existing platform command timeout
applies. A zero timeout removes the command time limit; the sandbox's own
lifetime still applies. Limits longer than the buffered endpoint's 290-second
maximum automatically use the process path and follow output, as does zero.

`--stream` follows a tracked process and prints new stdout/stderr incrementally.
The remote exit code becomes the CLI exit code. A streamed command that exceeds
its time limit is killed and exits 124; Ctrl-C signals the process and exits 130.
With `--json`, streamed output is JSON Lines with `stdout`, `stderr` and `exit`
events. Buffered execution keeps its existing single JSON result.

`--detach` returns immediately with a job ID (or process metadata with `--json`).
It cannot be combined with `--stream` or a command timeout: the CLI must remain
connected to enforce those limits. Existing `logs`, `ps`, and
`compute kill <sandbox-id> <job-id>` and `compute wait <sandbox-id> <job-id>` manage the background job. If
following output fails, the CLI reports the job ID for recovery without
starting the command again.

## Project creation and sync

```bash
compute new e2b .                         # provider first, local project last
compute new daytona ./my-app
compute new .                             # use your router
compute exec --cwd /app npm test
compute sync . :/app                      # update the selected sandbox
compute sync :/app ./results              # download directory contents
compute sync <sandbox-a>:/app <sandbox-b>:/app
compute sync . :/app --dry-run
compute sync . :/app --delete
compute sync . :/app --watch
```

`new` accepts an optional final local directory using explicit path syntax
(`.`, `./project`, `../project`, or an absolute path); bare operands remain
provider names. It validates the source before provisioning, syncs contents to
`/app`, then selects the sandbox. `--no-use` preserves the existing selection.
If initial sync fails, teardown is attempted and the old selection is retained;
a cleanup failure includes the sandbox ID for manual teardown.

`sync <source> <destination>` operates on directory contents, in one direction.
An endpoint is local, `<sandbox-uuid>:/absolute/path`, or `:/absolute/path` for
the selected sandbox. At least one endpoint must be remote. Both sandboxes
use the invocation's credentials, organization, and platform URL.

Content hashes and permissions identify changed files. Local uploads honor
nested `.gitignore` files and repository ancestor rules. `.git` is excluded;
`--delete` removes destination-only entries while preserving ignored paths.
Binary files, executable permissions, and project-contained relative symlinks
are preserved. Filesystem roots, overlapping endpoints on the same sandbox,
symlink traversal, and file/directory type conflicts are refused. Source hardlinks are copied as separate files; overwriting hard-linked destination files is refused.

`--dry-run` returns a plan without changing destination files. `--watch` polls
every two seconds, serializes passes, and finishes the active pass before
stopping on Ctrl-C; `--dry-run --watch` is invalid. `--json` returns `dryRun`,
`copied`, and `deleted` (relative path arrays); watch mode emits JSON Lines for
passes with changes. Errors use the standard stderr JSON envelope.

Sync uses the platform OCI checkpoint engine for scan, diff, capture, and
integrity-checked restore. Node.js is required in each sandbox. The existing
transfer API carries only selected OCI layers through the CLI, including sandbox
relays; a changed file can require its whole top-level directory layer. Only
planned entries are restored. Deletions occur after a successful restore. Transfers
are not atomic across the entire directory; avoid concurrent destination edits.
The sandbox working directory is unchanged: use `exec --cwd /app` for the synced
project. Watch mode is one-way; it does not merge conflicting edits.

When the platform supports managed sync snapshots, each pass that copies files
must retain its full filtered source capture before destination writes begin.
Retention failure stops the pass. `sync --json` includes `snapshot: {id, expiresAt}`;
project creation includes `syncSnapshot`. Human output shows the same ID and
expiry supplied by the platform. Dry runs, unchanged passes, and delete-only
passes create no captures. A failed destination copy does not delete the retained
capture. Literal `*` and `?` characters in endpoint paths are unsupported.

## Status, resumable login, and run summaries

`compute status` shows verified authentication, the effective organization,
credit balance and holds, the selected sandbox, and default routing readiness.
It performs read-only checks, accepts `--org`, `--api-key`, `--base-url`, and
`--json`, and preserves partial results if an endpoint fails. `--check` exits 1
unless authentication is verified and the default sandbox route is ready; no
selected sandbox is required. The routing quote creates nothing.

Normal `compute login` opens the browser and waits. Pending sign-ins are stored
privately per platform URL and reused after interruptions until approval, denial,
or expiry. `--new` replaces a pending code; logout clears local pending attempts.
For agents, `compute login --json` immediately returns `verificationUrl`, `code`,
and ISO `expiresAt`, with no private device code or credentials. A subsequent
`compute login --wait --json` waits for approval, saves the shared credentials,
and returns `{ "signedIn": true, "organization": "<slug>" }`. JSON login does not
open a browser. Without `--json`, login retains its normal human-readable flow.

`compute run` prints a final summary on stderr: exit code, elapsed seconds,
provider, and whether teardown was confirmed or the sandbox was kept. Cost is
included only when the teardown response contains a settled amount. With
`--json`, command output is stdout/stderr JSON Lines followed by a `summary`
record with `sandboxId`, `jobId`, `exitCode`, `elapsedSeconds`, `provider`,
`deleted`, `kept`, and optional `costUsd`. An unknown command exit code is null;
cleanup failure makes a successful CLI invocation fail. `run --detach --json`
returns `{ "type": "detached", "sandboxId": "...", "jobId": "..." }` immediately.

## `compute byok` — the org's BYOK provider keys and custom rates

Keys and custom rates serve every product that places sandboxes (Actions jobs
and sandbox creates). Reads are open to members; writes need an owner/admin.

```bash
compute byok                                   # every BYOK provider: key state, rate
compute byok show <provider>                   # key state, platform rate, custom rate
compute byok configure <provider> --key <key> [--verify]   # save the org's credential
compute byok configure <provider> --field name=value ...   # multi-field credentials
compute byok verify <provider>                 # probe it with a real sandbox
compute byok remove <provider> [-y]
compute byok rate set <provider> <usd> [--per second|minute|hour]
compute byok rate clear <provider>
```

A custom rate is for the org's own cost reporting (typically what it pays the
provider): sandbox costs on that provider are reported at it instead of the
platform rate. It never changes what the org is billed.
`compute actions providers configure|verify|remove` still work but are
deprecated in favour of these.

## `compute providers`

```bash
compute providers    # SDK provider credentials in this environment (local env vars)
```
