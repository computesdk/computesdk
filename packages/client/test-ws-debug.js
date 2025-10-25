import { ComputeClient } from './dist/index.mjs';

const client = new ComputeClient({
  apiUrl: 'https://mild-bass-mfcbhp.preview.computesdk.com'
});

console.log('Generating token...');
await client.generateToken();

console.log('\nAttempting to create terminal (this will enable WebSocket debug logging)...');

// Monkey patch to see the URL
const originalEnsureWebSocket = client.ensureWebSocket;

try {
  const terminal = await client.createTerminal();
  console.log('✅ Terminal created successfully!');
  console.log('Terminal ID:', terminal.getId());
  await terminal.destroy();
} catch (error) {
  console.error('❌ Error:', error.message);
  console.error('Stack:', error.stack);
}
