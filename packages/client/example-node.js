/**
 * Example: Using @computesdk/client in Node.js
 *
 * Run: node example-node.js <sandbox-url>
 */

import { ComputeClient } from './dist/index.mjs';
import WebSocket from 'ws';

const url = process.argv[2] || 'http://localhost:8080';

console.log('🚀 ComputeClient Example (Node.js)\n');
console.log(`📡 Connecting to: ${url}\n`);

const client = new ComputeClient({
  sandboxUrl: url,
  WebSocket // Pass ws implementation for Node.js
});

try {
  // Health check
  console.log('✓ Health check...');
  await client.health();

  // Generate token
  console.log('✓ Generating token...');
  await client.generateToken();

  // Execute command
  console.log('✓ Executing command...');
  const result = await client.execute({ command: 'echo "Hello from Node.js!"' });
  console.log('  Output:', result.data.stdout.trim());

  console.log('\n✅ Success!\n');
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
