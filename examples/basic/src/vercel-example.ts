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
import { executeSandbox } from 'computesdk';

async function main() {
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
    const nodeSandbox = vercel();
    
    console.log('Created Vercel sandbox:', nodeSandbox.sandboxId);
    
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
    
    // Create Python sandbox
    const pythonSandbox = vercel({ runtime: 'python' });
    
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
      `.trim()
    });
    
    console.log('\nPython Output:', pythonResult.stdout);
    
    // Clean up
    await nodeSandbox.kill();
    await pythonSandbox.kill();
    console.log('\nSandboxes cleaned up successfully');
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();