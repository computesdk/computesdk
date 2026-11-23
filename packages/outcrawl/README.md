# @computesdk/outcrawl

Outcrawl browser provider for ComputeSDK. Cloud browser sessions via [Outcrawl](https://outcrawl.ai), driven over plain CDP with Playwright, Puppeteer or any CDP client.

```bash
npm install @computesdk/outcrawl
```

```ts
import { outcrawl } from '@computesdk/outcrawl';
import { chromium } from 'playwright-core';

const oc = outcrawl({ apiKey: process.env.OUTCRAWL_API_KEY });

const session = await oc.session.create();
const browser = await chromium.connectOverCDP(session.connectUrl);
const page = await (await browser.newContext()).newPage();
await page.goto('https://example.com');

await oc.session.destroy(session.sessionId);
```

## Config

| option | env | default |
|---|---|---|
| `apiKey` | `OUTCRAWL_API_KEY` | none (required) |
| `baseUrl` | `OUTCRAWL_URL` | `https://api.outcrawl.ai` |

Get an API key at https://outcrawl.ai/sign-in (1,000 free credits a month, no card).

## Session model

`create()` calls `GET /connect`, which allocates a browser on the Outcrawl fleet and answers with `{ sessionId, wsEndpoint, expiresAt }`. `connectUrl` is the `wsEndpoint`, a short-lived CDP websocket URL. `expiresAt` is when that connect ticket expires, not when the session ends.

`destroy()` ends the session and its billing with `DELETE /v1/sessions/{id}`; the recording is kept. A session that is already gone is a no-op.

A session has no record on Outcrawl until a client opens its CDP websocket, so `getById()` and `list()` see it only after that. For a session `create()` just allocated, `getConnectUrl()` returns its own endpoint until the connect ticket expires (same process only). After that, or for a session this process did not create, it re-attaches with `session=<id>` and returns a fresh 60-second endpoint. Re-attaching works only for a held session: create it with `keepAlive: true`, which sets Outcrawl's `idle_timeout` (the `timeout` option in seconds, default 300, limited to 10 to 21600). For any other session, `getConnectUrl()` surfaces Outcrawl's error. A held session is billed while it waits, so set `timeout` to the longest gap you need to bridge plus a margin: the 300-second default expires a session that is left disconnected for exactly 300 seconds.

`list()` and `getById()` read `GET /v1/sessions` and `GET /v1/sessions/{id}`, which also return finished sessions with their replay URL. They carry no live endpoint: `getById()` returns an empty `connectUrl`, so use `getConnectUrl()` for a held session.

## Options

| `create()` option | Outcrawl |
|---|---|
| `profileId` | `profile`: a saved Outcrawl profile, cookies and logins carry over |
| `recording: false` | `record=false` |
| `keepAlive: true` (with optional `timeout`) | `idle_timeout`: a held session you can re-attach to |
| `proxies: [{ type: 'custom', server, username, password }]` | `proxy`: your own proxy |
| `proxies: [{ geolocation: { country, state, city } }]` | residential exit in that geography |
| `proxies: true` | no param: every session already leaves from a residential exit |
| `stealth` | no param: every session is a stealth browser |

`viewport`, `timeout` (without `keepAlive`), `logging: false`, `extensionIds`, `region`, `saveDownloads` and `userMetadata` have no equivalent and warn once and are ignored.

SECURITY: `create()` sends the API key as a query parameter on `/connect`, as Outcrawl's own clients do. The returned `connectUrl` carries a short-lived connect ticket, not the key; treat it as a bearer credential until it expires.
