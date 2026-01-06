# Sandbox (interface)

## Overview

Methods available for interacting with a compute sandbox.

<br/>
<br/>

---

## `runCommand(command, options?)`

Execute shell commands in the sandbox with full control over execution environment.

**Parameters:**

- `command` (string, required): The shell command to execute as a single string
- `options` (RunCommandOptions, optional): Execution options
  - `cwd` (string, optional): Working directory for command execution
  - `env` (Record<string, string>, optional): Environment variables to set
  - `timeout` (number, optional): Command timeout in milliseconds
  - `background` (boolean, optional): Run command in background without waiting for completion

**Returns:** `Promise<CommandResult>` - Command execution result with output streams, exit code, and duration

**CommandResult interface:**
- `stdout` (string): Standard output from the command
- `stderr` (string): Standard error output from the command
- `exitCode` (number): Exit code (0 for success, non-zero for errors)
- `durationMs` (number): Command execution duration in milliseconds

**Examples:**

```typescript
// Simple command execution
const result = await sandbox.runCommand('ls -la');
console.log(result.stdout);      // Directory listing
console.log(result.exitCode);    // 0
console.log(result.durationMs);  // 45

// Command with working directory
const result = await sandbox.runCommand('npm install', {
  cwd: '/app'
});
console.log(result.stdout);

// Command with environment variables
const result = await sandbox.runCommand('node server.js', {
  env: { 
    NODE_ENV: 'production',
    PORT: '3000'
  }
});

// Background command execution
const result = await sandbox.runCommand('npm run dev', {
  background: true
});
// Command runs in background, result returns immediately

// Combined options
const result = await sandbox.runCommand('python script.py', {
  cwd: '/app/scripts',
  env: { DEBUG: 'true' },
  timeout: 30000
});

// Error handling with exit codes
const result = await sandbox.runCommand('grep pattern file.txt');
if (result.exitCode !== 0) {
  console.error('Command failed:', result.stderr);
} else {
  console.log('Match found:', result.stdout);
}

// Multi-command execution (use shell operators)
const result = await sandbox.runCommand('cd /app && npm install && npm test');

// Command with shell pipes and redirects
const result = await sandbox.runCommand('cat data.txt | grep "error" | wc -l');
```

**Notes:**
- Commands are executed as a single string, not as separate command + arguments arrays
- Use shell operators (`&&`, `||`, `|`, etc.) within the command string for complex operations
- Non-zero exit codes indicate command failure but do not throw errors - check `exitCode` in the result
- Background commands return immediately with `exitCode: 0` without waiting for completion
- The command runs in a shell context, so all shell features (pipes, redirects, etc.) are available
- Available on all sandbox instances regardless of provider

<br/>
<br/>

---

## `runCode(code, language?)`

Execute code in the sandbox with automatic language detection or explicit runtime.

**Parameters:**

- `code` (string, required): The code to execute
- `language` ('node' | 'python' | 'deno' | 'bun', optional): Runtime environment for execution. Auto-detects if not specified.

**Returns:** `Promise<CodeResult>` - Execution result with output, exit code, and detected language

**CodeResult interface:**
- `output` (string): Combined output from code execution
- `exitCode` (number): Exit code (0 for success, non-zero for errors)
- `language` (string): Detected or specified programming language

**Examples:**

```typescript
// Auto-detect language (Python)
const result = await sandbox.runCode('print("Hello from Python")');
console.log(result.output);    // "Hello from Python\n"
console.log(result.exitCode);  // 0
console.log(result.language);  // "python"

// Auto-detect language (Node.js)
const result = await sandbox.runCode('console.log("Hello from Node.js")');
console.log(result.output);    // "Hello from Node.js\n"
console.log(result.language);  // "node"

// Explicit runtime
const result = await sandbox.runCode('console.log("Hello")', 'node');

// Multi-line Python code
const pythonResult = await sandbox.runCode(`
def greet(name):
    return f"Hello, {name}!"
    
print(greet("World"))
`, 'python');
console.log(pythonResult.output); // "Hello, World!\n"
```

**Notes:**
- Supports automatic language detection for Python and Node.js code
- Available on all sandbox instances regardless of provider
- Returns structured output with exit codes for error handling


<br/>
<br/>

---

