/**
 * Cloudflare Containers Provider Example
 * 
 * ⚠️  MOCK IMPLEMENTATION - This provider is not yet fully implemented.
 * This example shows the intended API for the Cloudflare provider.
 * Currently returns mock responses instead of executing real code.
 * 
 * TODO: Implement real Cloudflare Containers API integration
 */

import { cloudflare } from '@computesdk/cloudflare';
import { executeSandbox } from 'computesdk';

async function main() {
  console.log('⚠️  Note: This is a MOCK implementation!');
  console.log('The Cloudflare provider is not yet fully implemented.');
  console.log('This example shows the intended API and returns mock responses.\n');
  
  // Make sure credentials are set (for future implementation)
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    console.log('💡 For the real implementation, you will need:');
    console.log('export CLOUDFLARE_API_TOKEN=your_cloudflare_token_here');
    console.log('export CLOUDFLARE_ACCOUNT_ID=your_account_id_here\n');
    
    // Continue with mock for demonstration
    process.env.CLOUDFLARE_API_TOKEN = 'mock_token_for_demo';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'mock_account_id_for_demo';
  }
  
  try {
    // Create Cloudflare sandbox with Python container
    const pythonSandbox = cloudflare({
      container: 'python:3.11-slim'
    });
    
    console.log('Created Cloudflare Python sandbox:', pythonSandbox.sandboxId);
    
    // Execute Python code in container
    const pythonResult = await executeSandbox({
      sandbox: pythonSandbox,
      code: `print("Hello from Cloudflare container!")`,
      runtime: 'python'
    });
    
    console.log('Python Output:', pythonResult.stdout);
    
    // Create Node.js container with custom configuration
    const nodeSandbox = cloudflare({
      container: {
        image: 'node:20-alpine',
        env: {
          NODE_ENV: 'production',
          APP_NAME: 'cloudflare-example'
        },
        workdir: '/app'
      }
    });
    
    console.log('Created Cloudflare Node.js sandbox:', nodeSandbox.sandboxId);
    
    // Execute Node.js code in container
    const nodeResult = await executeSandbox({
      sandbox: nodeSandbox,
      code: `
console.log('Environment:', process.env.NODE_ENV);
console.log('App Name:', process.env.APP_NAME);
console.log('Working Directory:', process.cwd());
console.log('Node.js version:', process.version);
      `.trim(),
      runtime: 'node'
    });
    
    console.log('\nNode.js Output:', nodeResult.stdout);
    
    // Create a custom container with multiple tools
    const customSandbox = cloudflare({
      container: {
        image: 'ubuntu:22.04',
        command: ['bash'],
        env: {
          DEBIAN_FRONTEND: 'noninteractive'
        }
      }
    });
    
    // Execute shell commands
    const shellResult = await executeSandbox({
      sandbox: customSandbox,
      code: `
echo "System Information:"
uname -a
echo ""
echo "Available commands:"
which python3 || echo "Python not installed"
which node || echo "Node.js not installed"
which curl || echo "curl not installed"
      `.trim()
    });
    
    console.log('\nShell Output:', shellResult.stdout);
    
    // Clean up
    await pythonSandbox.kill();
    await nodeSandbox.kill();
    await customSandbox.kill();
    console.log('\nAll sandboxes cleaned up successfully');
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();