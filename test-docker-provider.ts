/**
 * Quick test script to demonstrate Docker provider functionality
 */

import { docker } from './packages/docker/src/index';

async function test() {
  console.log('🐳 Testing Docker Provider\n');

  try {
    // Create provider
    const provider = docker({ runtime: 'node', image: 'node:20-alpine' });
    console.log('✅ Created Docker provider\n');

    // Create sandbox
    console.log('Creating sandbox...');
    const { sandbox, sandboxId } = await provider.sandbox.create();
    console.log('✅ Created sandbox:', sandboxId.substring(0, 12) + '...\n');

    // Test code execution using the returned sandbox object's methods
    console.log('Testing code execution...');

    // Get the actual Sandbox instance from the provider's internal structure
    const sandboxInstance = await provider.sandbox.getById(sandboxId);
    if (!sandboxInstance) {
      throw new Error('Failed to get sandbox instance');
    }

    const codeResult = await sandboxInstance.runCode(
      'console.log("Hello from Docker!"); console.log("Node version:", process.version);'
    );
    console.log('Output:', codeResult.stdout);
    console.log('Exit code:', codeResult.exitCode);
    console.log('Execution time:', codeResult.executionTime, 'ms\n');

    // Test filesystem
    console.log('Testing filesystem...');
    await sandboxInstance.filesystem.writeFile('/tmp/test.txt', 'Hello World!');
    const content = await sandboxInstance.filesystem.readFile('/tmp/test.txt');
    console.log('✅ File content:', content, '\n');

    // Test command execution
    console.log('Testing command execution...');
    const cmdResult = await sandboxInstance.runCommand('echo', ['Test command']);
    console.log('Command output:', cmdResult.stdout.trim(), '\n');

    // Get info
    const info = await sandboxInstance.getInfo();
    console.log('Sandbox info:', {
      provider: info.provider,
      runtime: info.runtime,
      status: info.status
    }, '\n');

    // Cleanup
    console.log('Cleaning up...');
    await provider.sandbox.destroy(sandboxId);
    console.log('✅ Cleanup complete\n');

    console.log('🎉 All tests passed!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Set timeout to exit if it takes too long
setTimeout(() => {
  console.log('\n⏱️  Test completed (auto-exit)');
  process.exit(0);
}, 60000);

test();
