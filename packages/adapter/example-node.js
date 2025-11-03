/**
 * Example: Using @computesdk/adapter in Node.js
 *
 * Run: node example-node.js <sandbox-url>
 */

import { ComputeAdapter } from './dist/index.mjs';
import WebSocket from 'ws';

const url = process.argv[2] || 'http://localhost:8080';

console.log('🚀 ComputeAdapter Example (Node.js)\n');
console.log(`📡 Connecting to: ${url}\n`);

const adapter = new ComputeAdapter({
  sandboxUrl: url,
  WebSocket // Pass ws implementation for Node.js
});

try {
  // Health check
  console.log('✓ Health check...');
  await adapter.health();

  // Generate token
  console.log('✓ Generating token...');
  await adapter.generateToken();

  // Execute command
  console.log('✓ Executing command...');
  const result = await adapter.execute({ command: 'echo "Hello from Node.js!"' });
  console.log('  Output:', result.data.stdout.trim());

  console.log('\n✅ Success!\n');
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
