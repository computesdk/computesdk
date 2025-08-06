# ComputeSDK

A unified abstraction layer for executing code in secure, isolated sandboxed environments across multiple cloud providers.

Similar to how Vercel's AI SDK abstracts different LLM providers, ComputeSDK abstracts different compute sandbox providers into a single, consistent TypeScript interface.

## Features

- 🚀 **Multi-provider support** - E2B, Vercel, Daytona
- 📁 **Filesystem operations** - Read, write, create directories across providers
- 🖥️ **Terminal support** - Interactive PTY terminals (E2B)
- ⚡ **Command execution** - Run shell commands directly
- 🔄 **Auto-detection** - Automatically selects providers based on environment variables
- 🛡️ **Type-safe** - Full TypeScript support with comprehensive error handling
- 📦 **Modular** - Install only the providers you need
- 🔧 **Extensible** - Easy to add custom providers

## Supported Providers

| Provider | Code Execution | Filesystem | Terminal | Use Cases |
|----------|----------------|------------|----------|-----------|
| **E2B** | Python | ✅ Full | ✅ PTY | Data science, AI/ML, interactive development |
| **Vercel** | Node.js, Python | ✅ Full | ❌ | Web apps, APIs, serverless functions |
| **Daytona** | Python, Node.js | ✅ Full | ❌ | Development workspaces, custom environments |

## Installation

```bash
# Core SDK
npm install computesdk

# Provider packages (install only what you need)
npm install @computesdk/e2b        # E2B provider
npm install @computesdk/vercel     # Vercel provider
npm install @computesdk/daytona    # Daytona provider
```

## Quick Start

### Auto-detection (Recommended)

ComputeSDK automatically detects available providers based on environment variables:

```typescript
import { ComputeSDK } from 'computesdk';

// Automatically detects and uses the first available provider
const sandbox = ComputeSDK.createSandbox();

const result = await sandbox.execute('print("Hello World!")');
console.log(result.stdout); // "Hello World!"

await sandbox.kill();
```

### Provider-specific Usage

```typescript
import { executeSandbox } from 'computesdk';
import { e2b } from '@computesdk/e2b';

// Execute with specific provider
const result = await executeSandbox({
  sandbox: e2b(),
  code: 'print("Hello from E2B!")',
  runtime: 'python'
});

console.log(result.stdout);
```

### Advanced Usage with Type Safety

ComputeSDK provides rich TypeScript interfaces for different provider capabilities:

```typescript
import { ComputeSDK, FilesystemComputeSandbox, TerminalComputeSandbox } from 'computesdk';

const sandbox = ComputeSDK.createSandbox();

// Check provider capabilities at runtime
if ('filesystem' in sandbox) {
  const fsSandbox = sandbox as FilesystemComputeSandbox;
  
  // Use filesystem operations
  await fsSandbox.filesystem.writeFile('/tmp/data.txt', 'Hello World!');
  const content = await fsSandbox.filesystem.readFile('/tmp/data.txt');
  console.log(content); // "Hello World!"
}

if ('terminal' in sandbox) {
  const termSandbox = sandbox as TerminalComputeSandbox;
  
  // Create interactive terminal (E2B only)
  const terminal = await termSandbox.terminal.create({
    command: 'bash',
    cols: 80,
    rows: 24
  });
  
  await terminal.write('echo "Interactive terminal!"\n');
  await terminal.kill();
}
```

## Environment Setup

Each provider requires specific environment variables for authentication:

