---
name: sandboxes
description: >-
  Run real code in ComputeSDK cloud sandboxes — create environments, write and
  read files, execute commands, run long-lived processes, preview exposed ports,
  and clean up. Use when the user wants to exe
---

# ComputeSDK sandboxes

ComputeSDK places cloud sandboxes through the ComputeSDK gateway. All usage bills the ComputeSDK org selected when the connection was authorized — no provider setup is needed or possible in-chat.

## Core workflow

1. `create_sandbox` — returns a sandbox `id`. Args: `size` (`small` 1 vCPU/2 GB, `medium` 2/4 GB, `large` 4/8 GB, `xlarge` 8/16 GB, `2xlarge` 16/32 GB, `3xlarge` 32/128 GB; default `medium`; not every provider sells every size, `sandboxes_get_options` shows which), `label`, `image`, `timeoutMs` (lifetime in ms; default 30 minutes, max 6 hours), and `providerOrder` (camelCase routing preference). Pin one provider with `provider` (mutually exclusive with `providerOrder`), plus `region` and `credentialSource`: `auto` (default) uses the org's own key for that provider, else a ComputeSDK managed account billed from prepaid credit; `byok` requires the org's key; `house` always uses a ComputeSDK managed account. The result's `placement` says where it landed and the rate it bills at. **What it can run on:** `sandboxes_get_options` lists everything a create can land on, in the router's order: managed accounts (ComputeSDK-run, billed from prepaid credit, with a price per size) and the org's own provider keys (billed by the provider, `ready` says whether the key can place now). The first usable row is where a plain `create_sandbox` goes (`strategy` says how managed accounts are ordered: ComputeSDK's recommended order by default, cheapest first, or the org's own order). A size with `rate: null` isn't sold on that account. Call it when the user asks what they can run on or what it costs, before suggesting a provider. `byok` on `create_sandbox`/`get_quote` overrides the router for one call: `only` = the org's own keys only, `off` = managed accounts only (not with `provider`). **Pricing:** `get_quote` (same size/region/timeout inputs; it creates nothing) walks the same router a create would and returns the provider it would place on, the rate in every unit (`rateUsd.perHour` — hourly is what users compare against) and the credit balance. Use it for long timeouts, large sizes, or whenever the user asks what one create will cost, and tell the user the hourly price; `sandboxes_get_options` shows the price of every size on every provider. For provider-specific pricing before creation, check `sandboxes_get_options` for the provider, size, and account type. If no rate is available, explain that and wait for the user to authorize creation before checking the actual `placement` and `rateUsd` on the result. `insufficient_credits` means the org is out of prepaid credit: tell the user to add credit in the ComputeSDK dashboard. Don't share a top-up or checkout link.
2. Do the work: `write_file`, `read_file`, `make_directory`, `remove_path`; `run_command` or `start_process`; `sandbox_url` for anything that listens on a port. File tools take absolute paths; `read_file` on a directory lists its entries.
3. `destroy_sandbox` when the task is finished — sandboxes bill for runtime, so always clean up unless the user wants it kept alive.

`get_sandbox` fetches one sandbox's details; `list_sandboxes` lists the visible ones. `get_profile` returns the connection's identity — an opaque `id`, and `nickname`, which is the name of the billed org.

## Choosing the execution tool

* `run_command` — one-shot commands under about 290 seconds. Returns buffered stdout/stderr/exit code.
* `start_process` — anything that outlives that: servers, watchers, builds, training. Returns `jobId`; follow up with `wait_process`, `process_status` (buffered output), `kill_process`, or `list_processes` to see all jobs on a sandbox. For interactive programs (REPLs, CLIs), spawn with `stdin: true`, then use `write_process_stdin` to send input; pass `close: true` to signal EOF.

## Workflow details

* Scope: users see every sandbox they created through this plugin in that org — including ones from earlier sessions or other connected assistants. Sandboxes belonging to other org members, the warm pool, or CI are never visible; "sandbox not found" on someone else's id is expected.
* `sandbox_url` fails when the provider the sandbox was placed on has no ingress — say so, and offer to recreate pinned to a provider that supports preview URLs.
* Previewed servers must listen on `0.0.0.0` and on the exact port passed to `sandbox_url`. Dev servers usually default to `localhost`, and the preview proxy then returns 502 even though the server is running. Per-framework:
  * Flask: `app.run(host="0.0.0.0", port=N)`
  * Vite: `vite --host 0.0.0.0 --port N --strictPort`, and add the preview host to `server.allowedHosts` (Vite 5+ blocks unknown hosts)
  * Next.js: `next dev -H 0.0.0.0 -p N`
* Argument names: sandbox tools take `id`; process tools take `jobId`.
* Never print, echo, or write secrets — not in commands, files, env values, or tool output.

## Spend and settings

* `sandboxes_get_costs` — the org's running and settled spend, by provider. Open to any member.
* `sandboxes_get_settings` — placement settings (provider order, sizes, warm pool). Owners/admins only; read-only here, changes are made in the dashboard or `compute sandboxes settings`.
