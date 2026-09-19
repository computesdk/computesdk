import { runProviderTestSuite } from '@computesdk/test-utils'
import { brezel } from '../index'

runProviderTestSuite({
  name: 'brezel',
  provider: brezel({
    baseUrl: process.env.BREZEL_API_URL,
    apiKey: process.env.BREZEL_API_KEY,
    project: process.env.BREZEL_PROJECT_ID,
    environmentRevision: process.env.BREZEL_ENVIRONMENT_REVISION,
    allowInternet: process.env.BREZEL_ALLOW_INTERNET === 'true',
  }),
  supportsFilesystem: true,
  supportsGetUrl: true,
  supportsStreaming: true,
  ports: [3000, 8080],
  skipIntegration: !process.env.BREZEL_API_KEY,
})
