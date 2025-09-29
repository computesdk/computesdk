# Terminal

ComputeSDK provides full terminal access for interactive shell sessions, command execution, and process management. Create persistent terminal sessions, handle input/output streams, and manage multiple shell environments.

## Quick Start

```typescript
import { compute } from 'computesdk'

const sandbox = await compute('e2b')

// Create a terminal session
const terminal = await sandbox.createTerminal()

// Execute commands interactively
await terminal.write('python --version\n')
const output = await terminal.read()
console.log(output)

// Close the terminal
await terminal.close()
```

## Creating Terminal Sessions

### Basic Terminal Creation

```typescript
// Create default terminal (usually bash)
const terminal = await sandbox.createTerminal()

// Create with specific shell
const bashTerminal = await sandbox.createTerminal({
  shell: '/bin/bash'
})

const zshTerminal = await sandbox.createTerminal({
  shell: '/bin/zsh',
  args: ['--login']
})

// Create with custom environment
const terminal = await sandbox.createTerminal({
  env: {
    NODE_ENV: 'development',
    DEBUG: 'true',
    PATH: '/custom/bin:' + process.env.PATH
  }
})

// Create with specific working directory
const terminal = await sandbox.createTerminal({
  cwd: '/app/src',
  shell: '/bin/bash'
})
```

### Terminal Configuration

```typescript
interface TerminalConfig {
  // Shell to use
  shell?: string
  
  // Shell arguments
  args?: string[]
  
  // Working directory
  cwd?: string
  
  // Environment variables
  env?: Record<string, string>
  
  // Terminal size
  cols?: number
  rows?: number
  
  // Encoding
  encoding?: 'utf8' | 'ascii' | 'binary'
  
  // Timeout for operations
  timeout?: number
  
  // Keep alive settings
  keepAlive?: boolean
  idleTimeout?: number
}

const terminal = await sandbox.createTerminal({
  shell: '/bin/bash',
  cols: 120,
  rows: 30,
  env: { TERM: 'xterm-256color' },
  timeout: 30000,
  keepAlive: true
})
```

## Interactive Terminal Operations

### Writing to Terminal

```typescript
// Execute a command
await terminal.write('ls -la\n')

// Send input to interactive program
await terminal.write('python\n')
await terminal.write('print("Hello, World!")\n')
await terminal.write('exit()\n')

// Send special characters
await terminal.write('\u0003') // Ctrl+C
await terminal.write('\u0004') // Ctrl+D
await terminal.write('\u001b[A') // Up arrow

// Send multiple commands
await terminal.writeLines([
  'cd /app',
  'npm install',
  'npm start'
])
```

### Reading from Terminal

```typescript
// Read all available output
const output = await terminal.read()
console.log(output)

// Read with timeout
const output = await terminal.read({ timeout: 5000 })

// Read until specific pattern
const output = await terminal.readUntil('$ ') // Read until shell prompt

// Read line by line
const line = await terminal.readLine()

// Read specific number of bytes
const chunk = await terminal.read({ bytes: 1024 })
```

### Streaming Operations

```typescript
// Stream terminal output
terminal.onData((data) => {
  console.log('Terminal output:', data)
})

// Handle specific output patterns
terminal.onData((data) => {
  if (data.includes('Error:')) {
    console.error('Command failed:', data)
  } else if (data.includes('Warning:')) {
    console.warn('Warning detected:', data)
  }
})

// Stream input to terminal
const inputStream = new PassThrough()
inputStream.pipe(terminal.stdin)

// Write to input stream
inputStream.write('echo "Hello"\n')
```

## Advanced Terminal Features

### Multiple Terminal Sessions

```typescript
// Create multiple terminals
const terminals = await Promise.all([
  sandbox.createTerminal({ name: 'main' }),
  sandbox.createTerminal({ name: 'logs' }),
  sandbox.createTerminal({ name: 'tests' })
])

// Run different tasks in each terminal
terminals[0].write('npm run dev\n')     // Development server
terminals[1].write('tail -f app.log\n') // Log monitoring
terminals[2].write('npm test -- --watch\n') // Test watcher

// Switch between terminals
const activeTerminal = terminals[0]
await activeTerminal.focus()
```

