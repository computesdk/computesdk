import { runProviderCrudTest } from '@computesdk/test-utils'
import { brezel } from '../index'

runProviderCrudTest({
  name: 'brezel',
  provider: brezel({
    baseUrl: process.env.BREZEL_API_URL,
    apiKey: process.env.BREZEL_API_KEY,
    project: process.env.BREZEL_PROJECT_ID,
    environmentRevision: process.env.BREZEL_ENVIRONMENT_REVISION,
    allowInternet: process.env.BREZEL_ALLOW_INTERNET === 'true',
  }),
  skipIntegration: !process.env.BREZEL_API_KEY,
})