### E2B (Full Features)
```bash
export E2B_API_KEY=e2b_your_api_key_here
```
Get your API key from [e2b.dev](https://e2b.dev/)

### Vercel (Filesystem + Code Execution)
```bash
export VERCEL_TOKEN=your_vercel_token_here
export VERCEL_TEAM_ID=your_team_id_here
export VERCEL_PROJECT_ID=your_project_id_here
```
Get your token from [Vercel Account Tokens](https://vercel.com/account/tokens)

### Daytona (Development Workspaces)
```bash
export DAYTONA_API_KEY=your_daytona_api_key_here
```



## API Reference

### Core SDK

#### `ComputeSDK.createSandbox(config?)`

Creates a sandbox using auto-detection or specified configuration.

```typescript
// Auto-detection
const sandbox = ComputeSDK.createSandbox();

// With configuration
const sandbox = ComputeSDK.createSandbox({
  provider: 'e2b',
  runtime: 'python',
  timeout: 600000 // 10 minutes
});
```

**Parameters:**
- `config` (optional): Sandbox configuration object

**Returns:** `ComputeSandbox` - The appropriate sandbox type based on provider capabilities

#### `ComputeSDK.detectProviders()`

Detects available providers based on environment variables.

```typescript
const providers = ComputeSDK.detectProviders();
console.log('Available providers:', providers); // ['e2b', 'vercel']
```

**Returns:** `ProviderType[]` - Array of available provider names

### Utility Functions

#### `executeSandbox(params)`

Utility function for one-off code execution.

```typescript
import { executeSandbox } from 'computesdk';
import { vercel } from '@computesdk/vercel';

const result = await executeSandbox({
  sandbox: vercel({ runtime: 'node' }),
  code: 'console.log("Hello from Node.js!");',
  runtime: 'node'
});
```

**Parameters:**
```typescript
interface ExecuteSandboxParams {
  sandbox: ComputeSandbox;
  code: string;
  runtime?: Runtime;
}
```

### Sandbox Interfaces

ComputeSDK provides a rich type system for different provider capabilities:

#### `BaseComputeSandbox`

Basic code execution capabilities (all providers support this):

```typescript
interface BaseComputeSandbox {
  provider: string;
  sandboxId: string;
  
  execute(code: string, runtime?: Runtime): Promise<ExecutionResult>;
  runCode(code: string, runtime?: Runtime): Promise<ExecutionResult>;
  runCommand(command: string, args?: string[]): Promise<ExecutionResult>;
  kill(): Promise<void>;
  getInfo(): Promise<SandboxInfo>;
}
```

#### `FilesystemComputeSandbox`

Extends base capabilities with filesystem operations (E2B, Vercel, Daytona):

```typescript
interface FilesystemComputeSandbox extends BaseComputeSandbox {
  readonly filesystem: SandboxFileSystem;
}

interface SandboxFileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  readdir(path: string): Promise<FileEntry[]>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
}
```

#### `TerminalComputeSandbox`

Extends base capabilities with terminal operations (E2B only):

```typescript
interface TerminalComputeSandbox extends BaseComputeSandbox {
  readonly terminal: SandboxTerminal;
}

interface SandboxTerminal {
  create(options?: TerminalCreateOptions): Promise<InteractiveTerminalSession>;
  list(): Promise<InteractiveTerminalSession[]>;
}
```

#### `FullComputeSandbox`

Full capabilities including filesystem and terminal (E2B only):

```typescript
interface FullComputeSandbox extends FilesystemComputeSandbox, TerminalComputeSandbox {}
```

### Data Types

#### `ExecutionResult`

Result object returned by all execution methods:

```typescript
interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  sandboxId: string;
  provider: string;
}
```

#### `SandboxInfo`

Information about a sandbox instance:

```typescript
interface SandboxInfo {
  id: string;
  provider: string;
  runtime: Runtime;
  status: 'running' | 'stopped' | 'error';
  createdAt: Date;
  timeout: number;
  metadata?: Record<string, any>;
}
```

#### `FileEntry`

File system entry information:

```typescript
interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  lastModified: Date;
}
```

## Examples

### Cross-Provider Data Processing

```typescript
import { ComputeSDK, FilesystemComputeSandbox } from 'computesdk';

async function processData() {
  // Auto-detect best available provider
  const sandbox = ComputeSDK.createSandbox();
  
  if ('filesystem' in sandbox) {
    const fsSandbox = sandbox as FilesystemComputeSandbox;
    
    // Create project structure
    await fsSandbox.filesystem.mkdir('/project/data');
    await fsSandbox.filesystem.mkdir('/project/output');
    
    // Write input data
    const data = JSON.stringify([
      { name: 'Alice', sales: 1000 },
      { name: 'Bob', sales: 1500 },
      { name: 'Charlie', sales: 800 }
    ]);
    
    await fsSandbox.filesystem.writeFile('/project/data/sales.json', data);
    
    // Process data based on provider
    let code: string;
    if (sandbox.provider === 'e2b') {
      // Python processing for E2B
      code = `
import json
import pandas as pd

# Read data
with open('/project/data/sales.json', 'r') as f:
    data = json.load(f)

# Process with pandas
df = pd.DataFrame(data)
total_sales = df['sales'].sum()
avg_sales = df['sales'].mean()

# Write results
results = {
    'total_sales': total_sales,
    'average_sales': avg_sales,
    'top_performer': df.loc[df['sales'].idxmax(), 'name']
}

with open('/project/output/results.json', 'w') as f:
    json.dump(results, f, indent=2)

print(f"Total Sales: ${total_sales}")
print(f"Average Sales: ${avg_sales:.2f}")
print(f"Top Performer: {results['top_performer']}")
      `;
    } else {
      // JavaScript processing for Vercel/Daytona
      code = `
const fs = require('fs');

// Read data
const data = JSON.parse(fs.readFileSync('/project/data/sales.json', 'utf8'));

// Process data
const totalSales = data.reduce((sum, person) => sum + person.sales, 0);
const avgSales = totalSales / data.length;
const topPerformer = data.reduce((top, person) => 
  person.sales > top.sales ? person : top
);

// Write results
const results = {
  total_sales: totalSales,
  average_sales: avgSales,
  top_performer: topPerformer.name
};

fs.writeFileSync('/project/output/results.json', JSON.stringify(results, null, 2));

console.log(\`Total Sales: $\${totalSales}\`);
console.log(\`Average Sales: $\${avgSales.toFixed(2)}\`);
console.log(\`Top Performer: \${results.top_performer}\`);
      `;
    }
    
    // Execute processing
    const result = await fsSandbox.execute(code);
    console.log('Processing Output:', result.stdout);
    
    // Read results
    const results = await fsSandbox.filesystem.readFile('/project/output/results.json');
    console.log('Results:', JSON.parse(results));
    
    // List generated files
    const outputFiles = await fsSandbox.filesystem.readdir('/project/output');
    console.log('Generated files:', outputFiles.map(f => f.name));
  }
  
  await sandbox.kill();
}

