/**
 * Docker Provider Example
 *
 * This example shows how to use the Docker provider with Testcontainers
 * for local code execution with full filesystem support.
 */

import { docker } from '@computesdk/docker';
import { createCompute } from 'computesdk';
import { config } from 'dotenv';
import { NODE_SNIPPETS } from './constants/code-snippets';
config();

async function main() {
  console.log('🐳 Docker Provider Example\n');
  console.log('Note: Docker must be installed and running on your system\n');

  try {
    // Configure compute with Docker provider
    const compute = createCompute({
      provider: docker({
        runtime: 'node',
        image: 'node:20-alpine'
      })
    });

    console.log('Creating Docker sandbox...');
    const sandbox = await compute.sandbox.create();
    console.log('✅ Created Docker sandbox:', sandbox.sandboxId.substring(0, 12) + '...\n');

    // Execute Node.js code
    console.log('--- Node.js Code Execution ---');
    const result = await sandbox.runCode(NODE_SNIPPETS.HELLO_WORLD);
    console.log('Output:');
    console.log(result.stdout);
    console.log('Execution time:', result.executionTime, 'ms\n');

    // Execute complex code
    console.log('--- JSON Processing ---');
    const jsonResult = await sandbox.runCode(`
const data = {
  message: 'Hello from Docker!',
  timestamp: new Date().toISOString(),
  container: true
};
console.log(JSON.stringify(data, null, 2));
    `.trim());
    console.log('Output:');
    console.log(jsonResult.stdout);

    // Filesystem operations
    console.log('\n--- Filesystem Operations ---');

    await sandbox.filesystem.writeFile('/tmp/test.txt', 'Hello from filesystem!');
    console.log('✅ Wrote file to /tmp/test.txt');

    const content = await sandbox.filesystem.readFile('/tmp/test.txt');
    console.log('✅ Read file content:', content);

    await sandbox.filesystem.mkdir('/tmp/mydir');
    console.log('✅ Created directory /tmp/mydir');

    const files = await sandbox.filesystem.readdir('/tmp');
    console.log('✅ Files in /tmp:', files.map(f => f.name).join(', '));

    // Command execution
    console.log('\n--- Command Execution ---');
    const cmdResult = await sandbox.runCommand('echo', ['Hello from command!']);
    console.log('Command output:', cmdResult.stdout.trim());

    // Get sandbox info
    console.log('\n--- Sandbox Info ---');
    const info = await sandbox.getInfo();
    console.log('Provider:', info.provider);
    console.log('Runtime:', info.runtime);
    console.log('Status:', info.status);

    // Clean up
    await sandbox.kill();
    console.log('\n✅ Sandbox cleaned up successfully');

  } catch (error) {
    if (error instanceof Error) {
      console.error('❌ Error:', error.message);
      if (error.message.includes('Docker')) {
        console.error('\n⚠️  Make sure Docker is installed and running');
      }
    }
    process.exit(1);
  }
}

main();
