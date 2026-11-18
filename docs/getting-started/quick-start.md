# CLI quickstart

[Install the CLI](installation.md#cli), then create a sandbox and run a command:

```bash
compute new
compute exec echo hello
```

The CLI guides setup and selects the new sandbox for this directory and
organization. `exec` uses that selection, so you do not need to copy an ID.
ComputeSDK handles provider setup and routing.

## Destroy the sandbox

```bash
compute destroy
```

A sandbox keeps running and billing until destroyed or its lifetime expires.
Closing your terminal does not stop it. Use `compute list` to check for running
sandboxes and retry cleanup if needed.

For a single command with automatic cleanup:

```bash
compute run echo hello
```

`run` creates a sandbox, executes the command, then attempts teardown.
`--keep` and `--detach` leave compute running.

## Choose a provider

Already know where you want to run? Use a [provider starter](../providers/README.md):

```bash
npm create modal
```

Or, with the CLI installed:

```bash
compute new modal
```

Omit the provider to follow your organization's saved router. See
[routing](../guides/routing.md) for preferences and fallback.

## Next steps

- [Run commands and follow output](../guides/commands.md)
- [Work with files](../guides/files.md) or [sync a project](../cli/project-sync.md)
- [Preview an application](../guides/previews.md)
- [Reconnect and manage sandbox lifetime](../guides/lifecycle.md)
- [Use JSON output in scripts and agents](../cli/automation.md)
- [CLI command reference](../platform/cli.md)

If creation cannot be placed, inspect `compute sandboxes options` and
`compute sandboxes route`. See [billing](../guides/billing.md) for credits or
[authentication](authentication.md) for noninteractive access.