### Terminal Multiplexing

```typescript
// Create tmux session
const tmux = await sandbox.createTmux({
  sessionName: 'development'
})

// Create multiple panes
await tmux.newWindow('editor')
await tmux.newWindow('server')
await tmux.newWindow('logs')

// Send commands to specific windows
await tmux.sendCommand('editor', 'vim src/app.js')
await tmux.sendCommand('server', 'npm start')
await tmux.sendCommand('logs', 'tail -f /var/log/app.log')

// Switch between windows
await tmux.selectWindow('editor')
```

### Screen Sessions

```typescript
// Create screen session
const screen = await sandbox.createScreen({
  sessionName: 'background-tasks'
})

// Create multiple screens
await screen.newScreen('worker1')
await screen.newScreen('worker2')

// Run background tasks
await screen.sendCommand('worker1', 'python worker.py')
await screen.sendCommand('worker2', 'node background-job.js')

// Detach and reattach
await screen.detach()
const sessions = await screen.list()
await screen.reattach('background-tasks')
```

## Process Management

### Running Background Processes

```typescript
// Start process in background
const process = await terminal.startBackground('python server.py')

// Check if process is running
const isRunning = await process.isAlive()
console.log('Process running:', isRunning)

// Get process information
const info = await process.getInfo()
console.log('PID:', info.pid)
console.log('CPU usage:', info.cpu)
console.log('Memory usage:', info.memory)

// Stop the process
await process.kill('SIGTERM')
```

### Process Monitoring

```typescript
// Monitor all processes
const monitor = terminal.createProcessMonitor()

monitor.on('processStart', (proc) => {
  console.log('Process started:', proc.pid, proc.command)
})

monitor.on('processExit', (proc) => {
  console.log('Process exited:', proc.pid, 'code:', proc.exitCode)
})

monitor.on('processError', (proc, error) => {
  console.error('Process error:', proc.pid, error)
})

// Monitor specific process
const processMonitor = await terminal.monitorProcess(1234)
processMonitor.on('stats', (stats) => {
  console.log('CPU:', stats.cpu, 'Memory:', stats.memory)
})
```

### Job Control

```typescript
// List running jobs
const jobs = await terminal.getJobs()
jobs.forEach(job => {
  console.log(`Job ${job.id}: ${job.command} [${job.status}]`)
})

// Send job to background
await terminal.background(jobId)

// Bring job to foreground
await terminal.foreground(jobId)

// Kill job
await terminal.killJob(jobId)

// Suspend/resume job
await terminal.suspend(jobId)
await terminal.resume(jobId)
```

## Command Execution Patterns

### Execute and Wait

```typescript
// Execute command and wait for completion
const result = await terminal.exec('npm install')
console.log('Exit code:', result.exitCode)
console.log('Output:', result.output)

// Execute with timeout
const result = await terminal.exec('long-running-command', {
  timeout: 60000
})

// Execute multiple commands sequentially
const results = await terminal.execSequence([
  'git pull',
  'npm install',
  'npm run build',
  'npm test'
])
```

### Interactive Command Handling

```typescript
// Handle interactive prompts
await terminal.write('npm init\n')

// Respond to prompts
await terminal.expectPrompt('name:')
await terminal.write('my-package\n')

await terminal.expectPrompt('version:')
await terminal.write('1.0.0\n')

await terminal.expectPrompt('description:')
await terminal.write('My awesome package\n')

// Automated interactive session
const automation = terminal.createAutomation()
automation.expect('Password:').respond('secret123')
automation.expect('Continue? (y/n)').respond('y')
automation.expect('$ ').complete()

await terminal.write('sudo apt update\n')
await automation.run()
```

### Command Pipelining

