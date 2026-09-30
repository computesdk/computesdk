# @computesdk/chatgpt-plugin

ComputeSDK ChatGPT plugin: a remote MCP server that lets ChatGPT users place
sandboxes on any sandbox provider. **BYOK first** — users supply their own
provider credentials; a first-party ComputeSDK-gateway provider can be added
as another registry entry later.

## Architecture

- `src/index.ts` — stateless streamable-HTTP MCP server (`POST /mcp`,
  `GET /healthz`). Bearer token identifies the user (SHA-256 → vault key).
- `src/vault.ts` — per-user credential store. AES-256-GCM encrypted at rest;
  secret values never appear in tool results.
- `src/providers.ts` — provider registry (name, credential fields, factory).
  Ships with e2b, modal, vercel, daytona; add providers as one more entry.
- `src/tools.ts` — MCP tools: `list_providers`,
  `set_provider_credentials`, `remove_provider_credentials`,
  `create_sandbox`, `list_sandboxes`, `run_command`, `read_file`,
  `write_file`, `get_sandbox_url`, `destroy_sandbox`.

## Run

```sh
pnpm build
CREDENTIALS_MASTER_KEY=$(openssl rand -hex 32) pnpm start   # :8787
```

Env vars:

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | HTTP port |
| `CREDENTIALS_MASTER_KEY` | ephemeral | AES-256 key for the credential vault |
| `CREDENTIALS_STORE_PATH` | `./.data/credentials.json` | encrypted store location |

## ChatGPT

Add the deployed URL as a custom connector/plugin (`/mcp`). Every request must
carry `Authorization: Bearer <token>` — the token scopes the user's credential
vault. Production deployments should terminate OAuth and validate real tokens;
the current scheme is a scaffold, not authentication.

## Phase 2 (first-party)

Add a `computesdk` entry to `PROVIDERS` that takes a gateway API key (or none —
server-held), so users get hosted sandboxes with no BYOK step; bill via the
platform's org/API-key system. Repo-connected Actions (`run this on push/PR`)
can land as an `actions` tool surface on the same plugin.
