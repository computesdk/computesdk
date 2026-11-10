import { runProviderCrudTest } from '@computesdk/test-utils';
import { sandboxCli } from '../index';

runProviderCrudTest({
  name: 'sandbox-cli',
  provider: sandboxCli({}),
  skipIntegration: !process.env.SANDBOX_ENDPOINT || !process.env.SANDBOX_TOKEN,
});
