import { runProviderTestSuite } from '@computesdk/test-utils'

import { givemeanode } from '../index'

runProviderTestSuite({
  name: 'givemeanode',
  provider: givemeanode({
    apiKey: process.env.GMN_TOKEN,
    baseUrl: process.env.GMN_API_HOST,
  }),
  supportsFilesystem: true,
  // A givemeanode sandbox has no inbound ports: it reaches out, and its
  // egress posture is fixed when the guest is baked. `getUrl` throws with
  // that explanation, so the suite must not ask for one.
  supportsGetUrl: false,
  skipIntegration: !process.env.GMN_TOKEN,
})