## `getInfo()`

Get information about the sandbox including status, runtime, provider, and metadata.

**Parameters:** None

**Returns:** `Promise<SandboxInfo>` - Sandbox information including status, runtime, and configuration

**SandboxInfo interface:**
- `id` (string): Unique identifier for the sandbox
- `provider` (string): Provider hosting the sandbox (e.g., 'e2b', 'modal', 'docker')
- `runtime` (Runtime): Runtime environment ('node' | 'python' | 'deno' | 'bun')
- `status` (string): Current sandbox status ('running' | 'stopped' | 'error')
- `createdAt` (Date): Timestamp when the sandbox was created
- `timeout` (number): Execution timeout in milliseconds
- `metadata` (Record<string, any>, optional): Additional provider-specific metadata

**Examples:**

```typescript
// Basic usage - inspect sandbox info
const info = await sandbox.getInfo();
console.log(info.id);         // "sb_abc123..."
console.log(info.provider);   // "e2b"
console.log(info.runtime);    // "python"
console.log(info.status);     // "running"

// Check sandbox status
const info = await sandbox.getInfo();
if (info.status === 'running') {
  console.log('Sandbox is active');
  await sandbox.runCode('print("Hello")');
} else {
  console.log('Sandbox is not available');
}

// Access provider and runtime info
const info = await sandbox.getInfo();
console.log(`Running on ${info.provider} with ${info.runtime} runtime`);
console.log(`Created: ${info.createdAt.toISOString()}`);
console.log(`Timeout: ${info.timeout}ms`);

// Full info inspection for debugging
const info = await sandbox.getInfo();
console.log('Sandbox Information:');
console.log(`  ID: ${info.id}`);
console.log(`  Provider: ${info.provider}`);
console.log(`  Runtime: ${info.runtime}`);
console.log(`  Status: ${info.status}`);
console.log(`  Created: ${info.createdAt}`);
console.log(`  Timeout: ${info.timeout}ms`);
if (info.metadata) {
  console.log(`  Metadata:`, info.metadata);
}
```

**Notes:**
- Returns information about the sandbox's current state and configuration
- Gateway implementation returns locally cached information without making network calls
- The `metadata` field contains any custom metadata set during sandbox creation
- Available on all sandbox instances regardless of provider

<br/>
<br/>

---

## `getUrl(options)`

Get a publicly accessible URL for accessing services running on a specific port in the sandbox.

**Parameters:**

- `options` (object, required): URL configuration options
  - `port` (number, required): Port number where the service is running in the sandbox
  - `protocol` (string, optional): Protocol to use ('http' | 'https'). Defaults to 'https'

**Returns:** `Promise<string>` - Publicly accessible URL for the specified port

**Examples:**

```typescript
// Access web server on port 3000
const url = await sandbox.getUrl({ port: 3000 });
console.log(url);  // "https://sandbox-123-3000.preview.computesdk.com"

// Use URL to make HTTP request
const url = await sandbox.getUrl({ port: 8080 });
const response = await fetch(url);
console.log(await response.text());

// Specify HTTP protocol
const url = await sandbox.getUrl({ 
  port: 5000, 
  protocol: 'http' 
});
console.log(url);  // "http://sandbox-123-5000.preview.computesdk.com"

// Multiple services on different ports
const apiUrl = await sandbox.getUrl({ port: 3000 });
const wsUrl = await sandbox.getUrl({ port: 8080 });
console.log('API:', apiUrl);
console.log('WebSocket:', wsUrl);

// Start server and get URL
await sandbox.runCommand('npm start', { background: true });
await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for server
const url = await sandbox.getUrl({ port: 3000 });
console.log(`Server running at: ${url}`);

// Error case - accessing URL before service is ready
const url = await sandbox.getUrl({ port: 3000 });
try {
  const response = await fetch(url);
  console.log('Server is ready:', response.status);
} catch (error) {
  console.error('Service not running on port 3000 yet');
  // Wait and retry, or start the service first
}
```

**Notes:**
- Returns a publicly accessible URL that routes to the specified port in your sandbox
- URL construction is instantaneous (no network calls) - the URL is available immediately
- The service must be running on the specified port for the URL to be accessible

<br/>
<br/>

---

## `sandbox.filesystem`

