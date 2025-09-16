# Quick Start

Welcome to ComputeSDK! This guide will get you up and running with secure, isolated code execution across multiple cloud providers using a unified TypeScript interface.

## Installation

```bash
# Core SDK
npm install computesdk

# Provider packages (install only what you need)
npm install @computesdk/e2b        # E2B provider
npm install @computesdk/vercel     # Vercel provider  
npm install @computesdk/daytona    # Daytona provider
npm install @computesdk/modal      # Modal provider
npm install @computesdk/codesandbox # CodeSandbox provider

# Frontend integration (optional)
npm install @computesdk/ui         # React hooks and utilities
```

## Basic Usage

```typescript
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

// Set default provider
compute.setConfig({ 
  defaultProvider: e2b({ apiKey: process.env.E2B_API_KEY }) 
});

// Create a sandbox
const sandbox = await compute.sandbox.create();

// Execute code
const result = await sandbox.runCode('print("Hello World!")');
console.log(result.stdout); // "Hello World!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

## Provider-Specific Setup

### E2B - Full Development Environment

```typescript
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

compute.setConfig({ 
  defaultProvider: e2b({ apiKey: process.env.E2B_API_KEY }) 
});

const sandbox = await compute.sandbox.create();

// Execute Python with data science libraries
const result = await sandbox.runCode(`
import pandas as pd
import numpy as np

data = {'A': [1, 2, 3], 'B': [4, 5, 6]}
df = pd.DataFrame(data)
print(df)
print(f"Sum: {df.sum().sum()}")
`);

console.log(result.stdout);
```

### Vercel - Serverless Execution

```typescript
import { compute } from 'computesdk';
import { vercel } from '@computesdk/vercel';

compute.setConfig({ 
  defaultProvider: vercel({ runtime: 'node' }) 
});

const sandbox = await compute.sandbox.create();

// Execute Node.js or Python
const result = await sandbox.runCode(`
console.log('Node.js version:', process.version);
console.log('Hello from Vercel!');
`);

console.log(result.stdout);
```

### Daytona - Development Workspaces

```typescript
import { compute } from 'computesdk';
import { daytona } from '@computesdk/daytona';

compute.setConfig({ 
  defaultProvider: daytona({ apiKey: process.env.DAYTONA_API_KEY }) 
});

const sandbox = await compute.sandbox.create();

// Execute in development workspace
const result = await sandbox.runCode(`
print('Hello from Daytona!')
import sys
print(f'Python version: {sys.version}')
`);

console.log(result.stdout);
```

### Modal - GPU-Accelerated Python Workloads

```typescript
import { compute } from 'computesdk';
import { modal } from '@computesdk/modal';

compute.setConfig({ 
  defaultProvider: modal({ 
    tokenId: process.env.MODAL_TOKEN_ID,
    tokenSecret: process.env.MODAL_TOKEN_SECRET 
  }) 
});

const sandbox = await compute.sandbox.create();

// Execute GPU-accelerated Python workloads
const result = await sandbox.runCode(`
import torch
print(f'PyTorch version: {torch.__version__}')
print(f'CUDA available: {torch.cuda.is_available()}')

# Example GPU computation
if torch.cuda.is_available():
    x = torch.rand(1000, 1000).cuda()
    y = torch.mm(x, x)
    print(f'GPU computation result shape: {y.shape}')
else:
    print('Running on CPU')
`);

console.log(result.stdout);
```

### CodeSandbox - Collaborative Sandboxes

```typescript
import { compute } from 'computesdk';
import { codesandbox } from '@computesdk/codesandbox';

compute.setConfig({ 
  defaultProvider: codesandbox({ 
    apiKey: process.env.CSB_API_KEY 
  }) 
});

const sandbox = await compute.sandbox.create();

// Execute in collaborative environment
const result = await sandbox.runCode(`
const message = "Hello from CodeSandbox!";
console.log(message);

const data = { users: 3, tasks: 15 };
console.log(JSON.stringify(data, null, 2));
`);

console.log(result.stdout);
```

## Filesystem Operations

```typescript
// Write file
await sandbox.filesystem.writeFile('/tmp/hello.py', 'print("Hello")');

// Read file
const content = await sandbox.filesystem.readFile('/tmp/hello.py');

// Create directory
await sandbox.filesystem.mkdir('/tmp/mydir');

// List directory
const files = await sandbox.filesystem.readdir('/tmp');

// Check if exists
const exists = await sandbox.filesystem.exists('/tmp/hello.py');

// Remove file/directory
await sandbox.filesystem.remove('/tmp/hello.py');
```

## Shell Commands

```typescript
// Run shell command
const result = await sandbox.runCommand('ls', ['-la']);
console.log(result.stdout);

// With different working directory
const result2 = await sandbox.runCommand('pwd', [], { cwd: '/tmp' });
```

## Error Handling

```typescript
try {
  const sandbox = await compute.sandbox.create();
  const result = await sandbox.runCode('invalid code');
} catch (error) {
  console.error('Execution failed:', error.message);
  // Handle specific error types as needed
}
```

