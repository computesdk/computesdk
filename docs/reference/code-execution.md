# Code Execution

ComputeSDK provides powerful code execution capabilities across multiple languages and environments. Execute scripts, run commands, manage processes, and handle input/output streams with ease.

## Quick Start

```typescript
import { createCompute } from 'computesdk'

const compute = createCompute()
const sandbox = await compute('e2b')

// Execute a simple command
const result = await sandbox.exec('python -c "print(\"Hello, World!\")"')
console.log(result.stdout) // "Hello, World!"

// Run a script file
const output = await sandbox.run('main.py')
```

## Basic Code Execution

### exec() Method

Execute shell commands directly:

```typescript
// Simple command execution
const result = await sandbox.exec('ls -la')
console.log(result.stdout)

// Command with arguments
const result = await sandbox.exec('python', ['-c', 'print("Hello")'])

// With options
const result = await sandbox.exec('npm install', {
  cwd: '/app',
  timeout: 30000,
  env: { NODE_ENV: 'development' }
})
```

### run() Method

Execute script files:

```typescript
// Run a Python script
const result = await sandbox.run('script.py')

// Run with arguments
const result = await sandbox.run('script.py', ['arg1', 'arg2'])

// Run with custom interpreter
const result = await sandbox.run('script.js', [], {
  interpreter: 'node',
  cwd: '/app/src'
})
```

## Execution Result Interface

```typescript
interface ExecutionResult {
  // Standard output
  stdout: string
  
  // Standard error
  stderr: string
  
  // Exit code (0 = success)
  exitCode: number
  
  // Execution time in milliseconds
  executionTime: number
  
  // Process ID
  pid?: number
  
  // Resource usage
  usage?: {
    cpuTime: number
    memoryMB: number
    diskIO: number
  }
}
```

## Language-Specific Execution

### Python

```typescript
// Execute Python code directly
const result = await sandbox.python(`
import math
result = math.sqrt(16)
print(f"Square root of 16 is {result}")
`)

// With virtual environment
const result = await sandbox.python('import pandas as pd', {
  venv: '/opt/venv',
  requirements: ['pandas', 'numpy']
})

// Jupyter notebook style execution
const result = await sandbox.python(`
import matplotlib.pyplot as plt
plt.plot([1, 2, 3, 4])
plt.savefig('plot.png')
`, {
  returnFiles: ['plot.png']
})
```

### Node.js

```typescript
// Execute JavaScript/Node.js code
const result = await sandbox.node(`
const fs = require('fs')
const data = { message: 'Hello from Node.js' }
fs.writeFileSync('output.json', JSON.stringify(data))
console.log('File written successfully')
`)

// With npm packages
const result = await sandbox.node(`
const axios = require('axios')
const response = await axios.get('https://api.github.com/users/octocat')
console.log(response.data.name)
`, {
  packages: ['axios']
})

// TypeScript execution
const result = await sandbox.typescript(`
interface User {
  name: string
  age: number
}

const user: User = { name: 'John', age: 30 }
console.log(user)
`)
```

### Shell Scripts

```typescript
// Bash script execution
const result = await sandbox.bash(`
#!/bin/bash
echo "Starting deployment..."
git pull origin main
npm install
npm run build
echo "Deployment complete"
`)

// With environment variables
const result = await sandbox.bash(`
export API_URL=$1
export API_KEY=$2
curl -H "Authorization: Bearer $API_KEY" $API_URL/health
`, ['https://api.example.com', 'secret-key'])
```

### Other Languages

```typescript
// Go
const result = await sandbox.go(`
package main
import "fmt"
func main() {
    fmt.Println("Hello from Go!")
}
`)

// Rust
const result = await sandbox.rust(`
fn main() {
    println!("Hello from Rust!");
}
`)

// Java
const result = await sandbox.java(`
public class HelloWorld {
    public static void main(String[] args) {
        System.out.println("Hello from Java!");
    }
}
`)
```

## Async and Streaming Execution

### Stream Output

Stream output in real-time:

```typescript
// Stream stdout/stderr
const stream = sandbox.execStream('python long_running_script.py')

stream.stdout.on('data', (chunk) => {
  console.log('STDOUT:', chunk.toString())
})

stream.stderr.on('data', (chunk) => {
  console.error('STDERR:', chunk.toString())
})

stream.on('exit', (code) => {
  console.log('Process exited with code:', code)
})

// Send input to the process
stream.stdin.write('user input\n')
```

