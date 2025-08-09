# @computesdk/ui

Types, configurations, and utilities for integrating with ComputeSDK APIs from frontend applications. This package provides the foundation for building compute interfaces across any framework.

## Installation

```bash
npm install @computesdk/ui
```

## What's Included

### Types
Complete TypeScript definitions for ComputeSDK API integration:

```typescript
import type { 
  ComputeRequest, 
  ComputeResponse, 
  ComputeConfig,
  Runtime 
} from '@computesdk/ui'
```

### API Utilities
Helper functions for making requests to ComputeSDK APIs:

```typescript
import { 
  executeComputeRequest,
  executeCode,
  APIError 
} from '@computesdk/ui'

// Execute code
const response = await executeCode(
  'print("Hello World!")', 
  'python',
  undefined, // sandboxId (optional)
  '/api/compute'
)

// Or make any compute request
const response = await executeComputeRequest({
  action: 'compute.sandbox.filesystem.readFile',
  sandboxId: 'sandbox-123',
  path: '/tmp/output.txt'
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

## API Reference

### Core Types

#### `ComputeRequest`
Request structure for all compute operations:
- `action` - Operation type (e.g., `'compute.sandbox.runCode'`)
- `sandboxId?` - Target sandbox ID
- `code?` - Code to execute
- `runtime?` - Runtime environment (`'python'` | `'javascript'`)
- `path?` - File path (for filesystem operations)
- `content?` - File content (for write operations)
- And more...

#### `ComputeResponse`
Response structure from compute operations:
- `success` - Whether operation succeeded
- `error?` - Error message if failed
- `sandboxId` - Sandbox ID involved
- `provider` - Provider that handled the operation
- `result?` - Execution results
- `fileContent?` - File content (for read operations)
- And more...

### Utility Functions

#### `executeCode(code, runtime?, sandboxId?, endpoint?)`
Convenience function for code execution.

#### `executeComputeRequest(request, endpoint?)`
Generic function for any compute operation.

#### `validateCode(code)`, `validateRuntime(runtime)`, etc.
Input validation functions.

## Framework Integration

This package is framework-agnostic. Use it with any frontend framework:

### React Example
```typescript
import { executeCode, type ComputeResponse } from '@computesdk/ui'

function useCodeExecution() {
  const [result, setResult] = useState<ComputeResponse | null>(null)
  
  const execute = async (code: string) => {
    const response = await executeCode(code, 'python')
    setResult(response)
  }
  
  return { result, execute }
}
```

### Vue Example
```typescript
import { ref } from 'vue'
import { executeCode, type ComputeResponse } from '@computesdk/ui'

export function useCodeExecution() {
  const result = ref<ComputeResponse | null>(null)
  
  const execute = async (code: string) => {
    result.value = await executeCode(code, 'python')
  }
  
  return { result, execute }
}
```

### Svelte Example
```typescript
import { writable } from 'svelte/store'
import { executeCode, type ComputeResponse } from '@computesdk/ui'

export const result = writable<ComputeResponse | null>(null)

export async function execute(code: string) {
  const response = await executeCode(code, 'python')
  result.set(response)
}
```

## Server-Side Integration

Your server should implement the ComputeSDK request handler:

```typescript
// /api/compute endpoint
import { handleComputeRequest } from 'computesdk'
import { e2b } from '@computesdk/e2b'

export async function POST(request: Request) {
  const computeRequest = await request.json()
  
  const response = await handleComputeRequest({
    request: computeRequest,
    provider: e2b({ apiKey: process.env.E2B_API_KEY })
  })
  
  return Response.json(response)
}
```

## Examples

See the [ComputeSDK examples](https://github.com/computesdk/computesdk/tree/main/examples) for complete framework integrations:

- [Next.js](https://github.com/computesdk/computesdk/tree/main/examples/nextjs)
- [Nuxt](https://github.com/computesdk/computesdk/tree/main/examples/nuxt)  
- [SvelteKit](https://github.com/computesdk/computesdk/tree/main/examples/sveltekit)
- [Remix](https://github.com/computesdk/computesdk/tree/main/examples/remix)
- [Astro](https://github.com/computesdk/computesdk/tree/main/examples/astro)

## License

MIT