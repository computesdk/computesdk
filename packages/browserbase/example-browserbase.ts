import { chromium } from 'playwright-core';
import { browserbase } from './src/index';
import 'dotenv/config';

async function main() {
  const bb = browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });

  // Create a new session
  const session = await bb.session.create();

  // Connect to the session
  const browser = await chromium.connectOverCDP(session.connectUrl);

  // Getting the default context to ensure the sessions are recorded
  const defaultContext = browser.contexts()[0]!;
  const page = defaultContext.pages()[0]!;

  await page.goto('https://computesdk.com/');
  await page.getByRole('navigation').getByRole('link', { name: 'Benchmarks' }).click();
  await page.waitForLoadState('load');
  await page.getByRole('button', { name: /median tti/i }).click();
  await page.waitForTimeout(1000);

  // Find the provider card with the lowest Median TTI and click it
  const cards = await page.locator('.grid a.flex.items-center').all();
  let lowestScore = Infinity;
  let lowestCard = null;
  let lowestName = '';

  for (const card of cards) {
    const text = await card.innerText();
    const match = text.match(/([\d.]+)s/);
    if (match) {
      const score = parseFloat(match[1]);
      if (score < lowestScore) {
        lowestScore = score;
        lowestCard = card;
        lowestName = text.replace(/\s+/g, ' ').trim();
      }
    }
  }

  if (lowestCard) {
    await lowestCard.click();
    console.log(`Clicked provider with lowest Median TTI: ${lowestScore}s ("${lowestName}")`);
    await page.waitForLoadState('load');
  }

  await page.close();
  await browser.close();

  console.log(
    `Session complete! View replay at https://browserbase.com/sessions/${session.sessionId}`
  );
}

main().catch(console.error);
