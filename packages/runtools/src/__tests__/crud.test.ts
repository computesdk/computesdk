import { runProviderCrudTest } from '@computesdk/test-utils'
import { runtools } from '../index'

runProviderCrudTest({
  name: 'runtools',
  provider: runtools({}),
  timeout: 120_000,
  skipIntegration: !process.env.RUNTOOLS_API_KEY,
})
