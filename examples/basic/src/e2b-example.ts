/**
 * E2B Provider Example
 * 
 * This example shows how to use ComputeSDK with the E2B provider for Python code execution
 * with filesystem and terminal support.
 */

import { compute } from 'computesdk';
import { config } from 'dotenv';
import { PYTHON_SNIPPETS } from './constants/code-snippets';
config(); // Load environment variables from .env file

async function main() {
  if (!process.env.E2B_API_KEY) {
    console.error('Please set E2B_API_KEY environment variable');
    process.exit(1);
  }

  try {
    // Gateway mode: configure compute to use E2B provider
    // Note: If COMPUTESDK_API_KEY is set, this will auto-detect E2B from E2B_API_KEY
    // Otherwise, use setConfig for explicit configuration
    compute.setConfig({
      provider: 'e2b',
      apiKey: process.env.COMPUTESDK_API_KEY || 'local',
      e2b: { apiKey: process.env.E2B_API_KEY }
    });

    // Create sandbox
    const sandbox = await compute.sandbox.create();

    console.log('Created E2B sandbox:', sandbox.sandboxId);

    // Execute Python code
    const result = await sandbox.runCode(PYTHON_SNIPPETS.HELLO_WORLD + '\n\n' + PYTHON_SNIPPETS.FIBONACCI);

    console.log('Output:', result.output);
    console.log('Exit code:', result.exitCode);
    console.log('Language:', result.language);

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
    await sandbox.destroy();
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
