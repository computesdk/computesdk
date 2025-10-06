# Code Execution

ComputeSDK provides powerful code execution capabilities across multiple languages and environments. Execute scripts, run commands, manage processes, and handle input/output streams with ease.

## Quick Start

```typescript
import { createCompute } from 'computesdk'

const compute = createCompute()
const sandbox = await compute.sandbox.create()

// Execute a simple command
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

### runCommand() Method

Execute commands and scripts in the sandbox:

```typescript
// Basic command execution
const result = await sandbox.runCommand('ls', ['-la'])
console.log(result.stdout)

// Run a Python script with arguments
const result = await sandbox.runCommand('python', ['script.py', 'arg1', 'arg2'])

// Run a command in the background (non-blocking)
// Note: The command will still complete and return a result when done
const result = await sandbox.runCommand('long-running-command', [], {
  background: true
})

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
