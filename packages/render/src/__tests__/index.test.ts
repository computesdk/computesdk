import { runProviderTestSuite } from '@computesdk/test-utils';
import { render } from '../index';

runProviderTestSuite({
  name: 'render',
  provider: render({}),
  supportsFilesystem: true,
  supportsGetUrl: false,
  supportsStreaming: true,
  skipIntegration: !process.env.RENDER_API_KEY || !process.env.RENDER_WORKSPACE_ID,
});
