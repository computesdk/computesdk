/**
 * Fly.io Machines Provider Example
 * 
 * ⚠️  MOCK IMPLEMENTATION - This provider is not yet fully implemented.
 * This example shows the intended API for the Fly.io provider.
 * Currently returns mock responses instead of executing real code.
 * 
 * TODO: Implement real Fly.io Machines API integration
 */

import { fly } from '@computesdk/fly';
import { executeSandbox, createComputeRegistry } from 'computesdk';

async function main() {
  console.log('⚠️  Note: This is a MOCK implementation!');
  console.log('The Fly.io provider is not yet fully implemented.');
  console.log('This example shows the intended API and returns mock responses.\n');
  
  // Make sure FLY_API_TOKEN is set (for future implementation)
  if (!process.env.FLY_API_TOKEN) {
    console.log('💡 For the real implementation, you will need:');
    console.log('export FLY_API_TOKEN=your_fly_token_here\n');
    
    // Continue with mock for demonstration
    process.env.FLY_API_TOKEN = 'mock_token_for_demo';
  }
  
  try {
    // Example 1: Basic Python container
    const pythonSandbox = fly({
      container: 'python:3.11-slim'
    });
    
    console.log('Created Fly.io Python machine:', pythonSandbox.sandboxId);
    
    const pythonResult = await executeSandbox({
      sandbox: pythonSandbox,
      code: `
import time
start = time.time()
print(f"Machine booted in {time.time() - start:.3f}s")
print("Hello from Fly.io machine!")
print(f"Running Python {__import__('sys').version.split()[0]}")
      `.trim(),
      runtime: 'python'
    });
    
    console.log('Python Output:', pythonResult.stdout);
    console.log('Total execution time:', pythonResult.executionTime, 'ms');
    
    // Example 2: High-performance Node.js container
    const nodeSandbox = fly({
      container: {
        image: 'node:20-alpine',
        env: {
          NODE_ENV: 'production',
          FLY_REGION: process.env.FLY_REGION || 'iad'
        }
      }
    });
    
    const nodeResult = await executeSandbox({
      sandbox: nodeSandbox,
      code: `
const start = Date.now();
console.log(\`Machine ready in \${Date.now() - start}ms\`);
console.log('Region:', process.env.FLY_REGION);
console.log('Node.js version:', process.version);

// Simulate CPU-intensive task
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

console.time('fibonacci');
const result = fibonacci(35);
console.timeEnd('fibonacci');
console.log('Result:', result);
      `.trim(),
      runtime: 'node'
    });
    
    console.log('\nNode.js Output:', nodeResult.stdout);
    
    // Example 3: Using registry for multiple providers
    const registry = createComputeRegistry({
      fly,
      // You can add other providers here if needed
    });
    
    // Use registry to create sandbox by ID
    const registrySandbox = registry.sandbox('fly:python:3.11');
    
    const registryResult = await executeSandbox({
      sandbox: registrySandbox,
      code: 'print("Created via registry!")'
    });
    
    console.log('\nRegistry Output:', registryResult.stdout);
    
    // Clean up all sandboxes
    await pythonSandbox.kill();
    await nodeSandbox.kill();
    await registrySandbox.kill();
    console.log('\nAll Fly.io machines terminated successfully');
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();