/**
 * WebContainer Polyfill Example
 *
 * This demonstrates using the WebContainer API with remote sandboxes.
 * Perfect drop-in replacement for @webcontainer/api!
 */

import { WebContainer } from '../src/webcontainer-polyfill';

async function main() {
  console.log('🚀 Booting WebContainer polyfill...');

  // Boot WebContainer (same API as @webcontainer/api!)
  const wc = await WebContainer.boot({
    apiUrl: process.env.SANDBOX_URL || 'https://sandbox-123.preview.computesdk.co',
    // Optional: pass WebSocket for Node.js
    WebSocket: require('ws')
  });

  console.log('✅ WebContainer ready!\n');

  // ============================================================================
  // Example 1: Mount a file tree
  // ============================================================================
  console.log('📁 Mounting file tree...');

  await wc.mount({
    'package.json': {
      file: {
        contents: JSON.stringify(
          {
            name: 'webcontainer-example',
            version: '1.0.0',
            type: 'module',
            dependencies: {
              express: '^4.18.0'
            }
          },
          null,
          2
        )
      }
    },
    src: {
      directory: {
        'server.js': {
          file: {
            contents: `
import express from 'express';

const app = express();
const port = 3000;

app.get('/', (req, res) => {
  res.json({
    message: 'Hello from WebContainer polyfill!',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.listen(port, () => {
  console.log(\`Server listening on port \${port}\`);
});
            `.trim()
          }
        },
        'hello.js': {
          file: {
            contents: `
console.log('Hello from WebContainer!');
console.log('Node version:', process.version);
console.log('Platform:', process.platform);
            `.trim()
          }
        }
      }
    },
    'README.md': {
      file: {
        contents: '# WebContainer Polyfill Example\n\nThis runs on remote sandboxes!'
      }
    }
  });

  console.log('✅ Files mounted!\n');

  // ============================================================================
  // Example 2: List files
  // ============================================================================
  console.log('📋 Listing files...');

  const files = await wc.fs.readdir('/home/project', { withFileTypes: true });
  for (const file of files) {
    const type = file.isDirectory() ? '📁' : '📄';
    console.log(`  ${type} ${file.name}`);
  }
  console.log('');

  // ============================================================================
  // Example 3: Run a simple script
  // ============================================================================
  console.log('🏃 Running hello.js...');

  const helloProcess = await wc.spawn('node', ['src/hello.js']);

  // Read output
  const reader = helloProcess.output.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    process.stdout.write(`  ${value}`);
  }

  await helloProcess.exit;
  console.log('✅ Script completed!\n');

  // ============================================================================
  // Example 4: Install dependencies
  // ============================================================================
  console.log('📦 Installing dependencies...');

  const installProcess = await wc.spawn('npm', ['install', '--quiet']);

  const installReader = installProcess.output.getReader();
  while (true) {
    const { done, value } = await installReader.read();
    if (done) break;
    // Only show important output
    if (value.includes('added') || value.includes('error')) {
      process.stdout.write(`  ${value}`);
    }
  }

  const exitCode = await installProcess.exit;
  if (exitCode === 0) {
    console.log('✅ Dependencies installed!\n');
  } else {
    console.log('❌ Install failed!\n');
  }

  // ============================================================================
  // Example 5: File operations
  // ============================================================================
  console.log('✏️  Testing file operations...');

  // Write a new file
  await wc.fs.writeFile('/home/project/test.txt', 'Hello, World!');
  console.log('  ✅ Created test.txt');

  // Read it back
  const content = await wc.fs.readFile('/home/project/test.txt', 'utf-8');
  console.log(`  ✅ Read content: "${content}"`);

  // Create a directory
  await wc.fs.mkdir('/home/project/data');
  console.log('  ✅ Created data/ directory');

  // Write file in new directory
  await wc.fs.writeFile('/home/project/data/sample.json', JSON.stringify({ foo: 'bar' }));
  console.log('  ✅ Created data/sample.json\n');

  // ============================================================================
  // Example 6: Start Express server (with port monitoring)
  // ============================================================================
  console.log('🌐 Starting Express server...');

  // Listen for port events
  wc.on('server-ready', (port, url) => {
    console.log(`  🎉 Server ready on port ${port}`);
    console.log(`  🔗 URL: ${url}\n`);
  });

  const serverProcess = await wc.spawn('node', ['src/server.js']);

  // Let the server run for a bit
  console.log('  ⏳ Waiting for server to start...');

  // Read initial output
  const serverReader = serverProcess.output.getReader();
  setTimeout(async () => {
    // Check if we got output
    try {
      const { value } = await serverReader.read();
      if (value) {
        console.log(`  📝 Server output: ${value.trim()}`);
      }
    } catch (e) {
      // Ignore
    }
  }, 2000);

  // Keep server running for a few seconds
  await new Promise(resolve => setTimeout(resolve, 5000));

  // ============================================================================
  // Example 7: File watching
  // ============================================================================
  console.log('👀 Setting up file watcher...');

  const watcher = wc.fs.watch(
    '/home/project',
    { recursive: true },
    (event, filename) => {
      console.log(`  📝 File ${event}: ${filename}`);
    }
  );

  // Make some changes
  await wc.fs.writeFile('/home/project/test.txt', 'Updated content!');
  await new Promise(resolve => setTimeout(resolve, 1000));

  watcher.close();
  console.log('✅ Watcher closed\n');

  // ============================================================================
  // Example 8: Export file system
  // ============================================================================
  console.log('💾 Exporting file system...');

  const exported = await wc.export('/home/project/src', { format: 'json' });
  console.log('  ✅ Exported structure:');
  console.log(JSON.stringify(exported, null, 2));
  console.log('');

  // ============================================================================
  // Cleanup
  // ============================================================================
  console.log('🧹 Cleaning up...');

  // Kill server
  serverProcess.kill();

  // Teardown WebContainer
  await wc.teardown();

  console.log('✅ Done!\n');
  console.log('🎉 WebContainer polyfill works perfectly!');
}

// Run example
main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
