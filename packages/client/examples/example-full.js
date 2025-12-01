/**
 * Comprehensive example: @computesdk/client with all features
 *
 * This demonstrates:
 * - Authentication with session tokens
 * - Command execution
 * - File operations
 * - Real-time terminals with WebSocket
 * - File watching
 * - Signal monitoring
 *
 * Usage: node example-full.js <sandbox-url> <session-token>
 * Example: node example-full.js https://sandbox-123.preview.computesdk.com your-session-token-here
 *
 * Note: Requires Node.js 21+ for native WebSocket support.
 *       For Node.js < 21, see the README for WebSocket configuration.
 */

import { ComputeClient } from '@computesdk/client';

const sandboxUrl = process.argv[2];
const token = process.argv[3];

if (!sandboxUrl || !token) {
  console.error('Usage: node example-full.js <sandbox-url> <session-token>');
  console.error('Example: node example-full.js https://sandbox-123.preview.computesdk.com your-token');
  process.exit(1);
}

console.log('🚀 ComputeSDK Client - Full Example\n');
console.log(`📡 Connecting to: ${sandboxUrl}\n`);

const client = new ComputeClient({
  sandboxUrl,
  token
});

try {
  // ============================================================================
  // 1. Health Check
  // ============================================================================
  console.log('1️⃣  Health check...');
  const health = await client.health();
  console.log('   ✅', health.status);

  // ============================================================================
  // 2. Server Info
  // ============================================================================
  console.log('\n2️⃣  Getting server info...');
  const info = await client.getServerInfo();
  console.log('   ✅ Version:', info.data.version);
  console.log('   ✅ Sandbox count:', info.data.sandbox_count);

  // ============================================================================
  // 3. Authentication Status
  // ============================================================================
  console.log('\n3️⃣  Checking auth status...');
  const authStatus = await client.getAuthStatus();
  console.log('   ✅ Authenticated:', authStatus.data.authenticated);
  console.log('   ✅ Token type:', authStatus.data.token_type);

  // ============================================================================
  // 4. Execute Command
  // ============================================================================
  console.log('\n4️⃣  Executing command...');
  const result = await client.execute({ command: 'echo "Hello from ComputeSDK!"' });
  console.log('   ✅ Output:', result.data.stdout.trim());
  console.log('   ⏱️  Duration:', result.data.duration_ms + 'ms');
  console.log('   ✅ Exit code:', result.data.exit_code);

  // ============================================================================
  // 5. File Operations
  // ============================================================================
  console.log('\n5️⃣  File operations...');

  // Write file
  await client.writeFile('/home/project/test.txt', 'Hello, World!');
  console.log('   ✅ Created test.txt');

  // Read file
  const content = await client.readFile('/home/project/test.txt');
  console.log('   ✅ Read content:', content);

  // List files
  const files = await client.listFiles('/home/project');
  console.log('   ✅ Found', files.data.files.length, 'files');

  // Filesystem interface
  await client.filesystem.mkdir('/home/project/data');
  await client.filesystem.writeFile('/home/project/data/sample.json', JSON.stringify({ test: true }));
  console.log('   ✅ Created data/ directory with sample.json');

  // ============================================================================
  // 6. Terminal with WebSocket
  // ============================================================================
  console.log('\n6️⃣  Creating terminal (WebSocket)...');
  const terminal = await client.createTerminal('/bin/bash');
  console.log('   ✅ Terminal created:', terminal.getId());

  // Set up output listener
  terminal.on('output', (data) => {
    process.stdout.write('   📤 ' + data);
  });

  // Execute commands in terminal
  console.log('   🔨 Running commands in terminal...');
  await terminal.execute('echo "Terminal test"');
  await terminal.execute('pwd');
  await terminal.execute('ls -la /home/project');

  // Clean up terminal
  await terminal.destroy();
  console.log('   ✅ Terminal destroyed');

  // ============================================================================
  // 7. File Watcher
  // ============================================================================
  console.log('\n7️⃣  Setting up file watcher...');
  const watcher = await client.createWatcher('/home/project', {
    ignored: ['node_modules', '.git'],
    includeContent: false
  });
  console.log('   ✅ Watcher created');

  // Listen for changes
  watcher.on('change', (event) => {
    console.log(`   📝 File ${event.event}: ${event.path}`);
  });

  // Trigger some changes
  await client.writeFile('/home/project/test.txt', 'Updated content!');
  await new Promise(resolve => setTimeout(resolve, 500));

  await watcher.destroy();
  console.log('   ✅ Watcher stopped');

  // ============================================================================
  // 8. Signal Service
  // ============================================================================
  console.log('\n8️⃣  Starting signal service...');
  const signals = await client.startSignals();
  console.log('   ✅ Signal service started');

  // Listen for port events
  signals.on('port', (event) => {
    console.log(`   🌐 Port ${event.port} ${event.type}: ${event.url}`);
  });

  // Emit a test signal
  await client.emitPortSignal(3000, 'open', 'http://localhost:3000');
  await new Promise(resolve => setTimeout(resolve, 200));

  await signals.stop();
  console.log('   ✅ Signal service stopped');

  // ============================================================================
  // 9. Cleanup
  // ============================================================================
  console.log('\n9️⃣  Cleaning up...');
  await client.disconnect();
  console.log('   ✅ Disconnected');

  console.log('\n✅ All features tested successfully!\n');

} catch (error) {
  console.error('\n❌ Error:', error.message);
  await client.disconnect();
  process.exit(1);
}
