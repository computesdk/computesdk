import { loadCredentials } from '@benchsdk/cli';
import { ActionsCliError } from './actions-client.js';
import { client, type CommonOpts } from './actions.js';
import { login } from './login.js';

/** Only creation may initiate login, and only before any provision request. */
export async function creationClient(opts: CommonOpts & { quiet?: boolean; browser?: boolean }) {
  const interactive = process.stdin.isTTY && process.stderr.isTTY && !process.env.CI && !opts.json && !opts.quiet &&
    !opts.apiKey && !process.env.COMPUTE_API_KEY && !process.env.BENCHMARKS_PLATFORM_API_KEY &&
    !process.env.BENCHMARKS_PLATFORM_TOKEN;
  // Snapshot before resolution: a legacy session resolver may clear its
  // rejected credentials. That must not turn it into a first-run login.
  const credentials = interactive ? await loadCredentials() : undefined;
  try {
    return await client(opts);
  } catch (error) {
    if (!(error instanceof ActionsCliError) || error.code !== 'no_credentials' || !interactive ||
        credentials?.token || credentials?.apiKey || credentials?.refreshToken) throw error;
    await login({ baseUrl: opts.baseUrl, browser: opts.browser });
    return client(opts);
  }
}
