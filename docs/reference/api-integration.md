# API Integration

ComputeSDK provides seamless integration with web frameworks and APIs, enabling you to embed compute capabilities directly into your applications. Build powerful backend services, API endpoints, and serverless functions with compute sandboxes.

## Quick Start

```typescript
import { createCompute } from 'computesdk'
import express from 'express'

const app = express()

app.post('/execute', async (req, res) => {
  const compute = createCompute()
  const sandbox = await compute('e2b')
  
  try {
    const result = await sandbox.exec(req.body.command)
    res.json({ output: result.stdout, success: true })
  } catch (error) {
    res.status(500).json({ error: error.message, success: false })
  } finally {
    await sandbox.destroy()
  }
})
```

## Express.js Integration

### Basic API Endpoints

```typescript
import express from 'express' 
import { createCompute } from 'computesdk'

const app = express()
app.use(express.json())

// Code execution endpoint
app.post('/api/execute', async (req, res) => {
  const compute = createCompute()
  const { code, language, provider = 'e2b' } = req.body
  
  try {
    const sandbox = await compute(provider, {
      template: language,
      timeout: 30000
    })
    
    const result = await sandbox[language](code)
    
    res.json({
      success: true,
      output: result.stdout,
      stderr: result.stderr,
      executionTime: result.executionTime
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// File operations endpoint
app.post('/api/files', async (req, res) => {
  const compute = createCompute()
  const { action, path, content } = req.body
  const sandbox = await compute('e2b')
  
  try {
    switch (action) {
      case 'read':
        const fileContent = await sandbox.readFile(path)
        res.json({ content: fileContent })
        break
        
      case 'write':
        await sandbox.writeFile(path, content)
        res.json({ success: true })
        break
        
      case 'list':
        const files = await sandbox.listFiles(path)
        res.json({ files })
        break
        
      default:
        res.status(400).json({ error: 'Invalid action' })
    }
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})
```

### Middleware Integration

```typescript
// Sandbox middleware
function sandboxMiddleware(provider: string = 'e2b') {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      req.sandbox = await compute(provider, {
        keepAlive: true,
        timeout: 60000
      })
      
      // Cleanup on response finish
      res.on('finish', async () => {
        if (req.sandbox) {
          await req.sandbox.destroy()
        }
      })
      
      next()
    } catch (error) {
      res.status(500).json({ error: 'Failed to create sandbox' })
    }
  }
}

// Usage
app.use('/api/compute', sandboxMiddleware('e2b'))

app.post('/api/compute/python', async (req, res) => {
  const result = await req.sandbox.python(req.body.code)
  res.json(result)
})
```

### Error Handling Middleware

```typescript
// Global error handler for compute operations
function computeErrorHandler(error: any, req: Request, res: Response, next: NextFunction) {
  console.error('Compute error:', error)
  
  if (error.name === 'TimeoutError') {
    res.status(408).json({
      error: 'Operation timed out',
      code: 'TIMEOUT'
    })
  } else if (error.name === 'ExecutionError') {
    res.status(400).json({
      error: 'Code execution failed',
      details: error.stderr,
      code: 'EXECUTION_ERROR'
    })
  } else if (error.name === 'ResourceError') {
    res.status(507).json({
      error: 'Insufficient resources',
      code: 'RESOURCE_ERROR'
    })
  } else {
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    })
  }
}

app.use(computeErrorHandler)
```

## Next.js Integration

### API Routes

```typescript
// pages/api/execute.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { createCompute } from 'computesdk'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  
  const { code, language } = req.body
  
  try {
    const compute = createCompute()
    const sandbox = await compute('vercel', {
      template: language,
      region: 'iad1'
    })
    
    const result = await sandbox.exec(`${language} -c "${code}"`)
    
    res.status(200).json({
      output: result.stdout,
      error: result.stderr,
      success: result.exitCode === 0
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
```

### App Router (Next.js 13+)