ComputeSDK provides filesystem operations for managing files and directories within sandboxes. All filesystem operations are accessed through the `sandbox.filesystem` object.

### `filesystem.readFile(path)`

Read the contents of a file from the sandbox filesystem.

**Parameters:**

- `path` (string, required): Absolute path to the file to read within the sandbox

**Returns:** `Promise<string>` - File contents as UTF-8 encoded string

**Examples:**

```typescript
// Basic file reading
const content = await sandbox.filesystem.readFile('/app/config.txt');
console.log(content);  // "port=3000\nhost=localhost"

// Read a JSON file
const jsonContent = await sandbox.filesystem.readFile('/app/package.json');
const packageData = JSON.parse(jsonContent);
console.log(packageData.name);     // "my-app"
console.log(packageData.version);  // "1.0.0"

// Read configuration files
const envContent = await sandbox.filesystem.readFile('/app/.env');
console.log(envContent);  // "API_KEY=secret\nDEBUG=true"

// Error handling for non-existent files
try {
  const content = await sandbox.filesystem.readFile('/nonexistent.txt');
} catch (error) {
  console.error('Failed to read file:', error.message);
  // "Failed to read file: File not found: /nonexistent.txt"
}

// Check existence before reading
const filePath = '/app/optional-config.json';
if (await sandbox.filesystem.exists(filePath)) {
  const content = await sandbox.filesystem.readFile(filePath);
  console.log('Config loaded:', content);
} else {
  console.log('Config file not found, using defaults');
}

// Read after writing
await sandbox.filesystem.writeFile('/app/output.txt', 'Hello, World!');
const content = await sandbox.filesystem.readFile('/app/output.txt');
console.log(content);  // "Hello, World!"

// Read code files
const scriptContent = await sandbox.filesystem.readFile('/app/server.js');
console.log(scriptContent);  // "const express = require('express');\n..."

// Read markdown files
const readme = await sandbox.filesystem.readFile('/app/README.md');
console.log(readme);  // "# My Project\n\nDescription..."
```

**Notes:**
- Always returns UTF-8 encoded strings
- Throws an error if the file does not exist
- Requires absolute paths (paths should start with `/`)
- No encoding options available - always returns UTF-8
<br/>
<br/>

---

### `filesystem.writeFile(path, content)`

Write content to a file in the sandbox filesystem, creating the file if it doesn't exist.

**Parameters:**

- `path` (string, required): Absolute path where the file should be written
- `content` (string, required): Content to write to the file as UTF-8 text

**Returns:** `Promise<void>` - Resolves when the file is successfully written

**Examples:**

```typescript
// Basic file writing
await sandbox.filesystem.writeFile('/app/config.txt', 'port=3000\nhost=localhost');
console.log('File written successfully');

// Write JSON data
const data = { name: 'my-app', version: '1.0.0' };
await sandbox.filesystem.writeFile('/app/package.json', JSON.stringify(data, null, 2));

// Write configuration files
const envContent = 'API_KEY=secret\nDEBUG=true\nPORT=3000';
await sandbox.filesystem.writeFile('/app/.env', envContent);

// Overwrite existing files
await sandbox.filesystem.writeFile('/app/log.txt', 'First entry');
await sandbox.filesystem.writeFile('/app/log.txt', 'Second entry');
const content = await sandbox.filesystem.readFile('/app/log.txt');
console.log(content);  // "Second entry" (first entry was overwritten)

// Error handling
try {
  await sandbox.filesystem.writeFile('/app/data.json', JSON.stringify({ key: 'value' }));
  console.log('File created successfully');
} catch (error) {
  console.error('Failed to write file:', error.message);
}

// Write multiline content with template literals
const script = `#!/bin/bash
echo "Starting application..."
npm install
npm start
`;
await sandbox.filesystem.writeFile('/app/start.sh', script);

// Write then read to verify
const newContent = 'Hello, World!';
await sandbox.filesystem.writeFile('/app/greeting.txt', newContent);
const readBack = await sandbox.filesystem.readFile('/app/greeting.txt');
console.log(readBack === newContent);  // true
```

**Notes:**
- Always writes UTF-8 encoded text
- Creates the file if it doesn't exist
- Overwrites existing files completely (previous content is lost)
- Requires absolute paths (paths should start with `/`)
- No encoding options available - always UTF-8
<br/>
<br/>

