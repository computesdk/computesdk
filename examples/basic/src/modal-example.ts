/**
 * Modal Provider Example
 * 
 * This example shows how to use the Modal provider for Python and Node.js code execution
 * with filesystem support.
 */

import { modal } from '@computesdk/modal';
import { config } from 'dotenv';
import { PYTHON_SNIPPETS, NODEJS_SNIPPETS } from './constants/code-snippets';
config(); // Load environment variables from .env file

async function main() {
  if (!process.env.MODAL_TOKEN_ID || !process.env.MODAL_TOKEN_SECRET) {
    console.error('Please set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET environment variables');
    console.error('Run: modal token new');
    process.exit(1);
  }

  try {
    // Direct mode: use Modal provider directly
    const compute = modal({ 
      tokenId: process.env.MODAL_TOKEN_ID,
      tokenSecret: process.env.MODAL_TOKEN_SECRET 
    });

    // Create sandbox - auto-detects Python runtime
    console.log('Creating Modal sandbox for Python...');
    const sandbox = await compute.sandbox.create();

    console.log('Created Modal sandbox:', sandbox.sandboxId);

    // Execute Python code
    console.log('\n--- Python Execution ---');
    const pythonResult = await sandbox.runCode(PYTHON_SNIPPETS.HELLO_WORLD + '\n\n' + PYTHON_SNIPPETS.FIBONACCI);

    console.log('Python Output:', pythonResult.output);
    console.log('Exit code:', pythonResult.exitCode);

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

    // Node.js execution
    console.log('\n--- Node.js Execution ---');
    
    // Create a Node.js sandbox
    const nodeSandbox = await compute.sandbox.create({ options: { runtime: 'node' } });
    console.log('Created Node.js sandbox:', nodeSandbox.sandboxId);
    
    const nodeResult = await nodeSandbox.runCode(NODEJS_SNIPPETS.HELLO_WORLD + '\n\n' + NODEJS_SNIPPETS.TEAM_PROCESSING);
    console.log('Node.js Output:', nodeResult.output);

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