# CLI compatibility and migration

## Current commands

New tutorials use the root sandbox shortcuts: `compute new`, `exec`, `list`, `use`, `run` and `destroy`. The `compute instances`, `compute sandboxes` and `compute sbx` groups remain available. Billing, routing, settings and snapshots live in those groups.

Use `compute --version` and command-specific `--help` when upgrading. The onboarding, root shortcuts, project sync and resumable login described in these docs ship in `@computesdk/cli` 2.6.14; sync also needs the platform's managed sync snapshot API. Installation alone does not establish availability on a custom deployment.

## From CLI 1.x

Version 2 uses platform OAuth device login and `~/.benchsdk/credentials.json`. The old console login and `~/.computesdk/credentials.json` do not apply. Run `compute login` after upgrading.

The legacy `create`, `sandbox`, `connect`, `workspace` commands and interactive REPL were removed. The old workspace-oriented `run` was removed; today's `compute run <command>` creates a sandbox, executes the command, and attempts teardown. Update old scripts rather than assuming that the reused name preserves the 1.x behavior.

`compute providers` reports local adapter credentials. `compute byok` manages keys stored for your organization on the platform. See [routing and BYOK](../guides/routing.md).

For SDK applications, `compute.instances` is the current lifecycle API; `compute.sandbox` remains a deprecated alias.