processData().catch(console.error);
```

### Interactive Development with E2B

```typescript
import { e2b } from '@computesdk/e2b';
import { TerminalComputeSandbox, FilesystemComputeSandbox } from 'computesdk';

async function interactiveDevelopment() {
  const sandbox = e2b() as TerminalComputeSandbox & FilesystemComputeSandbox;
  
  // Set up development environment
  await sandbox.filesystem.mkdir('/workspace');
  await sandbox.filesystem.writeFile('/workspace/requirements.txt', 
    'pandas\nnumpy\nmatplotlib\nscikit-learn'
  );
  
  // Create interactive terminal
  const terminal = await sandbox.terminal.create({
    command: 'bash',
    cols: 120,
    rows: 30
  });
  
  // Set up output handler
  terminal.onData = (data: Uint8Array) => {
    const output = new TextDecoder().decode(data);
    console.log('Terminal:', output);
  };
  
  // Install dependencies
  await terminal.write('cd /workspace\n');
  await terminal.write('pip install -r requirements.txt\n');
  
  // Start interactive Python session
  await terminal.write('python3\n');
  await terminal.write('import pandas as pd\n');
  await terminal.write('import numpy as np\n');
  await terminal.write('print("Development environment ready!")\n');
  
  // Simulate interactive development
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Clean up
  await terminal.kill();
  await sandbox.kill();
}