```typescript
// app/api/execute/route.ts
import { createCompute } from 'computesdk'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { code, language } = await request.json()
    const compute = createCompute()
    const sandbox = await compute('vercel', {
      template: language
    })
    
    const result = await sandbox[language](code)
    
    return NextResponse.json({
      output: result.stdout,
      executionTime: result.executionTime
    })
  } catch (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }
}
```

### Server Actions

```typescript
// app/actions.ts
'use server'

import { createCompute } from 'computesdk'

export async function executeCode(formData: FormData) {
  const code = formData.get('code') as string
  const language = formData.get('language') as string
  
  try {
    const compute = createCompute()
    const sandbox = await compute('vercel')
    const result = await sandbox[language](code)
    
    return {
      success: true,
      output: result.stdout,
      error: result.stderr
    }
  } catch (error) {
    return {
      success: false,
      error: error.message
    }
  }
}
```

## Fastify Integration

```typescript
import Fastify from 'fastify'
import { createCompute } from 'computesdk'

const fastify = Fastify({ logger: true })

// Plugin for compute functionality
async function computePlugin(fastify: any) {
  fastify.decorate('compute', compute)
  
  fastify.addHook('onRequest', async (request: any) => {
    request.startTime = Date.now()
  })
  
  fastify.addHook('onResponse', async (request: any, reply: any) => {
    const duration = Date.now() - request.startTime
    fastify.log.info(`Request completed in ${duration}ms`)
  })
}

fastify.register(computePlugin)

// Execute code endpoint
fastify.post('/execute', {
  schema: {
    body: {
      type: 'object',
      required: ['code', 'language'],
      properties: {
        code: { type: 'string' },
        language: { type: 'string' },
        provider: { type: 'string' }
      }
    }
  }
}, async (request, reply) => {
  const { code, language, provider = 'e2b' } = request.body
  
  const sandbox = await fastify.compute(provider, {
    template: language
  })
  
  try {
    const result = await sandbox[language](code)
    return { success: true, output: result.stdout }
  } catch (error) {
    reply.status(500)
    return { success: false, error: error.message }
  }
})
```

## GraphQL Integration

### Apollo Server

```typescript
import { ApolloServer, gql } from 'apollo-server-express'
import { createCompute } from 'computesdk'

const typeDefs = gql`
  type ExecutionResult {
    output: String!
    stderr: String
    executionTime: Int!
    success: Boolean!
  }
  
  type FileContent {
    path: String!
    content: String!
    size: Int!
  }
  
  type Query {
    listFiles(path: String!): [String!]!
    readFile(path: String!): FileContent
  }
  
  type Mutation {
    executeCode(
      code: String!
      language: String!
      provider: String = "e2b"
    ): ExecutionResult!
    
    writeFile(
      path: String!
      content: String!
    ): Boolean!
  }
`

const resolvers = {
  Query: {
    listFiles: async (_, { path }) => {
      const compute = createCompute()
      const sandbox = await compute('e2b')
      try {
        const files = await sandbox.listFiles(path)
        return files.map(f => f.name)
      } finally {
        await sandbox.destroy()
      }
    },
    
    readFile: async (_, { path }) => {
      const compute = createCompute()
      const sandbox = await compute('e2b')
      try {
        const content = await sandbox.readFile(path)
        const stats = await sandbox.stat(path)
        return {
          path,
          content,
          size: stats.size
        }
      } finally {
        await sandbox.destroy()
      }
    }
  },
  
  Mutation: {
    executeCode: async (_, { code, language, provider }) => {
      const compute = createCompute()
      const sandbox = await compute(provider, {
        template: language,
        timeout: 30000
      })
      
      try {
        const result = await sandbox[language](code)
        return {
          output: result.stdout,
          stderr: result.stderr,
          executionTime: result.executionTime,
          success: result.exitCode === 0
        }
      } catch (error) {
        return {
          output: '',
          stderr: error.message,
          executionTime: 0,
          success: false
        }
      } finally {
        await sandbox.destroy()
      }
    },
    
    writeFile: async (_, { path, content }) => {
      const compute = createCompute()
      const sandbox = await compute('e2b')
      try {
        await sandbox.writeFile(path, content)
        return true
      } catch (error) {
        return false
      } finally {
        await sandbox.destroy()
      }
    }
  }
}

const server = new ApolloServer({ typeDefs, resolvers })
```

