/**
 * CodeSandbox Provider Example
 * 
 * This example shows how to use the CodeSandbox provider for Python code execution
 * with filesystem support (but without terminal methods as CodeSandbox doesn't expose terminals in the same way).
 */

import { codesandbox } from '@computesdk/codesandbox';
import { createCompute } from 'computesdk';
import { config } from 'dotenv';
import { PYTHON_SNIPPETS } from './constants/code-snippets';
config(); // Load environment variables from .env file

async function main() {
  if (!process.env.CSB_API_KEY) {
    console.error('Please set CSB_API_KEY environment variable');
    process.exit(1);
  }

  try {
    // Configure compute with CodeSandbox provider
    const compute = createCompute({ provider: codesandbox({ apiKey: process.env.CSB_API_KEY }) });

    // Create sandbox using compute singleton
    const sandbox = await compute.sandbox.create();

    console.log('Created CodeSandbox sandbox:', sandbox.sandboxId);

    // Execute Python code
    const result = await sandbox.runCode(PYTHON_SNIPPETS.HELLO_WORLD + '\n\n' + PYTHON_SNIPPETS.FIBONACCI);

    console.log('Output:', result.stdout);
    console.log('Execution time:', result.executionTime, 'ms');

    // Filesystem operations
    console.log('\n--- Filesystem Operations ---');

    // Write and execute a Python script
    await sandbox.filesystem.writeFile('/project/workspace/script.py', PYTHON_SNIPPETS.FILE_PROCESSOR);

    const scriptResult = await sandbox.runCommand('python', ['/project/workspace/script.py']);
    console.log('Script output:', scriptResult.stdout);

    // Create directory and list files
    await sandbox.filesystem.mkdir('/project/workspace/data');
    const files = await sandbox.filesystem.readdir('/project/workspace');
    console.log('Files in /project/workspace:', files.map(f => f.name));

    // Clean up
    await sandbox.kill();
    console.log('\nSandbox cleaned up successfully');

  } catch (error: any) {
    console.error('Error:', error.message);
    if (error.message.includes('API key')) {
      console.error('Get your CodeSandbox API key from https://codesandbox.io/t/api');
    }
  }
}

main();