# daemond

Minimal seed launcher for repeatable command execution in a sandbox.

`daemond` exports three APIs:

- `daemonSeedScript(...)`
- `daemonSeedScriptCommand(...)`
- `parseSeedInvocationOutput(...)`

It returns a self-contained `node -e` launcher script that:

- boots or reuses a small local daemon (Unix socket)
- keeps a stable token per workspace daemon
- runs one command request
- returns a JSON envelope with `stdout`, `stderr`, `combined`, and daemon metadata
- exposes event streaming over socket (`subscribe`) and SSE

## Install

```bash
npm install daemond
```

## API

```ts
import { daemonSeedScript, daemonSeedScriptCommand } from "daemond";
```

- `daemonSeedScript({ name?, socket?, ssePort?, sseStrictPort? })`
  - `name` defaults to `daemond-seed`
  - `socket` defaults to `/tmp/.computesdk/seed-sockets/<hash>.sock`
  - `ssePort` defaults to `38989`
  - `sseStrictPort` defaults to `false`; when `true`, daemon fails instead of falling back if the SSE port is busy
- `daemonSeedScriptCommand(config, payload, options?)`
  - builds a shell-safe `node -e ...` command string
  - `payload` can be a plain command string (for example `"pwd"`), a JSON command object, or a job control object (`{ wait }`, `{ status }`, `{ kill }`)
  - `options.argvEncoding: "base64"` emits a command line made only of fixed tokens and base64 words (`printf %s <b64> | base64 -d | sh -s <b64> <b64>`). Use it for exec layers that re-split or collapse quotes; the default `"quoted"` mode is a single `sh -c '...'`
- `parseSeedInvocationOutput(stdout)`
  - parses seed launcher stdout into the typed invocation result
  - reads the last non-empty stdout line as JSON

## Basic usage

```ts
import { daemonSeedScript } from "daemond";

const script = daemonSeedScript({ name: "seed-control" });

// Host/sandbox side example:
// node -e "<script>" "pwd"
// node -e "<script>" '{"command":"node","args":["-v"]}'

import { daemonSeedScriptCommand, parseSeedInvocationOutput } from "daemond";

const cmd = daemonSeedScriptCommand(
  { name: "seed-control" },
  { command: "node", args: ["-v"] },
);
// pass `cmd` directly to sandbox.runCommand(cmd)

// Detached jobs: `exec` returns as soon as the process starts, so the
// sandbox's exec slot is free while the job runs. Wait for it later.
const started = parseSeedInvocationOutput(
  await run(daemonSeedScriptCommand(cfg, { command: "sh", args: ["-c", "make test"], detach: true })),
);
// started.command => { status: "running", exitCode: null, jobId: "...", pid: 123 }
const done = parseSeedInvocationOutput(
  await run(daemonSeedScriptCommand(cfg, { wait: started.command.jobId!, timeoutMs: 60_000 })),
);
// done.command => { status: "exited", exitCode: 2, signal: null, stdout, stderr, combined }
// If `timeoutMs` elapses first, the result is a `running` snapshot with the output so far.

const rawStdout = '{"token":"...","requestId":"...","daemon":{"reused":true,"pid":1234,"sseUrl":"..."},"command":{"exitCode":0,"stdout":"v22.0.0\\n","stderr":"","combined":"v22.0.0\\n"}}\n';
const parsed = parseSeedInvocationOutput(rawStdout);
```

Example output (single JSON line on stdout):

```json
{
  "token": "...",
  "requestId": "req-...",
  "daemon": {
    "reused": true,
    "pid": 1234,
    "sseUrl": "http://127.0.0.1:33937/events?token=..."
  },
  "command": {
    "exitCode": 0,
    "signal": null,
    "stdout": "...",
    "stderr": "",
    "combined": "..."
  }
}
```

## Socket protocol

The daemon speaks newline-delimited JSON over its Unix socket.

Supported message types:

- `health` (optional `token`; validated when provided)
- `exec` (requires `token`; `detach: true` returns `{ status: "running", exitCode: null, jobId }` once the process has started)
- `wait` (requires `token`; `{ wait: jobId, timeoutMs? }` blocks until the job exits or the timeout elapses)
- `status` (requires `token`; `{ status: jobId }` returns the current snapshot without blocking)
- `kill` (requires `token`; `{ kill: jobId, signal? }` signals the job's whole process group)
- `subscribe` / `unsubscribe` (requires `token`)
- `stop` (requires `token`)

Command results carry `status: "running" | "exited"`. `exitCode` is `null` while running and when the process was terminated by a signal (see `signal`); it is never invented. Finished jobs are retained for 10 minutes so late `wait`/`status` calls still resolve; unknown job ids are an error.

SSE stream endpoint:

- `GET /events?token=<token>`

Emitted events include:

- `command.started`
- `command.stdout`
- `command.stderr`
- `command.exit`

## Development

```bash
pnpm run build
pnpm run typecheck
pnpm run test:integration
pnpm run test:integration:docker
```

### Docker validation

`test:integration:docker` validates the seed launcher flow inside a containerized sandbox powered by
`@computesdk/docker`.

- runtime: `node`
- image: `node:22-bookworm`
- assertion focus: stable daemon token reuse and successful repeated command execution

## Scope

- Linux and macOS only (Unix socket)
- Local process model
- Runtime state under `/tmp/.computesdk`
