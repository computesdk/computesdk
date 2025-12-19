# Modal

Modal provider for ComputeSDK - Execute code with GPU support for machine learning workloads.

## Installation

```bash
npm install @computesdk/modal
```

## Usage

### With ComputeSDK

```typescript
import { createCompute } from 'computesdk';
import { modal } from '@computesdk/modal';

// Set as default provider
const compute = createCompute({ 
  provider: modal({ 
    tokenId: process.env.MODAL_TOKEN_ID,
    tokenSecret: process.env.MODAL_TOKEN_SECRET
  }),
  apiKey: process.env.COMPUTESDK_API_KEY 
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Get instance
const instance = sandbox.getInstance();

// Execute code
const result = await sandbox.runCode('print("Hello from Modal!")');
console.log(result.stdout); // "Hello from Modal!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

## Configuration

### Environment Variables

```bash
export MODAL_TOKEN_ID=your_modal_token_id_here
export MODAL_TOKEN_SECRET=your_modal_token_secret_here
```

### Configuration Options

```typescript
interface ModalConfig {
  /** Modal token ID - if not provided, will use MODAL_TOKEN_ID env var */
  tokenId?: string;
  /** Modal token secret - if not provided, will use MODAL_TOKEN_SECRET env var */
  tokenSecret?: string;
  /** Runtime to use */
  runtime?: 'node' | 'python';
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Modal environment (sandbox or main) */
  environment?: string;
  /** Ports to expose (unencrypted by default) */
  ports?: number[];
}
```

### Port Configuration

To expose ports from your Modal sandbox and access them via public URLs:

```typescript
import { createCompute } from 'computesdk';
import { modal } from '@computesdk/modal';

const compute = createCompute({ 
  provider: modal({ 
    tokenId: process.env.MODAL_TOKEN_ID,
    tokenSecret: process.env.MODAL_TOKEN_SECRET,
    ports: [3000, 8080] // Specify ports to expose
  })
});

const sandbox = await compute.sandbox.create();

// Start a web server on port 3000
await sandbox.runCode(`
const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Hello from Modal!');
});
server.listen(3000, () => console.log('Server running on port 3000'));
`, 'node');

// Get the public URL
const url = await sandbox.getUrl({ port: 3000 });
console.log(\`Server accessible at: \${url}\`);
```

Ports are exposed with unencrypted tunnels by default for maximum compatibility.
## SDK Reference Links:

- **[Code Execution](/docs/reference/code-execution)** - Execute code snippets in various runtimes
- **[Command Execution](/docs/reference/code-execution#basic-code-execution)** - Run shell commands and scripts
- **[Filesystem Operations](/docs/reference/filesystem)** - Read, write, and manage files in sandboxes
- **[Sandbox Management](/docs/reference/sandbox-management)** - Create, list, and destroy sandboxes
- **[Error Handling](/docs/reference/api-integration#error-handling)** - Handle command failures and runtime errors
- **[Web Framework Integration](/docs/reference/api-integration#web-framework-integration)** - Integrate with Express, Next.js, and other frameworks
