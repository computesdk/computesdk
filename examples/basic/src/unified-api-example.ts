/**
 * Example demonstrating the unified compute singleton API
 * 
 * This shows how to use compute.sandbox for both code execution and filesystem operations
 */

import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { config } from 'dotenv';
config(); // Load environment variables from .env file

async function runUnifiedAPIExample() {
  console.log('🚀 ComputeSDK Unified API Example\n');

  if (!process.env.E2B_API_KEY) {
    console.error('Please set E2B_API_KEY environment variable');
    process.exit(1);
  }

  try {
    // Configure compute with E2B provider
    compute.setConfig({ provider: e2b() });

    // 1. Create sandbox and execute Python code
    console.log('1. Creating sandbox and executing Python code...');
    const sandbox = await compute.sandbox.create({});
    
    const executeResult = await sandbox.runCode(
      'print("Hello from ComputeSDK!")\nprint("Current working directory:", __import__("os").getcwd())',
      'python'
    );
    
    console.log('✅ Execute Response:', {
      output: executeResult.stdout,
      provider: sandbox.provider,
      sandboxId: sandbox.sandboxId,
      executionTime: executeResult.executionTime
    });

    // 2. Create a file using filesystem operations
    console.log('\n2. Creating a Python file...');
    await sandbox.filesystem.writeFile('/tmp/hello.py', 
      'print("Hello from file!")\nprint("This file was created via the unified API")'
    );
    
    console.log('✅ Write File Response: File created successfully');

    // 3. Read the file back
    console.log('\n3. Reading the file back...');
    const fileContent = await sandbox.filesystem.readFile('/tmp/hello.py');
    console.log('✅ Read File Response:', {
      content: fileContent.substring(0, 100) + '...'
    });

    // 4. Execute the file we just created
    console.log('\n4. Executing the created file...');
    const fileExecuteResult = await sandbox.runCommand('python', ['/tmp/hello.py']);
    console.log('✅ File Execute Response:', {
      output: fileExecuteResult.stdout,
      executionTime: fileExecuteResult.executionTime
    });

    // 5. List files in the directory
    console.log('\n5. Listing files in /tmp...');
    const files = await sandbox.filesystem.readdir('/tmp');
    console.log('✅ List Files Response:', {
      fileCount: files.length,
      files: files.map(f => f.name).slice(0, 5) // Show first 5 files
    });

    // 6. Get sandbox information
    console.log('\n6. Getting sandbox information...');
    const info = await sandbox.getInfo();
    console.log('✅ Sandbox Info:', {
      id: info.id,
      provider: info.provider,
      runtime: info.runtime,
      status: info.status,
      createdAt: info.createdAt
    });

    // Clean up
    await sandbox.kill();
    console.log('\n✅ Sandbox cleaned up successfully');
    console.log('\n🎉 Unified API example completed successfully!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    
    if (error.message.includes('API key')) {
      console.error('Get your E2B API key from https://e2b.dev/');
    }
    
    process.exit(1);
  }
}

// Run the example
runUnifiedAPIExample();