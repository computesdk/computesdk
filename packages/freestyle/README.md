# @computesdk/freestyle

Freestyle provider for ComputeSDK - Execute code in secure, isolated Freestyle sandboxes.

## Installation

```bash
npm install @computesdk/freestyle
```

## Usage

### Basic Usage

```typescript
import { freestyle } from '@computesdk/freestyle';

// Create a Freestyle sandbox
const sandbox = freestyle({
  runtime: 'node', 
  timeout: 300000,   // 5 minutes
});

// Execute Node.js code
const result = await sandbox.execute(`
console.log("Hello from Freestyle!")
x = 2 + 2
console.log("2 + 2 = " + x)
`);

console.log(result.stdout); // "Hello from Freestyle!\n2 + 2 = 4"

// Execute shell commands
const cmdResult = await sandbox.runCommand('echo', ['Hello World']);
console.log(cmdResult.stdout); // "Hello World"

// File system operations
await sandbox.filesystem.writeFile('/tmp/test.txt', 'Hello, World!');
const content = await sandbox.filesystem.readFile('/tmp/test.txt');
console.log(content); // "Hello, World!"

// Clean up
await sandbox.kill();
```

### Git Repository Integration

```typescript
import { freestyle } from '@computesdk/freestyle';

// Create a Freestyle sandbox
const sandbox = freestyle({
  runtime: 'node',
  timeout: 300000,
});

// Create a git repository
const { repoId } = await sandbox.createGitRepository({
  name: "Test Repository",
  public: true,
});

console.log(`Created repo with ID: ${repoId}`);

// Create a new sandbox with the repository
const repoSandbox = freestyle({
  repoId: repoId,
  runtime: 'node',
  timeout: 300000,
});

// The dev server will now have access to the repository files
const result = await repoSandbox.execute(`
console.log("Repository files:")
for root, dirs, files in os.walk("/"):
    for file in files[:5]:  # Show first 5 files
        console.log(os.path.join(root, file))
    break
`);

console.log(result.stdout);

// Clean up
await repoSandbox.kill();
```

## Configuration

The Freestyle provider requires an API key:

```bash
export FREESTYLE_API_KEY="your-freestyle-api-key"
```

### Options

```typescript
interface FreestyleConfig {
  provider?: 'freestyle';
  runtime?: 'node';
  timeout?: number; // milliseconds
  repoId?: string; // Optional repository ID for git integration
  apiKey?: string; // Optional API key (defaults to FREESTYLE_API_KEY env var)
}
```

## Features

- **Code Execution**: Execute Node.js code
- **File System**: Full file system operations (read, write, mkdir, etc.)
- **Shell Commands**: Execute shell commands with arguments
- **Error Handling**: Comprehensive error handling with detailed messages
- **TypeScript**: Full TypeScript support with type definitions

## API Reference

### Methods

#### `execute(code: string, runtime?: Runtime): Promise<ExecutionResult>`

Execute code in the sandbox.

#### `runCode(code: string, runtime?: Runtime): Promise<ExecutionResult>`

Alias for `execute()`.

#### `runCommand(command: string, args?: string[]): Promise<ExecutionResult>`

Execute shell commands.

#### `kill(): Promise<void>`

Terminate the sandbox.

#### `getInfo(): Promise<SandboxInfo>`

Get sandbox information.

#### `createGitRepository(options: CreateRepositoryOptions): Promise<{ repoId: string }>`

Create a git repository that can be used with Freestyle sandboxes.

```typescript
interface CreateRepositoryOptions {
  name: string;
  public?: boolean;
  source?: {
    url: string;
    type: 'git';
  };
}
```

### File System

#### `filesystem.readFile(path: string): Promise<string>`

Read file contents.

#### `filesystem.writeFile(path: string, content: string): Promise<void>`

Write file contents.

#### `filesystem.mkdir(path: string): Promise<void>`

Create directory.

#### `filesystem.readdir(path: string): Promise<FileEntry[]>`

List directory contents.

#### `filesystem.exists(path: string): Promise<boolean>`

Check if file/directory exists.

#### `filesystem.remove(path: string): Promise<void>`

Remove file or directory.

## Error Handling

The provider throws specific errors for different scenarios:

- **Authentication errors**: Invalid or missing API key
- **Execution errors**: Code execution failures
- **Timeout errors**: Operations exceeding the timeout limit
- **File system errors**: File/directory operation failures

## License

MIT