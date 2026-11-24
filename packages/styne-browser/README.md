# @computesdk/styne-browser

Styne browser provider for ComputeSDK. Cloud browser sessions via [Styne](https://styne.ai), each running Chromium in its own microVM.

```bash
npm install @computesdk/styne-browser
```

```ts
import { styneBrowser } from '@computesdk/styne-browser';
import { chromium } from 'playwright-core';

const sb = styneBrowser({ apiKey: process.env.STYNE_API_KEY });

const session = await sb.session.create({ timeout: 300 });
const browser = await chromium.connectOverCDP(session.connectUrl!);
const page = browser.contexts()[0].pages()[0];
await page.goto('https://example.com');

await browser.close();
await session.destroy();
```

## Config

| option | env | default |
|---|---|---|
| `apiKey` | `STYNE_API_KEY` | (required) |
| `apiUrl` | `STYNE_API_URL` | `https://api.styne.ai` |

Get an API key from the [Styne dashboard](https://app.styne.ai). `apiUrl` must be https
(plain http only for localhost).

## Sessions

`timeout`, `region`, `viewport`, `userMetadata` (stored as the session's `metadata`) and `profileId` map directly.
`keepAlive: true` keeps the session from sleeping while no client is connected. Unblocking and CAPTCHA clicks are on by
default; `stealth: true` also solves challenges the click does not pass (metered per solve), `stealth: false` turns both off.
`proxies` picks a residential (`true`, `residential`, `isp`) or datacenter exit and a country. `saveDownloads: true` keeps
files the page downloads. `recording: false` or `logging: false` turns off the session recording. Other options warn once.

A session started with `profileId` saves its cookies and storage back into the profile when it ends. `getById()` and
`getConnectUrl()` resume a paused session and return a URL that connects; `list()` reports each session's state and leaves
`connectUrl` out for sessions that are not running. Every call has a 60 s deadline; a create whose outcome is unknown names
its `Idempotency-Key` in the error. `connectUrl` carries an auth token; don't log it.
