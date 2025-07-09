/**
 * Vercel Sandbox Provider Example
 * 
 * ⚠️  MOCK IMPLEMENTATION - This provider is not yet fully implemented.
 * This example shows the intended API for the Vercel provider.
 * Currently returns mock responses instead of executing real code.
 * 
 * TODO: Implement real Vercel Sandbox API integration
 */

import { vercel } from '@computesdk/vercel';
import { executeSandbox } from 'computesdk';

async function main() {
  console.log('⚠️  Note: This is a MOCK implementation!');
  console.log('The Vercel provider is not yet fully implemented.');
  console.log('This example shows the intended API and returns mock responses.\n');
  
  // Make sure VERCEL_TOKEN is set in environment variables (for future implementation)
  if (!process.env.VERCEL_TOKEN) {
    console.log('💡 For the real implementation, you will need:');
    console.log('export VERCEL_TOKEN=your_vercel_token_here\n');
    
    // Continue with mock for demonstration
    process.env.VERCEL_TOKEN = 'mock_token_for_demo';
  }
  
  try {
    // Create Vercel sandbox (defaults to Node.js)
    const nodeSandbox = vercel();
    
    console.log('Created Vercel sandbox (MOCK):', nodeSandbox.sandboxId);
    
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
    const pythonSandbox = vercel('python');
    
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