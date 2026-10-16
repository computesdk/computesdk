import { runProviderTestSuite } from '@computesdk/test-utils'
import { workpaper } from '../index'

runProviderTestSuite({
  name: 'workpaper',
  provider: workpaper({}),
  supportsFilesystem: true,
  supportsGetUrl: false,
  skipIntegration: !process.env.WORKPAPER_API_KEY,
})
