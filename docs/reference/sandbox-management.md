# Sandbox Management

ComputeSDK provides comprehensive sandbox lifecycle management, including creation, configuration, monitoring, and cleanup. Learn how to effectively manage compute resources across different providers.

## Quick Start

```typescript
import { compute } from 'computesdk'

// Create a new sandbox
const sandbox = await compute('e2b', {
  template: 'python',
  metadata: { project: 'my-app' }
})

// Use the sandbox
await sandbox.exec('python --version')

// Clean up when done
await sandbox.destroy()
```

## Sandbox Creation

### Basic Creation

```typescript
// Simple sandbox creation
const sandbox = await compute('e2b')

// With configuration
const sandbox = await compute('e2b', {
  template: 'nodejs18',
  timeoutMs: 60000,
  keepAlive: true
})

// With provider-specific options
const sandbox = await compute('modal', {
  template: 'python:3.11',
  resources: {
    cpuCores: 4,
    memoryMB: 8192,
    gpu: { enabled: true, type: 'nvidia-a100' }
  }
})
```

### Template-Based Creation

```typescript
// Use predefined templates
const webSandbox = await compute('vercel', {
  template: 'nextjs'
})

const mlSandbox = await compute('modal', {
  template: 'pytorch-gpu'
})

const devSandbox = await compute('daytona', {
  template: 'full-stack-dev'
})

// Custom template creation
const customTemplate = {
  name: 'my-python-env',
  baseImage: 'python:3.11-slim',
  packages: ['numpy', 'pandas', 'scikit-learn'],
  env: {
    PYTHONPATH: '/app',
    NODE_ENV: 'development'
  }
}

const sandbox = await compute('e2b', {
  template: customTemplate
})
```

### Batch Creation

```typescript
// Create multiple sandboxes
const sandboxes = await Promise.all([
  compute('e2b', { template: 'python' }),
  compute('vercel', { template: 'nodejs' }),
  compute('modal', { template: 'gpu-ml' })
])

// Create sandbox pool
class SandboxPool {
  private available: Sandbox[] = []
  private inUse: Set<Sandbox> = new Set()

  async acquire(provider: string, config?: any): Promise<Sandbox> {
    let sandbox = this.available.pop()
    
    if (!sandbox) {
      sandbox = await compute(provider, config)
    }
    
    this.inUse.add(sandbox)
    return sandbox
  }

  async release(sandbox: Sandbox) {
    this.inUse.delete(sandbox)
    
    // Reset sandbox state
    await sandbox.reset()
    this.available.push(sandbox)
  }

  async cleanup() {
    const allSandboxes = [...this.available, ...this.inUse]
    await Promise.all(allSandboxes.map(sb => sb.destroy()))
  }
}
```

## Sandbox Lifecycle

### Lifecycle Events

```typescript
// Listen to lifecycle events
sandbox.on('created', () => {
  console.log('Sandbox created successfully')
})

sandbox.on('ready', () => {
  console.log('Sandbox is ready for execution')
})

sandbox.on('error', (error) => {
  console.error('Sandbox error:', error)
})

sandbox.on('destroyed', () => {
  console.log('Sandbox has been destroyed')
})

// Connection events
sandbox.on('connected', () => {
  console.log('Connected to sandbox')
})

sandbox.on('disconnected', () => {
  console.log('Disconnected from sandbox')
})

sandbox.on('reconnecting', () => {
  console.log('Attempting to reconnect...')
})
```

### Status Monitoring

```typescript
// Check sandbox status
const status = await sandbox.getStatus()
console.log('Status:', status.state) // 'creating', 'running', 'stopped', 'error'
console.log('Uptime:', status.uptimeMs)
console.log('Resource usage:', status.resources)

// Continuous monitoring
const monitor = sandbox.monitor({
  interval: 5000, // Check every 5 seconds
  metrics: ['cpu', 'memory', 'disk', 'network']
})

monitor.on('metrics', (metrics) => {
  console.log('CPU usage:', metrics.cpu.percent)
  console.log('Memory usage:', metrics.memory.usedMB)
  console.log('Disk usage:', metrics.disk.usedMB)
})

// Stop monitoring
await monitor.stop()
```

### Health Checks

```typescript
// Built-in health check
const isHealthy = await sandbox.healthCheck()

// Custom health checks
const healthChecks = {
  python: () => sandbox.exec('python --version'),
  node: () => sandbox.exec('node --version'),
  disk: () => sandbox.exec('df -h'),
  network: () => sandbox.exec('ping -c 1 google.com')
}

async function runHealthChecks(sandbox: Sandbox) {
  const results = {}
  
  for (const [name, check] of Object.entries(healthChecks)) {
    try {
      await check()
      results[name] = 'healthy'
    } catch (error) {
      results[name] = 'unhealthy'
    }
  }
  
  return results
}
```

## Resource Management

### Resource Monitoring

