/**
 * Vercel Sandbox Provider Example
 * 
 * This example shows how to use the Vercel provider for Node.js and Python code execution.
 * 
 * Note: Filesystem operations are not yet implemented for Vercel provider.
 * Use E2B or Daytona providers for reliable filesystem support.
 * 
 * Prerequisites:
 * - VERCEL_TOKEN environment variable
 * - VERCEL_TEAM_ID environment variable  
 * - VERCEL_PROJECT_ID environment variable
 */

import { vercel } from '@computesdk/vercel';
import { compute } from 'computesdk';
import { config } from 'dotenv';
import { NODEJS_SNIPPETS } from './constants/code-snippets';
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
    // Configure compute with Vercel provider
    compute.setConfig({ 
      provider: vercel({ 
        token: process.env.VERCEL_TOKEN,
        teamId: process.env.VERCEL_TEAM_ID,
        projectId: process.env.VERCEL_PROJECT_ID,
        runtime: 'node' 
      }) 
    });
    
    // Create sandbox using compute singleton
    const sandbox = await compute.sandbox.create({});
    
    console.log('Created Vercel sandbox:', sandbox.sandboxId);
    console.log('Provider:', sandbox.provider);
    
    // Execute Node.js code
    const nodeResult = await sandbox.runCode(NODEJS_SNIPPETS.HELLO_WORLD + '\n\n' + NODEJS_SNIPPETS.TEAM_PROCESSING);
    
    console.log('Node.js Output:', nodeResult.stdout);
    console.log('Execution Time:', nodeResult.executionTime, 'ms');
    
    // Note: Filesystem operations are not supported by Vercel's sandbox environment
    console.log('\n--- Filesystem Operations ---');
    console.log('Note: Filesystem operations are not supported by Vercel\'s sandbox environment.');
    console.log('Vercel sandboxes are designed for code execution only.');
    
    // Instead, demonstrate in-memory data processing
    const dataResult = await sandbox.runCode(`
// In-memory data processing example
const config = { app: 'Vercel Demo', version: '1.0.0' };
console.log('Config loaded:', config.app, 'v' + config.version);

// Process data in memory
const results = { processed: true, timestamp: new Date().toISOString() };
console.log('Results processed:', JSON.stringify(results, null, 2));
    `);
    
    console.log('Data Processing Output:', dataResult.stdout);
    
    // Python example
    console.log('\n--- Python Execution ---');
    
    // Create Python sandbox using compute singleton
    compute.setConfig({ provider: vercel({ runtime: 'python' }) });
    const pythonSandbox = await compute.sandbox.create({});
    const pythonResult = await pythonSandbox.runCode(`
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