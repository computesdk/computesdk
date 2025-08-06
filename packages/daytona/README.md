# @computesdk/daytona

Daytona provider for ComputeSDK - Execute code in Daytona workspaces.

## Installation

```bash
pnpm install @computesdk/daytona
```

## Usage

```typescript
import { daytona } from '@computesdk/daytona';

// Create a Daytona sandbox
const sandbox = daytona({
  runtime: 'python',
  timeout: 30000
});

// Execute code
const result = await sandbox.execute('print("Hello from Daytona!")');
console.log(result.stdout); // "Hello from Daytona!"

// Run commands
const cmdResult = await sandbox.runCommand('ls', ['-la']);
console.log(cmdResult.stdout);

// File operations
await sandbox.filesystem.writeFile('/tmp/test.py', 'print("Hello World")');
const content = await sandbox.filesystem.readFile('/tmp/test.py');
console.log(content); // 'print("Hello World")'

// Clean up
await sandbox.kill();
```

## Configuration

Set your Daytona API key as an environment variable:

```bash
export DAYTONA_API_KEY=your_api_key_here
```

## Features

- ✅ Code execution in Python, Node.js, and other runtimes
- ✅ Command execution
- ✅ File system operations (read, write, mkdir, etc.)
- ❌ Interactive terminal sessions (not supported)

## API Reference

### `daytona(config?)`

Creates a new Daytona sandbox instance.

**Parameters:**
- `config` (optional): Configuration object
  - `runtime`: Runtime environment ('python', 'node', etc.)
  - `timeout`: Execution timeout in milliseconds

**Returns:** `DaytonaProvider` instance

### Methods

- `execute(code, runtime?)`: Execute code in the sandbox
- `runCode(code, runtime?)`: Alias for execute
- `runCommand(command, args?)`: Execute shell commands
- `kill()`: Terminate the sandbox
- `getInfo()`: Get sandbox information

### File System

- `filesystem.readFile(path)`: Read file contents
- `filesystem.writeFile(path, content)`: Write file contents
- `filesystem.mkdir(path)`: Create directory
- `filesystem.readdir(path)`: List directory contents
- `filesystem.exists(path)`: Check if file/directory exists
- `filesystem.remove(path)`: Remove file/directory

## License

MIT