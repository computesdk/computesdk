# UI Package

The `@computesdk/ui` package provides framework-agnostic factory functions and types for integrating ComputeSDK into your frontend applications. It offers TypeScript definitions, API utilities, and validation helpers for building compute-enabled interfaces.

## Installation

```bash
npm install @computesdk/ui
# or
pnpm add @computesdk/ui
# or
yarn add @computesdk/ui
```

## What's Included

### Types
Complete TypeScript definitions for ComputeSDK API integration:

```typescript
import type { 
  ComputeRequest, 
  ComputeResponse, 
  Runtime,
  UIConsole,
  UISandbox,
  UIFilesystem
} from '@computesdk/ui'
```

### Factory Functions
Framework-agnostic functions for creating compute instances:

```typescript
import { createCompute, createSandboxConsole } from '@computesdk/ui'

// Main compute management
const compute = createCompute({
  apiEndpoint: '/api/compute',
  defaultRuntime: 'python'
})

// Create sandbox
const sandbox = await compute.sandbox.create()

// REPL-style console with history
const console = createSandboxConsole({
  sandboxId: sandbox.id,
  apiEndpoint: '/api/compute'
})

await console.runCode('x = 42')
await console.runCode('print(x)')  // Maintains context
console.history  // View execution history
```

### API Utilities
Helper functions for making requests to ComputeSDK APIs:

```typescript
import { executeComputeRequest, APIError } from '@computesdk/ui'

const response = await executeComputeRequest({
  action: 'compute.sandbox.runCode',
  code: 'print("Hello World!")',
  runtime: 'python'
}, '/api/compute')
```

### Validation Utilities
Input validation for compute operations:

```typescript
import { 
  validateCode,
  validateRuntime,
  validateComputeRequest 
} from '@computesdk/ui'

const codeValidation = validateCode('print("hello")')
if (!codeValidation.isValid) {
  console.error(codeValidation.errors)
}
```

## Core Factory Functions

### createCompute

Main factory for compute environment management:

```typescript
import { createCompute } from '@computesdk/ui'

const compute = createCompute({
  apiEndpoint: '/api/compute',    // Default: '/api/compute'
  defaultRuntime: 'python'       // Default: 'python'
})

// Create a new sandbox
const sandbox = await compute.sandbox.create({
  runtime: 'python',
  timeout: 300000
})

// Get existing sandbox
const existingSandbox = await compute.sandbox.get('sandbox-id')

// List all sandboxes
const sandboxes = await compute.sandbox.list()

// Destroy sandbox
await compute.sandbox.destroy('sandbox-id')
```

### createSandbox

Create a sandbox instance for direct operations:

```typescript
import { createSandbox } from '@computesdk/ui'

const sandbox = createSandbox({
  sandboxId: 'my-sandbox',
  provider: 'e2b',
  runtime: 'python',
  status: 'running',
  apiEndpoint: '/api/compute'
})

// Execute code
const result = await sandbox.runCode('print("Hello World!")')

// Run shell commands
const cmdResult = await sandbox.runCommand('ls', ['-la'])

// Filesystem operations
await sandbox.filesystem.writeFile('/app/script.py', 'print("Hello")')
const content = await sandbox.filesystem.readFile('/app/script.py')
const files = await sandbox.filesystem.readdir('/app')

// Get sandbox info
const info = await sandbox.getInfo()

// Destroy sandbox
await sandbox.destroy()
```

### createSandboxConsole

Create a REPL-style console with execution history:

```typescript
import { createSandboxConsole } from '@computesdk/ui'

const console = createSandboxConsole({
  sandboxId: 'my-sandbox',
  apiEndpoint: '/api/compute',
  defaultRuntime: 'python'
})

// Execute code with context persistence
await console.runCode('x = 42')
await console.runCode('y = x * 2')
await console.runCode('print(f"Result: {y}")')

// Run shell commands
await console.runCommand('pip', ['install', 'requests'])

// Access execution history
console.history.forEach(entry => {
  console.log(`${entry.type}: ${entry.content}`)
})

// Clear history
console.clear()

// Check execution state
if (console.isRunning) {
  console.log('Code is currently executing...')
}
```

### createSandboxFilesystem

Create a filesystem interface with enhanced UX:

```typescript
import { createSandboxFilesystem } from '@computesdk/ui'

const fs = createSandboxFilesystem({
  sandboxId: 'my-sandbox',
  apiEndpoint: '/api/compute'
})

// File operations with error handling
try {
  await fs.writeFile('/app/config.json', JSON.stringify({ api: 'v1' }))
  const content = await fs.readFile('/app/config.json')
  console.log('Config:', JSON.parse(content))
  
  const files = await fs.readdir('/app')
  files.forEach(file => {
    console.log(`${file.name} (${file.isDirectory ? 'dir' : 'file'})`)
  })
  
  const exists = await fs.exists('/app/config.json')
  if (exists) {
    await fs.remove('/app/config.json')
  }
} catch (error) {
  console.error('Filesystem error:', error.message)
}
```

