import { flyio } from '@computesdk/fly';
import type { Sandbox } from 'computesdk';
import { config } from 'dotenv';

// Load environment variables
config();

async function testFlyProvider() {
  console.log('🚀 Testing Fly.io Provider...');
  
  // Check if API token is available
  if (!process.env.FLY_API_TOKEN) {
    console.error('❌ FLY_API_TOKEN not found in environment variables');
    console.log('💡 Make sure to add your Fly.io API token to the .env file');
    process.exit(1);
  }

  const provider = flyio({
    apiToken: process.env.FLY_API_TOKEN,
    org: process.env.FLY_ORG || 'personal', // Use FLY_ORG env var or default to 'personal'
    region: 'ord' // Chicago region
  });

  let sandbox: Sandbox | undefined;

  try {
    console.log('📦 Creating Fly.io sandbox...');
    sandbox = await provider.sandbox.create({
      runtime: 'node'
    });
    console.log('✅ Sandbox created successfully!');
    console.log(`   Sandbox ID: ${sandbox.sandboxId}`);
    console.log(`   Provider: ${sandbox.provider}`);

    console.log('\nℹ️  Getting sandbox information...');
    const info = await sandbox.getInfo();
    console.log('📊 Sandbox Info:');
    console.log(`   ID: ${info.id}`);
    console.log(`   Provider: ${info.provider}`);
    console.log(`   Runtime: ${info.runtime}`);
    console.log(`   Status: ${info.status}`);
    console.log(`   Created: ${info.createdAt.toISOString()}`);
    console.log(`   Timeout: ${info.timeout}ms`);
    
    if (info.metadata) {
      console.log('   Metadata:');
      console.log(`     Fly App: ${info.metadata.flyAppName}`);
      console.log(`     Machine ID: ${info.metadata.flyMachineId}`);
      console.log(`     Region: ${info.metadata.region}`);
    }

    console.log('\n🌐 Getting sandbox URL...');
    const url = await sandbox.getUrl({ port: 3000, protocol: 'https' });
    console.log(`🔗 Sandbox URL: ${url}`);

    console.log('\n💻 Testing code execution (stub implementation)...');
    const codeResult = await sandbox.runCode('console.log("Hello from Fly.io sandbox!");', 'node');
    console.log('📝 Code Execution Result:');
    console.log(`   Exit Code: ${codeResult.exitCode}`);
    console.log(`   Execution Time: ${codeResult.executionTime}ms`);
    console.log(`   Stdout: ${codeResult.stdout}`);
    if (codeResult.stderr) {
      console.log(`   Stderr: ${codeResult.stderr}`);
    }

    console.log('\n⚡ Testing command execution (stub implementation)...');
    const cmdResult = await sandbox.runCommand('echo', ['Hello', 'from', 'Fly.io!']);
    console.log('📝 Command Execution Result:');
    console.log(`   Exit Code: ${cmdResult.exitCode}`);
    console.log(`   Execution Time: ${cmdResult.executionTime}ms`);
    console.log(`   Stdout: ${cmdResult.stdout}`);
    if (cmdResult.stderr) {
      console.log(`   Stderr: ${cmdResult.stderr}`);
    }

    console.log('\n🧪 Testing Python code execution (stub implementation)...');
    const pythonResult = await sandbox.runCode('print("Hello from Python on Fly.io!")', 'python');
    console.log('📝 Python Code Result:');
    console.log(`   Exit Code: ${pythonResult.exitCode}`);
    console.log(`   Stdout: ${pythonResult.stdout}`);

    console.log('\n✅ All tests completed successfully!');

  } catch (error) {
    console.error('\n❌ Test failed with error:');
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
      if (error.message.includes('unauthorized') || error.message.includes('token')) {
        console.log('\n💡 Troubleshooting tips:');
        console.log('   - Check that your FLY_API_TOKEN is correct');
        console.log('   - Get a new token from: https://fly.io/user/personal_access_tokens');
        console.log('   - Make sure the token has the necessary permissions');
      } else if (error.message.includes('app') || error.message.includes('machine')) {
        console.log('\n💡 This might be a Fly.io API or quota issue');
        console.log('   - Check your Fly.io account dashboard');
        console.log('   - Verify you have sufficient credits');
      }
    } else {
      console.error(`   ${String(error)}`);
    }
  } finally {
    // Clean up - destroy the sandbox if it was created
    if (sandbox) {
      try {
        console.log('\n🗑️  Cleaning up - destroying sandbox...');
        await sandbox.destroy();
        console.log('✅ Sandbox destroyed successfully');
      } catch (cleanupError) {
        console.warn('⚠️  Warning: Failed to destroy sandbox:', cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
        console.log('   You may need to manually clean up resources in your Fly.io dashboard');
      }
    }
  }
}

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('\n\n🛑 Test interrupted by user');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('\n❌ Unhandled promise rejection:', reason);
  process.exit(1);
});

// Run the test
if (require.main === module) {
  testFlyProvider()
    .then(() => {
      console.log('\n🎉 Test completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Unexpected error:', error);
      process.exit(1);
    });
}

export { testFlyProvider };