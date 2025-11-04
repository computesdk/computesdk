/**
 * Comprehensive example: @computesdk/client with all features
 *
 * Usage: node example-full.js <sandbox-url>
 * Example: node example-full.js https://mild-bass-mfcbhp.preview.computesdk.com
 */

import { ComputeClient } from './dist/index.mjs';
import WebSocket from 'ws';

const url = process.argv[2];

if (!url) {
  console.error('Usage: node example-full.js <sandbox-url>');
  process.exit(1);
}

console.log('🚀 ComputeSDK Client - Full Example\n');
console.log(`📡 Connecting to: ${url}\n`);

const client = new ComputeClient({
  sandboxUrl: url,
  WebSocket // Required for Node.js
});

try {
  // 1. Health check
  console.log('1️⃣  Health check...');
  const health = await client.health();
  console.log('   ✅', health.status);

  // 2. Generate token
  console.log('\n2️⃣  Generating token...');
  const tokenResponse = await client.generateToken();
  console.log('   ✅ Token:', tokenResponse.data.token.substring(0, 30) + '...');

  // 3. Execute command
  console.log('\n3️⃣  Executing command...');
  const result = await client.execute({ command: 'echo "Hello from ComputeSDK!"' });
  console.log('   ✅ Output:', result.data.stdout.trim());
  console.log('   ⏱️  Duration:', result.data.duration_ms + 'ms');

  // 4. File operations
  console.log('\n4️⃣  File operations...');
  await client.writeFile('/tmp/test.txt', 'Hello, World!');
  const content = await client.readFile('/tmp/test.txt');
  console.log('   ✅ Wrote and read file:', content);

  // 5. Terminal with WebSocket
  console.log('\n5️⃣  Creating terminal (WebSocket)...');
  const terminal = await client.createTerminal();
  console.log('   ✅ Terminal created:', terminal.getId());

  terminal.on('output', (data) => {
    console.log('   📤 Terminal output:', data.trim());
  });

  terminal.write('echo "WebSocket works!"\n');
  await new Promise(resolve => setTimeout(resolve, 500));

  await terminal.destroy();
  console.log('   ✅ Terminal destroyed');

  // 6. Cleanup
  console.log('\n6️⃣  Disconnecting...');
  await client.disconnect();

  console.log('\n✅ All tests passed!\n');

} catch (error) {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
}