---
### `filesystem.mkdir(path)`

Create a directory in the sandbox filesystem, automatically creating parent directories as needed.

**Parameters:**

- `path` (string, required): Absolute path of the directory to create

**Returns:** `Promise<void>` - Resolves when the directory is successfully created

**Examples:**

```typescript
// Basic directory creation
await sandbox.filesystem.mkdir('/app/data');
console.log('Directory created');

// Multiple directories for project structure
await sandbox.filesystem.mkdir('/app/src');
await sandbox.filesystem.mkdir('/app/tests');
await sandbox.filesystem.mkdir('/app/dist');

// Directory already exists - succeeds silently
await sandbox.filesystem.mkdir('/app/data');
await sandbox.filesystem.mkdir('/app/data'); // No error thrown
console.log('Both calls succeeded');

// Error handling
try {
  await sandbox.filesystem.mkdir('/app/project/data');
  console.log('Directory created successfully');
} catch (error) {
  console.error('Failed to create directory:', error.message);
}
```

**Notes:**
- Automatically creates parent directories as needed
- Does not throw an error if the directory already exists
- Requires absolute paths (paths should start with `/`)
- Throws errors only on actual failures (permissions, invalid paths, disk space issues)
<br/>
<br/>

---

### `filesystem.readdir(path)`

List the contents of a directory in the sandbox filesystem.

**Parameters:**

- `path` (string, required): Absolute path to the directory to list

**Returns:** `Promise<FileEntry[]>` - Array of entries in the directory

**FileEntry interface:**
- `name` (string): Name of the file or directory
- `type` ('file' | 'directory'): Type of the entry
- `size` (number, optional): Size in bytes (for files)
- `modified` (Date, optional): Last modification timestamp

**Examples:**

```typescript
// Basic directory listing
const entries = await sandbox.filesystem.readdir('/app');
console.log(entries);
// [
//   { name: 'config.json', type: 'file', size: 245 },
//   { name: 'src', type: 'directory' },
//   { name: 'package.json', type: 'file', size: 512 }
// ]

// List and display all entries
const entries = await sandbox.filesystem.readdir('/app');
entries.forEach(entry => {
  console.log(`${entry.type === 'directory' ? '📁' : '📄'} ${entry.name}`);
});
// 📄 config.json
// 📁 src
// 📄 package.json


// Find specific files by extension
const entries = await sandbox.filesystem.readdir('/app/src');
const jsFiles = entries.filter(e => 
  e.type === 'file' && e.name.endsWith('.js')
);
console.log('JavaScript files:', jsFiles.map(f => f.name));

// Count files and directories
const entries = await sandbox.filesystem.readdir('/app');
const fileCount = entries.filter(e => e.type === 'file').length;
const dirCount = entries.filter(e => e.type === 'directory').length;
console.log(`Found ${fileCount} files and ${dirCount} directories`);

// Check if directory is empty
const entries = await sandbox.filesystem.readdir('/app/temp');
if (entries.length === 0) {
  console.log('Directory is empty');
} else {
  console.log(`Directory contains ${entries.length} items`);
}

// Error handling for non-existent directories
try {
  const entries = await sandbox.filesystem.readdir('/nonexistent');
  console.log(entries);
} catch (error) {
  console.error('Failed to read directory:', error.message);
  // "Failed to read directory: Directory not found: /nonexistent"
}

// Check existence before reading
const dirPath = '/app/optional-data';
if (await sandbox.filesystem.exists(dirPath)) {
  const entries = await sandbox.filesystem.readdir(dirPath);
  console.log(`Found ${entries.length} entries in ${dirPath}`);
} else {
  console.log('Directory does not exist');
}
```

**Notes:**
- Returns an array of FileEntry objects with file/directory metadata
- Requires absolute paths (paths should start with `/`)
- Only lists direct children - does not recursively list subdirectories
- Throws an error if the directory does not exist
- The `size` and `modified` fields may not be available on all providers
- Empty directories return an empty array (not an error)
<br/>
<br/>

---

### `filesystem.exists(path)`

Check if a file or directory exists at the specified path in the sandbox filesystem.

**Parameters:**

