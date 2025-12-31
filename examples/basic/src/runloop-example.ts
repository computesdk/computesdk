/**
 * Runloop Provider Example
 * 
 * This example shows how to use ComputeSDK with the Runloop provider for Python code execution
 * with filesystem support (but without terminal methods as Runloop doesn't expose terminals in the same way).
 */

import { compute } from 'computesdk';
import { config } from 'dotenv';
import { PYTHON_SNIPPETS } from './constants/code-snippets';
config(); // Load environment variables from .env file

async function main() {
  if (!process.env.RUNLOOP_API_KEY) {
    console.error('Please set RUNLOOP_API_KEY environment variable');
    process.exit(1);
  }

  try {
    // Gateway mode: configure compute to use Runloop provider
    compute.setConfig({
      provider: 'runloop',
      apiKey: process.env.COMPUTESDK_API_KEY || 'local',
      runloop: { apiKey: process.env.RUNLOOP_API_KEY }
    });

    // Create sandbox
    const sandbox = await compute.sandbox.create();

    console.log('Created Runloop sandbox:', sandbox.sandboxId);

    // Execute Python code
    const result = await sandbox.runCode(PYTHON_SNIPPETS.HELLO_WORLD + '\n\n' + PYTHON_SNIPPETS.FIBONACCI);

    console.log('Output:', result.output);
    console.log('Exit code:', result.exitCode);

    // Filesystem operations
    console.log('\n--- Filesystem Operations ---');

    // Create directory first and write a Python script
    await sandbox.filesystem.mkdir('/tmp');
    await sandbox.filesystem.writeFile('/tmp/script.py', PYTHON_SNIPPETS.FILE_PROCESSOR);

    const scriptResult = await sandbox.runCommand('python3', ['/tmp/script.py']);
    console.log('Script output:', scriptResult.stdout);

    // Create directory and list files
    await sandbox.filesystem.mkdir('/tmp/data');
    const files = await sandbox.filesystem.readdir('/tmp');
    console.log('Files in /tmp:', files.map(f => f.name));

    // Clean up
    await sandbox.destroy();
    console.log('\nSandbox cleaned up successfully');

  } catch (error: any) {
    console.error('Error:', error.message);
    if (error.message.includes('API key')) {
      console.error('Get your Runloop API key from https://runloop.ai/');
    }
  }
}

main();