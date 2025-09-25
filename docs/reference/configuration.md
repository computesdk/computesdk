# Configuration

ComputeSDK provides flexible configuration options for customizing sandbox behavior, performance settings, and provider-specific options. Configuration can be set globally, per-instance, or dynamically at runtime.

## Quick Start

```typescript
import { compute } from 'computesdk'

// Basic configuration
const sandbox = await compute('e2b', {
  template: 'python',
  timeoutMs: 30000,
  metadata: { project: 'my-app' }
})
```

## Configuration Hierarchy

Configuration is applied in the following order (later takes precedence):

1. **Provider defaults** - Built-in provider settings
2. **Global configuration** - Set via `setGlobalConfig()`
3. **Instance configuration** - Passed to `compute()` function
4. **Runtime configuration** - Dynamic updates during execution

## Global Configuration

### Setting Global Config

```typescript
import { setGlobalConfig } from 'computesdk'

setGlobalConfig({
  // Default provider when none specified
  defaultProvider: 'e2b',
  
  // Global timeout for all operations
  timeoutMs: 60000,
  
  // Retry configuration
  retries: {
    maxAttempts: 3,
    delayMs: 1000,
    backoff: 'exponential'
  },
  
  // Logging configuration
  logging: {
    level: 'info',
    includeTimestamps: true,
    includeProviderLogs: false
  },
  
  // Resource limits
  resources: {
    maxConcurrentSandboxes: 5,
    maxMemoryMB: 2048,
    maxCpuCores: 2
  }
})
```

### Getting Global Config

```typescript
import { getGlobalConfig } from 'computesdk'

const config = getGlobalConfig()
console.log('Current config:', config)
```

## Instance Configuration

### Basic Options

```typescript
interface ComputeConfig {
  // Provider-specific template or image
  template?: string
  
  // Custom metadata for the sandbox
  metadata?: Record<string, any>
  
  // Timeout for operations (ms)
  timeoutMs?: number
  
  // Keep sandbox alive after script completion
  keepAlive?: boolean
  
  // Environment variables
  env?: Record<string, string>
  
  // Working directory
  workingDirectory?: string
  
  // Resource limits
  resources?: ResourceConfig
  
  // Networking configuration
  network?: NetworkConfig
  
  // File system configuration
  filesystem?: FilesystemConfig
}
```

### Resource Configuration

```typescript
interface ResourceConfig {
  // Memory limit in MB
  memoryMB?: number
  
  // CPU cores (may be fractional)
  cpuCores?: number
  
  // Disk space in MB
  diskMB?: number
  
  // GPU configuration
  gpu?: {
    enabled: boolean
    type?: 'nvidia-t4' | 'nvidia-a100' | 'amd-mi50'
    memory?: number
  }
}

const sandbox = await compute('modal', {
  resources: {
    memoryMB: 4096,
    cpuCores: 4,
    gpu: {
      enabled: true,
      type: 'nvidia-a100',
      memory: 16384
    }
  }
})
```

### Network Configuration

```typescript
interface NetworkConfig {
  // Enable internet access
  internetAccess?: boolean
  
  // Custom DNS servers
  dns?: string[]
  
  // Port forwarding
  ports?: {
    internal: number
    external?: number
    protocol?: 'tcp' | 'udp'
  }[]
  
  // Proxy configuration
  proxy?: {
    http?: string
    https?: string
    noProxy?: string[]
  }
}

const sandbox = await compute('e2b', {
  network: {
    internetAccess: true,
    ports: [
      { internal: 3000, external: 8080 },
      { internal: 5432, protocol: 'tcp' }
    ],
    dns: ['8.8.8.8', '1.1.1.1']
  }
})
```

### Filesystem Configuration

```typescript
interface FilesystemConfig {
  // Mount points
  mounts?: {
    source: string
    target: string
    readOnly?: boolean
  }[]
  
  // Initial files to copy
  files?: {
    path: string
    content: string | Buffer
    mode?: number
  }[]
  
  // Workspace initialization
  workspace?: {
    // Git repository to clone
    git?: {
      url: string
      branch?: string
      token?: string
    }
    
    // Template to use
    template?: string
    
    // Files to ignore
    ignore?: string[]
  }
}

const sandbox = await compute('daytona', {
  filesystem: {
    workspace: {
      git: {
        url: 'https://github.com/user/repo.git',
        branch: 'main'
      }
    },
    files: [
      {
        path: '.env',
        content: 'NODE_ENV=development\nAPI_KEY=secret',
        mode: 0o600
      }
    ]
  }
})
```

