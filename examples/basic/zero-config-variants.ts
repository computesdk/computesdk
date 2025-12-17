/**
 * Zero-Config Variants Example
 * 
 * Shows different ways to use ComputeSDK with zero-config mode
 */

import { compute, createCompute } from 'computesdk';

async function main() {
  console.log('🚀 ComputeSDK Zero-Config Variants\n');

  // ============================================================================
  // Variant 1: Singleton `compute` (Recommended)
  // ============================================================================
  console.log('1️⃣  Using singleton compute instance:');
  const sandbox1 = await compute.sandbox.create();
  console.log(`   ✅ Sandbox created: ${sandbox1.sandboxId}`);
  await sandbox1.runCode('print("Hello from singleton!")');
  await sandbox1.destroy();
  console.log('   ✅ Destroyed\n');

  // ============================================================================
  // Variant 2: createCompute() with NO arguments
  // ============================================================================
  console.log('2️⃣  Using createCompute() with no arguments:');
  const myCompute = createCompute(); // Auto-detects from env
  const sandbox2 = await myCompute.sandbox.create();
  console.log(`   ✅ Sandbox created: ${sandbox2.sandboxId}`);
  await sandbox2.runCode('print("Hello from createCompute!")');
  await sandbox2.destroy();
  console.log('   ✅ Destroyed\n');

  // ============================================================================
  // Variant 3: Multiple compute instances (useful for testing)
  // ============================================================================
  console.log('3️⃣  Using multiple createCompute() instances:');
  const compute1 = createCompute();
  const compute2 = createCompute();
  
  const [sb1, sb2] = await Promise.all([
    compute1.sandbox.create(),
    compute2.sandbox.create()
  ]);
  
  console.log(`   ✅ Sandbox 1: ${sb1.sandboxId}`);
  console.log(`   ✅ Sandbox 2: ${sb2.sandboxId}`);
  
  await Promise.all([sb1.destroy(), sb2.destroy()]);
  console.log('   ✅ Both destroyed\n');

  // ============================================================================
  // Bonus: Enhanced features work with all variants
  // ============================================================================
  console.log('4️⃣  Enhanced features work automatically:');
  const sandbox3 = await createCompute().sandbox.create();
  
  // All enhanced features available
  const terminal = await sandbox3.createTerminal();
  console.log('   ✅ Terminal created');
  
  const watcher = await sandbox3.createWatcher('/home');
  console.log('   ✅ File watcher created');
  
  await sandbox3.filesystem.writeFile('/home/test.txt', 'Zero-config rocks!');
  const content = await sandbox3.filesystem.readFile('/home/test.txt');
  console.log(`   ✅ File content: ${content}`);
  
  await sandbox3.destroy();
  console.log('   ✅ Destroyed\n');

  console.log('🎉 All variants work perfectly!');
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
