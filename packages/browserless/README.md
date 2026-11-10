# @computesdk/browserless

Browserless browser provider for ComputeSDK. Cloud browser sessions via [Browserless](https://www.browserless.io).

```bash
npm install @computesdk/browserless
```

```ts
import { browserless } from '@computesdk/browserless';
import { chromium } from 'playwright-core';

const bl = browserless({ apiKey: process.env.BROWSERLESS_API_KEY });

const session = await bl.session.create();
const browser = await chromium.connectOverCDP(session.connectUrl);
const page = browser.contexts()[0].pages()[0];
await page.goto('https://example.com');

await bl.session.destroy(session.sessionId);
```

## Config

| option | env | default |
|---|---|---|
| `apiKey` | `BROWSERLESS_API_KEY` | — (required) |
| `baseUrl` | `BROWSERLESS_URL` | `https://production-sfo.browserless.io` |

Shared fleet regions: `production-sfo`, `production-lon`, `production-ams`.
Private fleet: `chrome.browserless.io` or `chrome-<region>.browserless.io` — a
private-fleet token against a shared-fleet host returns 401.

## Session model

Browserless has no create-session REST call on the shared fleet: a session
materializes when the client opens the CDP websocket. `create()` mints a
`trackingId` and returns its connect URL (`/chromium?token=…&trackingId=…`);
the session ends on disconnect or via `destroy()` (`/kill/<trackingId>`).

`list()`/`getById()` use `GET /sessions`, which is private/enterprise-fleet
only — on the shared fleet those calls surface the HTTP error.

SECURITY: `connectUrl` embeds the API token as a query param — treat it as a
secret (don't log or persist).
