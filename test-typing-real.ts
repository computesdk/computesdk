/**
 * Real typing test to verify getInstance() actually works
 * This should compile without errors and show proper autocomplete
 */

import { e2b } from './packages/e2b/src/index'
import { createCompute } from './packages/computesdk/src/index'

async function testTypingWorks() {
  console.log('Testing getInstance() typing...')

  // Test 1: createCompute pattern
  const compute = createCompute({
    defaultProvider: e2b({ apiKey: 'test-key' }),
  })

  const sandbox = await compute.sandbox.create()
  const instance = sandbox.getInstance()

  // These should work if typing is correct (E2B Sandbox has these properties):
  console.log('Instance ID:', instance.id)
  console.log('Instance template:', instance.template)

  // This should also compile (E2B Sandbox method):
  // const timeout = instance.timeout(30000)

  // Test 2: Direct provider usage
  const provider = e2b({ apiKey: 'test-key' })
  const sandbox2 = await provider.sandbox.create()
  const instance2 = sandbox2.getInstance()

  console.log('Direct instance ID:', instance2.sandboxId)
  console.log('Direct instance template:', (await instance2.getInfo()).templateId)

  return { instance, instance2 }
}

// Export for type checking only - don't run
export { testTypingWorks }