## WebSocket Integration

### Real-time Code Execution

```typescript
import { WebSocketServer } from 'ws'
import { createCompute } from 'computesdk'

const wss = new WebSocketServer({ port: 8080 })

interface Client {
  ws: WebSocket
  sandbox?: Sandbox
  id: string
}

const clients = new Map<string, Client>()

wss.on('connection', (ws) => {
  const clientId = generateId()
  const client: Client = { ws, id: clientId }
  clients.set(clientId, client)
  
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString())
      
      switch (message.type) {
        case 'create-sandbox':
          const compute = createCompute()
          client.sandbox = await compute(message.provider || 'e2b', {
            template: message.template
          })
          
          ws.send(JSON.stringify({
            type: 'sandbox-ready',
            sandboxId: client.sandbox.id
          }))
          break
          
        case 'execute':
          if (!client.sandbox) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'No active sandbox'
            }))
            return
          }
          
          // Stream execution output
          const stream = client.sandbox.execStream(message.command)
          
          stream.stdout.on('data', (chunk) => {
            ws.send(JSON.stringify({
              type: 'output',
              stream: 'stdout',
              data: chunk.toString()
            }))
          })
          
          stream.stderr.on('data', (chunk) => {
            ws.send(JSON.stringify({
              type: 'output',
              stream: 'stderr',
              data: chunk.toString()
            }))
          })
          
          stream.on('exit', (code) => {
            ws.send(JSON.stringify({
              type: 'execution-complete',
              exitCode: code
            }))
          })
          break
          
        case 'destroy-sandbox':
          if (client.sandbox) {
            await client.sandbox.destroy()
            client.sandbox = undefined
          }
          break
      }
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        message: error.message
      }))
    }
  })
  
  ws.on('close', async () => {
    if (client.sandbox) {
      await client.sandbox.destroy()
    }
    clients.delete(clientId)
  })
})
```

### Socket.IO Integration

```typescript
import { Server } from 'socket.io'
import { createCompute } from 'computesdk'

const io = new Server(server, {
  cors: { origin: "*" }
})

interface SessionData {
  sandbox?: Sandbox
  userId: string
}

io.on('connection', (socket) => {
  const session: SessionData = {
    userId: socket.handshake.auth.userId
  }
  
  socket.on('start-session', async (config) => {
    try {
      const compute = createCompute()
      session.sandbox = await compute(config.provider, {
        template: config.template,
        metadata: { userId: session.userId }
      })
      
      socket.emit('session-started', {
        sandboxId: session.sandbox.id
      })
    } catch (error) {
      socket.emit('error', { message: error.message })
    }
  })
  
  socket.on('execute-code', async (data) => {
    if (!session.sandbox) {
      socket.emit('error', { message: 'No active session' })
      return
    }
    
    try {
      const result = await session.sandbox[data.language](data.code)
      socket.emit('execution-result', {
        output: result.stdout,
        stderr: result.stderr,
        success: result.exitCode === 0
      })
    } catch (error) {
      socket.emit('execution-error', {
        message: error.message
      })
    }
  })
  
  socket.on('terminal-input', async (data) => {
    if (session.sandbox?.terminal) {
      await session.sandbox.terminal.write(data)
    }
  })
  
  socket.on('disconnect', async () => {
    if (session.sandbox) {
      await session.sandbox.destroy()
    }
  })
})
```

## Serverless Function Integration

### Vercel Functions

```typescript
// api/compute.ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createCompute } from 'computesdk'

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  
  const { code, language } = req.body
  
  try {
    const compute = createCompute()
    const sandbox = await compute('vercel', {
      template: language,
      region: process.env.VERCEL_REGION || 'iad1'
    })
    
    const result = await sandbox[language](code, {
      timeout: 10000 // 10 second limit for serverless
    })
    
    res.json({
      output: result.stdout,
      executionTime: result.executionTime
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
```