### Interactive Execution

Handle interactive programs:

```typescript
// Interactive Python session
const session = await sandbox.startInteractiveSession('python')

// Send commands and receive responses
await session.send('x = 10')
await session.send('y = 20')
const result = await session.send('print(x + y)')
console.log(result.output) // "30"

// End the session
await session.close()
```

### Background Processes

Run long-running processes in the background:

```typescript
// Start a background process
const process = await sandbox.startBackground('python -m http.server 8000')

// Check if process is running
const isRunning = await process.isAlive()

// Get process info
const info = await process.getInfo()
console.log('PID:', info.pid)
console.log('CPU usage:', info.cpuPercent)

// Stop the process
await process.kill()
```

## Execution Options

### Timeout and Cancellation

```typescript
// Set timeout
const result = await sandbox.exec('sleep 10', {
  timeout: 5000 // 5 seconds
})

// Manual cancellation
const controller = new AbortController()
const execution = sandbox.exec('long_command', {
  signal: controller.signal
})

// Cancel after 3 seconds
setTimeout(() => controller.abort(), 3000)

try {
  const result = await execution
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('Execution was cancelled')
  }
}
```

### Environment Variables

```typescript
// Set environment variables for execution
const result = await sandbox.exec('printenv', {
  env: {
    NODE_ENV: 'production',
    API_KEY: 'secret',
    DEBUG: 'true'
  }
})

// Inherit from sandbox environment
const result = await sandbox.exec('node app.js', {
  env: {
    ...await sandbox.getEnv(),
    ADDITIONAL_VAR: 'value'
  }
})
```

### Working Directory

```typescript
// Execute in specific directory
const result = await sandbox.exec('ls', {
  cwd: '/app/src'
})

// Change directory and execute
await sandbox.cd('/app')
const result = await sandbox.exec('npm start')
```

### Input/Output Handling

```typescript
// Provide input to command
const result = await sandbox.exec('python -c "print(input())"', {
  input: 'Hello from input!'
})

// Capture binary output
const result = await sandbox.exec('cat image.png', {
  encoding: 'binary'
})

// Limit output size
const result = await sandbox.exec('cat large_file.txt', {
  maxOutputSize: 1024 * 1024 // 1MB limit
})
```

## Process Management

### List Running Processes

```typescript
// Get all running processes
const processes = await sandbox.ps()

processes.forEach(proc => {
  console.log(`PID: ${proc.pid}, Command: ${proc.command}`)
})

// Filter processes
const pythonProcs = await sandbox.ps({ 
  filter: (proc) => proc.command.includes('python') 
})
```

### Kill Processes

```typescript
// Kill specific process
await sandbox.kill(1234) // Kill by PID

// Kill by pattern
await sandbox.killall('python')

// Graceful shutdown with timeout
await sandbox.kill(1234, { signal: 'SIGTERM', timeout: 5000 })
```

### Process Monitoring

```typescript
// Monitor process resource usage
const monitor = await sandbox.monitor(1234)

monitor.on('stats', (stats) => {
  console.log('CPU:', stats.cpuPercent)
  console.log('Memory:', stats.memoryMB)
})

// Stop monitoring
await monitor.stop()
```

## Error Handling

### Execution Errors

```typescript
try {
  const result = await sandbox.exec('invalid_command')
} catch (error) {
  if (error instanceof ExecutionError) {
    console.log('Command failed with exit code:', error.exitCode)
    console.log('Error output:', error.stderr)
    console.log('Standard output:', error.stdout)
  }
}

// Handle timeout errors
try {
  const result = await sandbox.exec('sleep 60', { timeout: 5000 })
} catch (error) {
  if (error instanceof TimeoutError) {
    console.log('Command timed out after 5 seconds')
  }
}
```

### Graceful Error Recovery

```typescript
// Retry failed executions
async function executeWithRetry(command: string, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await sandbox.exec(command)
    } catch (error) {
      if (i === maxRetries - 1) throw error
      console.log(`Attempt ${i + 1} failed, retrying...`)
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
}

// Fallback commands
async function executeWithFallback(commands: string[]) {
  for (const command of commands) {
    try {
      return await sandbox.exec(command)
    } catch (error) {
      console.log(`Command "${command}" failed, trying next...`)
    }
  }
  throw new Error('All commands failed')
}
```

## Performance Optimization

