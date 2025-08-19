import { runProviderTestSuite } from '@computesdk/test-utils';
import { codesandbox } from '../index';

runProviderTestSuite({
  name: 'CodeSandbox',
  provider: codesandbox({}),
  supportsFilesystem: true,  // CodeSandbox supports filesystem operations
  supportsPython: true,      // CodeSandbox supports Python runtime
  skipIntegration: !process.env.CSB_API_KEY
});