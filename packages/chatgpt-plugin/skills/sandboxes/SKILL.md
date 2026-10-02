---
name: sandboxes
description: Run real code in ComputeSDK cloud sandboxes from ChatGPT — create environments, execute commands, manage files and long-running processes, preview exposed ports, and clean up when done.
---

# ComputeSDK sandboxes

Use these tools when the user wants to run, test, build, or inspect real code in a remote sandboxed environment.

## Default path (first-party)

The user's bearer token is their ComputeSDK API key — sandboxes run first-party and bill to their ComputeSDK account balance. No provider credentials are needed; do NOT ask for provider keys unless the user explicitly wants to use their own provider account (BYOK).

1. `create_sandbox` — returns `sandbox_id`. Optional first-party args: `label`, `image`, `snapshotId`, `provider_order` (e.g. `["namespace:us-east"]`, or `["market"]` for market fills), `resources {cpus, memoryMb, ephemeralDiskMb}`.
2. Do the work: `run_command`, `write_file`/`read_file`/`list_files`/`delete_path`, `get_sandbox_url`.
3. `destroy_sandbox` when the task is finished — sandboxes bill for runtime, so always clean up unless the user wants it kept alive.

## Choosing the execution tool

- `run_command` — one-shot commands under ~290s and 64KB. Returns buffered stdout/stderr/exit_code.
- `start_process` — anything that outlives the cap: servers, watchers, builds, training. Returns `job_id`; follow up with `wait_process`, `process_status` (buffered output), `kill_process`. `list_processes` shows all jobs on a sandbox. Spawn with `stdin: true` to keep a writable stdin pipe for `write_stdin`/`close_stdin` (interactive REPLs, CLIs).

## Workflow details

- Scope: first-party tools only see and act on `chatgpt-plugin-*` sandboxes the plugin created — the org's pool and CI sandboxes are never listed, and commands/destroys on them are refused.
- `get_routing_settings` shows the org's provider order and market spend cap — use it when the user asks "where will my sandbox run".
- `get_sandbox_url` can fail with 501 when the placed provider has no ingress; tell the user and offer to recreate with a `provider_order` whose provider supports URLs.
- Placement failures (502) return per-provider `attempts` in the error — relay them and suggest fixing provider connections or trying `provider_order: ["market"]`.
- Timeouts: sandbox max 6h (default 30m); command max ~290s; file content max 32MB.
- Do not embed secrets or credentials in commands, files, or env values.

## BYOK path (technical users)

Only when the user wants their own provider account: `set_provider_credentials` for tensorlake, blaxel, archil, or namespace (see `list_providers` for required fields), then pass `provider: "<name>"` to sandbox tools. Process tools and gateway-only create args are first-party-only and will reject BYOK providers.

## Panel

`show_sandboxes` renders the live sandboxes panel (status, provider, cost, destroy) — prefer it over pasting lists into chat when the user asks to "see" their sandboxes.
