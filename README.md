<div align="center">
  <img src="https://www.computesdk.com/_astro/hv_main_logo_light.CpYMD9-V.svg" alt="ComputeSDK" width="300" />
</div>

<div align="center">
  <strong>A free and open-source toolkit for running other people's code in your applications.</strong>
</div>

<div align="center">

[![npm version](https://badge.fury.io/js/computesdk.svg)](https://badge.fury.io/js/computesdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Documentation](https://img.shields.io/badge/docs-computesdk.com-blue)](https://computesdk.com)

</div>

---

## What is ComputeSDK?

ComputeSDK is a unified abstraction layer that lets you execute code in secure, isolated sandboxed environments across multiple cloud providers. Think of it as the "Vercel AI SDK for compute" - providing a consistent TypeScript interface whether you're using E2B, Vercel, or Daytona.

**Why ComputeSDK?**
- 🔄 **Provider-agnostic** - Switch between E2B, Vercel, and Daytona without code changes
- 🛡️ **Security-first** - Isolated sandboxes protect your infrastructure
- ⚡ **Developer experience** - Simple, TypeScript-native API
- 🌍 **Production-ready** - Used by teams building the next generation of developer tools

**Perfect for building:**
- **Code execution platforms** - Run user-submitted code safely
- **Educational tools** - Interactive coding environments  
- **Data analysis applications** - Process code with full filesystem access
- **AI-powered development tools** - Let AI agents write and execute code
- **Testing & CI/CD systems** - Isolated test environments

## Features

- 🚀 **Multi-provider support** - E2B, Vercel, Daytona
- 📁 **Filesystem operations** - Read, write, create directories across providers
- 🖥️ **Terminal support** - Interactive PTY terminals (E2B)
- ⚡ **Command execution** - Run shell commands directly
- 🔄 **Auto-detection** - Automatically selects providers based on environment variables
- 🛡️ **Type-safe** - Full TypeScript support with comprehensive error handling
- 📦 **Modular** - Install only the providers you need
- 🔧 **Extensible** - Easy to add custom providers

## Get Started in 30 Seconds

```bash
# Install the core SDK
npm install computesdk

# Add your preferred provider
npm install @computesdk/e2b        # For data science and Python
npm install @computesdk/vercel     # For web-scale Node.js/Python  
npm install @computesdk/daytona    # For development workspaces
```

Set your environment variables and you're ready to go:

```bash
export E2B_API_KEY=your_api_key
# or VERCEL_TOKEN=your_token
# or DAYTONA_API_KEY=your_key
```

## Quick Start

### Auto-detection (Recommended)

```typescript
import { ComputeSDK } from 'computesdk';

// Automatically detects and uses the first available provider
const sandbox = ComputeSDK.createSandbox();

const result = await sandbox.execute('print("Hello World!")');
console.log(result.stdout);

await sandbox.kill();
```

### Provider-specific usage

```typescript
import { e2b } from '@computesdk/e2b';
import { executeSandbox } from 'computesdk';

const result = await executeSandbox({
  sandbox: e2b(),
  code: 'print("Hello from E2B!")'
});
```

## Provider Setup

### E2B (Fully Implemented)

```bash
# Set environment variable
export E2B_API_KEY=your_e2b_api_key
```

```typescript
import { e2b } from '@computesdk/e2b';

const sandbox = e2b({
  template: 'python', // optional, defaults to 'python'
  timeout: 300000,    // optional, defaults to 5 minutes
});

const result = await sandbox.execute(`
import numpy as np
import pandas as pd

data = {'A': [1, 2, 3], 'B': [4, 5, 6]}
df = pd.DataFrame(data)
print(df)
`);
```

### Vercel (Fully Implemented)

```bash
export VERCEL_TOKEN=your_vercel_token
export VERCEL_TEAM_ID=your_team_id
export VERCEL_PROJECT_ID=your_project_id
```

```typescript
import { vercel } from '@computesdk/vercel';

const sandbox = vercel({
  runtime: 'node',    // 'node' or 'python'
  timeout: 300000,    // optional, defaults to 5 minutes
});

const result = await sandbox.execute(`
console.log('Node.js version:', process.version);
console.log('Hello from Vercel Sandbox!');
`);
```

### Daytona (Fully Implemented)

```bash
export DAYTONA_API_KEY=your_daytona_api_key
```

```typescript
import { daytona } from '@computesdk/daytona';

const sandbox = daytona({
  runtime: 'python',    // 'python', 'node', etc.
  timeout: 300000,      // optional, defaults to 5 minutes
});

const result = await sandbox.execute(`
print('Hello from Daytona!')
import sys
print(f'Python version: {sys.version}')
`);
```

## API Reference

### Core Methods

#### `ComputeSDK.createSandbox(options?)`

Creates a sandbox using auto-detection.

```typescript
const sandbox = ComputeSDK.createSandbox({
  timeout: 300000,  // 5 minutes (optional)
  runtime: 'python' // runtime preference (optional)
});
```

#### `sandbox.execute(code, runtime?)`

Executes code in the sandbox.

```typescript
const result = await sandbox.execute('print("Hello")', 'python');
// Returns: { stdout: string, stderr: string, executionTime: number }
```

#### `sandbox.runCommand(command, args?)`

Executes shell commands directly.

```typescript
const result = await sandbox.runCommand('ls', ['-la', '/tmp']);
console.log(result.stdout); // Directory listing
```

#### `sandbox.getInfo()`

Gets sandbox information.

```typescript
const info = await sandbox.getInfo();
// Returns: { provider: string, sandboxId: string, status: string, ... }
```

#### `sandbox.kill()`

Terminates the sandbox.

```typescript
await sandbox.kill();
```

#### `executeSandbox(options)`

Utility function for one-off executions.

```typescript
const result = await executeSandbox({
  sandbox: e2b(),
  code: 'print("Hello")',
  runtime: 'python' // optional
});
```

### Filesystem Operations

All providers support comprehensive filesystem operations through the `sandbox.filesystem` interface:

#### `sandbox.filesystem.readFile(path)`

Reads the contents of a file.

```typescript
const content = await sandbox.filesystem.readFile('/path/to/file.txt');
console.log(content); // File contents as string
```

#### `sandbox.filesystem.writeFile(path, content)`

Writes content to a file, creating it if it doesn't exist.

```typescript
await sandbox.filesystem.writeFile('/path/to/file.txt', 'Hello World!');
```

#### `sandbox.filesystem.mkdir(path)`

Creates a directory (and parent directories if needed).

```typescript
await sandbox.filesystem.mkdir('/path/to/new/directory');
```

#### `sandbox.filesystem.readdir(path)`

Lists the contents of a directory.

```typescript
const entries = await sandbox.filesystem.readdir('/path/to/directory');
entries.forEach(entry => {
  console.log(`${entry.name} (${entry.isDirectory ? 'dir' : 'file'}) - ${entry.size} bytes`);
});
```

#### `sandbox.filesystem.exists(path)`

Checks if a file or directory exists.

```typescript
const exists = await sandbox.filesystem.exists('/path/to/check');
if (exists) {
  console.log('Path exists!');
}
```

#### `sandbox.filesystem.remove(path)`

Removes a file or directory.

```typescript
await sandbox.filesystem.remove('/path/to/delete');
```

### Terminal Operations (E2B Only)

E2B provides interactive terminal support with PTY (pseudo-terminal) sessions:

#### `sandbox.terminal.create(options?)`

Creates an interactive terminal session.

```typescript
import { e2b } from '@computesdk/e2b';

const sandbox = e2b();

// Create interactive terminal
const terminal = await sandbox.terminal.create({
  command: 'bash',  // Command to run (default: 'bash')
  cols: 80,         // Terminal width
  rows: 24          // Terminal height
});

// Write commands to terminal
await terminal.write('echo "Hello from terminal!"\n');
await terminal.write('python --version\n');

// Handle terminal output
terminal.onData = (data: Uint8Array) => {
  const output = new TextDecoder().decode(data);
  console.log('Terminal output:', output);
};

// Clean up
await terminal.kill();
```

#### `sandbox.terminal.list()`

Lists all active terminal sessions.

```typescript
const terminals = await sandbox.terminal.list();
console.log(`Active terminals: ${terminals.length}`);
```

## Error Handling

ComputeSDK provides comprehensive error handling:

```typescript
try {
  const sandbox = ComputeSDK.createSandbox();
  const result = await sandbox.execute('invalid python code');
} catch (error) {
  if (error.message.includes('Missing') && error.message.includes('API key')) {
    console.error('Authentication Error: Check your environment variables');
  } else if (error.message.includes('timeout')) {
    console.error('Timeout Error: Execution took too long');
  } else if (error.message.includes('quota') || error.message.includes('limit')) {
    console.error('Quota Error: API usage limits exceeded');
  } else if (error.message.includes('not installed')) {
    console.error('Configuration Error: Provider package not installed');
  } else {
    console.error('Execution Error:', error.message);
  }
}
```

## Examples

### Data Science with E2B

```typescript
import { e2b } from '@computesdk/e2b';

const sandbox = e2b();

const result = await sandbox.execute(`
import matplotlib.pyplot as plt
import numpy as np

# Generate data
x = np.linspace(0, 10, 100)
y = np.sin(x)

# Create plot
plt.figure(figsize=(10, 6))
plt.plot(x, y, 'b-', linewidth=2)
plt.title('Sine Wave')
plt.xlabel('x')
plt.ylabel('sin(x)')
plt.grid(True)
plt.savefig('sine_wave.png')
plt.show()

print("Plot saved as sine_wave.png")
`);

console.log(result.stdout);
```

### Filesystem Operations

```typescript
import { e2b } from '@computesdk/e2b';

const sandbox = e2b();

// Create a directory structure
await sandbox.filesystem.mkdir('/project/data');
await sandbox.filesystem.mkdir('/project/output');

// Write configuration file
const config = JSON.stringify({
  name: 'My Project',
  version: '1.0.0',
  settings: { debug: true }
}, null, 2);

await sandbox.filesystem.writeFile('/project/config.json', config);

// Create a Python script
const script = `
import json
import os

# Read configuration
with open('/project/config.json', 'r') as f:
    config = json.load(f)

print(f"Project: {config['name']} v{config['version']}")

# Process data
data = [1, 2, 3, 4, 5]
result = sum(data)

# Write results
with open('/project/output/results.txt', 'w') as f:
    f.write(f"Sum: {result}\\n")
    f.write(f"Count: {len(data)}\\n")

print("Processing complete!")
`;

await sandbox.filesystem.writeFile('/project/process.py', script);

// Execute the script
const result = await sandbox.execute('python /project/process.py');
console.log(result.stdout);

// Read the results
const results = await sandbox.filesystem.readFile('/project/output/results.txt');
console.log('Results:', results);

// List all files in the project
const files = await sandbox.filesystem.readdir('/project');
console.log('Project files:');
files.forEach(file => {
  console.log(`  ${file.name} (${file.isDirectory ? 'directory' : 'file'})`);
});

await sandbox.kill();
```

### Cross-Provider Filesystem Example

```typescript
import { vercel } from '@computesdk/vercel';
import { daytona } from '@computesdk/daytona';

async function processData(sandbox: any) {
  // Create workspace
  await sandbox.filesystem.mkdir('/workspace');
  
  // Write input data
  await sandbox.filesystem.writeFile('/workspace/input.json', 
    JSON.stringify({ numbers: [1, 2, 3, 4, 5] })
  );
  
  // Process with code execution
  const result = await sandbox.execute(`
import json

# Read input
with open('/workspace/input.json', 'r') as f:
    data = json.load(f)

# Process
numbers = data['numbers']
result = {
    'sum': sum(numbers),
    'average': sum(numbers) / len(numbers),
    'count': len(numbers)
}

# Write output
with open('/workspace/output.json', 'w') as f:
    json.dump(result, f, indent=2)

print("Processing complete!")
  `);
  
  // Read results
  const output = await sandbox.filesystem.readFile('/workspace/output.json');
  return JSON.parse(output);
}

// Use with any provider
const vercelSandbox = vercel();
const vercelResult = await processData(vercelSandbox);
console.log('Vercel result:', vercelResult);

const daytonaSandbox = daytona();
const daytonaResult = await processData(daytonaSandbox);
console.log('Daytona result:', daytonaResult);
```

## Development

### Package Structure

```
computesdk/                    # Main SDK package
├── @computesdk/e2b           # E2B provider
├── @computesdk/vercel        # Vercel provider
└── @computesdk/daytona       # Daytona provider
```

### Building

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run examples
cd examples/basic && pnpm run e2b
```

### Creating Custom Providers

```typescript
import { BaseProvider, BaseComputeSandbox } from 'computesdk';

class MyProvider extends BaseProvider implements BaseComputeSandbox {
  provider = 'my-provider';
  sandboxId = 'my-sandbox-id';
  
  async execute(code: string) {
    // Implementation
  }
  
  async runCode(code: string) {
    // Implementation
  }
  
  async runCommand(command: string, args?: string[]) {
    // Implementation
  }
  
  async kill() {
    // Implementation  
  }
  
  async getInfo() {
    // Implementation
  }
}

export function myProvider(options = {}) {
  return new MyProvider(options);
}
```

## Provider Status

| Provider | Status | Code Execution | Filesystem | Terminal | Features |
|----------|--------|----------------|------------|----------|----------|
| **E2B** | ✅ Complete | ✅ Python | ✅ Native | ✅ PTY | Data science libraries, interactive terminals |
| **Vercel** | ✅ Complete | ✅ Node.js, Python | ✅ Shell-based | ❌ | Global deployment, up to 45min runtime |
| **Daytona** | ✅ Complete | ✅ Python, Node.js | ✅ Full | ❌ | Development workspaces, custom environments |

### Feature Matrix

- **✅ Complete**: Fully implemented and tested
- **🎯 Community**: Available for community contribution
- **❌ Not Available**: Not supported by the provider

## Resources

- 📖 **[Full Documentation](https://computesdk.com)** - Complete guides and API reference
- 🚀 **[Getting Started](https://computesdk.com/getting-started)** - Quick setup guide
- 💡 **[Examples](./examples)** - Real-world usage examples
- 🎯 **[Providers](https://computesdk.com/providers)** - Provider-specific guides

## Contributing

ComputeSDK is open source and welcomes contributions! Whether you're fixing bugs, adding features, or improving documentation, we'd love your help.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Community & Support

- 💬 **[GitHub Discussions](https://github.com/computesdk/computesdk/discussions)** - Ask questions and share ideas
- 🐛 **[GitHub Issues](https://github.com/computesdk/computesdk/issues)** - Report bugs and request features
- 📧 **[Contact Us](https://computesdk.com/contact)** - Get in touch with the team

## License

MIT License - see the [LICENSE](LICENSE) file for details.

---

<div align="center">
  <strong>Built with ❤️ by the ComputeSDK team</strong><br>
  <a href="https://computesdk.com">computesdk.com</a>
</div>
