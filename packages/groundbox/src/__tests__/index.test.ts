import { runProviderTestSuite } from '@computesdk/test-utils';
import { groundbox } from '../index';

const provider = groundbox({ apiKey: process.env.GROUNDBOX_API_KEY });

// The shared suite creates its sandboxes with no options, and has no setting for create
// options. Live runs wrap create to ask for the smallest size and a 10 minute lifetime, so a
// sandbox that a failed run leaves behind costs little and ends by itself, and to label it
// (created_by) so it can be found. Options the suite passes still win.
const create = provider.instances.create.bind(provider.instances);
provider.instances.create = (options) => create({ sizeClass: 'xs', timeout: 10 * 60_000, metadata: { created_by: 'computesdk-conformance' }, ...options });

runProviderTestSuite({
  name: 'groundbox',
  provider,
  supportsFilesystem: true,
  supportsStreaming: true,
  supportsProcesses: true,
  expectProcessRuntime: { streaming: 'native', processes: 'native' },
  skipIntegration: !process.env.GROUNDBOX_API_KEY,
});