## Core Types

### ComputeRequest

Request structure for all compute operations:

```typescript
interface ComputeRequest {
  action: 
    | 'compute.sandbox.create' 
    | 'compute.sandbox.destroy' 
    | 'compute.sandbox.getInfo'
    | 'compute.sandbox.list'
    | 'compute.sandbox.runCode'
    | 'compute.sandbox.runCommand'
    | 'compute.sandbox.filesystem.readFile'
    | 'compute.sandbox.filesystem.writeFile'
    | 'compute.sandbox.filesystem.mkdir'
    | 'compute.sandbox.filesystem.readdir'
    | 'compute.sandbox.filesystem.exists'
    | 'compute.sandbox.filesystem.remove'
  
  sandboxId?: string
  code?: string
  command?: string
  args?: string[]
  runtime?: Runtime
  path?: string
  content?: string
  options?: {
    runtime?: Runtime
    timeout?: number
    sandboxId?: string
  }
}
```

### ComputeResponse

Response structure from compute operations:

```typescript
interface ComputeResponse {
  success: boolean
  error?: string
  sandboxId: string
  provider: string
  
  result?: {
    stdout: string
    stderr: string
    exitCode: number
    executionTime: number
  }
  
  info?: {
    id: string
    provider: string
    runtime: Runtime
    status: SandboxStatus
    createdAt: string
    timeout: number
    metadata?: Record<string, unknown>
  }
  
  fileContent?: string
  files?: Array<{
    name: string
    path: string
    isDirectory: boolean
    size: number
    lastModified: string
  }>
  exists?: boolean
  sandboxes?: Array<{
    sandboxId: string
    provider: string
  }>
}
```

### UIConsole

REPL-style console interface:

```typescript
interface UIConsole {
  sandboxId: string
  runCode: (code: string, runtime?: Runtime) => Promise<ConsoleResult>
  runCommand: (command: string, args?: string[]) => Promise<ConsoleResult>
  history: ConsoleEntry[]
  isRunning: boolean
  currentRuntime: Runtime
  clear: () => void
  getContext: () => Promise<Record<string, unknown>>
}
```

### ConsoleEntry

Individual console history entry:

```typescript
interface ConsoleEntry {
  id: string
  type: 'input' | 'output' | 'error'
  content: string
  runtime?: Runtime
  timestamp: Date
  result?: {
    stdout: string
    stderr: string
    exitCode: number
    executionTime: number
  }
}
```

## Utility Functions

### executeComputeRequest

Generic function for any compute operation:

```typescript
async function executeComputeRequest(
  request: ComputeRequest,
  endpoint?: string
): Promise<ComputeResponse>

// Example usage
const response = await executeComputeRequest({
  action: 'compute.sandbox.runCode',
  sandboxId: 'my-sandbox',
  code: 'print("Hello")',
  runtime: 'python'
}, '/api/compute')
```

### APIError

Error class for compute operations:

```typescript
class APIError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string
  )
}
```

### Validation Functions

Input validation utilities:

```typescript
// Validate code input
function validateCode(code: string): ValidationResult

// Validate runtime selection
function validateRuntime(runtime: string): ValidationResult

// Validate API endpoint
function validateApiEndpoint(endpoint: string): ValidationResult

// Validate full compute configuration
function validateComputeConfig(config: ComputeConfig): ValidationResult

// Validate compute request structure
function validateComputeRequest(request: ComputeRequest): ValidationResult
```

### Formatting Utilities

Display helpers:

```typescript
// Format execution time for display
function formatExecutionTime(milliseconds: number): string

// Format output for display
function formatOutput(output: string): string

// Check if response indicates error
function isComputeError(response: ComputeResponse): boolean

// Get error message from response
function getErrorMessage(response: ComputeResponse): string
```

## Framework Integration

This package is framework-agnostic. Use it with any frontend framework:

### React Example

```typescript
import React, { useState } from 'react'
import { createCompute, type ComputeResponse } from '@computesdk/ui'

function CodeExecutor() {
  const [code, setCode] = useState('print("Hello World!")')
  const [result, setResult] = useState<ComputeResponse | null>(null)
  const [loading, setLoading] = useState(false)
  
  const compute = createCompute({
    apiEndpoint: '/api/compute',
    defaultRuntime: 'python'
  })
  
  const executeCode = async () => {
    setLoading(true)
    try {
      const sandbox = await compute.sandbox.create()
      const response = await sandbox.runCode(code)
      setResult(response)
      await sandbox.destroy()
    } catch (error) {
      console.error('Execution failed:', error)
    } finally {
      setLoading(false)
    }
  }
  
  return (
    <div>
      <textarea 
        value={code} 
        onChange={(e) => setCode(e.target.value)}
        rows={10}
        cols={50}
      />
      <button onClick={executeCode} disabled={loading}>
        {loading ? 'Executing...' : 'Execute'}
      </button>
      {result && (
        <pre>
          {result.success ? result.result?.stdout : result.error}
        </pre>
      )}
    </div>
  )
}
```

