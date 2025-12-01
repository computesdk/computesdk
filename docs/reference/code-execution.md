# Code Execution

ComputeSDK provides powerful code execution capabilities across multiple languages and environments. Execute scripts, run commands, manage processes, and handle input/output streams with ease.

## Quick Start

```typescript
import { createCompute } from 'computesdk'

const compute = createCompute()
const sandbox = await compute.sandbox.create()

// Execute code directly (auto-detects runtime)
const result = await sandbox.runCode('print("Hello, World!")')
console.log(result.stdout) // "Hello, World!"

// Execute a shell command
const result = await sandbox.runCommand('python', ['-c', 'print("Hello, World!")'])
console.log(result.stdout) // "Hello, World!"

// Run a script file
const output = await sandbox.runCommand('python', ['main.py'])
```

## Basic Code Execution

### runCommand() Method

Execute shell commands directly:

```typescript
// Simple command execution
const result = await sandbox.runCommand('ls', ['-la'])
console.log(result.stdout)

// Command with arguments
const result = await sandbox.runCommand('python', ['-c', 'print("Hello")'])

// With options
const result = await sandbox.runCommand('npm', ['install'], {
  cwd: '/app',
  env: { NODE_ENV: 'development' }
})
```


### runCode() Method

Execute code directly in the sandbox with automatic runtime detection:

```typescript
// Execute JavaScript/Node.js code
const result = await sandbox.runCode('console.log("Hello from Node.js!")')
console.log(result.stdout) // "Hello from Node.js!"

// Execute Python code  
const result = await sandbox.runCode('print("Hello from Python!")')
console.log(result.stdout) // "Hello from Python!"

// Specify runtime explicitly
const result = await sandbox.runCode('console.log("Hello")', 'node')
const result = await sandbox.runCode('print("Hello")', 'python')
```

#### Runtime Auto-Detection

When no runtime is specified, `runCode` automatically detects the language:

```typescript
// Auto-detected as Python
await sandbox.runCode('print("Hello World")')
await sandbox.runCode('import json; print(json.dumps({"key": "value"}))')

// Auto-detected as Node.js
await sandbox.runCode('console.log("Hello World")')
await sandbox.runCode('const fs = require("fs"); console.log("Node.js")')

// Multi-line code execution
const result = await sandbox.runCode(`
  const data = [1, 2, 3, 4, 5];
  const sum = data.reduce((acc, val) => acc + val, 0);
  console.log('Sum:', sum);
`)
```

#### Error Handling

```typescript
// Handle execution errors
const result = await sandbox.runCode('console.log("test")')

if (result.exitCode === 0) {
  console.log('Success:', result.stdout)
} else {
  console.log('Error:', result.stderr)
}

// Syntax errors throw exceptions
try {
  await sandbox.runCode('print("missing quote)')
} catch (error) {
  console.log('Syntax error:', error.message)
}
```

#### JavaScript/Node.js Examples

```typescript
// File operations
await sandbox.runCode(`
  const fs = require('fs');
  const data = { message: 'Hello World', timestamp: Date.now() };
  fs.writeFileSync('output.json', JSON.stringify(data, null, 2));
  console.log('File written successfully');
`)

// API calls (if modules are available)
await sandbox.runCode(`
  const https = require('https');
  console.log('Making API request...');
  // API logic here
`)
```

#### Python Examples  

```typescript
// Data processing
await sandbox.runCode(`
import json
import math

data = [1, 2, 3, 4, 5]
stats = {
    'sum': sum(data),
    'average': sum(data) / len(data),
    'max': max(data),
    'min': min(data)
}

print(json.dumps(stats, indent=2))
`)

// File operations
await sandbox.runCode(`
with open('data.txt', 'w') as f:
    f.write('Hello from Python!')
    
print('File created successfully')
`)
```

## Execution Result Interface

```typescript
interface ExecutionResult {
  // Standard output from the command
  stdout: string;
  
  // Standard error output
  stderr: string;
  
  // Exit code (0 = success)
  exitCode: number;
  
  // Execution time in milliseconds
  executionTime: number;
  
  // ID of the sandbox where the command was executed
  sandboxId: string;
  
  // Name of the provider that executed the command
  provider: string;
  
  // Indicates if the command was run in the background
  isBackground?: boolean;
  
  // Process ID (not available for background processes)
  pid?: number;
}
```

## Running Python Code

You can run Python code using the `runCommand` method with the Python interpreter:

```typescript
// Execute a simple Python one-liner
const result = await sandbox.runCommand('python', [
  '-c',
  'print("Hello from Python!"); import math; print(f"Square root of 16 is {math.sqrt(16)}")'
]);
console.log(result.stdout);
// Output:
// Hello from Python!
// Square root of 16 is 4.0

// Run a Python script from a file
const scriptResult = await sandbox.runCommand('python', ['script.py']);

// Run Python with arguments
const argsResult = await sandbox.runCommand('python', [
  'process_data.py',
  '--input', 'data.csv',
  '--output', 'result.json'
]);

// Install Python packages and run a script
await sandbox.runCommand('pip', ['install', 'numpy', 'pandas']);
const analysisResult = await sandbox.runCommand('python', ['analyze.py']);
```

### Virtual Environments

To use a Python virtual environment, you can activate it before running your commands:

```typescript
// Activate virtual environment and run a script
const venvResult = await sandbox.runCommand('bash', [
  '-c',
  'source /path/to/venv/bin/activate && python script.py'
]);
```

### Node.js

```typescript
// Execute JavaScript/Node.js code
const result = await sandbox.runCommand('node', ['-e', `
const fs = require('fs')
const data = { message: 'Hello from Node.js' }
fs.writeFileSync('output.json', JSON.stringify(data))
console.log('File written successfully')
`)