## Provider-Specific Configuration

### E2B Configuration

```typescript
const sandbox = await compute('e2b', {
  // E2B template ID
  template: 'python-3.11',
  
  // E2B-specific options
  e2b: {
    // Sandbox lifetime in minutes
    lifetimeMinutes: 60,
    
    // Team ID for organization sandboxes
    teamId: 'team-123',
    
    // Custom domain
    domain: 'custom.e2b.dev'
  }
})
```

### Vercel Configuration

```typescript
const sandbox = await compute('vercel', {
  // Vercel runtime
  template: 'nodejs18.x',
  
  // Vercel-specific options
  vercel: {
    // Region for execution
    region: 'iad1',
    
    // Project ID
    projectId: 'prj_123',
    
    // Team ID
    teamId: 'team_456'
  }
})
```

### Modal Configuration

```typescript
const sandbox = await compute('modal', {
  // Modal image
  template: 'modal-labs/transformers:latest',
  
  // Modal-specific options
  modal: {
    // Workspace name
    workspace: 'my-workspace',
    
    // Secrets to mount
    secrets: ['huggingface-token', 'aws-credentials'],
    
    // Shared volumes
    volumes: ['/data', '/models']
  }
})
```

### CodeSandbox Configuration

```typescript
const sandbox = await compute('codesandbox', {
  // CodeSandbox template
  template: 'node',
  
  // CodeSandbox-specific options
  codesandbox: {
    // Team ID
    teamId: 'team-789',
    
    // Privacy setting
    privacy: 'public' | 'private' | 'unlisted',
    
    // Editor preferences
    editor: {
      theme: 'dark',
      fontSize: 14,
      tabSize: 2
    }
  }
})
```

## Dynamic Configuration

### Runtime Updates

```typescript
const sandbox = await compute('e2b', { template: 'python' })

// Update configuration at runtime
await sandbox.updateConfig({
  timeoutMs: 90000,
  env: {
    ...sandbox.config.env,
    NEW_VAR: 'value'
  }
})
```

### Environment Variables

```typescript
// Set environment variables
await sandbox.setEnv({
  'NODE_ENV': 'production',
  'API_URL': 'https://api.example.com'
})

// Get environment variable
const nodeEnv = await sandbox.getEnv('NODE_ENV')

// Remove environment variable
await sandbox.unsetEnv('DEBUG')
```

### Working Directory

```typescript
// Change working directory
await sandbox.cd('/app/src')

// Get current working directory
const cwd = await sandbox.pwd()
console.log('Current directory:', cwd)
```

## Configuration Validation

### Schema Validation

ComputeSDK validates configuration using JSON Schema:

```typescript
import { validateConfig } from 'computesdk'

const config = {
  template: 'python',
  timeoutMs: 30000,
  resources: {
    memoryMB: 1024
  }
}

try {
  validateConfig(config)
  console.log('Configuration is valid')
} catch (error) {
  console.error('Invalid configuration:', error.message)
}
```

### Custom Validation

```typescript
import { addConfigValidator } from 'computesdk'

// Add custom validation rule
addConfigValidator('memoryLimit', (config) => {
  if (config.resources?.memoryMB > 8192) {
    throw new Error('Memory limit cannot exceed 8GB')
  }
})
```

## Configuration Templates

### Predefined Templates

```typescript
import { configTemplates } from 'computesdk'

// Development template
const devConfig = configTemplates.development({
  provider: 'e2b',
  template: 'nodejs18'
})

// Production template
const prodConfig = configTemplates.production({
  provider: 'vercel',
  region: 'iad1'
})

// ML/AI template
const mlConfig = configTemplates.ml({
  provider: 'modal',
  gpu: 'nvidia-a100'
})
```

### Custom Templates

```typescript
import { createConfigTemplate } from 'computesdk'

const myTemplate = createConfigTemplate('web-dev', {
  template: 'nodejs18',
  timeoutMs: 60000,
  resources: {
    memoryMB: 2048,
    cpuCores: 2
  },
  network: {
    internetAccess: true,
    ports: [{ internal: 3000 }]
  },
  env: {
    NODE_ENV: 'development'
  }
})

// Use the template
const sandbox = await compute('e2b', myTemplate)
```

