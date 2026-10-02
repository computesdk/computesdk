# ComputeSDK Router — ChatGPT plugin

A developer tool for running code in any sandbox provider, with a live
bidding option for the best price. A remote MCP server that lets ChatGPT
users run real code in cloud sandboxes — create, exec, file I/O, long-running
processes, preview URLs, list, destroy.

**First-party first**: the user's ChatGPT connector bearer token is their
ComputeSDK API key. `create_sandbox` routes through the hosted gateway at
`platform.computesdk.com` (`/api/v1/sandboxes`) — no provider setup, usage
billed to their ComputeSDK account. BYOK providers (tensorlake, blaxel, archil,
namespace) are still available via `set_provider_credentials`.

## Architecture

- `src/index.ts` — stateless streamable-HTTP MCP server (`POST /mcp`,
  `GET /healthz`). Bearer token = ComputeSDK API key for first-party ops;
  also scopes the BYOK credential vault (SHA-256 → vault key).
- `src/gateway.ts` — first-party `computesdk` provider: REST client for the
  hosted sandbox router (create/list/get/destroy, commands, files, urls,
  detached processes, settings). Verified live against
  `platform.computesdk.com/api/v1`.
- `src/vault.ts` — per-user BYOK credential store. AES-256-GCM encrypted at
  rest; secret values never appear in tool results.
- `src/providers.ts` — provider registry; `firstParty: true` entries skip the
  credential vault and call `spec.create({}, userToken)`.
- `src/panel.ts` — sidebar panel (`ui://computesdk/panel`,
  `text/html;profile=mcp-app`): live sandbox list with provider/cost/status,
  refresh + destroy. Uses the MCP Apps postMessage bridge
  (`ui/initialize`, `tools/call`, `ui/notifications/tool-result`).
- `src/tools.ts` — MCP tools: `list_providers`,
  `set_provider_credentials`, `remove_provider_credentials`,
  `create_sandbox` (label, image, snapshotId, provider_order, resources,
  secrets passthroughs), `list_sandboxes` (`label_prefix` filter),
  `run_command`, `start_process` / `list_processes` / `process_status` /
  `wait_process` / `kill_process` / `write_stdin` / `close_stdin`
  (first-party only), `read_file`, `write_file`, `list_files`,
  `delete_path`, `get_sandbox_url`, `destroy_sandbox`. All sandbox tools
  default `provider` to `computesdk`; `create_sandbox`/`list_sandboxes`
  carry `openai/outputTemplate` pointing at the panel.

### Gateway API surface used

| Op | Endpoint |
|---|---|
| create | `POST /api/v1/sandboxes` `{label?, timeoutMs?, providerOrder?, image?, snapshotId?, resources?, secrets?}` |
| get | `GET /api/v1/sandboxes/:id` (includes `attach` descriptor — BYOK connect() offramp) |
| list | `GET /api/v1/sandboxes?status&limit&cursor` |
| destroy | `DELETE /api/v1/sandboxes/:id` |
| exec | `POST /api/v1/sandboxes/:id/commands` `{command, timeoutMs?}` (buffered; ≤64KB, ~290s) |
| files | `GET/POST/DELETE /api/v1/sandboxes/:id/files?path=` (absolute paths, ≤32MB content) |
| urls | `GET /api/v1/sandboxes/:id/urls?port&protocol` → `{url}` (501 when the provider has no ingress) |
| processes | `POST/GET /api/v1/sandboxes/:id/processes`, `GET /processes/:jobId`, `.../wait`, `.../kill`, `.../stdin`, `.../close-stdin` |
| settings | `GET /api/v1/sandboxes/settings` (routing order, market cap, sizes, warm pool) |

Client-side clamps mirror the platform: 6h sandbox timeout, 64KB/~290s
commands, 32MB file content. `sb-pool`-prefixed labels are reserved by the
warm pool — plugin sandboxes are labelled `chatgpt-plugin-*`.

## Run

```sh
pnpm build
CREDENTIALS_MASTER_KEY=$(openssl rand -hex 32) pnpm start   # :8787
```

Env vars:

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | HTTP port |
| `CREDENTIALS_MASTER_KEY` | ephemeral | AES-256 key for the BYOK vault |
| `CREDENTIALS_STORE_PATH` | `./.data/credentials.json` | encrypted store location |
| `COMPUTESDK_API_KEY` | — | fallback gateway key when no bearer token |
| `COMPUTESDK_BASE_URL` | `https://platform.computesdk.com` | gateway override |

## ChatGPT

Add the deployed URL as a plugin (`/mcp`) with
`Authorization: Bearer <COMPUTESDK_API_KEY>` — the key is the user's existing
ComputeSDK account credential (plugins may sign users into existing paid
accounts; in-plugin subscription sales are not permitted, so billing stays on
the platform side).

## Phase 2

- OAuth flow instead of pasted bearer (ChatGPT connector auth).
- Repo-connected Actions (`run this on push/PR`) as an `actions` tool surface
  on the same plugin.
- File-viewer panel + MCP Events (sandbox-finished notifications).
