import { ComputeClient } from './dist/index.mjs';

const client = new ComputeClient({
  apiUrl: 'https://cool-giraffe-huk3uj.preview.computesdk.com'
});

console.log('Testing health...');
const health = await client.health();
console.log('Health:', health);

console.log('\nTesting token generation...');
try {
  const token = await client.generateToken();
  console.log('Token generated!', token.data.token.substring(0, 30) + '...');
} catch (error) {
  console.error('Error:', error);
  console.error('Stack:', error.stack);
}
