# @computesdk/tilion

Tilion browser provider for ComputeSDK. Cloud browser sessions via [Tilion](https://tilion.dev) (beta).

```bash
npm install @computesdk/tilion
```

```ts
import { tilion } from '@computesdk/tilion';
import { chromium } from 'playwright-core';

const t = tilion({ apiKey: process.env.TILION_API_KEY });

const session = await t.session.create();
const browser = await chromium.connectOverCDP(session.connectUrl);
const page = browser.contexts()[0].pages()[0];
await page.goto('https://example.com');

await t.session.destroy(session.sessionId);
```

## Config

| option | env | default |
|---|---|---|
| `apiKey` | `TILION_API_KEY` | — (required) |
| `baseUrl` | `TILION_BASE_URL` | `https://api.tilion.dev` |

`create` returns an authenticated CDP url inline (`connectUrl`), so `connectOverCDP` works with no
extra round trip. Sessions are non-stealth with direct egress by default.

Get an API key at [tilion.dev](https://tilion.dev). Beta — reach out if you need one provisioned for testing.
