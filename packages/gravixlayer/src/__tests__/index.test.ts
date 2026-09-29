import { runProviderTestSuite } from '@computesdk/test-utils'
import { gravixlayer } from '../index'

runProviderTestSuite({
  name: 'gravixlayer',
  provider: gravixlayer({ apiKey: process.env.GRAVIXLAYER_API_KEY }),
  supportsFilesystem: true,
  supportsGetUrl: true,
  supportsStreaming: true,
  ports: [3000],
  skipIntegration: !process.env.GRAVIXLAYER_API_KEY,
})
