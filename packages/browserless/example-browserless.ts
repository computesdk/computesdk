import { chromium, type Browser } from 'playwright-core';
import { browserless } from './src/index';
import 'dotenv/config';

async function main() {
  const bl = browserless({ apiKey: process.env.BROWSERLESS_API_KEY });

  const session = await bl.session.create();
  let browser: Browser | undefined;

  try {
    browser = await chromium.connectOverCDP(session.connectUrl!);

    const page = browser.contexts()[0]!.pages()[0]!;
    await page.goto('https://example.com');
    console.log(await page.title());
  } finally {
    // Clean up independently: a failed connect still owes the provider a
    // destroy, and a failed browser.close() must not skip it either.
    await browser?.close().catch(() => {});
    await session.destroy();
  }
}

main().catch(console.error);
