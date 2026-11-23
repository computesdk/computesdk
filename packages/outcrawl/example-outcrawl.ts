import { chromium, type Browser } from 'playwright-core';
import { outcrawl } from './src/index';
import 'dotenv/config';

async function main() {
  const oc = outcrawl({ apiKey: process.env.OUTCRAWL_API_KEY });

  const session = await oc.session.create();
  let browser: Browser | undefined;

  try {
    browser = await chromium.connectOverCDP(session.connectUrl!);

    const page = await (await browser.newContext()).newPage();
    await page.goto('https://example.com');
    console.log(await page.title());
  } finally {
    // Clean up independently: a failed connect still owes the provider a
    // destroy, and a failed browser.close() must not skip it either.
    await browser?.close().catch(() => {});
    await session.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
