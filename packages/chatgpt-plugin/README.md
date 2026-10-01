# @computesdk/chatgpt-plugin

ComputeSDK ChatGPT plugin: a remote MCP server that lets ChatGPT users run
real code in cloud sandboxes — create, exec, file I/O, list, destroy.

**First-party first**: the user's ChatGPT connector bearer token is their
ComputeSDK API key. `create_sandbox` routes through the hosted gateway at
`platform.computesdk.com` (`/api/v1/sandboxes`) — no provider setup, usage
billed to their ComputeSDK account. BYOK providers (e2b, modal, vercel,
daytona) are still available via `set_provider_credentials`.

## Architecture

- `src/index.ts` — stateless streamable-HTTP MCP server (`POST /mcp`,
  `GET /healthz`). Bearer token = ComputeSDK API key for first-party ops;
  also scopes the BYOK credential vault (SHA-256 → vault key).
- `src/gateway.ts` — first-party `computesdk` provider: REST client for the
  hosted sandbox router (create/list/get/destroy/commands), filesystem via
  shell ops. Verified live against `platform.computesdk.com/api/v1`.
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
  `create_sandbox`, `list_sandboxes`, `run_command`, `read_file`,
  `write_file`, `get_sandbox_url`, `destroy_sandbox`. All sandbox tools
  default `provider` to `computesdk`; `create_sandbox`/`list_sandboxes`
  carry `openai/outputTemplate` pointing at the panel.

### Gateway API surface used

| Op | Endpoint |
|---|---|
| create | `POST /api/v1/sandboxes` `{label?, timeoutMs?, providerOrder?}` |
| get | `GET /api/v1/sandboxes/:id` |
| list | `GET /api/v1/sandboxes?status&limit&cursor` |
| destroy | `DELETE /api/v1/sandboxes/:id` |
| exec | `POST /api/v1/sandboxes/:id/commands` `{command, timeoutMs?}` (Accept: application/json → buffered result) |

The gateway has no file or preview-URL endpoints — filesystem ops are
implemented over `commands` (base64), and `get_sandbox_url` returns an error
for `computesdk` sandboxes.

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
