# Browser Use for ComputeSDK

Run a Browser Use Cloud browser through ComputeSDK, then control it with Playwright.

## Install

```bash
pnpm add @computesdk/browseruse playwright-core
```

Create a Browser Use API key at [cloud.browser-use.com/settings?tab=api-keys](https://cloud.browser-use.com/settings?tab=api-keys), then set it in your environment:

```bash
export BROWSER_USE_API_KEY="bu_..."
```

## Quick start

```ts
import { browseruse } from '@computesdk/browseruse';
import { chromium } from 'playwright-core';

const bu = browseruse({ apiKey: process.env.BROWSER_USE_API_KEY });

const session = await bu.session.create({
  recording: true,
  proxies: [{ type: 'residential', geolocation: { country: 'us' } }],
});

const browser = await chromium.connectOverCDP(session.connectUrl);
const context = browser.contexts()[0]!;
const page = context.pages()[0]!;

await page.goto('https://example.com');
console.log(await page.title());

await browser.close();
await session.destroy();
```

## Session options

```ts
const session = await bu.session.create({
  viewport: { width: 1440, height: 900 },
  timeout: 60 * 60, // seconds; rounded up to minutes for Browser Use
  recording: true,
  profileId: 'profile-id',
  proxies: [{ type: 'residential', geolocation: { country: 'de' } }],
});
```

Set `proxies: false` to disable the Browser Use residential proxy. Custom HTTP or SOCKS5 proxy settings are also accepted through ComputeSDK's `ProxyConfig` shape.

## Profiles and recordings

```ts
const profile = await bu.profile.create({ name: 'signed-in-user' });
const session = await bu.session.create({ profileId: profile.profileId, recording: true });

// Run browser work, then stop the session.
await session.destroy();

const recording = await bu.recording.get(session.sessionId);
console.log(recording?.url);
```

The provider supports session create/get/list/destroy, persistent profiles, residential or custom proxies, viewport sizing, session timeouts, and recording lookup.

## Configuration

```ts
const bu = browseruse({
  apiKey: process.env.BROWSER_USE_API_KEY,
  // baseUrl: 'https://api.browser-use.com',
  // timeout: 30_000,
  // maxRetries: 2,
});
```

See the runnable [example-browseruse.ts](./example-browseruse.ts) and the [Browser Use Cloud docs](https://docs.browser-use.com/cloud/quickstart).
