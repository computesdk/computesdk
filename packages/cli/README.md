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
compute actions …               # Actions API — repos, dispatch, runs, logs, vault
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

### Live Pi controls and automatic sleep

On platforms with persistent Pi RPC, interrupting a turn keeps the sandbox
and conversation alive; steering changes the next step without aborting the
current tool:

```sh
compute agents interrupt <sessionId>
compute agents steer <sessionId> "Use the test database instead"
```

`compute agents stop` still ends the session and releases compute; interrupt
active work first. Legacy live sessions must be ended/resumed to enable these
controls. OpenCode does not support Pi controls.

Durable Pi sessions automatically sleep after the platform's idle timeout
(60 seconds by default, checked every minute). `compute agents send <sessionId> "Continue"` wakes
a `suspended` session on replacement compute, preserving its ID, Pi history
and workspace. Sleep preserves files, not running processes or memory.
Explicitly stopped sessions require `run --resume`. One live session per agent
remains the limit, including automatically resumed sessions.

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
