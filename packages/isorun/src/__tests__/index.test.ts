import { runProviderTestSuite } from '@computesdk/test-utils'
import { isorun } from '../index'

runProviderTestSuite({
  name: 'isorun',
  provider: isorun({}),
  supportsFilesystem: true,
  supportsGetUrl: true,
  ports: [3000, 8080],
  skipIntegration: !process.env.ISORUN_API_KEY,
})