- `path` (string, required): Absolute path to the file or directory to check

**Returns:** `Promise<boolean>` - Returns `true` if the path exists (file or directory), `false` otherwise

**Examples:**

```typescript
// Basic file existence check
const exists = await sandbox.filesystem.exists('/app/config.json');
console.log(exists);  // true

// Basic directory existence check
const dirExists = await sandbox.filesystem.exists('/app/src');
console.log(dirExists);  // true

// Check for non-existent path (returns false, doesn't throw error)
const missing = await sandbox.filesystem.exists('/app/nonexistent.txt');
console.log(missing);  // false

// Check before reading to avoid errors
const configPath = '/app/config.json';
if (await sandbox.filesystem.exists(configPath)) {
  const content = await sandbox.filesystem.readFile(configPath);
  console.log('Config loaded:', content);
} else {
  console.log('Config file not found, using defaults');
}

// Check before writing to avoid overwriting
const outputPath = '/app/output.txt';
if (await sandbox.filesystem.exists(outputPath)) {
  console.log('File already exists, skipping write');
} else {
  await sandbox.filesystem.writeFile(outputPath, 'New content');
  console.log('File created');
}

// Verify file creation
await sandbox.filesystem.writeFile('/app/data.json', '{}');
const created = await sandbox.filesystem.exists('/app/data.json');
console.log('File created successfully:', created);  // true

// Verify file deletion
await sandbox.filesystem.writeFile('/app/temp.txt', 'temporary');
await sandbox.filesystem.remove('/app/temp.txt');
const stillExists = await sandbox.filesystem.exists('/app/temp.txt');
console.log('File still exists:', stillExists);  // false

// Verify directory creation
await sandbox.filesystem.mkdir('/app/logs');
const dirCreated = await sandbox.filesystem.exists('/app/logs');
console.log('Directory created:', dirCreated);  // true


// Check multiple files at once
const requiredFiles = ['/app/package.json', '/app/src/index.js', '/app/README.md'];
const checks = await Promise.all(
  requiredFiles.map(path => sandbox.filesystem.exists(path))
);
const allExist = checks.every(exists => exists);
console.log('All required files present:', allExist);
```

**Notes:**
- Returns a boolean value - never throws errors (unlike `readFile` or `readdir`)
- Works for both files and directories - no distinction in the return value
- Requires absolute paths (paths should start with `/`)
- Returns `false` for non-existent paths, not an error
- Cannot distinguish between a file and directory from the return value alone
- Useful for defensive programming to prevent errors before operations
<br/>
<br/>

---

### `filesystem.remove(path)`

Remove a file or directory from the sandbox filesystem. For directories, this recursively removes all contents.

**Parameters:**

- `path` (string, required): Absolute path to the file or directory to remove

**Returns:** `Promise<void>` - Resolves when the file or directory is successfully removed

**Examples:**

```typescript
// Basic file removal
await sandbox.filesystem.writeFile('/app/temp.txt', 'temporary data');
await sandbox.filesystem.remove('/app/temp.txt');
console.log('File removed');

// Basic directory removal (recursive)
await sandbox.filesystem.mkdir('/app/old-data');
await sandbox.filesystem.writeFile('/app/old-data/file1.txt', 'data');
await sandbox.filesystem.writeFile('/app/old-data/file2.txt', 'data');
await sandbox.filesystem.remove('/app/old-data');
console.log('Directory and all contents removed');

// Remove file and verify deletion
await sandbox.filesystem.writeFile('/app/output.txt', 'content');
await sandbox.filesystem.remove('/app/output.txt');
const exists = await sandbox.filesystem.exists('/app/output.txt');
console.log('File still exists:', exists);  // false

// Remove directory with nested contents
await sandbox.filesystem.mkdir('/app/cache/images/thumbnails');
await sandbox.filesystem.writeFile('/app/cache/data.json', '{}');
await sandbox.filesystem.writeFile('/app/cache/images/photo.jpg', 'image data');
await sandbox.filesystem.remove('/app/cache');
console.log('Entire cache directory tree removed');

// Error handling for non-existent paths
try {
  await sandbox.filesystem.remove('/app/nonexistent.txt');
} catch (error) {
  console.error('Failed to remove:', error.message);
  // "Failed to remove: File not found: /app/nonexistent.txt"
}

// Safe removal with existence check
const filePath = '/app/optional-cache.json';
if (await sandbox.filesystem.exists(filePath)) {
  await sandbox.filesystem.remove(filePath);
  console.log('Cache file removed');
} else {
  console.log('No cache file to remove');
}
```

