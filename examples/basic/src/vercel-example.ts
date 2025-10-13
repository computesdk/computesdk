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
import { createCompute } from 'computesdk';
import { config } from 'dotenv';
import { NODEJS_SNIPPETS, PYTHON_SNIPPETS } from './constants/code-snippets';
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
    const compute = createCompute({ 
      provider: vercel({ 
        token: process.env.VERCEL_TOKEN,
        teamId: process.env.VERCEL_TEAM_ID,
        projectId: process.env.VERCEL_PROJECT_ID,
      }) 
    });
    
    // Create sandbox using compute singleton
    const sandbox = await compute.sandbox.create();
    
    console.log('Created Vercel sandbox:', sandbox.sandboxId);
    console.log('Provider:', sandbox.provider);
    
    // Execute Node.js code
    const nodeResult = await sandbox.runCode(NODEJS_SNIPPETS.HELLO_WORLD + '\n\n' + NODEJS_SNIPPETS.TEAM_PROCESSING);
    
    console.log('Node.js Output:', nodeResult.stdout);
    console.log('Execution Time:', nodeResult.executionTime, 'ms');
    
    // Note: Filesystem operations are not supported by Vercel's sandbox environment
    // console.log('\n--- Filesystem Operations ---');
    // console.log('Note: Filesystem operations are not supported by Vercel\'s sandbox environment.');
    // console.log('Vercel sandboxes are designed for code execution only.');
    
    // Python example
    console.log('\n--- Python Execution ---');

    // Instead, demonstrate in-memory data processing
    const pythonResult = await sandbox.runCode(PYTHON_SNIPPETS.HELLO_WORLD + '\n\n' + PYTHON_SNIPPETS.FIBONACCI);
    
    console.log('Python Output:', pythonResult.stdout);
    console.log('Execution time:', pythonResult.executionTime, 'ms');
    console.log('Exit code:', pythonResult.exitCode);
    
    
    // Clean up
    await sandbox.kill();
    console.log('\nSandboxes cleaned up successfully');
    
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error:', error.message);
      if (error.message.includes('token') || error.message.includes('authentication')) {
        console.error('Please check your Vercel credentials');
        console.error('Get your token from https://vercel.com/account/tokens');
      }
    } else {
      // Handle non-Error throw values (e.g., strings, numbers, plain objects)
      console.error('Unknown error:', error);
    }
  }
}

main();