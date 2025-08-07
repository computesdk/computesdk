/**
 * Example demonstrating the unified server-side API
 * 
 * This shows how to use handleComputeRequest for both sandbox and filesystem operations
 */

import { handleComputeRequest } from 'computesdk';
import type { ComputeRequest } from 'computesdk';

async function runUnifiedAPIExample() {
  console.log('🚀 ComputeSDK Unified API Example\n');

  try {
    // 1. Execute Python code
    console.log('1. Executing Python code...');
    const executeRequest: ComputeRequest = {
      operation: 'sandbox',
      action: 'execute',
      payload: {
        code: 'print("Hello from ComputeSDK!")\nprint("Current working directory:", __import__("os").getcwd())',
        runtime: 'python'
      }
    };

    const executeResponse = await handleComputeRequest(executeRequest);
    console.log('✅ Execute Response:', {
      success: executeResponse.success,
      output: executeResponse.data?.stdout,
      provider: executeResponse.provider,
      sandboxId: executeResponse.sandboxId
    });

    // Store sandbox ID for subsequent operations
    const sandboxId = executeResponse.sandboxId;

    // 2. Create a file using filesystem operations
    console.log('\n2. Creating a Python file...');
    const writeFileRequest: ComputeRequest = {
      operation: 'filesystem',
      action: 'writeFile',
      payload: {
        path: '/tmp/hello.py',
        content: 'print("Hello from file!")\nprint("This file was created via the unified API")'
      },
      sandboxId // Use the same sandbox
    };

    const writeResponse = await handleComputeRequest(writeFileRequest);
    console.log('✅ Write File Response:', {
      success: writeResponse.success,
      message: writeResponse.data?.message
    });

    // 3. Read the file back
    console.log('\n3. Reading the file back...');
    const readFileRequest: ComputeRequest = {
      operation: 'filesystem',
      action: 'readFile',
      payload: {
        path: '/tmp/hello.py'
      },
      sandboxId
    };

    const readResponse = await handleComputeRequest(readFileRequest);
    console.log('✅ Read File Response:', {
      success: readResponse.success,
      content: readResponse.data?.content
    });

    // 4. Execute the file we created
    console.log('\n4. Executing the created file...');
    const runCommandRequest: ComputeRequest = {
      operation: 'sandbox',
      action: 'runCommand',
      payload: {
        command: 'python',
        args: ['/tmp/hello.py']
      },
      sandboxId
    };

    const runResponse = await handleComputeRequest(runCommandRequest);
    console.log('✅ Run Command Response:', {
      success: runResponse.success,
      output: runResponse.data?.stdout
    });

    // 5. List directory contents
    console.log('\n5. Listing /tmp directory...');
    const readdirRequest: ComputeRequest = {
      operation: 'filesystem',
      action: 'readdir',
      payload: {
        path: '/tmp'
      },
      sandboxId
    };

    const readdirResponse = await handleComputeRequest(readdirRequest);
    console.log('✅ Directory Listing:', {
      success: readdirResponse.success,
      files: readdirResponse.data?.entries?.map((entry: any) => ({
        name: entry.name,
        isDirectory: entry.isDirectory,
        size: entry.size
      }))
    });

    // 6. Get sandbox info
    console.log('\n6. Getting sandbox information...');
    const infoRequest: ComputeRequest = {
      operation: 'sandbox',
      action: 'getInfo',
      payload: {},
      sandboxId
    };

    const infoResponse = await handleComputeRequest(infoRequest);
    console.log('✅ Sandbox Info:', {
      success: infoResponse.success,
      info: {
        id: infoResponse.data?.id,
        provider: infoResponse.data?.provider,
        runtime: infoResponse.data?.runtime,
        status: infoResponse.data?.status
      }
    });

    console.log('\n🎉 Unified API example completed successfully!');
    console.log(`📊 Used provider: ${executeResponse.provider}`);
    console.log(`🆔 Sandbox ID: ${sandboxId}`);

  } catch (error) {
    console.error('❌ Error running unified API example:', error);
  }
}

// Run the example if this file is executed directly
if (require.main === module) {
  runUnifiedAPIExample();
}

export { runUnifiedAPIExample };