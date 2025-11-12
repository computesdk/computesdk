# Codesandbox

CodeSandbox provider for ComputeSDK - Execute code in web-based development environments.

## Installation

```bash
npm install @computesdk/codesandbox
```

## Usage

### With ComputeSDK

```typescript
import { createCompute } from 'computesdk';
import { codesandbox } from '@computesdk/codesandbox';

// Set as default provider
const compute = createCompute({ 
  provider: codesandbox({ apiKey: process.env.CODESANDBOX_API_KEY }),
  apiKey: process.env.COMPUTESDK_API_KEY 
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Get instance
const instance = sandbox.getInstance();

// Execute code
const result = await sandbox.runCode('console.log("Hello from CodeSandbox!")');
console.log(result.stdout); // "Hello from CodeSandbox!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```


## Configuration

### Environment Variables

```bash
export CODESANDBOX_API_KEY=your_codesandbox_api_key_here
```

### Configuration Options

```typescript
interface CodeSandboxConfig {
  /** CodeSandbox API key - if not provided, will use CODESANDBOX_API_KEY env var */
  apiKey?: string;
   /** Project template to use */
  templateId?: string;
  /** Runtime to use */
  runtime?: 'node' | 'python';
  /** Execution timeout in milliseconds */
  timeout?: number;
}
```

## API Reference

### Code Execution

```typescript
// Execute JavaScript code
const result = await sandbox.runCode(`
const data = { message: "Hello from JavaScript", timestamp: Date.now() };
console.log(JSON.stringify(data));
`, 'javascript');

// Execute TypeScript code  
const result = await sandbox.runCode(`
interface Message {
  text: string;
  timestamp: number;
}

const message: Message = {
  text: "Hello from TypeScript",
  timestamp: Date.now()
};

console.log(JSON.stringify(message));
`, 'typescript');

// Auto-detection (based on code patterns)
const result = await sandbox.runCode('console.log("Auto-detected as JavaScript")');
```

### Command Execution

```typescript
// Install npm packages
const result = await sandbox.runCommand('npm', ['install', 'lodash']);

// Run npm scripts
const result = await sandbox.runCommand('npm', ['run', 'build']);

// Start development server
const result = await sandbox.runCommand('npm', ['start']);
```

### Filesystem Operations

```typescript
// Write file
await sandbox.filesystem.writeFile('/src/App.js', 'export default function App() { return <h1>Hello</h1>; }');

// Read file
const content = await sandbox.filesystem.readFile('/src/App.js');

// Create directory
await sandbox.filesystem.mkdir('/src/components');

// List directory contents
const files = await sandbox.filesystem.readdir('/src');

// Check if file exists
const exists = await sandbox.filesystem.exists('/src/App.js');

// Remove file or directory
await sandbox.filesystem.remove('/src/App.js');
```

### Sandbox Management

```typescript
// Get sandbox info (including live preview URL)
const info = await sandbox.getInfo();
console.log(info.id, info.provider, info.url);

// List all sandboxes
const sandboxes = await compute.sandbox.list();

// Get existing sandbox
const existing = await compute.sandbox.getById('sandbox-id');

// Destroy sandbox
await compute.sandbox.destroy('sandbox-id');
```

## Runtime Detection

The provider automatically detects the runtime based on code patterns:

**TypeScript indicators:**
- `interface`, `type` declarations
- TypeScript-specific syntax (`:`, `<T>`, etc.)
- `.ts` or `.tsx` file extensions

**Default:** JavaScript for all other cases

## SDK Reference Links:

- **[Code Execution](/docs/reference/code-execution)** - Execute code snippets in various runtimes
- **[Command Execution](/docs/reference/code-execution#basic-code-execution)** - Run shell commands and scripts
- **[Filesystem Operations](/docs/reference/filesystem)** - Read, write, and manage files in sandboxes
- **[Sandbox Management](/docs/reference/sandbox-management)** - Create, list, and destroy sandboxes
- **[Error Handling](/docs/reference/api-integration#error-handling)** - Handle command failures and runtime errors
- **[Web Framework Integration](/docs/reference/api-integration#web-framework-integration)** - Integrate with Express, Next.js, and other frameworks
