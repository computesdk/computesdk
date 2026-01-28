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

## `sandbox.filesystem.overlay`

Create filesystem overlays from template directories for instant sandbox setup. Overlays copy files from a source template into the sandbox, with optional smart strategies for performance.

### `overlay.create(options)`

Create a new overlay from a template directory.

**Parameters:**

- `options` (object, required): Overlay configuration
  - `source` (string, required): Absolute path to source directory (template)
  - `target` (string, required): Relative path in sandbox where overlay will be mounted
  - `ignore` (string[], optional): Glob patterns to ignore (e.g., `["node_modules", "*.log"]`)
  - `strategy` ('copy' | 'smart', optional): Creation strategy (default: 'smart')
  - `waitForCompletion` (boolean | WaitOptions, optional): Wait for background copy to complete

**WaitOptions interface:**
- `maxRetries` (number, optional): Maximum polling attempts (default: 60)
- `initialDelayMs` (number, optional): Initial delay between retries (default: 500)
- `maxDelayMs` (number, optional): Maximum delay with backoff (default: 5000)
- `backoffFactor` (number, optional): Exponential backoff multiplier (default: 1.5)

**Returns:** `Promise<OverlayInfo>` - Overlay information with copy status

**OverlayInfo interface:**
- `id` (string): Unique overlay identifier
- `source` (string): Absolute path to source directory
- `target` (string): Relative path in sandbox
- `strategy` ('copy' | 'smart'): Strategy used for the overlay
- `createdAt` (string): ISO timestamp when overlay was created
- `copyStatus` ('pending' | 'in_progress' | 'complete' | 'failed'): Background copy status
- `copyError` (string, optional): Error message if copy failed
- `stats.copiedFiles` (number): Number of files copied
- `stats.copiedDirs` (number): Number of directories copied
- `stats.skipped` (string[]): Paths that were skipped

**Examples:**

```typescript
// Basic overlay with smart strategy
const overlay = await sandbox.filesystem.overlay.create({
  source: '/templates/nextjs',
  target: './project',
  strategy: 'smart',
});
console.log(overlay.copyStatus); // 'pending' or 'in_progress'

// Wait for completion
const overlay = await sandbox.filesystem.overlay.create({
  source: '/templates/react',
  target: './app',
  waitForCompletion: true,
});
console.log(overlay.copyStatus); // 'complete'

// With ignore patterns
const overlay = await sandbox.filesystem.overlay.create({
  source: '/templates/node',
  target: './project',
  ignore: ['node_modules', '.git', '*.log'],
});
```

**Notes:**
- `smart` strategy uses symlinks for immutable directories (like `node_modules`) for instant setup
- Background copying happens asynchronously - use `waitForCompletion` or poll `copyStatus`
- Use `ignore` patterns to skip unnecessary files and speed up creation

<br/>
<br/>

---

### `overlay.list()`

List all overlays for the current sandbox.

**Returns:** `Promise<OverlayInfo[]>` - Array of overlay information objects

```typescript
const overlays = await sandbox.filesystem.overlay.list();
overlays.forEach(o => {
  console.log(`${o.target}: ${o.copyStatus}`);
});
```

<br/>
<br/>

---

### `overlay.retrieve(id)`

Retrieve a specific overlay by ID.

**Parameters:**
- `id` (string, required): Overlay ID

**Returns:** `Promise<OverlayInfo>` - Overlay information

```typescript
const overlay = await sandbox.filesystem.overlay.retrieve('overlay-123');
console.log(overlay.copyStatus);
```

<br/>
<br/>

---

### `overlay.waitForCompletion(id, options?)`

Wait for an overlay's background copy to complete.

**Parameters:**
- `id` (string, required): Overlay ID
- `options` (WaitOptions, optional): Polling options

**Returns:** `Promise<OverlayInfo>` - Overlay info with final copy status

```typescript
const overlay = await sandbox.filesystem.overlay.create({
  source: '/templates/large-project',
  target: './project',
});

// Do other setup...

// Then wait for overlay
const completed = await sandbox.filesystem.overlay.waitForCompletion(overlay.id);
console.log(completed.copyStatus); // 'complete'
```

<br/>
<br/>

---

### `overlay.destroy(id)`

Delete an overlay.

**Parameters:**
- `id` (string, required): Overlay ID

**Returns:** `Promise<void>`

```typescript
await sandbox.filesystem.overlay.destroy('overlay-123');
```

<br/>
<br/>

---

