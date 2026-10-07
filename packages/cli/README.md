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
compute market …                # sell side of the compute market
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
