# @computesdk/browser

Browser provider for ComputeSDK with LiveStore-backed filesystem.

## Features

- **In-browser execution** - Run JavaScript code directly in the browser
- **Virtual filesystem** - Full filesystem operations with in-memory storage
- **Command execution** - Basic shell commands (`echo`, `pwd`, `ls`)
- **LiveStore integration** - Event-sourced filesystem with OPFS persistence (planned)
- **Cross-tab sync** - Share filesystem state across browser tabs (planned)
- **Framework agnostic** - Works with any JavaScript framework

## Installation

```bash
npm install @computesdk/browser
# or
pnpm add @computesdk/browser
```

## Quick Start

```typescript
import { browser } from '@computesdk/browser'

// Create a browser sandbox
const sandbox = browser()

// Execute JavaScript code
const result = await sandbox.runCode('console.log("Hello, World!")')
console.log(result.stdout) // "Hello, World!\n"

// Use the filesystem
await sandbox.filesystem.writeFile('/hello.txt', 'Hello from browser!')
const content = await sandbox.filesystem.readFile('/hello.txt')
console.log(content) // "Hello from browser!"

// Execute shell commands
const lsResult = await sandbox.runCommand('ls')
console.log(lsResult.stdout) // Lists files in root directory
```

## API Reference

### `browser(options?)`

Creates a new browser sandbox instance.

**Options:**
- `cwd?: string` - Working directory (default: `/`)
- `resetPersistence?: boolean` - Reset persistence on initialization (default: `false`)

### BrowserSandbox

Implements the `FilesystemComputeSpecification` interface.

#### Core Methods

- `runCode(code: string, runtime?: Runtime): Promise<ExecutionResult>`
- `runCommand(command: string, args?: string[]): Promise<ExecutionResult>`
- `doExecute(code: string, runtime?: Runtime): Promise<ExecutionResult>`
- `doKill(): Promise<void>`
- `doGetInfo(): Promise<SandboxInfo>`

#### Filesystem Operations

- `filesystem.readFile(path: string): Promise<string>`
- `filesystem.writeFile(path: string, content: string): Promise<void>`
- `filesystem.mkdir(path: string): Promise<void>`
- `filesystem.readdir(path: string): Promise<FileEntry[]>`
- `filesystem.exists(path: string): Promise<boolean>`
- `filesystem.remove(path: string): Promise<void>`

## Supported Commands

The browser sandbox supports basic shell commands:

- `echo <text>` - Print text to stdout
- `pwd` - Print current working directory
- `ls [path]` - List directory contents

## Current Limitations

- **JavaScript only** - Python runtime not yet implemented
- **In-memory filesystem** - Files don't persist across page reloads (LiveStore integration planned)
- **Limited commands** - Only basic shell commands supported
- **No process management** - No long-running processes or job control

## Planned Features

- **LiveStore integration** - Persistent filesystem with OPFS storage
- **Cross-tab sync** - Share filesystem state across browser tabs
- **Terminal sessions** - Interactive terminal with PTY support
- **Python runtime** - Execute Python code using Pyodide
- **Package management** - Install and manage npm packages
- **Process management** - Background processes and job control

## Examples

### File Operations

```typescript
import { browser } from '@computesdk/browser'

const sandbox = browser()

// Create a project structure
await sandbox.filesystem.mkdir('/project')
await sandbox.filesystem.mkdir('/project/src')

// Write some files
await sandbox.filesystem.writeFile('/project/package.json', JSON.stringify({
  name: 'my-project',
  version: '1.0.0'
}, null, 2))

await sandbox.filesystem.writeFile('/project/src/index.js', `
console.log('Hello from my project!')
`)

// List project contents
const files = await sandbox.filesystem.readdir('/project')
console.log(files.map(f => f.name)) // ['package.json', 'src']
```

### Code Execution

```typescript
import { browser } from '@computesdk/browser'

const sandbox = browser()

// Execute JavaScript with console output
const result = await sandbox.runCode(`
const numbers = [1, 2, 3, 4, 5]
const sum = numbers.reduce((a, b) => a + b, 0)
console.log('Sum:', sum)
console.log('Average:', sum / numbers.length)
`)

console.log(result.stdout)
// Sum: 15
// Average: 3
```

### Command Execution

```typescript
import { browser } from '@computesdk/browser'

const sandbox = browser()

// Create some files
await sandbox.filesystem.writeFile('/file1.txt', 'content1')
await sandbox.filesystem.writeFile('/file2.txt', 'content2')

// List files using ls command
const result = await sandbox.runCommand('ls')
console.log(result.stdout)
// file1.txt
// file2.txt

// Echo command
const echoResult = await sandbox.runCommand('echo', ['Hello', 'World'])
console.log(echoResult.stdout) // "Hello World\n"
```

## Development Status

This package is in **early development**. The current implementation provides:

✅ **Working Features:**
- Basic JavaScript execution
- In-memory filesystem operations
- Simple command execution
- Full test coverage

🚧 **In Progress:**
- LiveStore integration for persistence
- Cross-tab synchronization

📋 **Planned:**
- Python runtime support
- Interactive terminal sessions
- Package management
- Advanced command support

## Contributing

This package is part of the ComputeSDK monorepo. See the main repository for contribution guidelines.

## License

MIT