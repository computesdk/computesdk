import { runProviderTestSuite } from '@computesdk/test-utils'
import { runtime } from '../index'

runProviderTestSuite({
  name: 'runtime',
  provider: runtime({
    apiKey: process.env.RUNTIME_API_KEY,
    baseUrl: process.env.RUNTIME_API_URL,
  }),
  supportsFilesystem: true,
  supportsGetUrl: true,
  supportsStreaming: true,
  ports: [3000, 8080],
  skipIntegration: !process.env.RUNTIME_API_KEY,
})
