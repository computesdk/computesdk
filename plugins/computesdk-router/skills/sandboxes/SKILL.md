---
name: sandboxes
description: Run real code in ComputeSDK cloud sandboxes — create environments, write and read files, execute commands, run long-lived processes, preview exposed ports, and clean up. Use when the user wants to execute, test, or host code, or asks about their running sandboxes.
---

# ComputeSDK sandboxes

ComputeSDK places cloud sandboxes through the ComputeSDK gateway. All usage bills the ComputeSDK org selected when the connection was authorized — no provider setup is needed or possible in-chat.

## Core workflow

1. `create_sandbox` — returns a sandbox `id`. Args: `size` (`small` 1 vCPU/2 GB, `medium` 2/4 GB, `large` 4/8 GB, `xlarge` 8/16 GB; default `medium`), `label`, `image`, `timeoutMs` (lifetime in ms; default 30 minutes, max 6 hours), `providerOrder` (camelCase routing preference, e.g. `["market"]` for a live-bid market fill), `orderType` (`market` or `limit`), and `maxPrice` (`{usd, per}` — a limit-order ceiling for a market fill).
   Pin one provider with `provider` (mutually exclusive with `providerOrder`), plus `region` and `credentialSource`: `auto` (default) uses the org's own key for that provider, else ComputeSDK's house account billed from prepaid credit; `byok` requires the org's key; `house` always uses the house account. The result's `placement` says where it landed and the rate it bills at.
   **Pricing:** `get_quote` (same size/region/timeout inputs; it creates nothing) walks the same router a create would and returns the provider it would place on, the rate in every unit (`rateUsd.perHour` — hourly is what users compare against) and the credit balance. Use it for long timeouts, large sizes, or whenever the user asks what a sandbox costs. It cannot be pinned to a provider: to price one, create it and read `placement`/`rateUsd`, or tell the user the quote is for the router's default choice.
   **Market fills only:** the market fields (`orderType`, `maxPrice`, org cap, protection ceiling) matter only when the placement would go to the market (`providerOrder` includes `market`, or the quote's `orderType` says so). Then the default order type is `limit`, so a create with no org market cap and no `maxPrice` fails `market_cap_required`: quote, tell the user the price, and create with `maxPrice` set to it. Pass `orderType: "market"` only when the user asks for the best available price. Org caps are admin settings (dashboard or `compute sandboxes settings set`), not something the assistant changes. If create fails `market_access_required`, the org isn't approved for market buying yet — send the user to the org's market page. Own-key and house placements need none of this. `insufficient_credits` means top up first (the quote's `topUpPath` points there).
2. Do the work: `write_file`, `read_file`, `make_directory`, `remove_path`; `run_command` or `start_process`; `sandbox_url` for anything that listens on a port. File tools take absolute paths; `read_file` on a directory lists its entries.
3. `destroy_sandbox` when the task is finished — sandboxes bill for runtime, so always clean up unless the user wants it kept alive.

`get_sandbox` fetches one sandbox's details; `list_sandboxes` lists the visible ones. `get_profile` returns the connection's identity — an opaque `id`, and `nickname`, which is the name of the billed org.

## Choosing the execution tool

- `run_command` — one-shot commands under about 290 seconds. Returns buffered stdout/stderr/exit code.
- `start_process` — anything that outlives that: servers, watchers, builds, training. Returns `jobId`; follow up with `wait_process`, `process_status` (buffered output), `kill_process`, or `list_processes` to see all jobs on a sandbox. For interactive programs (REPLs, CLIs), spawn with `stdin: true`, then use `write_process_stdin` to send input; pass `close: true` to signal EOF.

## Workflow details

- Scope: users see every sandbox they created through this plugin in that org — including ones from earlier sessions or other connected assistants. Sandboxes belonging to other org members, the warm pool, or CI are never visible; "sandbox not found" on someone else's id is expected.
- `sandbox_url` fails when the provider the sandbox was placed on has no ingress — say so, and offer to recreate pinned to a provider that supports preview URLs.
- Previewed servers must listen on `0.0.0.0` and on the exact port passed to `sandbox_url`. Dev servers usually default to `localhost`, and the preview proxy then returns 502 even though the server is running. Per-framework:
  - Flask: `app.run(host="0.0.0.0", port=N)`
  - Vite: `vite --host 0.0.0.0 --port N --strictPort`, and add the preview host to `server.allowedHosts` (Vite 5+ blocks unknown hosts)
  - Next.js: `next dev -H 0.0.0.0 -p N`
- Argument names: sandbox tools take `id`; process tools take `jobId`.
- Never print, echo, or write secrets — not in commands, files, env values, or tool output.

## Spend and settings

- `sandboxes_get_costs` — the org's running and settled spend, by provider. Open to any member.
- `sandboxes_get_settings` — placement settings (provider order, market caps, warm pool). Owners/admins only; read-only here, changes are made in the dashboard or `compute sandboxes settings`.
