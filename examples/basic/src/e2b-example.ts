/**
 * E2B Provider Example
 * 
 * This example shows how to use the E2B provider for Python code execution
 * with filesystem and terminal support.
 */

import { e2b } from '@computesdk/e2b';
import { createCompute } from 'computesdk';
import { config } from 'dotenv';
import { PYTHON_SNIPPETS } from './constants/code-snippets';
config(); // Load environment variables from .env file

async function main() {
  if (!process.env.E2B_API_KEY) {
    console.error('Please set E2B_API_KEY environment variable');
    process.exit(1);
  }

  try {
    // Configure compute with E2B provider
    const compute = createCompute({ provider: e2b({ apiKey: process.env.E2B_API_KEY }) });

    // Create sandbox using compute singleton
    const sandbox = await compute.sandbox.create();

    console.log('Created E2B sandbox:', sandbox.sandboxId);

    // Execute Python code
    const result = await sandbox.runCode(PYTHON_SNIPPETS.HELLO_WORLD + '\n\n' + PYTHON_SNIPPETS.FIBONACCI);

    console.log('Output:', result.stdout);
    console.log('Execution time:', result.executionTime, 'ms');

    // Filesystem operations
    console.log('\n--- Filesystem Operations ---');

    // Write and execute a Python script
    await sandbox.filesystem.writeFile('/tmp/script.py', PYTHON_SNIPPETS.FILE_PROCESSOR);

    const scriptResult = await sandbox.runCommand('python', ['/tmp/script.py']);
    console.log('Script output:', scriptResult.stdout);

    // Create directory and list files
    await sandbox.filesystem.mkdir('/tmp/data');
    const files = await sandbox.filesystem.readdir('/tmp');
    console.log('Files in /tmp:', files.map(f => f.name));

    // Clean up
    await sandbox.kill();
    console.log('\nSandbox cleaned up successfully');

  } catch (error) {
    if (error instanceof Error) {
      console.error('Error:', error.message);
      if (error.message.includes('API key')) {
        console.error('Get your E2B API key from https://e2b.dev/');
      }
    } else {
      console.error('Unknown error:', error);
    }
  }
}

main();
