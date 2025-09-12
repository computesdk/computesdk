import { runProviderTestSuite } from '@computesdk/test-utils';
import { codesandbox } from '../index';

runProviderTestSuite({
  name: 'codesandbox',
  provider: codesandbox({}),
  supportsFilesystem: true,  // CodeSandbox supports filesystem operations
  skipIntegration: !process.env.CSB_API_KEY
});