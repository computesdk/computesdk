// Final test to verify getInstance() typing works with createCompute
import { e2b } from './packages/e2b/src/index'
import { createCompute } from './packages/computesdk/src/index'

async function finalTest() {
  console.log('🧪 Testing createCompute + getInstance() typing...')

  // This is the pattern we want to work
  const compute = createCompute({
    defaultProvider: e2b({ apiKey: 'test-key' }),
  })

  const sandbox = await compute.sandbox.create()


  if (sandbox.getProvider().name === 'e2b') {
    const instance = sandbox.getInstance()
    // Test E2B specific methods - these should be available with proper typing
    if (instance.commands) {
      console.log('✅ Has commands property')
    }
    if (instance.files) {
      console.log('✅ Has files property')
    }

    // Test method calls that are E2B-specific
    console.log('getHost method exists:', typeof instance.getHost === 'function')
  }
  // These should now work (E2B Sandbox has these properties):
  return 'SUCCESS: All E2B properties accessible!'
}

// Just for typing check - don't run
export { finalTest }