import { runProviderCrudTest } from '@computesdk/test-utils'
import { workpaper } from '../index'

runProviderCrudTest({
  name: 'workpaper',
  provider: workpaper({}),
  skipIntegration: !process.env.WORKPAPER_API_KEY,
})
