import { runProviderCrudTest } from '@computesdk/test-utils'
import { cloudRun } from '../index'

runProviderCrudTest({
  name: 'cloud-run',
  provider: cloudRun({}),
  skipIntegration: !process.env.CLOUD_RUN_SANDBOX_TEST,
})
