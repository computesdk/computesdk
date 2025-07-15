/**
 * Auto-detection Example
 * 
 * This example shows how ComputeSDK automatically selects a provider
 * based on available API keys in environment variables.
 * 
 * Currently supported providers:
 * - E2B (fully implemented with filesystem/terminal support) - requires E2B_API_KEY
 * - Vercel (fully implemented) - requires VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID
 * - Cloudflare (fully implemented) - platform-specific sandbox
 * - Fly (mock implementation) - coming soon
 */

import { ComputeSDK, FilesystemComputeSandbox, TerminalComputeSandbox } from 'computesdk';

async function main() {
  try {
    // Auto-detect provider based on environment variables
    const sandbox = ComputeSDK.createSandbox();
    
    console.log('Using provider:', sandbox.provider);
    console.log('Sandbox ID:', sandbox.sandboxId);
    
    // Execute code based on provider
    if (sandbox.provider === 'e2b') {
      const pythonResult = await sandbox.execute('print("Hello from Python!")');
      console.log('Python output:', pythonResult.stdout);
      
      // E2B supports filesystem operations
      if ('filesystem' in sandbox) {
        const fsSandbox = sandbox as FilesystemComputeSandbox;
        await fsSandbox.filesystem.writeFile('/tmp/hello.txt', 'Hello from E2B filesystem!');
        const content = await fsSandbox.filesystem.readFile('/tmp/hello.txt');
        console.log('File content:', content);
      }
      
      // E2B also supports terminal operations
      if ('terminal' in sandbox) {
        const termSandbox = sandbox as TerminalComputeSandbox;
        const terminals = await termSandbox.terminal.list();
        console.log('Active terminals:', terminals.length);
      }
    } else if (sandbox.provider === 'vercel') {
      const nodeResult = await sandbox.execute('console.log("Hello from Node.js!")');
      console.log('Node.js output:', nodeResult.stdout);
    } else if (sandbox.provider === 'cloudflare') {
      const result = await sandbox.execute('console.log("Hello from Cloudflare!")');
      console.log('Cloudflare output:', result.stdout);
    } else {
      console.log('Note: Only E2B, Vercel, and Cloudflare providers are fully implemented. Fly provider uses mock responses.');
      
      // This will return mock data for Fly provider
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
    console.error('- E2B_API_KEY (fully implemented with filesystem/terminal)');
    console.error('- VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID (fully implemented)');
    console.error('- CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (platform-specific)');
    console.error('- FLY_API_TOKEN (mock implementation)');
    console.error('\nNote: E2B, Vercel, and Cloudflare providers execute real code. Fly returns mock responses.');
  }
}

main();