## Environment-Based Configuration

### Configuration Files

```javascript
// compute.config.js
export default {
  development: {
    provider: 'e2b',
    template: 'nodejs18',
    timeoutMs: 30000,
    logging: { level: 'debug' }
  },
  
  staging: {
    provider: 'vercel',
    template: 'nodejs18.x',
    timeoutMs: 60000,
    logging: { level: 'info' }
  },
  
  production: {
    provider: 'vercel',
    template: 'nodejs18.x',
    timeoutMs: 120000,
    logging: { level: 'error' },
    retries: { maxAttempts: 5 }
  }
}
```

```typescript
import { loadConfig } from 'computesdk'

// Load environment-specific configuration
const config = await loadConfig('./compute.config.js', process.env.NODE_ENV)
const sandbox = await compute(config.provider, config)
```

### Environment Variables

```bash
# .env
COMPUTE_PROVIDER=e2b
COMPUTE_TEMPLATE=python
COMPUTE_TIMEOUT_MS=60000
COMPUTE_LOG_LEVEL=info
E2B_API_KEY=your-api-key
```

```typescript
import { loadConfigFromEnv } from 'computesdk'

// Load configuration from environment variables
const config = loadConfigFromEnv({
  prefix: 'COMPUTE_',
  provider: process.env.COMPUTE_PROVIDER,
  apiKey: process.env[`${process.env.COMPUTE_PROVIDER?.toUpperCase()}_API_KEY`]
})
```

## Performance Optimization

### Connection Pooling

```typescript
setGlobalConfig({
  connectionPool: {
    // Maximum concurrent connections per provider
    maxConnections: 10,
    
    // Keep connections alive
    keepAlive: true,
    
    // Connection timeout
    connectTimeoutMs: 10000,
    
    // Idle timeout
    idleTimeoutMs: 300000
  }
})
```

### Caching

```typescript
setGlobalConfig({
  cache: {
    // Cache sandbox instances
    enabled: true,
    
    // Cache TTL in milliseconds
    ttlMs: 300000,
    
    // Maximum cache size
    maxSize: 100,
    
    // Cache key strategy
    keyStrategy: 'provider-template-config'
  }
})
```

## Error Handling Configuration

```typescript
setGlobalConfig({
  errorHandling: {
    // Retry configuration
    retries: {
      maxAttempts: 3,
      delayMs: 1000,
      backoff: 'exponential',
      retryableErrors: ['TIMEOUT', 'NETWORK_ERROR']
    },
    
    // Error reporting
    reporting: {
      enabled: true,
      endpoint: 'https://errors.example.com',
      includeStack: true
    }
  }
})
```

## Configuration Best Practices

1. **Use Environment Variables**: Store sensitive data like API keys in environment variables
2. **Validate Configuration**: Always validate configuration before use
3. **Use Templates**: Create reusable configuration templates for common scenarios
4. **Monitor Resources**: Set appropriate resource limits to avoid unexpected costs
5. **Environment Separation**: Use different configurations for development, staging, and production
6. **Documentation**: Document custom configuration options for your team

## Troubleshooting

### Common Configuration Issues

```typescript
// Issue: Invalid template name
const sandbox = await compute('e2b', { template: 'invalid-template' })
// Solution: Check available templates
const templates = await getAvailableTemplates('e2b')

// Issue: Insufficient resources
const sandbox = await compute('modal', { 
  resources: { memoryMB: 32000 } // Too much memory
})
// Solution: Check provider limits
const limits = await getProviderLimits('modal')

// Issue: Configuration not taking effect
setGlobalConfig({ timeoutMs: 60000 })
const sandbox = await compute('e2b', { timeoutMs: 30000 }) // Instance config overrides global
```

### Debugging Configuration

```typescript
import { debugConfig } from 'computesdk'

// Enable configuration debugging
debugConfig(true)

// This will log detailed configuration information
const sandbox = await compute('e2b', config)
```

## Related Documentation

- [Overview](./overview.md) - SDK architecture and concepts
- [Sandbox Management](./sandbox-management.md) - Creating and managing sandboxes
- [Providers](../providers/) - Provider-specific configuration options
- [Getting Started](../getting-started/installation.md) - Initial setup and configuration