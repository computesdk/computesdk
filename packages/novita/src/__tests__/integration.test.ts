import { runProviderTestSuite } from '@computesdk/test-utils';
import { describe } from 'vitest';
import { novita } from '../index';

const runLive = process.env.NOVITA_RUN_INTEGRATION === '1' && Boolean(process.env.NOVITA_API_KEY);

// Match E2B's shared contract coverage, but require explicit opt-in for cloud calls.
// SDK mocks in index.test.ts are isolated to that file by Vitest.
describe(`Novita shared provider contract (${runLive ? 'live' : 'mock'})`, () => {
  runProviderTestSuite({
    name: 'novita',
    provider: novita({}),
    supportsFilesystem: true,
    skipIntegration: !runLive,
    ports: [3000, 8080],
  });
});