interactiveDevelopment().catch(console.error);
```

### Multi-Provider Comparison

```typescript
import { executeSandbox } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { vercel } from '@computesdk/vercel';
import { daytona } from '@computesdk/daytona';

async function compareProviders() {
  const testCode = `
import json
import time
start = time.time()

# Simple computation
result = sum(range(1000))
elapsed = time.time() - start

output = {
    "result": result,
    "elapsed_ms": round(elapsed * 1000, 2),
    "provider": "will_be_set"
}

print(json.dumps(output))
  `;
  
  const providers = [
    { name: 'E2B', factory: () => e2b() },
    { name: 'Vercel', factory: () => vercel({ runtime: 'python' }) },
    { name: 'Daytona', factory: () => daytona({ runtime: 'python' }) },
  ];
  
  console.log('Performance Comparison:');
  console.log('='.repeat(50));
  
  for (const { name, factory } of providers) {
    try {
      const start = Date.now();
      const result = await executeSandbox({
        sandbox: factory(),
        code: testCode,
        runtime: 'python'
      });
      const totalTime = Date.now() - start;
      
      const output = JSON.parse(result.stdout);
      console.log(`${name}:`);
      console.log(`  Computation: ${output.result}`);
      console.log(`  Execution time: ${output.elapsed_ms}ms`);
      console.log(`  Total time: ${totalTime}ms`);
      console.log(`  Provider overhead: ${totalTime - output.elapsed_ms}ms`);
      console.log();
      
    } catch (error) {
      console.log(`${name}: Failed - ${error.message}`);
      console.log();
    }
  }
}

compareProviders().catch(console.error);
```

## Error Handling

ComputeSDK provides comprehensive error handling with specific error types:

```typescript
import { ComputeSDK } from 'computesdk';

try {
  const sandbox = ComputeSDK.createSandbox();
  const result = await sandbox.execute('invalid python code');
} catch (error) {
  if (error.message.includes('Missing') && error.message.includes('API key')) {
    console.error('Authentication Error: Check your environment variables');
    console.error('Required: E2B_API_KEY, VERCEL_TOKEN, etc.');
  } else if (error.message.includes('timeout')) {
    console.error('Timeout Error: Execution took too long');
  } else if (error.message.includes('quota') || error.message.includes('limit')) {
    console.error('Quota Error: API usage limits exceeded');
  } else if (error.message.includes('not installed')) {
    console.error('Configuration Error: Provider package not installed');
    console.error('Run: npm install @computesdk/[provider-name]');
  } else {
    console.error('Execution Error:', error.message);
  }
}
```

## Provider-Specific Features

### E2B - Full Development Environment

E2B provides the richest feature set with full filesystem and terminal support:

```typescript
import { e2b } from '@computesdk/e2b';

const sandbox = e2b();

// Full Python environment with data science libraries
const result = await sandbox.execute(`
import pandas as pd
import matplotlib.pyplot as plt
import numpy as np

# Create and visualize data
data = np.random.randn(1000)
plt.hist(data, bins=50)
plt.savefig('/tmp/histogram.png')
print("Histogram saved!")
`);

// Check if file was created
const exists = await sandbox.filesystem.exists('/tmp/histogram.png');
console.log('Histogram created:', exists);
```

### Vercel - Scalable Serverless Execution

Vercel provides reliable execution with filesystem support:

```typescript
import { vercel } from '@computesdk/vercel';

const sandbox = vercel({ runtime: 'node' });

