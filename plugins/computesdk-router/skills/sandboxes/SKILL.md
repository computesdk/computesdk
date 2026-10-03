---
name: sandboxes
description: Run real code in ComputeSDK cloud sandboxes from ChatGPT — create environments, write and read files, execute commands, run long-lived processes, preview exposed ports, and clean up. Use when the user wants to execute, test, or host code, or asks about their running sandboxes.
---

# ComputeSDK sandboxes

ComputeSDK places cloud sandboxes through the ComputeSDK gateway. All usage bills the ComputeSDK org selected when the connection was authorized — no provider setup is needed or possible in-chat.

## Core workflow

1. `create_sandbox` — returns a sandbox id. Optional args let you pick an image, restore a snapshot, size resources, or pin routing (`provider_order`, e.g. `["market"]` for a live-bid market fill).
2. Do the work: `write_file`, `read_file`, `list_files`, `make_directory`, `remove_path`; `run_command` or `start_process`; `sandbox_url` for anything that listens on a port.
3. `destroy_sandbox` when the task is finished — sandboxes bill for runtime, so always clean up unless the user wants it kept alive.

`get_sandbox` fetches one sandbox's details; `list_sandboxes` lists the visible ones; `get_profile` shows which ComputeSDK org/account the connection is billing.

## Choosing the execution tool

- `run_command` — one-shot commands under about 290 seconds. Returns buffered stdout/stderr/exit code. All paths in commands and file tools must be absolute.
- `start_process` — anything that outlives that: servers, watchers, builds, training. Returns a `job_id`; follow up with `wait_process`, `process_status` (buffered output), `kill_process`, or `list_processes` to see all jobs on a sandbox. For interactive programs (REPLs, CLIs) use `write_process_stdin` to send input; pass `close: true` to signal EOF.

## Workflow details

- Scope: only sandboxes created through this connection are visible. "Sandbox not found" on another id is expected — the plugin cannot see or act on sandboxes from other org members, the warm pool, or CI.
- `sandbox_url` fails when the provider the sandbox was placed on has no ingress — say so, and offer to recreate pinned to a provider that supports preview URLs.
- Timeouts: sandboxes expire on their own after their timeout, but prefer explicit `destroy_sandbox` — billing follows runtime.
- Never print, echo, or write secrets — not in commands, files, env values, or tool output.
