import { runProviderTestSuite } from '@computesdk/test-utils'
import { cloudRun } from '../index'

runProviderTestSuite({
  name: 'cloud-run',
  provider: cloudRun({}),
  supportsFilesystem: true,
  supportsGetUrl: false,
  skipIntegration: !process.env.CLOUD_RUN_SANDBOX_TEST,
})
