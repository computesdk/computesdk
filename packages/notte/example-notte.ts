import { chromium } from 'playwright-core';
import { notte } from './src/index';
import 'dotenv/config';

async function main() {
  const n = notte({ apiKey: process.env.NOTTE_API_KEY });

  // Keep the session open after disconnect up to its lifetime (15 minutes by default), with a 30-minute idle cap.
  const session = await n.session.create({ keepAlive: true });

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
