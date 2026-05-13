import { runProviderTestSuite } from '@computesdk/test-utils';
import { k8s } from '../index';

runProviderTestSuite({
  name: 'k8s',
  provider: k8s(),
  supportsFilesystem: false,
  supportsGetUrl: false,
  skipIntegration: process.env.COMPUTESDK_TEST_K8S !== '1',
  ports: [3000, 8080],
});
