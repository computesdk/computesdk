/**
 * Blaxel Provider Example
 * 
 * This example shows how to use ComputeSDK with the Blaxel provider for Python and Node.js code execution
 * with AI-powered optimization and fast boot times.
 */

import { compute } from 'computesdk';
import { config } from 'dotenv';
import { PYTHON_SNIPPETS, NODEJS_SNIPPETS } from './constants/code-snippets';
config(); // Load environment variables from .env file

async function main() {
  // Check required environment variables
  if (!process.env.BL_API_KEY || !process.env.BL_WORKSPACE) {
    console.error('❌ Missing required environment variables:');
    console.error('- BL_API_KEY: API key from Blaxel dashboard');
    console.error('- BL_WORKSPACE: Your Blaxel workspace name');
    console.error('\nPlease set both environment variables and try again.');
    process.exit(1);
  }

  try {
    // Gateway mode: configure compute to use Blaxel provider
    compute.setConfig({
      provider: 'blaxel',
      apiKey: process.env.COMPUTESDK_API_KEY || 'local',
      blaxel: {
        apiKey: process.env.BL_API_KEY,
        workspace: process.env.BL_WORKSPACE
      }
    });

    // Create Python sandbox
    console.log('🚀 Creating Blaxel sandbox for Python...');
    
    try {
      const sandbox = await compute.sandbox.create({ runtime: 'python' });
      console.log('✅ Created Blaxel sandbox:', sandbox.sandboxId);

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
      const nodeSandbox = await compute.sandbox.create({ runtime: 'node' });
      console.log('Created Node.js sandbox:', nodeSandbox.sandboxId);
      
      const nodeResult = await nodeSandbox.runCode(NODEJS_SNIPPETS.HELLO_WORLD + '\n\n' + NODEJS_SNIPPETS.TEAM_PROCESSING);
      console.log('Node.js Output:', nodeResult.output);

      // Clean up
      await sandbox.destroy();
      await nodeSandbox.destroy();
      console.log('\n✅ Sandboxes cleaned up successfully');

    } catch (sandboxError) {
      console.error('\n❌ Error during sandbox creation/execution:');
      console.error('Error type:', typeof sandboxError);
      console.error('Error constructor:', sandboxError?.constructor?.name);
      
      if (sandboxError instanceof Error) {
        console.error('Error message:', sandboxError.message);
        console.error('Error stack:', sandboxError.stack);
      } else {
        console.error('Raw error object:', sandboxError);
        console.error('Error JSON:', JSON.stringify(sandboxError, null, 2));
        
        // Try to extract useful information from the error object
        if (typeof sandboxError === 'object' && sandboxError !== null) {
          console.error('Error properties:');
          for (const [key, value] of Object.entries(sandboxError)) {
            console.error(`  ${key}:`, value);
          }
        }
      }
      
      throw sandboxError; // Re-throw to be caught by outer try-catch
    }

  } catch (error) {
    console.error('\n💥 Detailed Error Analysis:');
    console.error('==========================================');
    console.error('Error type:', typeof error);
    console.error('Error constructor:', error?.constructor?.name);
    console.error('Is Error instance:', error instanceof Error);
    
    if (error instanceof Error) {
      console.error('\n📋 Error Details:');
      console.error('Message:', error.message);
      console.error('Name:', error.name);
      console.error('Stack:', error.stack);
      
      // Check for common error patterns
      if (error.message.includes('unauthorized') || error.message.includes('401')) {
        console.error('\n🔐 Authentication Issue Detected:');
        console.error('- Check your BLAXEL_API_KEY is correct');
        console.error('- Verify the API key has proper permissions');
        console.error('- Get your Blaxel API key from https://blaxel.com/');
      } else if (error.message.includes('workspace') || error.message.includes('404')) {
        console.error('\n🏢 Workspace Issue Detected:');
        console.error('- Check your BLAXEL_WORKSPACE is correct');
        console.error('- Verify the workspace exists and you have access');
      } else if (error.message.includes('network') || error.message.includes('ENOTFOUND')) {
        console.error('\n🌐 Network Issue Detected:');
        console.error('- Check your internet connection');
        console.error('- Verify Blaxel API is accessible');
      } else if (error.message.includes('quota') || error.message.includes('limit')) {
        console.error('\n📊 Usage Limit Issue Detected:');
        console.error('- Check your Blaxel usage dashboard');
        console.error('- Consider upgrading your plan if needed');
      }
    } else {
      console.error('\n🔍 Non-Error Object Analysis:');
      console.error('Raw error:', error);
      
      // Try to serialize the error object
      try {
        const serialized = JSON.stringify(error, null, 2);
        console.error('Serialized error:', serialized);
      } catch (serializationError: unknown) {
        const errorMessage = serializationError instanceof Error 
          ? serializationError.message 
          : String(serializationError);
        console.error('Could not serialize error:', errorMessage);
        
        // Manual property inspection
        if (typeof error === 'object' && error !== null) {
          console.error('Error object properties:');
          try {
            for (const [key, value] of Object.entries(error)) {
              console.error(`  ${key}:`, typeof value === 'object' ? JSON.stringify(value) : value);
            }
          } catch (inspectionError) {
            const errorMessage = inspectionError instanceof Error 
              ? inspectionError.message 
              : String(inspectionError);
            console.error('Error inspecting properties:', errorMessage);
          }
        }
      }
    }
    
    console.error('\n🔧 Troubleshooting Steps:');
    console.error('1. Verify environment variables are set correctly');
    console.error('2. Check Blaxel API status at https://status.blaxel.com/');
    console.error('3. Try running the Blaxel package tests: `npm test` in packages/blaxel/');
    console.error('4. Check Blaxel documentation: https://docs.blaxel.com/');
    
    process.exit(1);
  }
}

main();