**Notes:**
- Works for both files and directories - no distinction needed
- **Recursive deletion for directories** - removes all contents and subdirectories (like `rm -rf`)
- Requires absolute paths (paths should start with `/`)
- Throws an error if the path does not exist
- **Deletion is permanent** - no recycle bin, trash, or undo capability
- **Use with caution** - destructive operation that cannot be reversed
- For directories, all nested files and subdirectories are removed automatically
- No confirmation prompt - removal happens immediately
<br/>
<br/>

---

## `sandbox.terminals`

### `terminals.create(options?)`

Create a terminal session in the sandbox with support for two modes: **PTY mode** (interactive shell with real-time I/O over WebSocket) and **Exec mode** (command tracking with structured results).

**Parameters:**

- `options` (object, optional): Terminal creation options
  - `pty` (boolean, optional): Terminal mode. `true` = PTY (interactive shell), `false` = exec (command tracking). Default: `false`
  - `shell` (string, optional): Shell to use (e.g., '/bin/bash', '/bin/zsh'). PTY mode only. Default: system default shell
  - `encoding` ('raw' | 'base64', optional): Output encoding. Default: `'raw'`

**Returns:** `Promise<TerminalInstance>` - Terminal instance with properties and methods based on the selected mode

**TerminalInstance properties:**
- `id` (string): Unique identifier for the terminal
- `status` ('running' | 'stopped' | 'active' | 'ready'): Current terminal status
- `channel` (string | null): WebSocket channel identifier (PTY mode only, null for exec mode)
- `pty` (boolean): Whether this is a PTY terminal (true) or exec terminal (false)
- `command` (TerminalCommand): Command execution namespace (exec mode only)

**TerminalInstance methods (PTY mode):**
- `write(input: string): void` - Send input to the terminal shell
- `resize(cols: number, rows: number): void` - Resize terminal window dimensions
- `on(event: string, handler: Function): void` - Register event handler ('output', 'error', 'destroyed')
- `off(event: string, handler: Function): void` - Unregister event handler
- `destroy(): Promise<void>` - Destroy the terminal and clean up resources

**TerminalInstance methods (Exec mode):**
- `command.run(command: string, options?: { background?: boolean }): Promise<Command>` - Execute a command
- `command.list(): Promise<Command[]>` - List all commands executed in this terminal
- `command.retrieve(cmdId: string): Promise<Command>` - Retrieve specific command by ID
- `destroy(): Promise<void>` - Destroy the terminal and clean up resources

**TerminalInstance methods (Both modes):**
- `isRunning(): boolean` - Check if terminal is currently running

**Command object (returned by command.run()):**
- `id` (string): Unique command identifier
- `terminalId` (string): Parent terminal ID
- `command` (string): The executed command string
- `status` ('running' | 'completed' | 'failed'): Current command status
- `stdout` (string): Standard output from the command
- `stderr` (string): Standard error output from the command
- `exitCode` (number | undefined): Exit code (undefined if still running)
- `durationMs` (number | undefined): Execution duration in milliseconds
- `startedAt` (string): ISO timestamp when command started
- `finishedAt` (string | undefined): ISO timestamp when command finished (undefined if still running)
- `wait(timeout?: number): Promise<Command>` - Wait for command to complete (timeout in seconds, 0 = no timeout)
- `refresh(): Promise<Command>` - Refresh command status from server

**Examples:**

```typescript
// PTY mode - Interactive shell with real-time output
const pty = await sandbox.terminals.create({ 
  pty: true, 
  shell: '/bin/bash' 
});

// Handle output events
pty.on('output', (data) => {
  console.log('Output:', data);
});

pty.on('error', (error) => {
  console.error('Error:', error);
});

pty.on('destroyed', () => {
  console.log('Terminal destroyed');
});

// Send commands to shell
pty.write('ls -la\n');
pty.write('cd /app\n');
pty.write('npm install\n');

// Resize terminal
pty.resize(120, 40);

// Clean up
await pty.destroy();
```

