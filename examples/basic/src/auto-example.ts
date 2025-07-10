/**
 * Auto-detection Example
 * 
 * This example shows how ComputeSDK automatically selects a provider
 * based on available API keys in environment variables.
 * 
 * Currently supported providers:
 * - E2B (fully implemented) - requires E2B_API_KEY
 * - Vercel (fully implemented) - requires VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID
 * - Cloudflare, Fly (mock implementations) - coming soon
 */

import { ComputeSDK } from 'computesdk';

async function main() {
  try {
    // Auto-detect provider based on environment variables
    // Currently: E2B_API_KEY (fully working), others are mock implementations
    const sandbox = ComputeSDK.createSandbox();
    
    console.log('Using provider:', sandbox.provider);
    console.log('Sandbox ID:', sandbox.sandboxId);
    
    // Execute code based on provider
    if (sandbox.provider === 'e2b') {
      const pythonResult = await sandbox.execute('print("Hello from Python!")');
      console.log('Python output:', pythonResult.stdout);
    } else if (sandbox.provider === 'vercel') {
      const nodeResult = await sandbox.execute('console.log("Hello from Node.js!")');
      console.log('Node.js output:', nodeResult.stdout);
    } else {
      console.log('Note: Only E2B and Vercel providers are fully implemented. Other providers use mock responses.');
      
      // This will return mock data for non-E2B/Vercel providers
      const result = await sandbox.execute('print("Hello World!")');
      console.log('Mock output:', result.stdout);
    }
    
    // Get sandbox info
    const info = await sandbox.getInfo();
    console.log('Sandbox info:', info);
    
    // Clean up
    await sandbox.kill();
    console.log('Sandbox killed successfully');
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error('\nMake sure you have one of these environment variables set:');
    console.error('- E2B_API_KEY (fully implemented)');
    console.error('- VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID (fully implemented)');
    console.error('- CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (mock implementation)');
    console.error('- FLY_API_TOKEN (mock implementation)');
    console.error('\nNote: E2B and Vercel providers execute real code. Others return mock responses.');
  }
}

main();