### Vue Example

```typescript
import { ref, computed } from 'vue'
import { createCompute, type ComputeResponse } from '@computesdk/ui'

export function useCodeExecution() {
  const code = ref('print("Hello World!")')
  const result = ref<ComputeResponse | null>(null)
  const loading = ref(false)
  
  const compute = createCompute({
    apiEndpoint: '/api/compute',
    defaultRuntime: 'python'
  })
  
  const output = computed(() => {
    if (!result.value) return ''
    return result.value.success 
      ? result.value.result?.stdout || ''
      : result.value.error || 'Unknown error'
  })
  
  const execute = async () => {
    loading.value = true
    try {
      const sandbox = await compute.sandbox.create()
      result.value = await sandbox.runCode(code.value)
      await sandbox.destroy()
    } catch (error) {
      console.error('Execution failed:', error)
    } finally {
      loading.value = false
    }
  }
  
  return { code, result, loading, output, execute }
}
```

### Svelte Example

```typescript
import { writable, get } from 'svelte/store'
import { createCompute, type ComputeResponse } from '@computesdk/ui'

export const code = writable('print("Hello World!")')
export const result = writable<ComputeResponse | null>(null)
export const loading = writable(false)

const compute = createCompute({
  apiEndpoint: '/api/compute',
  defaultRuntime: 'python'
})

export async function execute() {
  loading.set(true)
  try {
    const sandbox = await compute.sandbox.create()
    const response = await sandbox.runCode(get(code))
    result.set(response)
    await sandbox.destroy()
  } catch (error) {
    console.error('Execution failed:', error)
  } finally {
    loading.set(false)
  }
}
```

## REPL Console Example

Build a persistent code execution environment:

```typescript
import { createSandboxConsole } from '@computesdk/ui'

class CodeREPL {
  private console: UIConsole
  
  constructor(sandboxId: string) {
    this.console = createSandboxConsole({
      sandboxId,
      apiEndpoint: '/api/compute',
      defaultRuntime: 'python'
    })
  }
  
  async executeCode(code: string) {
    const result = await this.console.runCode(code)
    
    if (result.success) {
      console.log('Output:', result.stdout)
      if (result.stderr) {
        console.warn('Warnings:', result.stderr)
      }
    } else {
      console.error('Error:', result.error)
    }
    
    return result
  }
  
  getHistory() {
    return this.console.history.map(entry => ({
      type: entry.type,
      content: entry.content,
      timestamp: entry.timestamp
    }))
  }
  
  clearHistory() {
    this.console.clear()
  }
}

// Usage
const repl = new CodeREPL('my-sandbox')
await repl.executeCode('x = 42')
await repl.executeCode('y = x * 2')
await repl.executeCode('print(f"Result: {y}")')
console.log('History:', repl.getHistory())
```

## Error Handling

```typescript
import { createCompute, APIError, isComputeError, getErrorMessage } from '@computesdk/ui'

const compute = createCompute()

try {
  const sandbox = await compute.sandbox.create()
  const result = await sandbox.runCode('invalid python code')
  
  if (isComputeError(result)) {
    console.error('Compute error:', getErrorMessage(result))
  } else {
    console.log('Success:', result.result?.stdout)
  }
} catch (error) {
  if (error instanceof APIError) {
    console.error('API Error:', error.message, 'Status:', error.status)
  } else {
    console.error('Unexpected error:', error)
  }
}
```

## Server-Side Integration

Your server should implement the ComputeSDK request handler:

```typescript
// /api/compute endpoint
import { handleComputeRequest } from 'computesdk'
import { e2b } from '@computesdk/e2b'

export async function GET(request: Request) {
  return handleComputeRequest({
    request,
    provider: e2b({ apiKey: process.env.E2B_API_KEY })
  })
}

export async function POST(request: Request) {
  return handleComputeRequest({
    request,
    provider: e2b({ apiKey: process.env.E2B_API_KEY })
  })
}
```

## Examples

See the [ComputeSDK examples](../../examples/) for complete framework integrations:

- [Next.js](../../examples/nextjs/)
- [Nuxt](../../examples/nuxt/)  
- [SvelteKit](../../examples/sveltekit/)
- [Remix](../../examples/remix/)
- [Astro](../../examples/astro/)

## Related Documentation

- [Overview](./overview.md) - SDK architecture and concepts
- [Configuration](./configuration.md) - Global configuration options
- [Code Execution](./code-execution.md) - Running code and commands
- [Providers](../providers/) - Provider-specific documentation