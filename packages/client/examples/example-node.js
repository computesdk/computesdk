/**
 * Simple example: Using @computesdk/client in Node.js
 *
 * This demonstrates basic usage:
 * - Client initialization
 * - Health checks
 * - Command execution
 * - File operations
 *
 * Usage: node example-node.js <sandbox-url> <session-token>
 * Example: node example-node.js https://sandbox-123.preview.computesdk.com your-token
 *
 * Note: Requires Node.js 21+ for native WebSocket support.
 *       For Node.js < 21, see the README for WebSocket configuration.
 */

import { ComputeClient } from '@computesdk/client';

const sandboxUrl = process.argv[2];
const token = process.argv[3];

if (!sandboxUrl || !token) {
  console.error('Usage: node example-node.js <sandbox-url> <session-token>');
  console.error('Example: node example-node.js https://sandbox-123.preview.computesdk.com your-token');
  process.exit(1);
}

console.log('🚀 ComputeClient Example (Node.js)\n');
console.log(`📡 Connecting to: ${sandboxUrl}\n`);

const client = new ComputeClient({
  sandboxUrl,
  token
});

try {
  // Health check
  console.log('✓ Health check...');
  const health = await client.health();
  console.log(`  Status: ${health.status}\n`);

  // Get server info
  console.log('✓ Getting server info...');
  const info = await client.getServerInfo();
  console.log(`  Version: ${info.data.version}`);
  console.log(`  Sandboxes: ${info.data.sandbox_count}\n`);

  // Execute command
  console.log('✓ Executing command...');
  const result = await client.execute({ command: 'echo "Hello from Node.js!"' });
  console.log(`  Output: ${result.data.stdout.trim()}`);
  console.log(`  Duration: ${result.data.duration_ms}ms\n`);

  // File operations
  console.log('✓ File operations...');
  await client.writeFile('/home/project/hello.txt', 'Hello, World!');
  const content = await client.readFile('/home/project/hello.txt');
  console.log(`  Written and read: "${content}"\n`);

  // List files
  console.log('✓ Listing files...');
  const files = await client.listFiles('/home/project');
  console.log(`  Found ${files.data.files.length} files:`);
  files.data.files.forEach(file => {
    const type = file.is_dir ? '📁' : '📄';
    console.log(`    ${type} ${file.name}`);
  });

  console.log('\n✅ Success!\n');

  // Cleanup
  await client.disconnect();

} catch (error) {
  console.error('❌ Error:', error.message);
  await client.disconnect();
  process.exit(1);
}