```typescript
// Get current resource usage
const usage = await sandbox.getResourceUsage()
console.log('CPU:', usage.cpu.percent)
console.log('Memory:', usage.memory.usedMB, '/', usage.memory.totalMB)
console.log('Disk:', usage.disk.usedMB, '/', usage.disk.totalMB)

// Set resource limits
await sandbox.setResourceLimits({
  cpuPercent: 80,
  memoryMB: 2048,
  diskMB: 5120
})

// Resource alerts
sandbox.on('resourceAlert', (alert) => {
  console.warn(`Resource alert: ${alert.type} usage is ${alert.current}%`)
  
  if (alert.type === 'memory' && alert.current > 90) {
    // Take action to free memory
    sandbox.exec('python -c "import gc; gc.collect()"')
  }
})
```

### Auto-scaling

```typescript
// Configure auto-scaling
await sandbox.configureAutoScaling({
  enabled: true,
  metrics: {
    cpu: { threshold: 80, action: 'scale-up' },
    memory: { threshold: 85, action: 'scale-up' }
  },
  limits: {
    maxCpuCores: 8,
    maxMemoryMB: 16384
  }
})

// Manual scaling
await sandbox.scale({
  cpuCores: 4,
  memoryMB: 8192
})
```

## Persistence and State

### Persistent Storage

```typescript
// Create sandbox with persistent volumes
const sandbox = await compute('e2b', {
  volumes: [
    {
      name: 'workspace',
      path: '/workspace',
      size: '10GB',
      persistent: true
    },
    {
      name: 'cache',
      path: '/cache',
      size: '5GB',
      persistent: false
    }
  ]
})

// Mount existing volume
const sandbox2 = await compute('e2b', {
  volumes: [
    {
      name: 'workspace', // Same volume as above
      path: '/workspace',
      mountExisting: true
    }
  ]
})
```

### State Snapshots

```typescript
// Create a snapshot of current state
const snapshotId = await sandbox.createSnapshot({
  name: 'before-deployment',
  description: 'State before deploying new version'
})

// List snapshots
const snapshots = await sandbox.listSnapshots()

// Restore from snapshot
await sandbox.restoreSnapshot(snapshotId)

// Delete snapshot
await sandbox.deleteSnapshot(snapshotId)
```

### State Persistence

```typescript
// Save sandbox state
const state = await sandbox.saveState()

// Create new sandbox from saved state
const newSandbox = await compute('e2b', {
  restoreFrom: state
})

// Export/import state
const stateData = await sandbox.exportState()
const importedSandbox = await compute('e2b', {
  importState: stateData
})
```

## Sandbox Operations

### Reset and Restart

```typescript
// Soft reset (clear processes, keep files)
await sandbox.reset()

// Hard reset (restore to initial state)
await sandbox.reset({ hard: true })

// Restart sandbox
await sandbox.restart()

// Restart with new configuration
await sandbox.restart({
  template: 'python:3.11',
  env: { DEBUG: 'true' }
})
```

### Cloning

```typescript
// Clone existing sandbox
const clonedSandbox = await sandbox.clone()

// Clone with modifications
const clonedSandbox = await sandbox.clone({
  template: 'different-template',
  env: { NODE_ENV: 'production' }
})

// Clone to different provider
const clonedSandbox = await sandbox.clone({
  provider: 'vercel',
  template: 'nodejs18.x'
})
```

### Migration

```typescript
// Migrate to different provider
const migratedSandbox = await sandbox.migrate('modal', {
  template: 'python-gpu',
  preserveFiles: true,
  preserveEnv: true
})

// Migration with custom mapping
const migratedSandbox = await sandbox.migrate('vercel', {
  templateMapping: {
    'python:3.11': 'python3.11.x'
  },
  envMapping: {
    'DEBUG': 'VERCEL_DEBUG'
  }
})
```

## Multi-Sandbox Coordination

### Sandbox Groups

```typescript
// Create a group of related sandboxes
class SandboxGroup {
  private sandboxes: Map<string, Sandbox> = new Map()

  async add(name: string, provider: string, config?: any) {
    const sandbox = await compute(provider, config)
    this.sandboxes.set(name, sandbox)
    return sandbox
  }

  async broadcast(command: string) {
    const results = new Map()
    
    for (const [name, sandbox] of this.sandboxes) {
      try {
        const result = await sandbox.exec(command)
        results.set(name, result)
      } catch (error) {
        results.set(name, { error: error.message })
      }
    }
    
    return results
  }

  async destroyAll() {
    await Promise.all(
      Array.from(this.sandboxes.values()).map(sb => sb.destroy())
    )
  }
}

// Usage
const group = new SandboxGroup()
await group.add('web', 'vercel', { template: 'nextjs' })
await group.add('api', 'e2b', { template: 'nodejs' })
await group.add('ml', 'modal', { template: 'pytorch' })

// Execute command on all sandboxes
const results = await group.broadcast('npm --version')
```

### Inter-Sandbox Communication