```typescript
// Create command pipeline
const pipeline = terminal.createPipeline()

pipeline
  .command('cat /var/log/app.log')
  .pipe('grep ERROR')
  .pipe('tail -10')
  .pipe('sort')

const result = await pipeline.execute()
console.log('Pipeline output:', result.output)

// Complex pipeline with error handling
const pipeline = terminal.createPipeline()
  .command('find /app -name "*.js"')
  .pipe('xargs grep -l "TODO"')
  .onError((error, command) => {
    console.error(`Command failed: ${command}`, error)
    return 'continue' // or 'stop'
  })

await pipeline.execute()
```

## Terminal UI Features

### Cursor and Screen Control

```typescript
// Move cursor
await terminal.moveCursor(10, 5) // column 10, row 5
await terminal.moveCursorUp(3)
await terminal.moveCursorDown(2)
await terminal.moveCursorLeft(5)
await terminal.moveCursorRight(5)

// Clear screen operations
await terminal.clearScreen()
await terminal.clearLine()
await terminal.clearFromCursor()
await terminal.clearToCursor()

// Scroll operations
await terminal.scrollUp(5)
await terminal.scrollDown(3)
```

### Text Formatting

```typescript
// Set text colors and styles
await terminal.setForegroundColor('red')
await terminal.setBackgroundColor('yellow')
await terminal.setBold(true)
await terminal.setUnderline(true)

// Write formatted text
await terminal.writeFormatted('Error: ', { color: 'red', bold: true })
await terminal.writeFormatted('Operation failed\n', { color: 'white' })

// Reset formatting
await terminal.resetFormat()
```

### Terminal Size Management

```typescript
// Get current terminal size
const size = await terminal.getSize()
console.log(`Terminal size: ${size.cols}x${size.rows}`)

// Resize terminal
await terminal.resize(120, 40)

// Handle resize events
terminal.on('resize', (size) => {
  console.log(`Terminal resized to: ${size.cols}x${size.rows}`)
})

// Fit content to terminal
await terminal.fitToContent()
```

## Session Management

### Session Persistence

```typescript
// Create persistent session
const session = await sandbox.createTerminalSession({
  persistent: true,
  sessionId: 'my-dev-session'
})

// Save session state
await session.save()

// Restore session later
const restoredSession = await sandbox.restoreTerminalSession('my-dev-session')

// List saved sessions
const sessions = await sandbox.listTerminalSessions()
```

### Session Sharing

```typescript
// Create shareable session
const session = await sandbox.createTerminalSession({
  shareable: true,
  permissions: ['read', 'write']
})

// Get session URL for sharing
const shareUrl = await session.getShareUrl()

// Connect to shared session
const sharedSession = await sandbox.connectToSharedSession(shareUrl)

// Control session permissions
await session.setPermissions('user123', ['read'])
await session.revokeAccess('user456')
```

### Session Recording

```typescript
// Start recording session
const recording = await terminal.startRecording({
  format: 'asciicast', // or 'text', 'html'
  includeTimings: true
})

// ... perform terminal operations ...

// Stop recording and save
const recordingData = await recording.stop()
await sandbox.writeFile('/recordings/session.cast', recordingData)

// Replay recording
const player = await terminal.createPlayer()
await player.load('/recordings/session.cast')
await player.play()
```

## Error Handling

### Terminal Error Management

```typescript
// Handle terminal errors
terminal.on('error', (error) => {
  console.error('Terminal error:', error.message)
  
  if (error.code === 'CONNECTION_LOST') {
    // Attempt reconnection
    terminal.reconnect()
  } else if (error.code === 'COMMAND_TIMEOUT') {
    // Kill hanging process
    terminal.interrupt()
  }
})

// Graceful error recovery
async function executeWithRetry(terminal: Terminal, command: string, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await terminal.exec(command)
    } catch (error) {
      if (i === maxRetries - 1) throw error
      
      console.log(`Attempt ${i + 1} failed, retrying...`)
      await terminal.reset()
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
}
```

### Connection Management