```typescript
// Exec mode - Command execution with tracking
const exec = await sandbox.terminals.create({ pty: false });

// Run command in foreground (waits for completion)
const cmd = await exec.command.run('npm test');
console.log('Exit code:', cmd.exitCode);       // 0
console.log('Output:', cmd.stdout);            // Test results
console.log('Duration:', cmd.durationMs);      // 1543
console.log('Status:', cmd.status);            // 'completed'

// Check for errors
if (cmd.exitCode !== 0) {
  console.error('Command failed:', cmd.stderr);
} else {
  console.log('Tests passed!');
}

await exec.destroy();
```

```typescript
// Exec mode - Background execution with wait
const exec = await sandbox.terminals.create({ pty: false });

// Start long-running command in background
const cmd = await exec.command.run('npm install', { background: true });
console.log('Command started:', cmd.id);
console.log('Status:', cmd.status);  // 'running'

// Wait for command to complete (60 second timeout)
await cmd.wait(60);
console.log('Installation complete');
console.log('Exit code:', cmd.exitCode);
console.log('Output:', cmd.stdout);

// Or refresh status without waiting
await cmd.refresh();
console.log('Current status:', cmd.status);

await exec.destroy();
```

**Notes:**
- **PTY mode** provides an interactive shell with WebSocket streaming for real-time I/O - use for interactive sessions
- **Exec mode** tracks individual commands with structured results - use for automation and scripting
- PTY terminals require WebSocket connection for real-time communication
- Exec mode commands can run in foreground (blocking) or background (non-blocking with wait capability)
- Always call `destroy()` to clean up terminal resources when done
- Background commands return immediately with status 'running' - use `wait()` to block until completion
- The `write()` and `resize()` methods are only available for PTY terminals
- The `command` namespace is only available for exec terminals
- Terminal status 'active' is normalized to 'running' internally

<br/>
<br/>

---

### `terminals.list()`

List all active terminal sessions in the sandbox.

**Parameters:** None

**Returns:** `Promise<TerminalResponse[]>` - Array of terminal information objects

**TerminalResponse interface:**
- `id` (string): Terminal identifier
- `pty` (boolean): Whether this is a PTY terminal
- `status` ('running' | 'stopped' | 'active' | 'ready'): Terminal status
- `channel` (string | null): WebSocket channel (PTY mode only)

**Examples:**

```typescript
// List all terminals
const terminals = await sandbox.terminals.list();
console.log(`Active terminals: ${terminals.length}`);

terminals.forEach(term => {
  console.log(`${term.id} - ${term.pty ? 'PTY' : 'Exec'} - ${term.status}`);
});
```

**Notes:**
- Returns information about all active terminals regardless of mode
- Does not return TerminalInstance objects - use `retrieve()` to get a specific terminal instance

<br/>
<br/>

---

### `terminals.retrieve(id)`

Retrieve information about a specific terminal by ID.

**Parameters:**

- `id` (string, required): The terminal identifier

**Returns:** `Promise<TerminalResponse>` - Terminal information object

**TerminalResponse interface:**
- `id` (string): Terminal identifier
- `pty` (boolean): Whether this is a PTY terminal
- `status` ('running' | 'stopped' | 'active' | 'ready'): Terminal status
- `channel` (string | null): WebSocket channel (PTY mode only)

**Examples:**

```typescript
// Retrieve specific terminal
const terminal = await sandbox.terminals.retrieve('term-abc123');
console.log(`Terminal ${terminal.id}: ${terminal.status}`);

// Check terminal type
if (terminal.pty) {
  console.log('PTY terminal on channel:', terminal.channel);
} else {
  console.log('Exec terminal');
}
```

**Notes:**
- Returns terminal metadata, not a TerminalInstance object
- Throws an error if the terminal does not exist

<br/>
<br/>

---

### `terminals.destroy(id)`

Destroy a terminal session and clean up all associated resources.

**Parameters:**

- `id` (string, required): The terminal identifier

**Returns:** `Promise<void>` - Resolves when the terminal is destroyed

**Examples:**

