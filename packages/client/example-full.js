/**
 * Comprehensive example: @computesdk/adapter with all features
 *
 * Usage: node example-full.js <sandbox-url>
 * Example: node example-full.js https://sandbox-123.preview.computesdk.com
 */

import { ComputeAdapter } from './dist/index.mjs';
import WebSocket from 'ws';

const url = process.argv[2];

if (!url) {
  console.error('Usage: node example-full.js <sandbox-url>');
  process.exit(1);
}

console.log('🚀 ComputeSDK Adapter - Full Example\n');
console.log(`📡 Connecting to: ${url}\n`);

const adapter = new ComputeAdapter({
  sandboxUrl: url,
  WebSocket // Required for Node.js
});

try {
  // 1. Health check
  console.log('1️⃣  Health check...');
  const health = await adapter.health();
  console.log('   ✅', health.status);

  // 2. Generate token
  console.log('\n2️⃣  Generating token...');
  const tokenResponse = await adapter.generateToken();
  console.log('   ✅ Token:', tokenResponse.data.token.substring(0, 30) + '...');

  // 3. Execute command
  console.log('\n3️⃣  Executing command...');
  const result = await adapter.execute({ command: 'echo "Hello from ComputeSDK!"' });
  console.log('   ✅ Output:', result.data.stdout.trim());
  console.log('   ⏱️  Duration:', result.data.duration_ms + 'ms');

  // 4. File operations
  console.log('\n4️⃣  File operations...');
  await adapter.writeFile('/tmp/test.txt', 'Hello, World!');
  const content = await adapter.readFile('/tmp/test.txt');
  console.log('   ✅ Wrote and read file:', content);

  // 5. Terminal with WebSocket
  console.log('\n5️⃣  Creating terminal (WebSocket)...');
  const terminal = await adapter.createTerminal();
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
  await adapter.disconnect();

  console.log('\n✅ All tests passed!\n');

} catch (error) {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
}
