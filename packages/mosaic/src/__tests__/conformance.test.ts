import { describe } from 'vitest';
import { runProviderTestSuite } from '@computesdk/test-utils';
import { mosaic } from '../index.js';

const live = !!process.env.MOSAIC_API_TOKEN && !!process.env.MOSAIC_API_URL;

describe('mosaic conformance', () => {
  runProviderTestSuite({
    name: 'mosaic',
    provider: mosaic({}), // Uses MOSAIC_API_URL and MOSAIC_API_TOKEN from env
    supportsFilesystem: true,
    supportsPauseResume: true,
    supportsSnapshots: true,
    skipIntegration: !live,
  });
});
