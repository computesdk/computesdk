import { runProviderCrudTest } from '@computesdk/test-utils'
import { isorun } from '../index'

runProviderCrudTest({
  name: 'isorun',
  provider: isorun({}),
  skipIntegration: !process.env.ISORUN_API_KEY,
})
