import { runProviderTestSuite } from '@computesdk/test-utils'

import { givemeanode } from '../index'

runProviderTestSuite({
  name: 'givemeanode',
  provider: givemeanode({
    apiKey: process.env.GMN_TOKEN,
    baseUrl: process.env.GMN_API_HOST,
  }),
  supportsFilesystem: true,
  // `getUrl` mints a public HTTPS URL for a port inside the sandbox. The
  // request reaches it over vsock rather than as a packet on the guest's
  // interface, so it works on a sandbox prepared with `egress: 'none'`
  // too. The suite's case only asks for a URL, which is minted whether
  // or not anything is listening yet - a port with no server answers 502
  // when it is actually fetched.
  supportsGetUrl: true,
  skipIntegration: !process.env.GMN_TOKEN,
})
