import { ComputeClient } from './dist/index.mjs';

const client = new ComputeClient({
  apiUrl: 'https://mild-bass-mfcbhp.preview.computesdk.com'
});

console.log('Config:', client.config);
console.log('Generating token...');

const token = await client.generateToken();
console.log('Token:', token.data.token.substring(0, 30) + '...');

console.log('\nCreating terminal...');
try {
  const terminal = await client.createTerminal();
  console.log('Terminal created:', terminal);
} catch (error) {
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);
}