```typescript
// Handle connection issues
terminal.on('disconnect', () => {
  console.log('Terminal disconnected')
})

terminal.on('reconnect', () => {
  console.log('Terminal reconnected')
})

// Configure automatic reconnection
const terminal = await sandbox.createTerminal({
  reconnect: {
    enabled: true,
    maxAttempts: 5,
    delay: 1000,
    backoff: 'exponential'
  }
})

// Manual reconnection
if (!terminal.isConnected()) {
  await terminal.reconnect()
}
```

## Performance Optimization

### Terminal Buffering

```typescript
// Configure output buffering
const terminal = await sandbox.createTerminal({
  buffering: {
    enabled: true,
    size: 8192,        // Buffer size in bytes
    flushInterval: 100  // Flush every 100ms
  }
})

// Manual buffer control
await terminal.flushBuffer()
await terminal.clearBuffer()
```

### Batch Operations

```typescript
// Batch multiple commands
const batch = terminal.createBatch()
batch.add('cd /app')
batch.add('export NODE_ENV=production')
batch.add('npm start')

const results = await batch.execute()

// Parallel command execution in multiple terminals
const commands = [
  'npm run lint',
  'npm run test',
  'npm run build'
]

const results = await Promise.all(
  commands.map(cmd => {
    const terminal = await sandbox.createTerminal()
    return terminal.exec(cmd)
  })
)
```

## Integration Examples

### Web-based Terminal

```typescript
// WebSocket-based terminal
io.on('connection', (socket) => {
  let terminal: Terminal
  
  socket.on('create-terminal', async (config) => {
    terminal = await sandbox.createTerminal(config)
    
    terminal.onData((data) => {
      socket.emit('terminal-output', data)
    })
    
    socket.emit('terminal-ready')
  })
  
  socket.on('terminal-input', (data) => {
    if (terminal) {
      terminal.write(data)
    }
  })
  
  socket.on('resize', (size) => {
    if (terminal) {
      terminal.resize(size.cols, size.rows)
    }
  })
  
  socket.on('disconnect', () => {
    if (terminal) {
      terminal.close()
    }
  })
})
```

### Command-line Interface

```typescript
// CLI tool using terminal
class CLI {
  private terminal: Terminal
  
  constructor(terminal: Terminal) {
    this.terminal = terminal
  }
  
  async run() {
    console.log('Welcome to the interactive CLI')
    
    while (true) {
      const command = await this.prompt('> ')
      
      if (command === 'exit') {
        break
      }
      
      try {
        const result = await this.terminal.exec(command)
        console.log(result.output)
      } catch (error) {
        console.error('Error:', error.message)
      }
    }
  }
  
  async prompt(text: string): Promise<string> {
    return new Promise((resolve) => {
      process.stdout.write(text)
      process.stdin.once('data', (data) => {
        resolve(data.toString().trim())
      })
    })
  }
}
```

## Best Practices

1. **Resource Management**: Always close terminals when done to free resources
2. **Error Handling**: Implement proper error handling and recovery mechanisms
3. **Session Management**: Use persistent sessions for long-running operations
4. **Security**: Validate and sanitize all user inputs before execution
5. **Performance**: Use buffering and batch operations for better performance
6. **Monitoring**: Monitor terminal sessions for errors and resource usage
7. **Cleanup**: Implement proper cleanup procedures for background processes
8. **User Experience**: Provide responsive feedback for terminal operations

## Security Considerations

1. **Input Validation**: Always validate and sanitize terminal inputs
2. **Command Injection**: Prevent command injection attacks
3. **Access Control**: Implement proper access controls for shared sessions
4. **Resource Limits**: Set appropriate limits on terminal resources
5. **Audit Logging**: Log all terminal activities for security auditing
6. **Session Isolation**: Ensure proper isolation between terminal sessions

## Related Documentation

- [Overview](./overview.md) - SDK architecture and concepts
- [Code Execution](./code-execution.md) - Running code and commands
- [Sandbox Management](./sandbox-management.md) - Managing sandbox lifecycle
- [Filesystem](./filesystem.md) - File operations and management
- [Configuration](./configuration.md) - Terminal configuration options