### AWS Lambda

```typescript
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { createCompute } from 'computesdk'

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const compute = createCompute()
    const { code, language } = JSON.parse(event.body || '{}')
    
    const sandbox = await compute('modal', {
      template: language,
      resources: {
        memoryMB: 1024,
        timeoutMs: 30000
      }
    })
    
    const result = await sandbox[language](code)
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        output: result.stdout,
        stderr: result.stderr,
        executionTime: result.executionTime
      })
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: error.message
      })
    }
  }
}
```

### Cloudflare Workers

```typescript
// worker.ts
import { createCompute } from 'computesdk'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }
    
    try {
      const compute = createCompute()
      const { code, language } = await request.json()
      
      const sandbox = await compute('cloudflare', {
        template: language,
        region: 'auto'
      })
      
      const result = await sandbox[language](code, {
        timeout: 10000
      })
      
      return new Response(JSON.stringify({
        output: result.stdout,
        success: result.exitCode === 0
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      })
    } catch (error) {
      return new Response(JSON.stringify({
        error: error.message
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      })
    }
  }
}
```

## Authentication and Authorization

### JWT-based Authentication

```typescript
import jwt from 'jsonwebtoken'
import { createCompute } from 'computesdk'

// JWT middleware
function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  
  if (!token) {
    return res.sendStatus(401)
  }
  
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
    if (err) return res.sendStatus(403)
    req.user = user
    next()
  })
}

// Protected compute endpoint
app.post('/api/secure/execute', authenticateToken, async (req, res) => {
  const user = req.user
  
  const compute = createCompute()
  const sandbox = await compute('e2b', {
    metadata: {
      userId: user.id,
      userPlan: user.plan
    },
    resources: getUserResourceLimits(user.plan)
  })
  
  try {
    const result = await sandbox.exec(req.body.command)
    
    // Log usage for billing
    await logUsage(user.id, {
      executionTime: result.executionTime,
      resourceUsage: await sandbox.getResourceUsage()
    })
    
    res.json(result)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})
```

### Role-based Access Control

```typescript
interface UserPermissions {
  canExecuteCode: boolean
  canAccessFiles: boolean
  canCreateSandbox: boolean
  allowedProviders: string[]
  resourceLimits: {
    maxCpuCores: number
    maxMemoryMB: number
    maxExecutionTime: number
  }
}

function checkPermissions(permission: keyof UserPermissions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user
    const permissions = getUserPermissions(user.role)
    
    if (!permissions[permission]) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }
    
    req.permissions = permissions
    next()
  }
}

// Usage
app.post('/api/execute',
  authenticateToken,
  checkPermissions('canExecuteCode'),
  async (req, res) => {
    const { provider } = req.body
    const permissions = req.permissions
    
    if (!permissions.allowedProviders.includes(provider)) {
      return res.status(403).json({ error: 'Provider not allowed' })
    }
    
    const compute = createCompute()
    const sandbox = await compute(provider, {
      resources: permissions.resourceLimits,
      timeout: permissions.resourceLimits.maxExecutionTime
    })
    
    // ... execute code
  }
)
```

## Rate Limiting and Quotas

### Rate Limiting Middleware

```typescript
import rateLimit from 'express-rate-limit'
import { createCompute } from 'computesdk'

// Basic rate limiting
const createRateLimit = (windowMs: number, max: number) => 
  rateLimit({
    windowMs,
    max,
    message: 'Too many requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false
  })

// Different limits for different endpoints
app.use('/api/execute', createRateLimit(15 * 60 * 1000, 100)) // 100 requests per 15 minutes
app.use('/api/files', createRateLimit(15 * 60 * 1000, 500))   // 500 requests per 15 minutes

// Advanced rate limiting with user tiers
const userBasedRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req) => {
    const userTier = req.user?.tier || 'free'
    const limits = {
      free: 10,
      pro: 100,
      enterprise: 1000
    }
    return limits[userTier] || 10
  },
  keyGenerator: (req) => req.user?.id || req.ip
})
```

### Usage Tracking and Quotas

