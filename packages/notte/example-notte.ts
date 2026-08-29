import { chromium } from 'playwright-core';
import { notte } from './src/index';
import 'dotenv/config';

async function main() {
  const n = notte({ apiKey: process.env.NOTTE_API_KEY });

  // Create a new session
  const session = await n.session.create();

  // Connect to the session
  const browser = await chromium.connectOverCDP(session.connectUrl);

  const defaultContext = browser.contexts()[0]!;
  const page = defaultContext.pages()[0]!;

  await page.goto('https://news.ycombinator.com/');
  const topStory = await page.evaluate(() => {
    const titleElement = document.querySelector('.titleline > a');
    return titleElement ? titleElement.textContent : null;
  });
  console.log('Top story:', topStory);

  await page.close();
  await browser.close();

  // Clean up the session
  await session.destroy();

  console.log(`Session complete: ${session.sessionId}`);
}

main().catch(console.error);