## `sandbox.terminal`

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
const pty = await sandbox.terminal.create({ 
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
const exec = await sandbox.terminal.create({ pty: false });

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
const exec = await sandbox.terminal.create({ pty: false });

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
const terminals = await sandbox.terminal.list();
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
const terminal = await sandbox.terminal.retrieve('term-abc123');
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
await sandbox.terminal.destroy('term-abc123');
console.log('Terminal destroyed');

// Destroy all terminals
const terminals = await sandbox.terminal.list();
await Promise.all(
  terminals.map(term => sandbox.terminal.destroy(term.id))
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


## `sandbox.server`

Manage long-running server processes with full lifecycle management, including install commands, restart policies, and health checks.

### `server.start(options)`

Start a managed server process in the sandbox with automatic process management and URL exposure.

**Parameters:**

- `options` (object, required): Server configuration
  - `slug` (string, required): Unique URL-safe identifier for the server
  - `start` (string, required): Command to start the server process
  - `install` (string, optional): Install command to run before starting (e.g., "npm install")
  - `path` (string, optional): Working directory for command execution
  - `env_file` (string, optional): Path to environment file to load
  - `environment` (Record<string, string>, optional): Inline environment variables
  - `port` (number, optional): Requested port number (preallocated before start)
  - `strict_port` (boolean, optional): If true, fail instead of auto-incrementing when port is taken
  - `autostart` (boolean, optional): Whether to auto-start on daemon boot (default: true)
  - `restart_policy` ('never' | 'on-failure' | 'always', optional): When to automatically restart the server
  - `max_restarts` (number, optional): Maximum restart attempts (0 = unlimited, default: 0)
  - `restart_delay_ms` (number, optional): Delay between restart attempts in milliseconds (default: 1000)
  - `stop_timeout_ms` (number, optional): Graceful shutdown timeout - SIGTERM → wait → SIGKILL (default: 10000)
  - `health_check` (HealthCheckConfig, optional): Health check configuration for monitoring server availability

**HealthCheckConfig interface:**
- `path` (string): HTTP path to check (e.g., '/', '/health')
- `interval_ms` (number, optional): Polling interval in milliseconds
- `timeout_ms` (number, optional): Request timeout in milliseconds
- `delay_ms` (number, optional): Initial delay before starting health checks

**Returns:** `Promise<ServerInfo>` - Server information including status, URL, and process details

**ServerInfo interface:**
- `slug` (string): Server identifier
- `start` (string): The start command being executed
- `install` (string, optional): The install command if specified
- `path` (string): Working directory path
- `original_path` (string, optional): Original path before resolution
- `env_file` (string, optional): Environment file path if specified
- `port` (number, optional): Detected port number
- `url` (string, optional): Public URL when server is ready
- `status` ('installing' | 'starting' | 'running' | 'ready' | 'failed' | 'stopped'): Current server status
- `pid` (number, optional): Process ID when running
- `terminal_id` (string, optional): Associated terminal session ID
- `restart_policy` (string, optional): Configured restart policy
- `restart_count` (number, optional): Number of times the server has been restarted
- `healthy` (boolean, optional): Whether health check is passing
- `health_status` (string, optional): Current health check status
- `created_at` (string): ISO timestamp when server was created
- `updated_at` (string): ISO timestamp of last status update

**Examples:**

```typescript
// Basic server start
const server = await sandbox.server.start({
  slug: 'api',
  start: 'npm start'
});
console.log(server.slug);     // "api"
console.log(server.status);   // "starting"

// Server with install command (runs before start)
const server = await sandbox.server.start({
  slug: 'web',
  install: 'npm install',
  start: 'npm run dev',
  path: '/app'
});
// Status will be 'installing' during npm install, then 'starting'

// Server with restart policy
const server = await sandbox.server.start({
  slug: 'api',
  start: 'node server.js',
  restart_policy: 'on-failure',  // Restart only on non-zero exit code
  max_restarts: 5,
  restart_delay_ms: 2000
});

// Server with health check
const server = await sandbox.server.start({
  slug: 'web',
  start: 'npm run dev',
  health_check: {
    path: '/health',
    interval_ms: 5000,
    timeout_ms: 3000
  }
});
// Server will be 'ready' only after health check passes

// Server with environment file
const server = await sandbox.server.start({
  slug: 'api',
  start: 'node server.js',
  env_file: '.env.production'
});

// Full configuration example
const server = await sandbox.server.start({
  slug: 'fullstack',
  install: 'npm install',
  start: 'npm run dev',
  path: '/app',
  port: 3000,
  environment: {
    NODE_ENV: 'development',
    DEBUG: 'true'
  },
  restart_policy: 'always',
  stop_timeout_ms: 15000,
  health_check: {
    path: '/',
    interval_ms: 2000
  }
});
```

**Notes:**
- The `slug` must be unique across all servers in the sandbox
- The `install` command runs blocking before `start` - useful for `npm install`, `pip install`, etc.
- Server status will be `installing` during install phase, then `starting`, then `running` or `ready`
- Restart policies: `never` (default) = no auto-restart, `on-failure` = restart on non-zero exit, `always` = restart on any exit
- Health checks: when configured, server is only marked `ready` after health check passes
- Graceful shutdown: on stop, sends SIGTERM and waits `stop_timeout_ms` before SIGKILL
- Server processes continue running until explicitly stopped with `server.stop(slug)` or `server.delete(slug)`

<br/>
<br/>

---

### `server.list()`

List all managed server processes running in the sandbox.

**Parameters:** None

**Returns:** `Promise<ServerInfo[]>` - Array of server information objects (see `server.start()` for `ServerInfo` interface details)

**Examples:**

```typescript
// Basic usage - list all servers
const servers = await sandbox.server.list();
console.log(`Found ${servers.length} servers`);

// Empty array when no servers running
const servers = await sandbox.server.list();
if (servers.length === 0) {
  console.log('No servers are currently running');
}

// Display all server information
const servers = await sandbox.server.list();
servers.forEach(server => {
  console.log(`${server.slug}: ${server.status}`);
  console.log(`  Command: ${server.command}`);
  console.log(`  URL: ${server.url || 'not ready'}`);
});
```

**Notes:**
- Returns an empty array if no servers are currently running
- Use `server.retrieve(slug)` to get information about a specific server by its slug
- Available on all sandbox instances regardless of provider

<br/>
<br/>

---

### `server.retrieve(slug)`

Retrieve information about a specific server by its slug identifier.

**Parameters:**

- `slug` (string, required): The unique server slug identifier

**Returns:** `Promise<ServerInfo>` - Server information object (see `server.start()` for `ServerInfo` interface details)

**Examples:**

```typescript
// Basic retrieval - get server by slug
const server = await sandbox.server.retrieve('api');
console.log(server.status);  // "ready"
console.log(server.url);     // "https://..."

// Check if server is ready
const server = await sandbox.server.retrieve('api');
if (server.status === 'ready') {
  console.log('Server is ready at:', server.url);
} else {
  console.log('Server is still', server.status);
}

// Check server process information
const server = await sandbox.server.retrieve('api');
console.log('Process ID:', server.pid);
console.log('Port:', server.port);
console.log('Terminal:', server.terminal_id);

// Check server status before operations
const server = await sandbox.server.retrieve('backend');
if (server.status === 'failed') {
  console.log('Server failed, restarting...');
  await sandbox.server.restart('backend');
} else if (server.status === 'ready') {
  console.log('Server is healthy');
}
```

**Notes:**
- Returns the current state of the server - status may change immediately after retrieval
- Use `server.list()` first to check if a server exists before calling `retrieve()`
- Available on all sandbox instances regardless of provider

<br/>
<br/>

---

### `server.stop(slug)`

Stop a running server process.

**Parameters:**

- `slug` (string, required): The unique server slug identifier

**Returns:** `Promise<void>` - Resolves when the server is successfully stopped

**Examples:**

```typescript
// Basic stop - stop a server by slug
await sandbox.server.stop('api');
console.log('Server stopped');

// Stop before starting with new configuration
await sandbox.server.stop('api');
const newServer = await sandbox.server.start({
  slug: 'api',
  command: 'npm run prod',
  path: '/app'
});
console.log('Server started with new configuration');

// Check status before stopping
const server = await sandbox.server.retrieve('api');
if (server.status === 'running' || server.status === 'ready') {
  await sandbox.server.stop('api');
  console.log('Server stopped');
} else {
  console.log('Server is not running');
}
```

**Notes:**
- Stops a running server process
- Use `server.retrieve(slug)` to check server status before stopping
- Available on all sandbox instances regardless of provider

<br/>
<br/>

---

### `server.restart(slug)`

Restart a server process.

**Parameters:**

- `slug` (string, required): The unique server slug identifier

**Returns:** `Promise<ServerInfo>` - Server information object after restart (see `server.start()` for `ServerInfo` interface details)

**Examples:**

```typescript
// Basic restart - restart a server by slug
const server = await sandbox.server.restart('api');
console.log(server.status);  // Server status after restart
console.log(server.url);     // Server URL

// Restart and check updated status
const server = await sandbox.server.restart('backend');
console.log('Server restarted');
console.log('New status:', server.status);
console.log('New PID:', server.pid);

// Restart multiple servers sequentially
const api = await sandbox.server.restart('api');
const frontend = await sandbox.server.restart('frontend');
const worker = await sandbox.server.restart('worker');
console.log('All servers restarted');

// Check status before restart
const server = await sandbox.server.retrieve('api');
console.log('Current status:', server.status);
const restarted = await sandbox.server.restart('api');
console.log('New status:', restarted.status);
```

**Notes:**
- Returns updated server information after restart
- Use the returned `ServerInfo` object to check the new status, PID, and other details
- Available on all sandbox instances regardless of provider


<br/>
<br/>

---

## `sandbox.env`

Manage `.env` files in the sandbox:


### `env.retrieve(file)`

Retrieve all environment variables from a `.env` file in the sandbox as a key-value object.

**Parameters:**

- `file` (string, required): Path to the .env file relative to sandbox root (e.g., '.env', '.env.production', 'config/.env')

**Returns:** `Promise<Record<string, string>>` - Key-value map of all environment variables in the file

**Examples:**

```typescript
// Basic retrieval
const vars = await sandbox.env.retrieve('.env');
console.log(vars);  // { API_KEY: 'secret', DEBUG: 'true', PORT: '3000' }

// Access specific variables
const vars = await sandbox.env.retrieve('.env');
console.log(vars.API_KEY);  // "secret"
console.log(vars.DEBUG);    // "true"

// Check if file exists before retrieving
const exists = await sandbox.env.exists('.env.local');
if (exists) {
  const vars = await sandbox.env.retrieve('.env.local');
  console.log('Local config loaded:', vars);
} else {
  console.log('No local config found, using defaults');
}
```

**Notes:**
- Returns all environment variables as string key-value pairs
- File paths are relative to the sandbox root directory
- All values are returned as strings - no automatic type conversion
- Use with `env.exists()` to check file presence before retrieval

### `env.update(file, variables)`

Update or add environment variables in a `.env` file, merging with existing variables.

**Parameters:**

- `file` (string, required): Path to the .env file relative to sandbox root (e.g., '.env', '.env.production', 'config/.env')
- `variables` (Record<string, string>, required): Key-value pairs of environment variables to set or update

**Returns:** `Promise<string[]>` - Array of environment variable keys that were updated or added

**Examples:**

```typescript
// Basic update
const keys = await sandbox.env.update('.env', {
  API_KEY: 'new-secret',
  DEBUG: 'true'
});
console.log(keys);  // ['API_KEY', 'DEBUG']

// Conditional update with existence check
const exists = await sandbox.env.exists('.env.local');
if (!exists) {
  await sandbox.env.update('.env.local', { DEBUG: 'true', LOG_LEVEL: 'verbose' });
  console.log('Created new local environment file');
} else {
  await sandbox.env.update('.env.local', { DEBUG: 'false' });
  console.log('Updated existing local environment');
}
```

**Notes:**
- Merges with existing variables - does not replace the entire file
- Existing variables not mentioned in the update are preserved
- Creates the file if it doesn't exist
- All values must be strings - no automatic type conversion
- File paths are relative to the sandbox root directory
- Returns array of keys that were modified or added

### `env.remove(file, keys)`

Remove specific environment variables from a `.env` file while preserving all other variables.

**Parameters:**

- `file` (string, required): Path to the .env file relative to sandbox root (e.g., '.env', '.env.production', 'config/.env')
- `keys` (string[], required): Array of environment variable keys to remove from the file

**Returns:** `Promise<string[]>` - Array of environment variable keys that were successfully removed

**Examples:**

```typescript
// Basic removal
const removed = await sandbox.env.remove('.env', ['OLD_KEY', 'DEPRECATED']);
console.log(removed);  // ['OLD_KEY', 'DEPRECATED']

// Conditional removal with existence check
const exists = await sandbox.env.exists('.env.local');
if (exists) {
  const vars = await sandbox.env.retrieve('.env.local');
  if ('DEBUG' in vars) {
    await sandbox.env.remove('.env.local', ['DEBUG']);
    console.log('DEBUG variable removed from local environment');
  }
}
```

**Notes:**
- Only removes specified keys - all other variables in the file are preserved
- Returns array of keys that were successfully removed
- File paths are relative to the sandbox root directory
- Use with `env.retrieve()` to check which variables exist before removal

### `env.exists(file)`

Check if a `.env` file exists in the sandbox.

**Parameters:**

- `file` (string, required): Path to the .env file relative to sandbox root (e.g., '.env', '.env.production', 'config/.env')

**Returns:** `Promise<boolean>` - Returns `true` if the file exists, `false` otherwise

**Examples:**

```typescript
// Basic existence check
const exists = await sandbox.env.exists('.env');
console.log(exists);  // true or false

// Conditional operations - check before retrieve
const exists = await sandbox.env.exists('.env.local');
if (exists) {
  const vars = await sandbox.env.retrieve('.env.local');
  console.log('Local config loaded:', vars);
} else {
  console.log('No local config found, using defaults');
}

// Check before update - determine whether to create or update
const exists = await sandbox.env.exists('.env.production');
if (!exists) {
  await sandbox.env.update('.env.production', {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://prod-server/db'
  });
  console.log('Production environment file created');
} else {
  console.log('Production environment file already exists');
}
```

**Notes:**
- Returns a boolean value - never throws errors (safe to call without try/catch)
- Returns `false` for non-existent files rather than throwing an error
- File paths are relative to the sandbox root directory
<br/>
<br/>

---


## `sandbox.file`

Resource-oriented file operations. Note that `sandbox.file` is distinct from `sandbox.filesystem`:
- **`sandbox.file`** - Resource-oriented API with create/retrieve/destroy naming
- **`sandbox.filesystem`** - Traditional filesystem API with readFile/writeFile/mkdir/readdir/exists/remove

### `file.create(path, content?)`

Create a new file with optional content.

**Parameters:**
- `path` (string, required): File path
- `content` (string, optional): File content

**Returns:** `Promise<FileInfo>` - File information object

**FileInfo interface:**
- `name` (string): File name
- `path` (string): Full file path
- `size` (number): File size in bytes
- `is_dir` (boolean): Whether this is a directory
- `modified_at` (string): ISO timestamp of last modification

**Examples:**

```typescript
// Basic file creation with content
const file = await sandbox.file.create('/project/hello.txt', 'Hello, World!');
console.log(file.name);        // 'hello.txt'
console.log(file.size);        // 13
console.log(file.modified_at); // '2024-01-08T12:00:00Z'

// Create empty file (content is optional)
const emptyFile = await sandbox.file.create('/project/empty.txt');
console.log(emptyFile.size);   // 0

// Create JSON configuration file
const config = { api_url: 'https://api.example.com', timeout: 5000 };
const configFile = await sandbox.file.create(
  '/project/config.json', 
  JSON.stringify(config, null, 2)
);
console.log(configFile.name);  // 'config.json'

// Create file with multiline content using template literals
const script = await sandbox.file.create('/project/start.sh', `#!/bin/bash
echo "Starting application..."
npm install
npm start
`);
console.log(script.name);      // 'start.sh'

// Error handling for creation failures
try {
  const file = await sandbox.file.create('/invalid/path/file.txt', 'content');
  console.log('File created:', file.name);
} catch (error) {
  console.error('Failed to create file:', error.message);
}
```

**Notes:**
- Creates a new file or overwrites if the file already exists
- Content parameter is optional - omit it to create an empty file
- Always returns UTF-8 encoded text
- Available on all sandbox instances regardless of provider

<br/>
<br/>

---

### `file.list(path?)`

List files at the specified path.

**Parameters:**
- `path` (string, optional, default: '/'): Directory path to list

**Returns:** `Promise<FileInfo[]>` - Array of FileInfo objects

**Examples:**

```typescript
// Basic directory listing with iteration
const files = await sandbox.file.list('/project');
files.forEach(file => {
  console.log(`${file.is_dir ? '📁' : '📄'} ${file.name} (${file.size} bytes)`);
});
// Output:
// 📄 hello.txt (13 bytes)
// 📁 src (4096 bytes)
// 📄 package.json (512 bytes)

// List root directory (default parameter)
const rootFiles = await sandbox.file.list();  // Defaults to '/'
console.log(`Found ${rootFiles.length} items in root`);

// Alternative: explicitly specify root
const rootFiles2 = await sandbox.file.list('/');
console.log(rootFiles2.length);

// Separate files and directories
const items = await sandbox.file.list('/project');
const directories = items.filter(item => item.is_dir);
const regularFiles = items.filter(item => !item.is_dir);

console.log('Directories:', directories.map(d => d.name));
console.log('Files:', regularFiles.map(f => f.name));

// Check if directory is empty
const exists = await sandbox.file.exists('/project/temp');
if (exists) {
  const files = await sandbox.file.list('/project/temp');
  if (files.length === 0) {
    console.log('Directory is empty');
  } else {
    console.log(`Directory contains ${files.length} items`);
  }
} else {
  console.log('Directory does not exist');
}

// Defensive pattern: check existence before listing
const dirPath = '/project/optional-data';
if (await sandbox.file.exists(dirPath)) {
  const files = await sandbox.file.list(dirPath);
  console.log(`Found ${files.length} files`);
} else {
  console.log('Directory does not exist, skipping...');
}
```

**Notes:**
- Defaults to root directory (`'/'`) if path parameter is omitted
- Only lists direct children - does not recurse into subdirectories
- Returns FileInfo array with metadata (see `file.create()` for complete FileInfo interface details)
- Available on all sandbox instances regardless of provider

<br/>
<br/>

---

### `file.retrieve(path)`

Retrieve file content.

**Parameters:**
- `path` (string, required): File path

**Returns:** `Promise<string>` - File content as string

**Examples:**

```typescript
// Basic file retrieval
const content = await sandbox.file.retrieve('/project/hello.txt');
console.log(content); // 'Hello, World!'


// Read multiline file content (code, scripts, markdown)
const scriptContent = await sandbox.file.retrieve('/project/start.sh');
console.log(scriptContent);
// Output:
// #!/bin/bash
// echo "Starting application..."
// npm install
// npm start

// Defensive pattern: check existence before retrieving
const filePath = '/project/optional-config.json';
if (await sandbox.file.exists(filePath)) {
  const content = await sandbox.file.retrieve(filePath);
  const config = JSON.parse(content);
  console.log('Config loaded:', config);
} else {
  console.log('Config file not found, using defaults');
}
```

**Notes:**
- Always returns UTF-8 encoded text content as a string
- Returns content only - for file metadata (size, modified_at, etc.), use `file.create()` or `file.list()`
- Does not include file metadata in the return value (unlike `file.create()` which returns FileInfo)
- Available on all sandbox instances regardless of provider

<br/>
<br/>

---

### `file.destroy(path)`

Destroy (delete) a file or directory.

**Parameters:**
- `path` (string, required): File or directory path

**Returns:** `Promise<void>`

**Examples:**

```typescript
// Basic file deletion
await sandbox.file.destroy('/project/hello.txt');
console.log('File deleted');

// Delete file and verify with exists()
await sandbox.file.create('/project/temp.txt', 'temporary data');
await sandbox.file.destroy('/project/temp.txt');

const exists = await sandbox.file.exists('/project/temp.txt');
console.log('File still exists:', exists);  // false

// Delete directory recursively (simple directory)
await sandbox.file.create('/project/data/file.txt', 'content');
await sandbox.file.destroy('/project/data');
console.log('Directory and contents deleted');

// Delete directory recursively (nested structure)
await sandbox.file.create('/project/cache/images/thumb.jpg', 'image');
await sandbox.file.create('/project/cache/data.json', '{}');
await sandbox.file.destroy('/project/cache');
console.log('Entire directory tree removed');

// Defensive pattern: check existence before destroying
const filePath = '/project/optional-file.txt';
if (await sandbox.file.exists(filePath)) {
  await sandbox.file.destroy(filePath);
  console.log('File deleted');
} else {
  console.log('File does not exist, nothing to delete');
}
```

**Notes:**
- For directories, recursively removes all contents and subdirectories (similar to `rm -rf`)
- Deletion is permanent - no recycle bin, trash, or undo capability - use with caution
- Available on all sandbox instances regardless of provider

<br/>
<br/>

---

### `file.batchWrite(files)`

Batch file operations (write or delete multiple files). Features deduplication (last operation wins per path), file locking (prevents race conditions), and deterministic ordering (alphabetical path sorting).

**Parameters:**
- `files` (Array, required): Array of file operations where each operation contains:
  - `path` (string, required): File path
  - `operation` ('write' | 'delete', required): Operation type
  - `content` (string, optional): File content (required for 'write' operations)

**Returns:** `Promise<BatchWriteResult[]>` - Array of results for each operation

**BatchWriteResult interface:**
- `path` (string): File path
- `success` (boolean): Whether the operation succeeded
- `error` (string, optional): Error message if operation failed
- `file` (FileInfo, optional): File info if operation succeeded

**Examples:**

```typescript
// Batch write multiple files
const results = await sandbox.file.batchWrite([
  { path: '/project/a.txt', operation: 'write', content: 'A' },
  { path: '/project/b.txt', operation: 'write', content: 'B' },
]);

// Check results
results.forEach(result => {
  if (result.success) {
    console.log(`✓ ${result.path}`);
  } else {
    console.error(`✗ ${result.path}: ${result.error}`);
  }
});

// Batch delete files
const results = await sandbox.file.batchWrite([
  { path: '/project/old.txt', operation: 'delete' },
  { path: '/project/temp.txt', operation: 'delete' },
]);

// Mixed operations (write and delete)
const results = await sandbox.file.batchWrite([
  { path: '/project/new.txt', operation: 'write', content: 'New file' },
  { path: '/project/old.txt', operation: 'delete' },
  { path: '/project/updated.txt', operation: 'write', content: 'Updated content' },
]);

// Deduplication - last operation wins when targeting same path
const results = await sandbox.file.batchWrite([
  { path: '/project/config.txt', operation: 'write', content: 'First version' },
  { path: '/project/config.txt', operation: 'write', content: 'Second version' },
  { path: '/project/config.txt', operation: 'write', content: 'Final version' },
]);

// Only one file is created with the last content
const content = await sandbox.file.retrieve('/project/config.txt');
console.log(content); // 'Final version'
```

**Notes:**
- Deduplication: If multiple operations target the same path, the last operation wins
- File locking: Prevents race conditions during batch operations
- Deterministic ordering: Operations are processed in alphabetical order by path
- Partial failure handling: Returns per-file success/error results, allowing you to handle failures individually

<br/>
<br/>

---

### `file.exists(path)`

Check if a file or directory exists.

**Parameters:**
- `path` (string, required): File or directory path

**Returns:** `Promise<boolean>` - `true` if path exists, `false` otherwise

**Examples:**
```typescript
// Basic file existence check
const exists = await sandbox.file.exists('/project/hello.txt');
if (exists) {
  console.log('File exists!');
} else {
  console.log('File not found');
}
// Output: File exists! (if file exists) or File not found (if it doesn't)

// Check directory existence
const dirExists = await sandbox.file.exists('/project/src');
console.log(dirExists); // true (works for directories too)

// Check non-existent path (returns false, no error)
const missing = await sandbox.file.exists('/project/nonexistent.txt');
console.log(missing); // false (never throws an error)

// Defensive pattern before read
const configPath = '/project/config.json';
if (await sandbox.file.exists(configPath)) {
  const config = await sandbox.file.retrieve(configPath);
  console.log('Config loaded:', config);
} else {
  console.log('Config file not found');
}

// Defensive pattern before write (avoid overwrite)
const outputPath = '/project/report.txt';
if (await sandbox.file.exists(outputPath)) {
  console.log('File already exists, skipping write');
} else {
  await sandbox.file.create(outputPath, 'New report content');
  console.log('File created successfully');
}
```

**Notes:**
- Unlike `retrieve()` or `list()`, `exists()` always returns `false` for non-existent paths instead of throwing an error. This makes it safe to call without try/catch blocks and ideal for conditional logic.
- Returns `true` for any path that exists in the filesystem, whether it's a file or directory.
- Use `exists()` before operations to avoid errors (before read), prevent overwrites (before write), or skip unnecessary operations (before delete).
- Available on all sandbox instances regardless of provider.

<br/>
<br/>

---


## `sandbox.watcher`

Real-time file system monitoring.

### `watcher.create(path, options?)`

Create a file watcher to monitor filesystem changes in real-time.

**Parameters:**
- `path` (string, required): Directory or file path to watch
- `options` (object, optional):
  - `includeContent` (boolean): Include file content in change events (default: false)
  - `ignored` (string[]): Glob patterns to ignore (e.g., `['node_modules', '.git']`)
  - `encoding` ('raw' | 'base64'): Content encoding, 'raw' (default) or 'base64' for binary-safe content

**Returns:** `Promise<FileWatcher>` - FileWatcher instance with event handling

**Examples:**
```typescript
// Basic watcher creation
const watcher = await sandbox.watcher.create('/project/src');
watcher.on('change', (event) => {
  console.log(`${event.event}: ${event.path}`);
});
// Logs: add: /project/src/app.ts (when files are added)
//       change: /project/src/app.ts (when files are modified)
//       unlink: /project/src/app.ts (when files are deleted)

// Watch with ignored patterns
const watcher = await sandbox.watcher.create('/project', {
  ignored: ['node_modules', '.git', '*.log', 'dist']
}); // Only monitors changes outside of node_modules, .git, log files, and dist

// Watch with content included
const watcher = await sandbox.watcher.create('/project/config', {
  includeContent: true
});
watcher.on('change', (event) => {
  console.log(`File ${event.event}: ${event.path}`);
  if (event.content) {
    console.log('New content:', event.content);
  }
}); // Output includes full file content for each change event

```

**Notes:**
- Watchers emit five event types: `'add'` (file created), `'change'` (file modified), `'unlink'` (file deleted), `'addDir'` (directory created), `'unlinkDir'` (directory deleted).
- Set `includeContent: false` (default) for better performance when you only need to know which files changed, not their contents. Enable `includeContent: true` only when you need the actual file content.
- Use glob patterns to exclude directories like `node_modules` or `.git` to reduce noise and improve performance. Patterns are matched against the full path.
- Available on all sandbox instances regardless of provider.

<br/>
<br/>

---

### `watcher.list()`

List all active file watchers in the sandbox.

**Parameters:** None

**Returns:** `Promise<WatcherInfo[]>` - Array of watcher information objects

**Examples:**
```typescript
// Basic list all watchers
const watchers = await sandbox.watcher.list();
console.log(`Active watchers: ${watchers.length}`);
watchers.forEach(w => {
  console.log(`ID: ${w.id}, Path: ${w.path}, Status: ${w.status}`);
}); // Output: ID: watcher_123, Path: /project/src, Status: active

// Empty list handling
const watchers = await sandbox.watcher.list();
if (watchers.length === 0) {
  console.log('No active watchers');
} else {
  console.log(`Found ${watchers.length} active watcher(s)`);
}

// Check if specific path is being watched
const watchers = await sandbox.watcher.list();
const targetPath = '/project/config';
const isWatched = watchers.some(w => w.path === targetPath);
console.log(`Path ${targetPath} is ${isWatched ? 'being watched' : 'not watched'}`);
```

**Notes:**
- Each watcher object includes `id`, `path`, `includeContent`, `ignored`, `status`, `channel`, and `encoding`.
- Watchers can have status `'active'` (currently monitoring) or `'stopped'` (no longer monitoring).
- Returns the current state of all watchers. Create new watchers with `watcher.create()` and they will appear in subsequent `list()` calls.
- Available on all sandbox instances regardless of provider.

<br/>
<br/>

---

### `watcher.retrieve(id)`

Retrieve information about a specific file watcher by its ID.

**Parameters:**
- `id` (string, required): The watcher ID

**Returns:** `Promise<WatcherInfo>` - Watcher information object

**Examples:**
```typescript
// Basic retrieve watcher info
const watcher = await sandbox.watcher.create('/project/src');
const watcherId = watcher.getId();

const info = await sandbox.watcher.retrieve(watcherId);
console.log('Path:', info.path); // /project/src
console.log('Status:', info.status); // active

// Check watcher status
const watcherId = 'watcher_abc123';
const info = await sandbox.watcher.retrieve(watcherId);
if (info.status === 'active') {
  console.log('Watcher is actively monitoring');
} else {
  console.log('Watcher has been stopped');
}

// Get watcher configuration
const info = await sandbox.watcher.retrieve(watcherId);
console.log('Watching:', info.path);
console.log('Content included:', info.includeContent);
console.log('Ignored patterns:', info.ignored);
console.log('Encoding:', info.encoding || 'raw');

```

**Notes:**
- If the watcher ID doesn't exist, this method will throw an error. Use `list()` first if you're unsure whether a watcher exists.
- Returns the current state of the watcher at the moment of the call. The watcher's status can change if it's destroyed.
- Useful for verifying watcher configuration, checking if a watcher is still active, or debugging watcher setup.
- Available on all sandbox instances regardless of provider.

<br/>
<br/>

---

### `watcher.destroy(id)`

Destroy a file watcher by its ID, stopping all monitoring.

**Parameters:**
- `id` (string, required): The watcher ID to destroy

**Returns:** `Promise<void>`

**Examples:**
```typescript
// Basic destroy by ID
const watcher = await sandbox.watcher.create('/project/src');
const watcherId = watcher.getId();

await sandbox.watcher.destroy(watcherId);
console.log('Watcher destroyed');


// Destroy multiple watchers
const watchers = await sandbox.watcher.list();
for (const w of watchers) {
  await sandbox.watcher.destroy(w.id);
}
console.log('All watchers destroyed');


// Destroy and verify
const watcherId = watcher.getId();
await sandbox.watcher.destroy(watcherId);

const remaining = await sandbox.watcher.list();
const stillExists = remaining.some(w => w.id === watcherId);
console.log('Destroyed:', !stillExists); // true

```

**Notes:**
- `sandbox.watcher.destroy(id)` takes a watcher ID parameter. The FileWatcher instance also has a [`destroy()`](#destroy-2) method that takes no parameters: `watcher.destroy()`. Both accomplish the same result.
- Destroying an already-destroyed watcher will throw an error. Use defensive checks with `list()` if you're unsure.
- Available on all sandbox instances regardless of provider.

<br/>
<br/>

---

### FileWatcher Instance

The `FileWatcher` instance returned by `watcher.create()` provides event-based monitoring and management methods.

**Getter Methods:**
- `getId()`: Returns the watcher ID (string)
- `getPath()`: Returns the watched path (string)
- `getStatus()`: Returns watcher status ('active' | 'stopped')
- `getChannel()`: Returns the WebSocket channel (string)
- `isIncludingContent()`: Returns true if content is included in events (boolean)
- `getIgnoredPatterns()`: Returns array of ignored patterns (string[])
- `isActive()`: Returns true if watcher is active (boolean)

**Example:**
```typescript
const watcher = await sandbox.watcher.create('/project/src', {
  includeContent: true,
  ignored: ['*.test.ts']
});

console.log('ID:', watcher.getId());              // watcher_abc123
console.log('Path:', watcher.getPath());          // /project/src
console.log('Status:', watcher.getStatus());      // active
console.log('Active:', watcher.isActive());       // true
console.log('Content:', watcher.isIncludingContent()); // true
console.log('Ignored:', watcher.getIgnoredPatterns());  // ['*.test.ts']
```

---

#### `on(event, handler)`

Register an event handler for file changes or watcher destruction.

**Parameters:**
- `event` ('change' | 'destroyed', required): Event type to listen for
- `handler` (function, required): Event handler function
  - For 'change': `(event: FileChangeEvent) => void`
  - For 'destroyed': `() => void`

**FileChangeEvent properties:**
- `event`: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
- `path`: File or directory path (string)
- `content`: File content (string, only if `includeContent: true`)

**Returns:** void

**Examples:**
```typescript
// Basic change event listener
const watcher = await sandbox.watcher.create('/project/src');
watcher.on('change', (event) => {
  console.log(`${event.event}: ${event.path}`);
});
// Output: change: /project/src/app.ts
//         add: /project/src/utils.ts
//         unlink: /project/src/old.ts

// Handle different event types
const watcher = await sandbox.watcher.create('/project');
watcher.on('change', (event) => {
  switch (event.event) {
    case 'add':
      console.log('File created:', event.path);
      break;
    case 'change':
      console.log('File modified:', event.path);
      break;
    case 'unlink':
      console.log('File deleted:', event.path);
      break;
    case 'addDir':
      console.log('Directory created:', event.path);
      break;
    case 'unlinkDir':
      console.log('Directory deleted:', event.path);
      break;
  }
});

// Access file content in events
const watcher = await sandbox.watcher.create('/project/config', {
  includeContent: true
});
watcher.on('change', (event) => {
  console.log(`${event.event}: ${event.path}`);
  if (event.content) {
    console.log('Content length:', event.content.length);
    console.log('First 100 chars:', event.content.substring(0, 100));
  }
});
```

**Notes:**
- You can register multiple handlers for the same event. All handlers will be called when the event fires.
- The `content` property is only present in change events if the watcher was created with `includeContent: true`.
- Change events are emitted in the order they occur. If multiple files change simultaneously, you'll receive multiple events.
- The 'destroyed' event fires when the watcher is destroyed (via `destroy()` or `sandbox.watcher.destroy(id)`), allowing cleanup of resources.

<br/>
<br/>

---

#### `off(event, handler)`

Unregister an event handler to stop receiving notifications.

**Parameters:**
- `event` ('change' | 'destroyed', required): Event type
- `handler` (function, required): The specific handler function to remove

**Returns:** void

**Examples:**
```typescript
// Basic remove handler
const watcher = await sandbox.watcher.create('/project/src');

const changeHandler = (event) => {
  console.log('Change:', event.path);
};

watcher.on('change', changeHandler);
  // Later, stop listening
watcher.off('change', changeHandler);

// Remove specific handler from multiple
const watcher = await sandbox.watcher.create('/project/src');

const handler1 = (event) => console.log('Handler 1:', event.path);
const handler2 = (event) => console.log('Handler 2:', event.path);

watcher.on('change', handler1);
watcher.on('change', handler2);

  // Remove only handler1, handler2 continues to receive events
watcher.off('change', handler1);

// Temporary listener pattern
const watcher = await sandbox.watcher.create('/project/build');

const buildCompleteHandler = (event) => {
  if (event.path.endsWith('build-complete.txt')) {
    console.log('Build complete!');
    // Stop listening after detecting completion
    watcher.off('change', buildCompleteHandler);
  }
};

watcher.on('change', buildCompleteHandler);

```

**Notes:**
- You must pass the exact same function reference that was used with `on()`. Anonymous functions cannot be removed unless you store a reference.
- Calling `off()` with a handler that wasn't registered has no effect and doesn't throw an error.
- Always remove event handlers when you're done with them to prevent memory leaks, especially in long-running applications.

<br/>
<br/>

---

#### `destroy()`

Destroy the watcher instance, stopping all monitoring and cleanup resources.

**Parameters:** None

**Returns:** `Promise<void>`

**Examples:**
```typescript
// Basic destroy instance
const watcher = await sandbox.watcher.create('/project/src');
watcher.on('change', (event) => {
  console.log('Change:', event.path);
});

  // Later, when done monitoring
await watcher.destroy();
console.log('Watcher stopped');


// Destroy after one-time operation
const watcher = await sandbox.watcher.create('/project/output');

watcher.on('change', async (event) => {
  if (event.path.endsWith('result.json')) {
    console.log('Result file created, cleaning up');
    await watcher.destroy();
  }
});
```

**Notes:**
- When you call `destroy()`, the watcher automatically unsubscribes from WebSocket events and clears all event handlers.
- Both `watcher.destroy()` (instance method, no parameters) and `sandbox.watcher.destroy(id)` (namespace method, requires ID) accomplish the same result.

<br/>
<br/>

---


## `sandbox.signals`

Monitor system events and emit custom signals via WebSocket.

<br/>
<br/>

---

### `signals.start()`

Start the signal service to monitor system events via WebSocket.

**Parameters:** None

**Returns:** `Promise<SignalService>` - SignalService instance with event handling

**SignalService interface:**
- Event methods: `on()`, `off()`, `stop()`
- Getter methods: `getStatus()`, `getChannel()`, `isActive()`

**Examples:**

```typescript
// Start signal monitoring
const signals = await sandbox.signals.start();

// Listen for port signals
signals.on('port', (event) => {
  console.log(`Port ${event.port} ${event.type}: ${event.url}`);
});

// Listen for error signals
signals.on('error', (event) => {
  console.error('Error:', event.message);
});

// Check status
console.log('Active:', signals.isActive());  // true
console.log('Status:', signals.getStatus()); // 'active'
console.log('Channel:', signals.getChannel()); // 'signals-channel-123'

// Stop when done
await signals.stop();
```

**Notes:**
- Returns a `SignalService` instance for monitoring events
- Requires WebSocket connection to receive events
- Multiple event handlers can be registered for the same event type
- Available on all sandbox instances regardless of provider

<br/>
<br/>

---

### `signals.status()`

Get the current status of the signal service.

**Parameters:** None

**Returns:** `Promise<SignalStatusInfo>` - Signal service status information

**SignalStatusInfo interface:**
- `status` ('active' | 'stopped'): Current service status
- `channel` (string): WebSocket channel identifier
- `wsUrl` (string): WebSocket URL

**Examples:**

```typescript
// Get signal service status
const status = await sandbox.signals.status();
console.log(status.status);   // 'active' or 'stopped'
console.log(status.channel);  // 'signals-channel-123'
console.log(status.wsUrl);    // 'wss://...'

// Check if service is active before emitting
const status = await sandbox.signals.status();
if (status.status === 'active') {
  await sandbox.signals.emitPort(3000, 'open', 'http://localhost:3000');
}
```

**Notes:**
- Returns current state without requiring a `SignalService` instance
- Use this to check status before calling other signal methods
- Available on all sandbox instances regardless of provider

<br/>
<br/>

---

### `signals.stop()`

Stop the signal service (namespace method).

**Parameters:** None

**Returns:** `Promise<void>`

**Examples:**

```typescript
// Stop signal service via namespace
await sandbox.signals.stop();
console.log('Signal service stopped');

// Alternative: stop via instance
const signals = await sandbox.signals.start();
await signals.stop();
```

**Notes:**
- This is a namespace method - can be called directly on `sandbox.signals`
- The `SignalService` instance also has a `stop()` method
- Both accomplish the same result
- Available on all sandbox instances regardless of provider

<br/>
<br/>

---

### `signals.emitPort(port, type, url)`

Emit a port signal to notify about port status changes.

**Parameters:**
- `port` (number, required): Port number
- `type` ('open' | 'close', required): Signal type indicating port status
- `url` (string, required): URL associated with the port

**Returns:** `Promise<void>`

**Examples:**

```typescript
// Emit port opened signal
await sandbox.signals.emitPort(3000, 'open', 'http://localhost:3000');

// Emit port closed signal
await sandbox.signals.emitPort(3000, 'close', 'http://localhost:3000');

// Notify about server starting
await sandbox.signals.emitPort(8080, 'open', 'https://myapp.example.com');
console.log('Port signal emitted');
```

**Notes:**
- Use 'open' type when a port becomes available
- Use 'close' type when a port is no longer available
- Requires signal service to be started to receive events
- Available on all sandbox instances regardless of provider

<br/>
<br/>

---

### `signals.emitError(message)`

Emit an error signal to notify about errors in the sandbox.

**Parameters:**
- `message` (string, required): Error message

**Returns:** `Promise<void>`

**Examples:**

```typescript
// Emit error signal
await sandbox.signals.emitError('Database connection failed');

// Error in application code
try {
  await riskyOperation();
} catch (error) {
  await sandbox.signals.emitError(`Operation failed: ${error.message}`);
}

// Custom error notifications
await sandbox.signals.emitError('Configuration file missing');
```

**Notes:**
- Use for application-level errors or notifications
- Requires signal service to be started to receive events
- Available on all sandbox instances regardless of provider

<br/>
<br/>

---

### `signals.emitServerReady(port, url)`

Emit a server ready signal to notify when a server is ready to accept connections.

**Parameters:**
- `port` (number, required): Port number where server is listening
- `url` (string, required): Server URL

**Returns:** `Promise<void>`

**Examples:**

```typescript
// Notify server is ready
await sandbox.signals.emitServerReady(3000, 'http://localhost:3000');

// After starting Express server
const app = express();
app.listen(3000, async () => {
  await sandbox.signals.emitServerReady(3000, 'http://localhost:3000');
  console.log('Server ready signal emitted');
});

// Multiple servers
await sandbox.signals.emitServerReady(3000, 'http://localhost:3000'); // API
await sandbox.signals.emitServerReady(8080, 'http://localhost:8080'); // WebSocket
```

**Notes:**
- Specialized signal for server readiness (distinct from port open)
- Useful for coordinating application startup
- Requires signal service to be started to receive events
- Available on all sandbox instances regardless of provider

<br/>
<br/>

---

## SignalService Instance

The `SignalService` instance returned by `signals.start()` provides event handling and management methods.

### `on(event, handler)`

Register an event handler for signal events.

**Parameters:**
- `event` ('port' | 'error' | 'signal', required): Event type to listen for
- `handler` (function, required): Event handler function
  - For 'port': `(event: PortSignalEvent) => void`
  - For 'error': `(event: ErrorSignalEvent) => void`
  - For 'signal': `(event: SignalEvent) => void`

**Event Types:**
- `PortSignalEvent`: `{ signal: 'port' | 'server-ready', port: number, url: string, type?: 'open' | 'close' }`
- `ErrorSignalEvent`: `{ signal: 'error', message: string }`
- `SignalEvent`: Union of all event types

**Returns:** void

**Examples:**

```typescript
const signals = await sandbox.signals.start();

// Listen for port events
signals.on('port', (event) => {
  console.log(`Signal: ${event.signal}`);
  console.log(`Port: ${event.port} - ${event.url}`);
  if (event.type) {
    console.log(`Type: ${event.type}`);
  }
});

// Listen for error events
signals.on('error', (event) => {
  console.error(`Error signal: ${event.message}`);
});

// Listen for all signal events (generic)
signals.on('signal', (event) => {
  console.log('Signal received:', event);
});

// Multiple handlers for same event
const handler1 = (event) => console.log('Handler 1:', event.port);
const handler2 = (event) => console.log('Handler 2:', event.port);

signals.on('port', handler1);
signals.on('port', handler2);
// Both handlers will be called
```

**Notes:**
- Multiple handlers can be registered for the same event type
- All handlers are called when an event fires
- The 'port' event includes both port signals and server-ready signals
- The 'signal' event is a generic listener that receives all signal types
- Handler errors are caught and logged to console without stopping other handlers

<br/>
<br/>

---

### `off(event, handler)`

Unregister an event handler to stop receiving notifications.

**Parameters:**
- `event` ('port' | 'error' | 'signal', required): Event type
- `handler` (function, required): The specific handler function to remove

**Returns:** void

**Examples:**

```typescript
const signals = await sandbox.signals.start();

// Register handler
const portHandler = (event) => {
  console.log('Port event:', event.port);
};
signals.on('port', portHandler);

// Later, remove handler
signals.off('port', portHandler);

// Remove specific handler from multiple
const handler1 = (event) => console.log('Handler 1');
const handler2 = (event) => console.log('Handler 2');

signals.on('error', handler1);
signals.on('error', handler2);

signals.off('error', handler1); // Only handler2 continues to receive events

// Cleanup pattern
const cleanup = () => {
  signals.off('port', portHandler);
  signals.off('error', errorHandler);
};
```

**Notes:**
- Must pass the exact same function reference used with `on()`
- Anonymous functions cannot be removed unless you store a reference
- No error if handler wasn't registered
- Use for cleanup when you no longer need specific handlers

<br/>
<br/>

---

### `stop()`

Stop the signal service instance and clean up resources.

**Parameters:** None

**Returns:** `Promise<void>`

**Examples:**

```typescript
// Stop via instance method
const signals = await sandbox.signals.start();
signals.on('port', (event) => console.log(event));

// Later, stop monitoring
await signals.stop();
console.log('Signal service stopped');

// Cleanup pattern with finally
let signals;
try {
  signals = await sandbox.signals.start();
  signals.on('port', (event) => console.log(event));
  // ... work ...
} finally {
  if (signals) {
    await signals.stop();
  }
}
```

**Notes:**
- Makes POST request to `/signals/stop`
- Cleans up WebSocket subscriptions and event handlers
- Sets status to 'stopped'
- Alternative to namespace method `sandbox.signals.stop()`

<br/>
<br/>

---

### Getter Methods

The `SignalService` instance provides getter methods to inspect its state.

**`getStatus()`** - Returns current status ('active' | 'stopped')
```typescript
const signals = await sandbox.signals.start();
console.log(signals.getStatus()); // 'active'
```

**`getChannel()`** - Returns WebSocket channel identifier
```typescript
const signals = await sandbox.signals.start();
console.log(signals.getChannel()); // 'signals-channel-123'
```

**`isActive()`** - Returns true if service is active
```typescript
const signals = await sandbox.signals.start();
console.log(signals.isActive()); // true

await signals.stop();
console.log(signals.isActive()); // false
```

<br/>
<br/>

---

## sandbox.sessionTokens

Manage session tokens for delegated access. Session tokens provide temporary, scoped access to a sandbox without requiring the primary access token.

**Important:** All sessionToken methods require an **access token**. Session tokens cannot manage themselves (403 Forbidden).

<br/>
<br/>

---

### `sessionTokens.create(options?)`

Create a new session token for delegated access to the sandbox.

**Parameters:**
- `options` (object, optional): Token configuration
  - `description` (string, optional): Human-readable description for the token
  - `expiresIn` (number, optional): Expiration time in seconds (default: 604800 = 7 days)

**Returns:** `Promise<SessionTokenInfo>` - Session token information including the token value

**SessionTokenInfo interface (create only):**
- `id` (string): Unique token identifier
- `token` (string): The actual token value - **ONLY returned on creation, cannot be retrieved later!**
- `description` (string, optional): Token description
- `createdAt` (string): ISO timestamp when token was created
- `expiresAt` (string): ISO timestamp when token expires

**Examples:**

```typescript
// Basic token creation with default expiration (7 days)
const token = await sandbox.sessionTokens.create();
console.log(token.token);      // "st_abc123..." - Save this!
console.log(token.id);         // "token_xyz789"
console.log(token.expiresAt);  // "2024-01-15T12:00:00Z"

// Token with description
const token = await sandbox.sessionTokens.create({
  description: 'My Application'
});
console.log(token.description); // "My Application"

// Token with custom expiration (1 hour = 3600 seconds)
const token = await sandbox.sessionTokens.create({
  description: 'Short-lived token',
  expiresIn: 3600
});

// Save token immediately - it won't be available later!
const token = await sandbox.sessionTokens.create({
  description: 'Production API'
});
const tokenValue = token.token; // Save this now!
// Later calls to retrieve() or list() will NOT include the token value

// Use token to create a new sandbox connection
const delegatedSandbox = new Sandbox({
  sandboxUrl: 'https://sandbox-123.computesdk.com',
  token: token.token  // Use session token instead of access token
});
```

**Notes:**
- ⚠️ **Critical:** The `token` field is ONLY returned once at creation time - store it securely immediately!
- Requires an **access token** to call (403 Forbidden if called with a session token)
- Default expiration is 7 days (604800 seconds)
- Token becomes invalid after expiration or revocation
- Use session tokens to delegate access without exposing your primary access token
- Available on all sandbox instances regardless of provider

<br/>
<br/>

---

### `sessionTokens.list()`

List all session tokens for the current sandbox.

**Parameters:** None

**Returns:** `Promise<SessionTokenInfo[]>` - Array of session token information

**SessionTokenInfo interface (list):**
- `id` (string): Unique token identifier
- `description` (string, optional): Token description
- `createdAt` (string): ISO timestamp when token was created
- `expiresAt` (string): ISO timestamp when token expires
- `lastUsedAt` (string, optional): ISO timestamp of last usage (undefined if never used)

**Note:** The actual `token` value is **NOT included** in list results.

**Examples:**

```typescript
// List all tokens
const tokens = await sandbox.sessionTokens.list();
console.log(`Found ${tokens.length} tokens`);

// Display token information
const tokens = await sandbox.sessionTokens.list();
tokens.forEach(token => {
  console.log(`ID: ${token.id}`);
  console.log(`Description: ${token.description || 'None'}`);
  console.log(`Created: ${token.createdAt}`);
  console.log(`Expires: ${token.expiresAt}`);
  console.log(`Last used: ${token.lastUsedAt || 'Never'}`);
});

// Find tokens by description
const tokens = await sandbox.sessionTokens.list();
const prodToken = tokens.find(t => t.description === 'Production API');

// Check for expired tokens
const tokens = await sandbox.sessionTokens.list();
const now = new Date();
const expiredTokens = tokens.filter(t => new Date(t.expiresAt) < now);
console.log(`${expiredTokens.length} tokens have expired`);
```

**Notes:**
- ⚠️ The actual `token` value is NOT included - use `create()` to get the token value
- Requires an **access token** to call (403 Forbidden if called with a session token)
- Returns empty array if no tokens exist
- Includes `lastUsedAt` to track when token was last used
- Available on all sandbox instances regardless of provider

<br/>
<br/>

---

### `sessionTokens.retrieve(id)`

Retrieve detailed information about a specific session token by ID.

**Parameters:**
- `id` (string, required): The token ID to retrieve

**Returns:** `Promise<SessionTokenInfo>` - Session token information

**SessionTokenInfo interface (retrieve):**
- `id` (string): Unique token identifier
- `description` (string, optional): Token description
- `createdAt` (string): ISO timestamp when token was created
- `expiresAt` (string): ISO timestamp when token expires

**Note:** The actual `token` value and `lastUsedAt` field are **NOT included** in retrieve results.

**Examples:**

```typescript
// Retrieve specific token
const token = await sandbox.sessionTokens.retrieve('token_abc123');
console.log(token.id);          // "token_abc123"
console.log(token.description); // "My Application"
console.log(token.expiresAt);   // "2024-01-15T12:00:00Z"

// Check if token exists
try {
  const token = await sandbox.sessionTokens.retrieve('token_xyz789');
  console.log('Token exists:', token.id);
} catch (error) {
  console.error('Token not found');
}

// Check expiration
const token = await sandbox.sessionTokens.retrieve('token_abc123');
const expiresAt = new Date(token.expiresAt);
const now = new Date();
if (expiresAt < now) {
  console.log('Token has expired');
  await sandbox.sessionTokens.revoke(token.id);
} else {
  const hoursRemaining = (expiresAt - now) / (1000 * 60 * 60);
  console.log(`Token expires in ${hoursRemaining.toFixed(1)} hours`);
}
```

**Notes:**
- ⚠️ The actual `token` value is NOT included - cannot retrieve token value after creation
- ⚠️ The `lastUsedAt` field is also NOT included (unlike `list()`)
- Requires an **access token** to call (403 Forbidden if called with a session token)
- Throws error if token ID doesn't exist
- Available on all sandbox instances regardless of provider

<br/>
<br/>

---

### `sessionTokens.revoke(id)`

Revoke (delete) a session token, immediately invalidating it and preventing further use.

**Parameters:**
- `id` (string, required): The token ID to revoke

**Returns:** `Promise<void>` - Resolves when token is successfully revoked

**Examples:**

```typescript
// Basic revocation
await sandbox.sessionTokens.revoke('token_abc123');
console.log('Token revoked');

// Revoke expired tokens
const tokens = await sandbox.sessionTokens.list();
const now = new Date();
for (const token of tokens) {
  if (new Date(token.expiresAt) < now) {
    await sandbox.sessionTokens.revoke(token.id);
    console.log(`Revoked expired token: ${token.id}`);
  }
}

// Safe revocation with error handling
try {
  await sandbox.sessionTokens.revoke('token_xyz789');
  console.log('Token revoked successfully');
} catch (error) {
  console.error('Revocation failed:', error.message);
}

// Revoke all tokens
const tokens = await sandbox.sessionTokens.list();
await Promise.all(
  tokens.map(token => sandbox.sessionTokens.revoke(token.id))
);
console.log('All tokens revoked');
```

**Notes:**
- Requires an **access token** to call (403 Forbidden if called with a session token)
- Revocation is immediate and permanent - the token cannot be used after this call
- Does not throw error if token doesn't exist or was already revoked
- Once revoked, any sandbox connections using this token will fail with authentication errors
- Use this to clean up expired or compromised tokens
- Available on all sandbox instances regardless of provider

<br/>
<br/>

---


## `sandbox.magicLinks`

Create one-time authentication URLs for browser-based access. Magic links provide passwordless authentication by automatically creating session tokens and setting them as secure cookies.

**Important:** Requires an **access token** to create magic links (403 Forbidden if called with a session token).

<br/>
<br/>

---

### `magicLinks.create(options?)`

Create a one-time magic link URL for browser-based authentication.

**Parameters:**
- `options` (object, optional): Magic link configuration
  - `redirectUrl` (string, optional): URL path to redirect to after authentication (default: `/play/`)

**Returns:** `Promise<MagicLinkInfo>` - Magic link information including the URL

**MagicLinkInfo interface:**
- `url` (string): The magic link URL to share with users
- `expiresAt` (string): ISO timestamp when the link expires
- `redirectUrl` (string): The redirect URL configured for this link

**Examples:**

```typescript
// Basic magic link with default redirect
const link = await sandbox.magicLinks.create();
console.log(link.url);         // "https://sandbox-123.computesdk.com/auth/magic/abc123..."
console.log(link.expiresAt);   // "2024-01-09T12:05:00Z" (5 minutes from now)
console.log(link.redirectUrl); // "/play/"

// Magic link with custom redirect
const link = await sandbox.magicLinks.create({
  redirectUrl: '/dashboard'
});
console.log(link.redirectUrl); // "/dashboard"

```

**Notes:**
- ⚠️ **One-time use:** Link expires after first click or 5 minutes (whichever comes first)
- ⚠️ **Security:** Session token is set as HttpOnly cookie, preventing XSS attacks
- Requires an **access token** to call (403 Forbidden if called with a session token)
- Magic link expires after **5 minutes** or first use
- Automatically creates a **session token** with **7-day expiration**
- Session token is set as an **HttpOnly cookie** (not accessible via JavaScript)
- Default redirect is `/play/` if `redirectUrl` is not specified
- Relative URLs only - `redirectUrl` should be a path, not a full URL
- Available on all sandbox instances regardless of provider

<br/>
<br/>

---
