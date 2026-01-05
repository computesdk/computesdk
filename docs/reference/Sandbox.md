# Sandbox (interface)

## Overview

Methods available for interacting with a compute sandbox.

<br/>
<br/>

---

## runCommand(command, options?)

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

## runCode(code, language?)

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

## getUrl()
To generate a url for the sandbox, provide your port of choice and use ```sandbox.getUrl({port: number})```
```typescript
const result = await sandbox.getUrl({port: number})
```

<br/>
<br/>

---

## sandbox.filesystem

ComputeSDK provides filesystem operations for managing files and directories within sandboxes. All filesystem operations are accessed through the `sandbox.filesystem` object.

### filesystem.readFile()

```typescript
// Read a file as text
const content = await sandbox.filesystem.readFile('/path/to/file.txt')

// With error handling
try {
  const content = await sandbox.filesystem.readFile('/nonexistent.txt')
} catch (error) {
  console.error('Failed to read file:', error.message)
}
```
<br/>
<br/>

---

### filesystem.writeFile()

```typescript
// Write a text file
await sandbox.filesystem.writeFile('/path/to/file.txt', 'Hello, World!')

// Write JSON data
const data = { key: 'value' }
await sandbox.filesystem.writeFile('/path/to/data.json', JSON.stringify(data))
```
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
