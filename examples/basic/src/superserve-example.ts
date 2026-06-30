/**
 * Superserve Provider Example
 *
 * Superserve provides sandbox infrastructure to run code in isolated
 * cloud environments powered by Firecracker MicroVMs.
 *
 * Prerequisites:
 *   - Set SUPERSERVE_API_KEY environment variable
 *     Get your key at https://console.superserve.ai
 */

import { compute } from 'computesdk';
import { config } from 'dotenv';
import { superserve } from '@computesdk/superserve';
config();

async function main() {
  console.log('Superserve Provider Example');
  console.log('===========================\n');

  if (!process.env.SUPERSERVE_API_KEY) {
    console.error('Please set SUPERSERVE_API_KEY environment variable');
    console.error('Get your Superserve API key from https://console.superserve.ai\n');
    process.exit(1);
  }

  try {
    compute.setConfig({
      provider: superserve({
        apiKey: process.env.SUPERSERVE_API_KEY,
        baseUrl: process.env.SUPERSERVE_BASE_URL,
      }),
    });

    console.log('Creating Superserve sandbox...');
    const sandbox = await compute.sandbox.create();
    console.log('Created sandbox:', sandbox.sandboxId);

    const versionResult = await sandbox.runCommand('node -v');
    console.log('node -v:', versionResult.stdout.trim());

    const info = await sandbox.getInfo();
    console.log('\nSandbox info:', {
      id: info.id,
      status: info.status,
      provider: info.provider,
    });

    console.log('\n--- Filesystem operations ---');
    await sandbox.filesystem.writeFile(
      '/tmp/hello.js',
      `console.log('Hello from Superserve, ' + process.platform + '/' + process.arch);`
    );
    const scriptResult = await sandbox.runCommand('node /tmp/hello.js');
    console.log('Script output:', scriptResult.stdout.trim());

    await sandbox.filesystem.mkdir('/tmp/data');
    const files = await sandbox.filesystem.readdir('/tmp');
    console.log('Files in /tmp:', files.map((f) => f.name));

    await sandbox.destroy();
    console.log('\nSandbox destroyed successfully');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('Error:', errorMessage);

    if (errorMessage.includes('API key') || errorMessage.includes('authentication')) {
      console.error('\nAuthentication failed:');
      console.error('- Get your Superserve API key from https://console.superserve.ai');
      console.error('- Set it as: export SUPERSERVE_API_KEY=your_key_here');
    } else if (errorMessage.includes('quota') || errorMessage.includes('limit')) {
      console.error('\nUsage limit reached:');
      console.error('- Check your team usage at https://console.superserve.ai');
    } else {
      console.error('\nFor help:');
      console.error('- Docs: https://docs.superserve.ai');
      console.error('- Verify your API key is valid');
    }
  }
}

main();
