/**
 * Cloudflare Containers Provider Example
 * 
 * This example shows how to use the Cloudflare provider for code execution
 * in Cloudflare Workers with Durable Objects.
 * 
 * Note: Cloudflare provider requires running within a Cloudflare Worker
 * environment with access to the Sandbox Durable Object namespace.
 */

import { cloudflare } from '@computesdk/cloudflare';
import { executeSandbox, BaseComputeSandbox } from 'computesdk';
import { config } from 'dotenv';
config(); // Load environment variables from .env file

// This would typically be part of your Worker code
interface Env {
  SANDBOX: DurableObjectNamespace;
}

async function main() {
  console.log('Cloudflare Provider Example');
  console.log('===========================\n');
  
  console.log('⚠️  Note: Cloudflare provider requires a Workers environment.');
  console.log('This example shows the intended API usage.\n');
  
  // In a real Cloudflare Worker, you would get env from the request handler
  // For example: export default { async fetch(request, env, ctx) { ... } }
  const mockEnv = {} as Env;
  
  try {
    // Create Cloudflare sandbox - requires env with SANDBOX namespace
    // In a real Worker: const sandbox = cloudflare({ env });
    const pythonSandbox: BaseComputeSandbox = cloudflare({
      env: mockEnv,
      runtime: 'python'
    });
    
    console.log('Created Cloudflare Python sandbox:', pythonSandbox.sandboxId);
    console.log('Provider:', pythonSandbox.provider);
    
    // Execute Python code in the sandbox
    const pythonResult = await executeSandbox({
      sandbox: pythonSandbox,
      code: `
print("Hello from Cloudflare Workers!")
print("Running Python in the edge network")

# Example: Process some data at the edge
data = [1, 2, 3, 4, 5]
squared = [x**2 for x in data]
print(f"Original: {data}")
print(f"Squared: {squared}")
      `.trim(),
      runtime: 'python'
    });
    
    console.log('\nPython Output:', pythonResult.stdout);
    console.log('Exit Code:', pythonResult.exitCode);
    console.log('Execution Time:', pythonResult.executionTime, 'ms');
    
    // Create Node.js sandbox
    const nodeSandbox: BaseComputeSandbox = cloudflare({
      env: mockEnv,
      runtime: 'node'
    });
    
    console.log('\n--- Node.js Execution ---');
    console.log('Created Node.js sandbox:', nodeSandbox.sandboxId);
    
    // Execute Node.js code
    const nodeResult = await executeSandbox({
      sandbox: nodeSandbox,
      code: `
console.log('Hello from Cloudflare Workers!');
console.log('Node.js running at the edge');

// Example: JSON processing at the edge
const users = [
  { id: 1, name: 'Alice', location: 'US' },
  { id: 2, name: 'Bob', location: 'EU' },
  { id: 3, name: 'Charlie', location: 'APAC' }
];

const byLocation = users.reduce((acc, user) => {
  acc[user.location] = (acc[user.location] || 0) + 1;
  return acc;
}, {});

console.log('\\nUsers by location:', byLocation);
      `.trim(),
      runtime: 'node'
    });
    
    console.log('Node.js Output:', nodeResult.stdout);
    console.log('Provider:', nodeResult.provider);
    console.log('Sandbox ID:', nodeResult.sandboxId);
    
    // Get sandbox info
    const info = await nodeSandbox.getInfo();
    console.log('\nSandbox Info:', {
      id: info.id,
      runtime: info.runtime,
      status: info.status,
      provider: info.provider
    });
    
    // Note about Cloudflare's capabilities
    console.log('\n--- Cloudflare Workers Context ---');
    console.log('Cloudflare sandboxes run in the Workers environment:');
    console.log('- Ultra-low latency execution at the edge');
    console.log('- Runs close to your users globally');
    console.log('- Integrated with Cloudflare\'s security features');
    console.log('- Currently provides BaseComputeSandbox functionality');
    
    // Example of how it would be used in a Worker
    console.log('\n--- Example Worker Code ---');
    console.log(`
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const sandbox = cloudflare({ env });
    const result = await executeSandbox({
      sandbox,
      code: 'print("Hello from the edge!")',
      runtime: 'python'
    });
    
    return new Response(result.stdout);
  }
};
    `.trim());
    
    // Clean up
    await pythonSandbox.kill();
    await nodeSandbox.kill();
    console.log('\nSandboxes cleaned up successfully');
    
  } catch (error) {
    console.error('Error:', error.message);
    if (error.message.includes('Workers environment')) {
      console.error('\nThis example must be run within a Cloudflare Worker.');
      console.error('Deploy this code to Cloudflare Workers to see it in action.');
    }
  }
}

// In a real Worker, this would be called from the fetch handler
main();