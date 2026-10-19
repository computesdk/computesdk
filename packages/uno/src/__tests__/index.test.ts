import { runProviderTestSuite } from '@computesdk/test-utils'
import { uno } from '../index'

runProviderTestSuite({
  name: 'uno',
  provider: uno({ apiKey: process.env.UNO_API_KEY ?? 'test', region: process.env.UNO_REGION }),
  supportsFilesystem: true,
  supportsGetUrl: false,
  timeout: 300_000,
  skipIntegration: !process.env.UNO_API_KEY,
})
