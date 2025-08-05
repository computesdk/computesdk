/**
 * Vercel Sandbox Provider Example
 * 
 * This example shows how to use the Vercel provider for Node.js and Python code execution
 * with filesystem support.
 * 
 * Prerequisites:
 * - VERCEL_TOKEN environment variable
 * - VERCEL_TEAM_ID environment variable  
 * - VERCEL_PROJECT_ID environment variable
 */

import { vercel } from '@computesdk/vercel';
import { config } from 'dotenv';
config(); // Load environment variables from .env file

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
    // Create Vercel sandbox with filesystem support
    const sandbox = vercel({ runtime: 'node' });
    
    console.log('Created Vercel sandbox:', sandbox.sandboxId);
    console.log('Provider:', sandbox.provider);
    
    // Execute Node.js code
    const nodeResult = await sandbox.execute(`
console.log('Node.js version:', process.version);
console.log('Platform:', process.platform);

const data = [
  { id: 1, name: 'Alice', role: 'Developer' },
  { id: 2, name: 'Bob', role: 'Designer' }
];

console.log('\\nTeam Members:');
data.forEach(member => {
  console.log(\`- \${member.name} (\${member.role})\`);
});

console.log('\\nExecution complete!');
    `);
    
    console.log('Node.js Output:', nodeResult.stdout);
    console.log('Execution Time:', nodeResult.executionTime, 'ms');
    
    // Filesystem operations
    console.log('\n--- Filesystem Operations ---');
    
    // Write configuration file
    await sandbox.filesystem.writeFile('/tmp/config.json', JSON.stringify({
      app: 'Vercel Demo',
      version: '1.0.0'
    }, null, 2));
    
    // Execute Node.js script that uses the file
    const fileResult = await sandbox.execute(`
const fs = require('fs');

// Read configuration
const config = JSON.parse(fs.readFileSync('/tmp/config.json', 'utf8'));
console.log('Config loaded:', config.app, 'v' + config.version);

// Process data and write results
const results = { processed: true, timestamp: new Date().toISOString() };
fs.writeFileSync('/tmp/results.json', JSON.stringify(results, null, 2));

console.log('Results written to filesystem');
    `);
    
    console.log('Filesystem Output:', fileResult.stdout);
    
    // Read the results back
    const results = await sandbox.filesystem.readFile('/tmp/results.json');
    console.log('Results from filesystem:', JSON.parse(results));
    
    // Python example
    console.log('\n--- Python Execution ---');
    
    const pythonSandbox = vercel({ runtime: 'python' });
    const pythonResult = await pythonSandbox.execute(`
import json
import datetime

print(f"Current time: {datetime.datetime.now()}")

data = {"users": [{"name": "Alice", "age": 30}, {"name": "Bob", "age": 25}]}
print("\\nUser data:")
print(json.dumps(data, indent=2))

avg_age = sum(user["age"] for user in data["users"]) / len(data["users"])
print(f"\\nAverage age: {avg_age:.1f}")
    `);
    
    console.log('Python Output:', pythonResult.stdout);
    
    // Clean up
    await sandbox.kill();
    await pythonSandbox.kill();
    console.log('\nSandboxes cleaned up successfully');
    
  } catch (error) {
    console.error('Error:', error.message);
    if (error.message.includes('token') || error.message.includes('authentication')) {
      console.error('Please check your Vercel credentials');
      console.error('Get your token from https://vercel.com/account/tokens');
    }
  }
}

main();