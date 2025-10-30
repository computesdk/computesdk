/**
 * Daytona Provider Example
 * 
 * This example shows how to use the Daytona provider for Python code execution
 * with filesystem support (but without terminal methods).
 * 
 * Prerequisites:
 * Set DAYTONA_API_KEY environment variable
 */

import { daytona } from '@computesdk/daytona';
import { createCompute } from 'computesdk';
import { config } from 'dotenv';
import { PYTHON_SNIPPETS } from './constants/code-snippets';
config(); // Load environment variables from .env file

async function main() {
  console.log('Daytona Provider Example');
  console.log('========================\n');
  
  if (!process.env.DAYTONA_API_KEY) {
    console.error('Please set DAYTONA_API_KEY environment variable');
    console.error('Get your Daytona API key from https://daytona.io/\n');
    process.exit(1);
  }

  try {
    // Configure compute with Daytona provider
    const compute = createCompute({ provider: daytona({ apiKey: process.env.DAYTONA_API_KEY }) });

    // Create sandbox using compute singleton
    const sandbox = await compute.sandbox.create();

    console.log('Created Daytona sandbox:', sandbox.sandboxId);

    

    // Execute Python code
    const result = await sandbox.runCode(PYTHON_SNIPPETS.HELLO_WORLD + '\n\n' + PYTHON_SNIPPETS.FIBONACCI);

    console.log('Output:', result.stdout);
    console.log('Execution time:', result.executionTime, 'ms');
    console.log('Exit code:', result.exitCode);

    // Get sandbox info
    const info = await sandbox.getInfo();
    console.log('\nSandbox Info:', {
      id: info.id,
      runtime: info.runtime,
      status: info.status,
      provider: info.provider
    });

    // Filesystem operations
    console.log('\n--- Filesystem Operations ---');

    // Write and execute a Python script
    await sandbox.filesystem.writeFile('/tmp/script.py', `
def greet(name):
    return f"Hello, {name}!"

print(greet("Daytona"))
print("This script was written via filesystem!")
    `);

    const scriptResult = await sandbox.runCommand('python', ['/tmp/script.py']);
    console.log('Script output:', scriptResult.stdout);

    // Create directory and list files
    await sandbox.filesystem.mkdir('/tmp/data');
    const files = await sandbox.filesystem.readdir('/tmp');
    console.log('Files in /tmp:', files.map((f: any) => f.name));

    // Clean up
    await sandbox.kill();
    console.log('\nDaytona sandbox terminated successfully');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('❌ Error:', errorMessage);
    
    if (errorMessage.includes('API key') || errorMessage.includes('authentication')) {
      console.error('\n💡 Authentication failed:');
      console.error('- Get your Daytona API key from https://daytona.io/');
      console.error('- Set it as: export DAYTONA_API_KEY=your_key_here');
    } else if (errorMessage.includes('quota') || errorMessage.includes('limit')) {
      console.error('\n💡 Usage limit reached:');
      console.error('- Check your Daytona usage dashboard');
      console.error('- Consider upgrading your plan if needed');
    } else if (errorMessage.includes('not implemented')) {
      console.error('\n💡 Feature not yet implemented:');
      console.error('- Some Daytona features are still in development');
      console.error('- Check the Daytona documentation for current capabilities');
    } else {
      console.error('\n💡 For help with Daytona setup:');
      console.error('- Visit: https://daytona.io/docs');
      console.error('- Check your network connection');
      console.error('- Verify your API key is valid');
    }
  }
}

main();