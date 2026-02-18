/**
 * Example: Using Workbench with Full TypeScript Autocomplete
 * 
 * This shows how to get IDE-level TypeScript autocomplete when using ComputeSDK.
 * Run this file with: tsx src/workbench-typescript-example.ts
 */

import { createWorkbenchSession } from '@computesdk/workbench/helpers';

async function main() {
  console.log('Creating workbench session with full TypeScript autocomplete...\n');
  
  // Create a session - you get full TypeScript autocomplete here!
  const session = await createWorkbenchSession('e2b');
  
  console.log('✅ Session created!\n');
  console.log('Now try editing this file in VSCode/your IDE:');
  console.log('Type "session." and press Ctrl+Space to see autocomplete!\n');
  
  // Full TypeScript autocomplete for all these:
  const result1 = await session.sandbox.runCommand('pwd');
  console.log('Current directory:', result1.stdout);
  
  const result2 = await session.sandbox.runCommand('ls', ['-la']);
  console.log('\nDirectory listing:', result2.stdout);
  
  // You can also use the cmd helpers (they return Command arrays that need to be run)
  // Note: These would need to be executed via session.sandbox.runCommand
  console.log('\nExample command builders:');
  console.log('npm.install("express"):', session.npm.install('express'));
  console.log('git.clone("..."):', session.git.clone('https://github.com/user/repo'));
  
  // Cleanup
  await session.sandbox.destroy();
  console.log('\n✅ Session destroyed');
}

main().catch(console.error);
