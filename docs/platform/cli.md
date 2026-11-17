---
description: >-
  Install and use the `compute` CLI (@computesdk/cli) to drive the ComputeSDK
  Platform — Actions dispatch, run logs, artifacts, provider credentials,
  secrets and variables, connected repos, sandboxes, and the bench toolchain.
---

# CLI reference

## Install

Start with the [CLI quickstart](../getting-started/quick-start.md), [installation options](../getting-started/installation.md), [project sync guide](../cli/project-sync.md) or [automation guide](../cli/automation.md).


```bash
pnpm dlx @computesdk/cli <cmd>   # zero-install, always latest
npm i -g @computesdk/cli         # or install once
```

The binary is `compute`. Pass `--json` on almost any platform command for machine-readable output. With `--json`, failures are written to stderr as a single JSON envelope and the process exits 1:

```json
{ "ok": false, "error": { "code": "forbidden", "message": "Owner or admin access required", "httpStatus": 403, "retryable": false } }
```

`code` is one of `bad_request`, `unauthenticated`, `forbidden`, `not_found`, `conflict`, `payload_too_large`, `rate_limited`, `server_error`, `http_error` (API responses — `httpStatus` is set), or `no_credentials`, `untrusted_host`, `untrusted_host_stored_auth`, `insecure_transport`, `invalid_argument`, `workflow_not_found`, `network`, `unknown` (raised locally — no `httpStatus`). `retryable` is `true` for 429/502/503/504 and network failures. `details` is present only when the API returned a `details` object.

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

Authenticate with `compute login`, or set `COMPUTE_API_KEY` for scripts and CI.
An explicit `--api-key` takes precedence over the environment key, which takes
precedence over a saved login. Actions commands require an existing login or
API key; without either, they fail with `no_credentials`.

`compute login` opens your browser and prints a URL and code as a fallback.
Use `compute login --no-browser` for manual sign-in. Saved sessions refresh
automatically. `compute logout` clears the local session; `compute --login`
and `compute --logout` are shortcuts. Press Ctrl-C to cancel.

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

The bearer key is only sent to `computesdk.com` and loopback hosts unless you pass `--allow-untrusted-host`, and only over HTTPS — plain `http://` is accepted for `localhost`/`127.0.0.1`/`::1` only. `--allow-untrusted-host` does not relax the HTTPS requirement, and it only applies to an explicit `--api-key` / `COMPUTE_API_KEY` credential: saved login credentials are never resolved or refreshed for a non-`computesdk.com`, non-loopback host (`untrusted_host_stored_auth`).

```bash
export COMPUTE_API_KEY="csdk_..."
compute actions runs myorg/myrepo
```

`--base-url` (or `COMPUTE_PLATFORM_URL`) sets the ComputeSDK API URL. Default: `https://platform.computesdk.com`.

## `compute actions` — drive CI on the platform

```bash
# See what you can run
compute actions repos                          # org's connected repos
compute actions repos connect <clone-url>      # connect a generic git remote
compute actions repos enable <owner>/<repo>    # enable / disable scheduling
compute actions repos disable <owner>/<repo>

# Where Actions can place (order, workflow readiness, key status)
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

See [command execution](../cli/execution.md) for argv handling, timeouts, streaming and detached jobs.

## Project creation and sync

See [project sync](../cli/project-sync.md) for provider-first project creation, endpoint syntax, ignore rules, watch mode and retained captures.

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
