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

## `getInfo()`

Get information about the sandbox including status, provider, and metadata.

**Parameters:** None

**Returns:** `Promise<SandboxInfo>` - Sandbox information including status and configuration

**SandboxInfo interface:**
- `id` (string): Unique identifier for the sandbox
- `provider` (string): Provider hosting the sandbox (e.g., 'e2b', 'modal', 'docker')
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
console.log(info.status);     // "running"

// Check sandbox status
const info = await sandbox.getInfo();
if (info.status === 'running') {
  console.log('Sandbox is active');
  await sandbox.runCommand('echo "Hello"');
} else {
  console.log('Sandbox is not available');
}

// Access provider info
const info = await sandbox.getInfo();
console.log(`Running on ${info.provider}`);
console.log(`Created: ${info.createdAt.toISOString()}`);
console.log(`Timeout: ${info.timeout}ms`);

// Full info inspection for debugging
const info = await sandbox.getInfo();
console.log('Sandbox Information:');
console.log(`  ID: ${info.id}`);
console.log(`  Provider: ${info.provider}`);
console.log(`  Status: ${info.status}`);
console.log(`  Created: ${info.createdAt}`);
console.log(`  Timeout: ${info.timeout}ms`);
if (info.metadata) {
  console.log(`  Metadata:`, info.metadata);
}
```

**Notes:**
- Returns information about the sandbox's current state and configuration
- May return locally cached information depending on provider implementation
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