```typescript
// Destroy a terminal by ID
await sandbox.terminals.destroy('term-abc123');
console.log('Terminal destroyed');

// Destroy all terminals
const terminals = await sandbox.terminals.list();
await Promise.all(
  terminals.map(term => sandbox.terminals.destroy(term.id))
);
console.log('All terminals destroyed');
```

**Notes:**
- Destroys the terminal and cleans up all resources including WebSocket connections
- Throws an error if the terminal does not exist
- Background commands may be terminated when the terminal is destroyed

<br/>
<br/>

---


## sandbox.servers

Manage long-running server processes:

### servers.start()

```typescript
// Start a server
const server = await sandbox.servers.start({
  name: 'api',
  command: 'npm start',
  path: '/app',
  env_file: '.env'
});
```

### servers.list()

```typescript
// List all servers
const servers = await sandbox.servers.list();
```

### servers.retrieve()

```typescript
// Get server info
const info = await sandbox.servers.retrieve('api');
console.log(info.status); // 'starting' | 'running' | 'ready' | 'failed' | 'stopped'
console.log(info.url);    // Server URL when ready
```

### servers.stop()
```typescript
// Stop a server
await sandbox.servers.stop('api');
```

### servers.restart()
```typescript
// Restart a server
await sandbox.servers.restart('api');
```


<br/>
<br/>

---

## sandbox.env

Manage `.env` files in the sandbox:


### env.retrieve()
```typescript
// Get environment variables
const vars = await sandbox.env.retrieve('.env');
console.log(vars); // { API_KEY: 'secret', DEBUG: 'true' }
```

### env.update()
```typescript
// Update environment variables (merges with existing)
await sandbox.env.update('.env', {
  API_KEY: 'new-secret',
  NEW_VAR: 'value'
});
```

### env.remove()
```typescript
// Remove environment variables
await sandbox.env.remove('.env', ['OLD_KEY', 'DEPRECATED']);
```

### env.exists()
```typescript
// Check if env file exists
const exists = await sandbox.env.exists('.env');
```
<br/>
<br/>

---


## sandbox.files

File operations via the resource namespace:

### files.read()
```typescript
// Read file
const content = await sandbox.files.read('/app/config.json');
```

### files.write()
```typescript
// Write file
await sandbox.files.write('/app/config.json', '{"key": "value"}');
```

### files.list()
```typescript
// List directory
const files = await sandbox.files.list('/app');
```

### files.delete()
```typescript
// Delete file
await sandbox.files.delete('/app/old-file.txt');
```

<br/>
<br/>

---


## sandbox.watchers

Real-time file system monitoring:

### watchers.create()
```typescript
// Create a file watcher
const watcher = await sandbox.watchers.create('/home/project', {
  ignored: ['node_modules', '.git'],
  includeContent: true
});
```

### watchers.on()
```typescript
watcher.on('change', (event) => {
  console.log(`${event.event}: ${event.path}`);
  if (event.content) {
    console.log('New content:', event.content);
  }
});
```

### watchers.destroy()
```typescript
// Destroy watcher
await sandbox.watchers.destroy(watcher.id);
```

<br/>
<br/>

---

## sandbox.signals

Monitor system events:

### signals.start()
```typescript
// Start signal monitoring
const signals = await sandbox.signals.start();
```

### signals.on()
```typescript
signals.on('port', (event) => {
  console.log(`Port ${event.port} ${event.type}: ${event.url}`);
});

signals.on('error', (event) => {
  console.error('Error:', event.message);
});
```

### signals.stop()
```typescript
// Stop signal monitoring
await sandbox.signals.stop();
```

<br/>
<br/>

---

## sandbox.sessionTokens

Manage delegated access (requires access token):

### sessionTokens.create()
```typescript
// Create a session token
const token = await sandbox.sessionTokens.create({
  description: 'My Application',
  expiresIn: 604800 // 7 days
});
```

### sessionTokens.list()
```typescript
// List session tokens
const tokens = await sandbox.sessionTokens.list();
```

### sessionTokens.revoke()
```typescript
// Revoke a token
await sandbox.sessionTokens.revoke(tokenId);
```


<br/>
<br/>

---


## sandbox.magicLinks.create()

Browser authentication (requires access token):

```typescript
// Create a magic link
const link = await sandbox.magicLinks.create({
  redirectUrl: '/dashboard'
});
console.log(link.magic_url);
```
