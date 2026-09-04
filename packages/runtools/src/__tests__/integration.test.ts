import { runProviderTestSuite } from '@computesdk/test-utils'
import { runtools } from '../index'

runProviderTestSuite({
  name: 'runtools',
  provider: runtools({}),
  supportsFilesystem: true,
  supportsGetUrl: true,
  ports: [3000, 8080],
  timeout: 120_000,
  skipIntegration: !process.env.RUNTOOLS_API_KEY,
})
