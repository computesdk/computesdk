import { runProviderTestSuite } from '@computesdk/test-utils';
import { offstage } from '../index';

// offstage sandboxes expose no ports, so getUrl throws. File paths are relative
// to the sandbox root, so the filesystem tests work in a directory under it.
runProviderTestSuite({
  name: 'offstage',
  provider: offstage({}),
  supportsFilesystem: true,
  supportsGetUrl: false,
  filesystemBasePath: 'computesdk-test',
  skipIntegration: !process.env.OFFSTAGE_API_KEY,
});
