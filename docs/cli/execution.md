# Commands and development servers

`compute exec` runs on the selected sandbox; use `compute use <id>` to change the selection or pass an explicit ID. For a new sandbox that should be destroyed after a command finishes, use `compute run` instead.

## Executing commands

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


## Expose a server

After [syncing your project](project-sync.md) and installing its dependencies, start the server as a background process. It must listen on the exposed interface, typically `0.0.0.0`:

```bash
compute exec --detach --cwd /app "npm run dev -- --host 0.0.0.0"
compute ps
compute url --port 3000
```

Use your application's actual port and startup flags. Port exposure and URL access depend on the provider; inspect the returned URL before sharing it. Use `compute logs <sandbox-id> <job-id> --follow` to follow a background process.

`compute destroy` ends the sandbox and its processes. Stopping your local log follower does not release compute.