### Batch Execution

```typescript
// Execute multiple commands in parallel
const results = await Promise.all([
  sandbox.exec('ls /app'),
  sandbox.exec('ps aux'),
  sandbox.exec('df -h')
])

// Sequential execution with shared context
const session = await sandbox.startSession()
await session.exec('cd /app')
await session.exec('export NODE_ENV=production')
const result = await session.exec('npm start')
await session.close()
```

### Caching

```typescript
// Cache execution results
const cache = new Map()

async function cachedExec(command: string) {
  if (cache.has(command)) {
    return cache.get(command)
  }
  
  const result = await sandbox.exec(command)
  cache.set(command, result)
  return result
}
```

### Resource Management

```typescript
// Limit concurrent executions
const semaphore = new Semaphore(3) // Max 3 concurrent executions

async function executeWithLimit(command: string) {
  await semaphore.acquire()
  try {
    return await sandbox.exec(command)
  } finally {
    semaphore.release()
  }
}
```

## Advanced Features

### Code Analysis

```typescript
// Analyze code before execution
const analysis = await sandbox.analyzeCode(`
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

print(fibonacci(10))
`, {
  language: 'python',
  checks: ['syntax', 'security', 'performance']
})

if (analysis.safe) {
  const result = await sandbox.python(analysis.code)
}
```

### Debugging

```typescript
// Execute with debugging enabled
const result = await sandbox.exec('python script.py', {
  debug: true,
  breakpoints: ['script.py:10', 'script.py:25']
})

// Step through execution
const debugger = await sandbox.startDebugger('python script.py')
await debugger.setBreakpoint('script.py', 10)
await debugger.continue()
const variables = await debugger.getVariables()
```

### Profiling

```typescript
// Profile code execution
const profile = await sandbox.profile('python -c "sum(range(1000000))"')

console.log('Function calls:', profile.functionCalls)
console.log('Memory usage:', profile.memoryUsage)
console.log('CPU time:', profile.cpuTime)
```

## Integration Examples

### Web Framework Integration

```typescript
// Express.js endpoint
app.post('/execute', async (req, res) => {
  try {
    const { code, language } = req.body
    
    const sandbox = await compute('e2b')
    const result = await sandbox[language](code, {
      timeout: 30000,
      maxOutputSize: 1024 * 1024
    })
    
    res.json({
      success: true,
      output: result.stdout,
      executionTime: result.executionTime
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})
```

### Real-time Code Execution

```typescript
// WebSocket-based code execution
io.on('connection', (socket) => {
  let sandbox: Sandbox
  
  socket.on('start-session', async () => {
    sandbox = await compute('e2b')
    socket.emit('session-ready')
  })
  
  socket.on('execute', async (data) => {
    try {
      const stream = sandbox.execStream(data.code)
      
      stream.stdout.on('data', (chunk) => {
        socket.emit('output', { type: 'stdout', data: chunk.toString() })
      })
      
      stream.stderr.on('data', (chunk) => {
        socket.emit('output', { type: 'stderr', data: chunk.toString() })
      })
      
      stream.on('exit', (code) => {
        socket.emit('execution-complete', { exitCode: code })
      })
    } catch (error) {
      socket.emit('execution-error', { error: error.message })
    }
  })
})
```

## Best Practices

1. **Always set timeouts** to prevent hanging executions
2. **Validate input** before executing user-provided code
3. **Use streaming** for long-running processes
4. **Handle errors gracefully** with proper error types
5. **Monitor resource usage** to prevent overconsumption
6. **Clean up processes** when done to free resources
7. **Use sessions** for related commands to maintain context
8. **Cache results** when appropriate to improve performance

## Security Considerations

1. **Sandbox isolation**: Always run untrusted code in isolated environments
2. **Input validation**: Sanitize and validate all user inputs
3. **Resource limits**: Set appropriate CPU, memory, and time limits
4. **Network restrictions**: Limit network access when not needed
5. **File system access**: Restrict file system operations to safe directories
6. **Environment variables**: Don't expose sensitive environment variables

## Related Documentation

- [Overview](./overview.md) - SDK architecture and concepts
- [Sandbox Management](./sandbox-management.md) - Creating and managing sandboxes
- [Terminal](./terminal.md) - Interactive terminal sessions
- [Filesystem](./filesystem.md) - File operations and management
- [Configuration](./configuration.md) - Execution configuration options