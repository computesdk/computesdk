---
name: sandboxes
description: Run real code in ComputeSDK cloud sandboxes from ChatGPT — create environments, write and read files, execute commands, run long-lived processes, preview exposed ports, and clean up. Use when the user wants to execute, test, or host code, or asks about their running sandboxes.
---

# ComputeSDK sandboxes

ComputeSDK places cloud sandboxes through the ComputeSDK gateway. All usage bills the ComputeSDK org selected when the connection was authorized — no provider setup is needed or possible in-chat.

## Core workflow

1. `create_sandbox` — returns a sandbox `id`. Args: `label`, `image`, `timeoutMs` (lifetime in ms; default 30 minutes, max 6 hours), and `providerOrder` (camelCase routing preference, e.g. `["market"]` for a live-bid market fill).
2. Do the work: `write_file`, `read_file`, `make_directory`, `remove_path`; `run_command` or `start_process`; `sandbox_url` for anything that listens on a port. File tools take absolute paths; `read_file` on a directory lists its entries.
3. `destroy_sandbox` when the task is finished — sandboxes bill for runtime, so always clean up unless the user wants it kept alive.

`get_sandbox` fetches one sandbox's details; `list_sandboxes` lists the visible ones. `get_profile` returns the connection's identity (an opaque `id`) — use it when the user asks which account this is, not for org or billing details.

## Choosing the execution tool

- `run_command` — one-shot commands under about 290 seconds. Returns buffered stdout/stderr/exit code.
- `start_process` — anything that outlives that: servers, watchers, builds, training. Returns `jobId`; follow up with `wait_process`, `process_status` (buffered output), `kill_process`, or `list_processes` to see all jobs on a sandbox. For interactive programs (REPLs, CLIs), spawn with `stdin: true`, then use `write_process_stdin` to send input; pass `close: true` to signal EOF.

## Workflow details

- Scope: users see every sandbox they created through this plugin in that org — including ones from earlier sessions or other ChatGPT connections. Sandboxes belonging to other org members, the warm pool, or CI are never visible; "sandbox not found" on someone else's id is expected.
- `sandbox_url` fails when the provider the sandbox was placed on has no ingress — say so, and offer to recreate pinned to a provider that supports preview URLs.
- Argument names: sandbox tools take `id`; process tools take `jobId`.
- Never print, echo, or write secrets — not in commands, files, env values, or tool output.
