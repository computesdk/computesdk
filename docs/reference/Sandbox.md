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
- URLs follow the pattern: `${protocol}://${sandbox-id}-${port}.preview.computesdk.com`

<br/>
<br/>

---

## sandbox.filesystem

ComputeSDK provides filesystem operations for managing files and directories within sandboxes. All filesystem operations are accessed through the `sandbox.filesystem` object.

### filesystem.readFile(path)

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
- Available on all sandbox instances with filesystem support
<br/>
<br/>

---

### filesystem.writeFile(path, content)

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
- Available on all sandbox instances with filesystem support
<br/>
<br/>

---
### filesystem.mkdir()

```typescript
// Create a directory
await sandbox.filesystem.mkdir('/app/new-directory')
``` 
<br/>
<br/>

---

### filesystem.readdir() 
```typescript
// List directory contents
const entries = await sandbox.filesystem.readdir('/app')
entries.forEach(entry => {
  console.log(`${entry.isDirectory ? '📁' : '📄'} ${entry.name} (${entry.size} bytes)`)
})
```
<br/>
<br/>

---

### filesystem.exists()
```typescript
// Check if a file or directory exists
const exists = await sandbox.filesystem.exists('/path/to/file')
```
<br/>
<br/>

---

### filesystem.remove()

```typescript
// Remove a file
await sandbox.filesystem.remove('/path/to/file.txt')

// Remove a directory (recursive)
await sandbox.filesystem.remove('/path/to/directory')
```

<br/>
<br/>

---

## sandbox.terminals

### terminals.create()

```typescript
// Create a PTY terminal (interactive shell with WebSocket)
const ptyTerminal = await sandbox.terminals.create({
  pty: true,
  shell: '/bin/bash'
});
ptyTerminal.on('output', (data) => console.log(data));
ptyTerminal.write('ls -la\n');

// Create an exec terminal (command tracking without WebSocket)
const execTerminal = await sandbox.terminals.create({ pty: false });
const result = await execTerminal.execute('npm test');
console.log(result.data.stdout);
```
<br/>
<br/>

---
### terminals.list()
```typescript
// List all terminals
const terminals = await sandbox.terminals.list();
```
<br/>
<br/>

---
### terminals.retrieve()
```typescript
// Retrieve a specific terminal
const terminal = await sandbox.terminals.retrieve('terminal-id');
```
<br/>
<br/>

---
### terminals.destroy()
```typescript
// Destroy a terminal
await sandbox.terminals.destroy('terminal-id');
```


### Terminal Modes

The client supports two terminal modes:

#### PTY Mode (Interactive)

PTY terminals provide a full interactive shell with WebSocket streaming:

```typescript
const terminal = await sandbox.terminals.create({
  pty: true,
  shell: '/bin/bash',
  encoding: 'raw' // or 'base64' for binary-safe
});

// Real-time output via WebSocket
terminal.on('output', (data) => process.stdout.write(data));
terminal.on('destroyed', () => console.log('Terminal closed'));

// Write to terminal
terminal.write('ls -la\n');
terminal.write('cd /app && npm start\n');

// Clean up
await terminal.destroy();
```

#### Exec Mode (Command Tracking)

Exec terminals track individual commands with status and output:

```typescript
const terminal = await sandbox.terminals.create({ pty: false });

// Run a command and get structured result
const result = await terminal.execute('npm test');
console.log(result.data.cmd_id);
console.log(result.data.status);  // 'running' | 'completed' | 'failed'
console.log(result.data.stdout);
console.log(result.data.stderr);
console.log(result.data.exit_code);

// Run in background
const bgResult = await terminal.execute('npm install', { background: true });
console.log(bgResult.data.cmd_id); // Track this command

// Check command status later
const cmdStatus = await sandbox.getCommand(terminal.getId(), bgResult.data.cmd_id);

// Wait for command to complete
const finalResult = await sandbox.waitForCommand(
  terminal.getId(),
  bgResult.data.cmd_id,
  { timeout: 60000 }
);

// List all commands in a terminal
const commands = await sandbox.listCommands(terminal.getId());

await terminal.destroy();
```

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
