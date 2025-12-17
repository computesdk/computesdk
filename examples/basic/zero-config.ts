/**
 * Zero-Config Example
 * 
 * This example demonstrates the simplest way to use ComputeSDK.
 * No imports, no configuration - just works! ✨
 * 
 * Requirements:
 *   - COMPUTESDK_API_KEY environment variable (get from https://computesdk.com)
 *   - Provider credentials (e.g., E2B_API_KEY)
 * 
 * Run:
 *   export COMPUTESDK_API_KEY=computesdk_live_xxx
 *   export E2B_API_KEY=e2b_xxx
 *   npx tsx zero-config.ts
 */

import { compute } from 'computesdk';

async function main() {
  console.log('🚀 ComputeSDK Zero-Config Example\n');

  // Check environment
  if (!process.env.COMPUTESDK_API_KEY) {
    console.error('❌ COMPUTESDK_API_KEY not set');
    console.log('\nGet your API key from https://computesdk.com');
    console.log('Then run: export COMPUTESDK_API_KEY=your_key\n');
    process.exit(1);
  }

  if (!process.env.E2B_API_KEY && !process.env.RAILWAY_API_KEY && !process.env.DAYTONA_API_KEY) {
    console.error('❌ No provider credentials found');
    console.log('\nSet one of:');
    console.log('  export E2B_API_KEY=xxx');
    console.log('  export RAILWAY_API_KEY=xxx (+ RAILWAY_PROJECT_ID + RAILWAY_ENVIRONMENT_ID)');
    console.log('  export DAYTONA_API_KEY=xxx\n');
    process.exit(1);
  }

  console.log('Creating sandbox (auto-detected from environment)...');
  const sandbox = await compute.sandbox.create();
  console.log(`✅ Sandbox created: ${sandbox.sandboxId}`);
  console.log(`   Provider: ${sandbox.provider}\n`);

  // Run Python code
  console.log('Running Python code...');
  const pythonResult = await sandbox.runCode(`
print("Hello from Python!")
print(f"2 + 2 = {2 + 2}")
  `.trim(), 'python');
  console.log('Output:', pythonResult.output);

  // Run Node.js code
  console.log('\nRunning Node.js code...');
  const nodeResult = await sandbox.runCode(`
console.log("Hello from Node.js!");
console.log(\`Process version: \${process.version}\`);
  `.trim(), 'node');
  console.log('Output:', nodeResult.output);

  // Run shell commands
  console.log('\nRunning shell commands...');
  const lsResult = await sandbox.runCommand('ls', ['-la', '/home']);
  console.log('Files:', lsResult.stdout.split('\n').slice(0, 5).join('\n'), '...\n');

  // Test filesystem operations
  console.log('\nTesting filesystem operations...');
  await sandbox.filesystem.writeFile('/home/test.txt', 'Hello from ComputeSDK!');
  const content = await sandbox.filesystem.readFile('/home/test.txt');
  console.log('File content:', content);

  // Cleanup
  console.log('\nDestroying sandbox...');
  await sandbox.destroy();
  console.log('✅ Done!\n');
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
