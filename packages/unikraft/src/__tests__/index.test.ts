import { runProviderTestSuite } from '@computesdk/test-utils'
import { unikraft } from '../index'

runProviderTestSuite({
  name: 'unikraft',
  provider: unikraft({}),
  supportsFilesystem: true,
  supportsGetUrl: false,
  skipIntegration: !process.env.UKC_TOKEN,
})
