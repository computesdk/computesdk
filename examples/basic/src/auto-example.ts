/**
 * Auto-detection Example
 * 
 * This example demonstrates ComputeSDK's auto-detection feature.
 * It automatically selects the best available provider based on
 * your environment variables - no manual configuration needed!
 */

import { ComputeSDK } from 'computesdk';
import { config } from 'dotenv';
config(); // Load environment variables from .env file

async function main() {
  console.log('ComputeSDK Auto-Detection Example');
  console.log('==================================\n');
  
  try {
    // 🎯 The magic happens here - auto-detect provider!
    const sandbox = ComputeSDK.createSandbox();
    
    console.log('✨ Auto-detected provider:', sandbox.provider);
    console.log('📦 Sandbox ID:', sandbox.sandboxId);
    
    // Get basic info about the detected provider
    const info = await sandbox.getInfo();
    console.log('🏷️  Runtime:', info.runtime);
    console.log('📊 Status:', info.status);
    
    // Execute a simple "Hello World" to prove it works
    console.log('\n🚀 Testing execution...');
    const code = sandbox.provider === 'e2b' || sandbox.provider === 'fly' 
      ? 'print("Hello from " + "' + sandbox.provider.toUpperCase() + '!")'
      : 'console.log("Hello from " + "' + sandbox.provider.toUpperCase() + '!")';
      
    const result = await sandbox.execute(code);
    console.log('📤 Output:', result.stdout);
    console.log('⏱️  Execution time:', result.executionTime + 'ms');
    
    // Show what capabilities this provider has
    console.log('\n🔧 Provider capabilities:');
    console.log('- Code execution: ✅');
    console.log('- Filesystem ops:', 'filesystem' in sandbox ? '✅' : '❌');
    console.log('- Terminal ops:', 'terminal' in sandbox ? '✅' : '❌');
    
    // Clean up
    await sandbox.kill();
    console.log('\n✅ Success! Auto-detection worked perfectly.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    
    console.log('\n💡 To use auto-detection, set one of these:');
    console.log('');
    console.log('🐍 E2B: E2B_API_KEY=your_key');
    console.log('🚀 Vercel: VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID');
    console.log('🌅 Daytona: DAYTONA_API_KEY=your_key');
    console.log('');
    console.log('👀 Check the other examples for detailed provider usage!');
    
    process.exit(1);
  }
}

main();