```typescript
class UsageTracker {
  private usage = new Map<string, UserUsage>()
  
  async trackExecution(userId: string, metrics: ExecutionMetrics) {
    const current = this.usage.get(userId) || { 
      executions: 0, 
      cpuSeconds: 0, 
      memoryMBSeconds: 0 
    }
    
    current.executions++
    current.cpuSeconds += metrics.cpuTime
    current.memoryMBSeconds += metrics.memoryMB * (metrics.duration / 1000)
    
    this.usage.set(userId, current)
    
    // Persist to database
    await this.saveUsage(userId, current)
  }
  
  async checkQuota(userId: string): Promise<boolean> {
    const usage = this.usage.get(userId)
    const limits = await this.getUserLimits(userId)
    
    return !usage || (
      usage.executions < limits.maxExecutions &&
      usage.cpuSeconds < limits.maxCpuSeconds &&
      usage.memoryMBSeconds < limits.maxMemoryMBSeconds
    )
  }
}

const usageTracker = new UsageTracker()

// Quota checking middleware
async function checkQuota(req: Request, res: Response, next: NextFunction) {
  const userId = req.user?.id
  
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  
  const hasQuota = await usageTracker.checkQuota(userId)
  
  if (!hasQuota) {
    return res.status(429).json({ 
      error: 'Quota exceeded',
      code: 'QUOTA_EXCEEDED'
    })
  }
  
  next()
}
```

## Monitoring and Observability

### Metrics Collection

```typescript
import prometheus from 'prom-client'

// Create metrics
const executionCounter = new prometheus.Counter({
  name: 'compute_executions_total',
  help: 'Total number of code executions',
  labelNames: ['provider', 'language', 'status']
})

const executionDuration = new prometheus.Histogram({
  name: 'compute_execution_duration_seconds',
  help: 'Duration of code executions',
  labelNames: ['provider', 'language']
})

const activeConnections = new prometheus.Gauge({
  name: 'compute_active_connections',
  help: 'Number of active sandbox connections'
})

// Middleware to collect metrics
function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now()
  
  res.on('finish', () => {
    const duration = (Date.now() - startTime) / 1000
    const status = res.statusCode >= 400 ? 'error' : 'success'
    
    executionCounter.inc({
      provider: req.body.provider || 'unknown',
      language: req.body.language || 'unknown',
      status
    })
    
    executionDuration.observe({
      provider: req.body.provider || 'unknown',
      language: req.body.language || 'unknown'
    }, duration)
  })
  
  next()
}

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', prometheus.register.contentType)
  res.end(await prometheus.register.metrics())
})
```

### Health Checks

```typescript
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {}
  }
  
  // Check sandbox connectivity
  try {
    const compute = createCompute()
    const testSandbox = await compute('e2b', { timeout: 5000 })
    await testSandbox.exec('echo "health check"')
    await testSandbox.destroy()
    health.services.e2b = 'healthy'
  } catch (error) {
    health.services.e2b = 'unhealthy'
    health.status = 'degraded'
  }
  
  // Check other providers...
  
  const statusCode = health.status === 'healthy' ? 200 : 503
  res.status(statusCode).json(health)
})
```

## Best Practices

1. **Resource Management**: Always clean up sandboxes and close connections
2. **Error Handling**: Implement comprehensive error handling and user-friendly messages
3. **Security**: Validate all inputs and implement proper authentication/authorization
4. **Rate Limiting**: Protect your API with appropriate rate limits and quotas
5. **Monitoring**: Track usage, performance, and errors for operational insights
6. **Caching**: Cache sandbox instances where appropriate to improve performance
7. **Timeouts**: Set reasonable timeouts to prevent hanging requests
8. **Documentation**: Provide clear API documentation for consumers

## Related Documentation

- [Overview](./overview.md) - SDK architecture and concepts
- [Configuration](./configuration.md) - Configuration options for different environments
- [Code Execution](./code-execution.md) - Running code and commands
- [UI Package](./ui-package.md) - Frontend integration components
- [Frameworks](../frameworks/) - Framework-specific integration guides