/**
 * Manual test script for @computesdk/client
 *
 * Usage: node test-manual.js <sandboxId>
 * Example: node test-manual.js abc123
 */

import { ComputeClient } from './dist/index.mjs';

const sandboxId = process.argv[2];

if (!sandboxId) {
  console.error('Usage: node test-manual.js <sandboxId>');
  process.exit(1);
}

async function main() {
  console.log('🚀 Testing @computesdk/client\n');

  const apiUrl = `https://${sandboxId}.preview.computesdk.co`;
  console.log(`📡 Connecting to: ${apiUrl}\n`);

  const client = new ComputeClient({ apiUrl });

  try {
    // Test 1: Health check
    console.log('1️⃣  Testing health check...');
    const health = await client.health();
    console.log('   ✅ Health:', health);
    console.log();

    // Test 2: Token generation
    console.log('2️⃣  Testing token generation...');
    const tokenResponse = await client.generateToken();
    console.log('   ✅ Token generated:', tokenResponse.data.token.substring(0, 20) + '...');
    console.log();

    // Test 3: Execute a simple command
    console.log('3️⃣  Testing command execution...');
    const result = await client.execute({ command: 'echo "Hello from ComputeSDK!"' });
    console.log('   ✅ Command output:', result.data.stdout.trim());
    console.log('   ⏱️  Duration:', result.data.duration_ms + 'ms');
    console.log();

    // Test 4: WebSocket + Terminal (if we can connect)
    console.log('4️⃣  Testing WebSocket + Terminal...');
    const terminal = await client.createTerminal();
    console.log('   ✅ Terminal created:', terminal);

    // Listen for output
    terminal.on('output', (data) => {
      console.log('   📤 Terminal output:', data);
    });

    // Send a command
    terminal.write('echo "WebSocket works!"\n');

    // Wait a bit for output
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Clean up
    await terminal.destroy();
    console.log('   ✅ Terminal destroyed');
    console.log();

    // Disconnect
    await client.disconnect();
    console.log('✅ All tests passed!\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
