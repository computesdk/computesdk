/**
 * Modal Provider Example
 * 
 * This example shows how to use ComputeSDK with the Modal provider for Python and Node.js code execution
 * with filesystem support.
 */

import { compute } from 'computesdk';
import { modal } from '@computesdk/modal';
import { PYTHON_SNIPPETS, NODEJS_SNIPPETS } from './constants/code-snippets';

async function main() {
  try {
    compute.setConfig({
      provider: modal()
    });

    // Create a Python sandbox
    console.log('Creating Modal sandbox for Python...');
    const sandbox = await compute.sandbox.create();

    console.log('Created Modal sandbox:', sandbox.sandboxId);

    // Execute Python code
    console.log('\n--- Python Execution ---');
    await sandbox.filesystem.writeFile('/tmp/hello.py', PYTHON_SNIPPETS.HELLO_WORLD + '\n\n' + PYTHON_SNIPPETS.FIBONACCI);
    const pythonResult = await sandbox.runCommand('python3 /tmp/hello.py');

    console.log('Python Output:', pythonResult.stdout);
    console.log('Exit code:', pythonResult.exitCode);

    // Filesystem operations
    console.log('\n--- Filesystem Operations ---');

    // Write and execute a Python script
    await sandbox.filesystem.writeFile('/tmp/script.py', PYTHON_SNIPPETS.FILE_PROCESSOR);

    const scriptResult = await sandbox.runCommand('python3 /tmp/script.py');
    console.log('Script output:', scriptResult.stdout);

    // Create directory and list files
    await sandbox.filesystem.mkdir('/tmp/data');
    const files = await sandbox.filesystem.readdir('/tmp');
    console.log('Files in /tmp:', files.map(f => f.name));

    // Node.js execution
    console.log('\n--- Node.js Execution ---');

    // Create a second sandbox for Node.js
    const nodeSandbox = await compute.sandbox.create();
    console.log('Created Node.js sandbox:', nodeSandbox.sandboxId);

    await nodeSandbox.filesystem.writeFile('/tmp/script.js', NODEJS_SNIPPETS.HELLO_WORLD + '\n\n' + NODEJS_SNIPPETS.TEAM_PROCESSING);
    const nodeResult = await nodeSandbox.runCommand('node /tmp/script.js');
    console.log('Node.js Output:', nodeResult.stdout);

    // Clean up
    await sandbox.destroy();
    await nodeSandbox.destroy();
    console.log('\nSandboxes cleaned up successfully');

  } catch (error) {
    if (error instanceof Error) {
      console.error('Error:', error.message);
      if (error.message.includes('token')) {
        console.error('Get your Modal token from https://modal.com/');
        console.error('Run: modal token new');
      }
    } else {
      console.error('An unknown error occurred:', error);
    }
  }
}

main();