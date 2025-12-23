/**
 * Named Sandbox Example
 * 
 * Demonstrates using the new findOrCreate and find methods for stable sandbox references.
 * 
 * Use Case: "One sandbox per project" - instead of creating a new sandbox every time,
 * you can find an existing sandbox by (namespace, name) or create it if it doesn't exist.
 */

import { compute } from '../packages/computesdk/src/index.js';

async function main() {
  // Prerequisites:
  // 1. Set COMPUTESDK_API_KEY environment variable
  // 2. Set provider credentials (e.g., E2B_API_KEY)
  
  console.log('=== Named Sandbox Example ===\n');

  // Example 1: Find or create a user-scoped sandbox
  console.log('1. Finding or creating user-scoped sandbox...');
  const userSandbox = await compute.sandbox.findOrCreate({
    name: 'my-app',           // Stable identifier for your app
    namespace: 'user-alice',  // Scope to a specific user
    timeout: 30 * 60 * 1000,  // 30 minutes
  });

  console.log(`   ✓ Sandbox ready: ${userSandbox.sandboxId}`);
  console.log(`   - First call creates new sandbox`);
  console.log(`   - Subsequent calls return same sandbox\n`);

  // Example 2: Find existing sandbox without creating
  console.log('2. Finding existing sandbox (without creating)...');
  const existingSandbox = await compute.sandbox.find({
    name: 'my-app',
    namespace: 'user-alice',
  });

  if (existingSandbox) {
    console.log(`   ✓ Found existing sandbox: ${existingSandbox.sandboxId}`);
    console.log(`   - Same as previous: ${existingSandbox.sandboxId === userSandbox.sandboxId}\n`);
  }

  // Example 3: Different namespace creates different sandbox
  console.log('3. Different namespace creates isolated sandbox...');
  const anotherUserSandbox = await compute.sandbox.findOrCreate({
    name: 'my-app',           // Same name
    namespace: 'user-bob',    // Different namespace
    timeout: 30 * 60 * 1000,
  });

  console.log(`   ✓ Sandbox ready: ${anotherUserSandbox.sandboxId}`);
  console.log(`   - Different from user-alice: ${anotherUserSandbox.sandboxId !== userSandbox.sandboxId}\n`);

  // Example 4: Find non-existent sandbox returns null
  console.log('4. Finding non-existent sandbox...');
  const nonExistent = await compute.sandbox.find({
    name: 'does-not-exist',
    namespace: 'user-charlie',
  });

  console.log(`   ✓ Result: ${nonExistent ? 'found' : 'null (as expected)'}\n`);

  // Example 5: Default namespace
  console.log('5. Using default namespace...');
  const defaultSandbox = await compute.sandbox.findOrCreate({
    name: 'global-service',
    // namespace omitted - defaults to "default"
    timeout: 60 * 60 * 1000, // 1 hour
  });

  console.log(`   ✓ Sandbox ready: ${defaultSandbox.sandboxId}`);
  console.log(`   - Uses "default" namespace when not specified\n`);

  // Example 6: Use the sandbox like any other
  console.log('6. Using the sandbox (run commands, access files, etc.)...');
  
  // Run a command
  const result = await userSandbox.runCommand('echo', ['Hello from named sandbox!']);
  console.log(`   ✓ Command output: ${result.stdout.trim()}`);

  // Access filesystem
  await userSandbox.filesystem.writeFile('/tmp/test.txt', 'Hello, World!');
  const content = await userSandbox.filesystem.readFile('/tmp/test.txt');
  console.log(`   ✓ File content: ${content}\n`);

  // Example 7: Cleanup (destroy all sandboxes we created)
  console.log('7. Cleaning up...');
  await compute.sandbox.destroy(userSandbox.sandboxId);
  await compute.sandbox.destroy(anotherUserSandbox.sandboxId);
  await compute.sandbox.destroy(defaultSandbox.sandboxId);
  console.log('   ✓ All sandboxes destroyed\n');

  console.log('=== Example Complete ===');
}

// Run the example
main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
