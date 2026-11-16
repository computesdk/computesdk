# CLI quickstart

Create a sandbox, run a command, and destroy it from your terminal.

## 1. Install and sign in

[Install the CLI](installation.md#cli), then run:

```bash
compute login
compute whoami
```

Approve the sign-in in your browser. If it cannot open automatically, use the printed URL and code or run `compute login --no-browser`. Your resources belong to the organization shown after sign-in; use `compute org list` and `compute org use <slug>` to switch.

## 2. Check where work will run

```bash
compute status
compute sandboxes options
compute sandboxes route
```

The route shows the current placement and rate without creating a sandbox. Managed compute requires available ComputeSDK credit; BYOK requires a configured provider key. If no route is ready, set up [managed compute or BYOK](../guides/routing.md).

## 3. Create and run

```bash
compute new
compute exec echo hello
compute list
```

`new` creates and selects a sandbox for this directory/repository and organization. It can also start browser sign-in when you are in an interactive terminal. `exec` uses that selection, so you do not need to copy an ID for every command.

## 4. Destroy the sandbox

```bash
compute destroy
```

A sandbox keeps running and billing until it is destroyed or its lifetime expires. Closing your terminal does not destroy it. Check `compute list` and retry cleanup if destruction fails.

For a single command with automatic cleanup, use:

```bash
compute run echo hello
```

`run` creates a sandbox, waits for the command, then attempts teardown. `--keep` and `--detach` leave compute running.

## Next steps

- [Bring and sync a project](../cli/project-sync.md)
- [Execute commands and expose a server](../cli/execution.md)
- [Use JSON output in scripts and agents](../cli/automation.md)
- [Use the Platform SDK from code](sdk-quick-start.md)
- [CLI command reference](../platform/cli.md)