```typescript
// Set up communication between sandboxes
const webSandbox = await compute('vercel')
const apiSandbox = await compute('e2b')

// Create shared network
const network = await createSharedNetwork([webSandbox, apiSandbox])

// Configure service discovery
await webSandbox.setEnv('API_URL', network.getServiceUrl('api'))
await apiSandbox.setEnv('SERVICE_NAME', 'api')

// Set up message passing
const messageQueue = new MessageQueue()
await messageQueue.connect([webSandbox, apiSandbox])

// Send message from web to api
await messageQueue.send('web', 'api', { action: 'process-data' })
```

## Error Handling and Recovery

### Error Recovery

```typescript
// Automatic error recovery
sandbox.on('error', async (error) => {
  console.error('Sandbox error:', error)
  
  if (error.type === 'connection-lost') {
    // Attempt reconnection
    await sandbox.reconnect()
  } else if (error.type === 'out-of-memory') {
    // Restart with more memory
    await sandbox.restart({
      resources: { memoryMB: sandbox.config.resources.memoryMB * 2 }
    })
  } else if (error.type === 'corruption') {
    // Restore from last snapshot
    const snapshots = await sandbox.listSnapshots()
    if (snapshots.length > 0) {
      await sandbox.restoreSnapshot(snapshots[0].id)
    }
  }
})

// Circuit breaker pattern
class SandboxCircuitBreaker {
  private failures = 0
  private lastFailure = 0
  private state = 'closed' // closed, open, half-open

  async execute(operation: () => Promise<any>) {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure < 60000) {
        throw new Error('Circuit breaker is open')
      }
      this.state = 'half-open'
    }

    try {
      const result = await operation()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  private onSuccess() {
    this.failures = 0
    this.state = 'closed'
  }

  private onFailure() {
    this.failures++
    this.lastFailure = Date.now()
    
    if (this.failures >= 5) {
      this.state = 'open'
    }
  }
}
```

### Graceful Shutdown

```typescript
// Graceful shutdown handler
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...')
  
  // Stop accepting new requests
  // Finish current operations
  
  // Clean up sandboxes
  const activeSandboxes = await listActiveSandboxes()
  await Promise.all(
    activeSandboxes.map(async (sandbox) => {
      try {
        // Save important state
        await sandbox.createSnapshot({ name: 'shutdown-backup' })
        
        // Clean shutdown
        await sandbox.destroy({ graceful: true, timeoutMs: 30000 })
      } catch (error) {
        console.error('Error during sandbox cleanup:', error)
      }
    })
  )
  
  process.exit(0)
})
```

## Performance Optimization

### Connection Pooling

```typescript
// Implement connection pooling
class SandboxPool {
  private pools = new Map<string, Sandbox[]>()
  private maxSize = 10
  private minSize = 2

  async acquire(provider: string, config?: any): Promise<Sandbox> {
    const key = this.getPoolKey(provider, config)
    const pool = this.pools.get(key) || []
    
    if (pool.length > 0) {
      return pool.pop()!
    }
    
    return await compute(provider, config)
  }

  async release(sandbox: Sandbox, provider: string, config?: any) {
    const key = this.getPoolKey(provider, config)
    const pool = this.pools.get(key) || []
    
    if (pool.length < this.maxSize) {
      // Reset sandbox state before returning to pool
      await sandbox.reset()
      pool.push(sandbox)
      this.pools.set(key, pool)
    } else {
      await sandbox.destroy()
    }
  }

  private getPoolKey(provider: string, config?: any): string {
    return `${provider}-${JSON.stringify(config || {})}`
  }
}
```

### Caching and Reuse

```typescript
// Cache sandbox configurations
const configCache = new Map()

async function createOptimizedSandbox(provider: string, config: any) {
  const cacheKey = `${provider}-${JSON.stringify(config)}`
  
  if (configCache.has(cacheKey)) {
    const cached = configCache.get(cacheKey)
    // Clone from cached sandbox
    return await cached.clone()
  }
  
  const sandbox = await compute(provider, config)
  configCache.set(cacheKey, sandbox)
  return sandbox
}
```

## Best Practices

1. **Resource Cleanup**: Always call `destroy()` when done with a sandbox
2. **Error Handling**: Implement proper error handling and recovery
3. **Resource Monitoring**: Monitor resource usage to prevent overconsumption
4. **State Management**: Use snapshots for important state preservation
5. **Connection Pooling**: Reuse sandboxes when possible to improve performance
6. **Graceful Shutdown**: Implement proper cleanup during application shutdown
7. **Security**: Isolate untrusted code in separate sandboxes
8. **Monitoring**: Set up proper logging and monitoring for production use

## Related Documentation

- [Overview](./overview.md) - SDK architecture and concepts
- [Configuration](./configuration.md) - Sandbox configuration options
- [Code Execution](./code-execution.md) - Running code in sandboxes
- [Filesystem](./filesystem.md) - File operations and management
- [Providers](../providers/) - Provider-specific management features