# `compute` CLI end-to-end tests

Live end-to-end tests for the sandbox compute market. These run against the
production platform, post real asks, boot real sandboxes, and spend real
(granted) market credits — **they are not run in CI**.

## `market-sandboxes.sh`

Covers the sandbox lane of the compute market through three dedicated orgs:

| Role | Setup needed |
|---|---|
| Buyer | on the sandbox access list, approved to buy in the `sandbox` lane, granted credits |
| Seller | market seller on some executor provider (e.g. `isorun`), `sandbox` lane only |
| Actions-only | on the sandbox access list, approved for `actions` only; has its own provider key for the own-key test |

Each org needs an API key (Settings → API keys). The seller's executor
credential is read from env vars the same way `market credential connect`
reads them (`<PROVIDER>_<FIELD>`, e.g. `ISORUN_API_KEY`).

```bash
export E2E_BUYER_KEY=csdk_...        # buyer org key
export E2E_SELLER_KEY=csdk_...       # seller org key
export E2E_ACTIONS_KEY=csdk_...      # actions-only org key
export E2E_SELLER_PROVIDER=isorun
export ISORUN_API_KEY=...            # seller executor credential
export E2E_OWNKEY_PROVIDER=e2b       # provider the actions org keys itself
# store the actions org's provider key first (Settings → Provider keys, or
# PATCH /api/v1/... provider-keys), then:
./market-sandboxes.sh
```

Environment knobs:

- `BASE_URL` — platform base URL (default `https://platform.computesdk.com`)
- `E2E_PARTS` — subset of `seller buyer actions oauth` (default `seller buyer actions`)
- `E2E_RUN_ID` — override the run id used in sandbox labels
- `COMPUTE` — path/name of the CLI under test (default `compute`)

Output is a `PASS`/`FAIL` line per check plus a summary table; exit code is
non-zero on any failure. A trap always destroys `e2e-<runid>-*` sandboxes,
withdraws this run's asks, and clears caps the run set. Buyer balance is
recorded before and after so the run's spend is visible.

### Part B — `oauth`

`E2E_PARTS=oauth` exercises the stored-login path instead of API keys: device
flow `compute login` for each account (interactive — you approve the code in a
browser on the first run), `whoami`, a buyer sandbox create over the stored
login, the actions org's `market_access_required` refusal, the seller's lane
status, and `compute logout`. Per-account home dirs persist the logins:
`E2E_BUYER_HOME` / `E2E_SELLER_HOME` / `E2E_ACTIONS_HOME` (default
`.e2e/homes/<role>`). Any `*_API_KEY` env vars are stripped for these checks
so the stored OAuth login is what actually authenticates.

Fill prices and quotes are asserted against the live book: an order fills the
cheapest ask whose snapshotted resources cover the requested size, so any
extra capacity on the book (yours or third-party) participates. `market
price` only stages `pendingUsd` until rollover, so the protection-limit check
pauses eligible asks and posts a temporary expensive one instead.

Caveats:

- Part B (`oauth`) runs `compute login` through a pseudo-TTY via `script`;
  works on Linux and macOS (the flag difference is handled in the script).
- B9 (the protection-limit check) pauses every medium-eligible ask it can
  see and posts a temporary $0.60/hr ask. It assumes no third-party sellers
  are live in the sandbox lane — it can only pause asks it can list, so a
  foreign seller's cheap ask would still win fills and skew the checks.

## `mcp-oauth-client.mjs`

Part C of the E2E: exercises the platform MCP endpoint
(`https://platform.computesdk.com/mcp`) over OAuth — dynamic client
registration, localhost redirect, org picker, `tools/list`, `get_quote`,
`create_sandbox`, `run_command`, `destroy_sandbox`, `get_profile`, and token
refresh. Requires `@modelcontextprotocol/sdk` and a browser that can complete
the consent screen.

```bash
npm i @modelcontextprotocol/sdk
node mcp-oauth-client.mjs            # buyer org checks (M1–M3, M5)
node mcp-oauth-client.mjs --actions  # actions-only org refusals (M4)
```

The script prints `AUTH_URL` — open it, sign in as the account for the org
under test, pick the org, approve the three permissions. The browser
redirects to a localhost listener that hands the code back (or write the
code to the per-run path it prints, inside a private `mcp-e2e-*` temp dir).
