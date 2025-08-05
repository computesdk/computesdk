/**
 * Vercel Sandbox Provider Example
 * 
 * This example shows how to use the Vercel provider for Node.js and Python code execution.
 * 
 * Prerequisites:
 * - VERCEL_TOKEN environment variable
 * - VERCEL_TEAM_ID environment variable  
 * - VERCEL_PROJECT_ID environment variable
 */

import { vercel } from '@computesdk/vercel';
import { executeSandbox, BaseComputeSandbox } from 'computesdk';
import { config } from 'dotenv';
config({ path: '.env.local' }); // This loads the .env file

async function main() {
  // Inside your TypeScript file
  console.log('VERCEL_TOKEN:', process.env.VERCEL_TOKEN);
  console.log('VERCEL_TEAM_ID:', process.env.VERCEL_TEAM_ID);
  console.log('VERCEL_PROJECT_ID:', process.env.VERCEL_PROJECT_ID);
  
  // Check required environment variables
  if (!process.env.VERCEL_TOKEN) {
    console.error('Please set VERCEL_TOKEN environment variable');
    console.error('Get your token from https://vercel.com/account/tokens');
    process.exit(1);
  }
  
  if (!process.env.VERCEL_TEAM_ID) {
    console.error('Please set VERCEL_TEAM_ID environment variable');
    process.exit(1);
  }
  
  if (!process.env.VERCEL_PROJECT_ID) {
    console.error('Please set VERCEL_PROJECT_ID environment variable');
    process.exit(1);
  }
  
  try {
    // Create Vercel sandbox (defaults to Node.js)
    // Vercel returns a BaseComputeSandbox (no filesystem/terminal support yet)
    const nodeSandbox: BaseComputeSandbox = vercel();
    
    console.log('Created Vercel sandbox:', nodeSandbox.sandboxId);
    console.log('Provider:', nodeSandbox.provider);
    
    // Execute Node.js code
    const nodeResult = await executeSandbox({
      sandbox: nodeSandbox,
      code: `
console.log('Node.js version:', process.version);
console.log('Platform:', process.platform);

// Create a simple HTTP server simulation
const data = [
  { id: 1, name: 'Alice', role: 'Developer' },
  { id: 2, name: 'Bob', role: 'Designer' },
  { id: 3, name: 'Charlie', role: 'Manager' }
];

console.log('\\nTeam Members:');
data.forEach(member => {
  console.log(\`- \${member.name} (\${member.role})\`);
});

// Async example
async function fetchData() {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve('Data fetched successfully!');
    }, 100);
  });
}

fetchData().then(result => console.log('\\n' + result));
      `.trim()
    });
    
    console.log('Node.js Output:', nodeResult.stdout);
    console.log('Exit Code:', nodeResult.exitCode);
    console.log('Execution Time:', nodeResult.executionTime, 'ms');
    
    // Get sandbox info
    const nodeInfo = await nodeSandbox.getInfo();
    console.log('\nSandbox Info:', {
      id: nodeInfo.id,
      runtime: nodeInfo.runtime,
      status: nodeInfo.status,
      timeout: nodeInfo.timeout
    });
    
    // Create Python sandbox
    const pythonSandbox: BaseComputeSandbox = vercel({ runtime: 'python' });
    
    console.log('\n--- Python Execution ---');
    console.log('Created Python sandbox:', pythonSandbox.sandboxId);
    
    // Execute Python code
    const pythonResult = await executeSandbox({
      sandbox: pythonSandbox,
      code: `
import json
import datetime

print(f"Current time: {datetime.datetime.now()}")

# JSON processing example
data = {
    "users": [
        {"name": "Alice", "age": 30},
        {"name": "Bob", "age": 25},
        {"name": "Charlie", "age": 35}
    ]
}

print("\\nUser data:")
print(json.dumps(data, indent=2))

# Calculate average age
ages = [user["age"] for user in data["users"]]
avg_age = sum(ages) / len(ages)
print(f"\\nAverage age: {avg_age:.1f}")
      `.trim(),
      runtime: 'python'
    });
    
    console.log('Python Output:', pythonResult.stdout);
    console.log('Provider:', pythonResult.provider);
    
    // Note: Vercel sandboxes don't currently support filesystem/terminal operations
    console.log('\n--- Note on Advanced Features ---');
    console.log('Vercel sandboxes currently provide BaseComputeSandbox functionality.');
    console.log('Filesystem and terminal operations are not yet available.');
    console.log('Use E2B provider for full filesystem/terminal support.');
    
    // Clean up
    await nodeSandbox.kill();
    await pythonSandbox.kill();
    console.log('\nSandboxes cleaned up successfully');
    
  } catch (error) {
    console.error('Error:', error.message);
    if (error.name === 'AuthenticationError') {
      console.error('Please check your Vercel credentials');
    }
  }
}

main();