// Process data with Node.js
const result = await sandbox.execute(`
const fs = require('fs');
const path = require('path');

// Create API simulation
const apiData = {
  users: 1000,
  active: 750,
  revenue: 50000
};

// Write to filesystem
fs.writeFileSync('/tmp/api-data.json', JSON.stringify(apiData, null, 2));

console.log('API data processed and saved');
console.log('Active users:', apiData.active);
`);

// Read the generated data
const data = await sandbox.filesystem.readFile('/tmp/api-data.json');
console.log('Generated data:', JSON.parse(data));
```

### Daytona - Development Workspaces

Daytona provides development workspace environments with full filesystem support:

```typescript
import { daytona } from '@computesdk/daytona';

const sandbox = daytona({ runtime: 'python' });

// Execute Python code in workspace
const result = await sandbox.execute(`
import json
import os

# Create project structure
os.makedirs('/workspace/src', exist_ok=True)
os.makedirs('/workspace/tests', exist_ok=True)

# Write project files
with open('/workspace/src/main.py', 'w') as f:
    f.write('def hello():\\n    return "Hello from Daytona!"\\n')

with open('/workspace/tests/test_main.py', 'w') as f:
    f.write('from src.main import hello\\n\\ndef test_hello():\\n    assert hello() == "Hello from Daytona!"\\n')

print("Project structure created!")
print("Files:", os.listdir('/workspace'))
`);

// Check created files
const files = await sandbox.filesystem.readdir('/workspace');
console.log('Workspace files:', files.map(f => f.name));

// Read project file
const mainPy = await sandbox.filesystem.readFile('/workspace/src/main.py');
console.log('main.py content:', mainPy);
```



## Best Practices

### 1. Provider Selection

Choose providers based on your use case:

- **E2B**: Data science, ML, interactive development, full Python environment
- **Vercel**: Web applications, APIs, serverless functions, long-running tasks
- **Daytona**: Development workspaces, custom environments, team collaboration

### 2. Resource Management

Always clean up resources:

```typescript
const sandbox = ComputeSDK.createSandbox();
try {
  // Your code here
  const result = await sandbox.execute('print("Hello")');
} finally {
  // Always clean up
  await sandbox.kill();
}
```

### 3. Error Handling

Implement comprehensive error handling:

```typescript
async function robustExecution(code: string) {
  let sandbox;
  try {
    sandbox = ComputeSDK.createSandbox();
    return await sandbox.execute(code);
  } catch (error) {
    console.error('Execution failed:', error.message);
    throw error;
  } finally {
    if (sandbox) {
      await sandbox.kill();
    }
  }
}
```

### 4. Type Safety

Use TypeScript interfaces for better development experience:

```typescript
import { FilesystemComputeSandbox, TerminalComputeSandbox } from 'computesdk';

function requiresFilesystem(sandbox: FilesystemComputeSandbox) {
  // TypeScript ensures filesystem operations are available
  return sandbox.filesystem.readFile('/path/to/file');
}

function requiresTerminal(sandbox: TerminalComputeSandbox) {
  // TypeScript ensures terminal operations are available
  return sandbox.terminal.create({ command: 'bash' });
}
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](https://github.com/computesdk/computesdk/blob/main/CONTRIBUTING.md) for details.

### Adding New Providers

1. Implement the appropriate `ComputeSpecification` interface:
   - `BaseComputeSpecification` for basic execution
   - `FilesystemComputeSpecification` for filesystem support
   - `TerminalComputeSpecification` for terminal support
   - `FullComputeSpecification` for complete functionality

2. Add comprehensive tests covering all implemented interfaces

3. Include documentation and examples

4. Submit a pull request

## License

MIT - see [LICENSE](https://github.com/computesdk/computesdk/blob/main/LICENSE) for details.

## Support

- [GitHub Issues](https://github.com/computesdk/computesdk/issues)
- [Documentation](https://github.com/computesdk/computesdk)
- [Examples](https://github.com/computesdk/computesdk/tree/main/examples)

---

Made with ❤️ by the ComputeSDK team