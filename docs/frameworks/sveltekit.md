# SvelteKit

Use ComputeSDK to execute code in secure sandboxes from your SvelteKit server API routes.

## Setup

### 1. Install Dependencies

```bash
npm install computesdk

# Provider packages (install what you need)
npm install @computesdk/e2b        # E2B provider
npm install @computesdk/vercel     # Vercel provider  
npm install @computesdk/daytona    # Daytona provider
```

### 2. Configure Environment Variables

Create a `.env` file and add your provider credentials:

```bash
# E2B (get from e2b.dev)
E2B_API_KEY=e2b_your_api_key_here

# Vercel
# Method 1: OIDC Token (recommended)
vercel env pull  # Downloads VERCEL_OIDC_TOKEN

# Method 2: Traditional
VERCEL_TOKEN=your_vercel_token_here
VERCEL_TEAM_ID=your_team_id_here
VERCEL_PROJECT_ID=your_project_id_here

# Daytona (get from your Daytona instance)
DAYTONA_API_KEY=your_daytona_api_key_here
```

### 3. Run Development Server

```bash
npm run dev
```

Navigate to [http://localhost:5173](http://localhost:5173)

## Implementation

### Server API Route with Request Handler

The simplest way to use ComputeSDK in SvelteKit is with the built-in request handler:

```typescript
// src/routes/api/compute/+server.ts
import { handleComputeRequest } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { E2B_API_KEY } from '$env/static/private';
import { json } from '@sveltejs/kit';

export async function POST({ request }) {
  const body = await request.json();
  
  const response = await handleComputeRequest({
    request: body,
    provider: e2b({ apiKey: E2B_API_KEY })
  });

  return json(response, {
    status: response.success ? 200 : 500
  });
}
```

### Custom Server API Route

For more control, create a custom server API route:

```typescript
// src/routes/api/sandbox/+server.ts
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { E2B_API_KEY } from '$env/static/private';
import { json, error } from '@sveltejs/kit';

export async function POST({ request }) {
  try {
    const { code, runtime } = await request.json();
    
    // Set provider
    compute.setConfig({ 
      provider: e2b({ apiKey: E2B_API_KEY }) 
    });
    
    // Create sandbox and execute code
    const sandbox = await compute.sandbox.create();
    const result = await sandbox.runCode(code, runtime);
    
    // Clean up
    await compute.sandbox.destroy(sandbox.sandboxId);
    
    return json({
      success: true,
      stdout: result.stdout,
      stderr: result.stderr,
      executionTime: result.executionTime
    });
  } catch (err: any) {
    throw error(500, err.message || 'Unknown error');
  }
}
```

### Frontend Integration

Call your API from SvelteKit pages:

```svelte
<!-- src/routes/playground/+page.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  
  let code = 'print("Hello World!")';
  let output = '';
  let loading = false;
  let runtime: 'python' | 'node' = 'python';

  async function executeCode() {
    loading = true;
    try {
      const response = await fetch('/api/compute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'compute.sandbox.runCode',
          code,
          runtime
        })
      });
      
      const data = await response.json();
      if (data.success) {
        output = data.result.stdout;
      } else {
        output = `Error: ${data.error}`;
      }
    } catch (error) {
      output = `Error: ${error.message}`;
    } finally {
      loading = false;
    }
  }
</script>

<div class="container mx-auto p-8">
  <h1 class="text-3xl font-bold mb-6">Code Executor</h1>
  
  <div class="mb-4">
    <select bind:value={runtime} class="px-3 py-2 border rounded mr-4">
      <option value="python">Python</option>
      <option value="node">Node.js</option>
    </select>
  </div>
  
  <textarea
    bind:value={code}
    rows="10"
    class="w-full p-4 border rounded font-mono mb-4"
    placeholder="Enter your code here..."
  />
  
  <button 
    on:click={executeCode} 
    disabled={loading}
    class="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
  >
    {loading ? 'Executing...' : 'Execute Code'}
  </button>
  
  {#if output}
    <pre class="mt-4 p-4 bg-gray-100 rounded overflow-x-auto">{output}</pre>
  {/if}
</div>

<style>
  .container {
    max-width: 800px;
  }
</style>
```

### Using Stores

Create a Svelte store for state management:

```typescript
// src/lib/stores/compute.ts
import { writable } from 'svelte/store';

interface ComputeState {
  loading: boolean;
  result: any;
  error: string | null;
}

function createComputeStore() {
  const { subscribe, set, update } = writable<ComputeState>({
    loading: false,
    result: null,
    error: null
  });

  return {
    subscribe,
    execute: async (code: string, runtime: 'python' | 'node' = 'python') => {
      update(state => ({ ...state, loading: true, error: null }));
      
      try {
        const response = await fetch('/api/compute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'compute.sandbox.runCode',
            code,
            runtime
          })
        });
        
        const data = await response.json();
        
        if (data.success) {
          update(state => ({ ...state, result: data.result, loading: false }));
        } else {
          update(state => ({ ...state, error: data.error, loading: false }));
        }
      } catch (err: any) {
        update(state => ({ ...state, error: err.message, loading: false }));
      }
    },
    reset: () => set({ loading: false, result: null, error: null })
  };
}

export const computeStore = createComputeStore();
```

```svelte
<!-- src/routes/store-demo/+page.svelte -->
<script lang="ts">
  import { computeStore } from '$lib/stores/compute';
  
  let code = 'print("Hello from store!")';
  
  $: ({ loading, result, error } = $computeStore);
</script>

<div class="container mx-auto p-8">
  <h1 class="text-3xl font-bold mb-6">Store Demo</h1>
  
  <textarea
    bind:value={code}
    rows="8"
    class="w-full p-4 border rounded font-mono mb-4"
  />
  
  <button 
    on:click={() => computeStore.execute(code, 'python')} 
    disabled={loading}
    class="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
  >
    {loading ? 'Executing...' : 'Execute Python Code'}
  </button>
  
  {#if loading}
    <div class="mt-4">Executing...</div>
  {/if}
  
  {#if result}
    <pre class="mt-4 p-4 bg-gray-100 rounded">{result.stdout}</pre>
  {/if}
  
  {#if error}
    <div class="mt-4 p-4 bg-red-100 text-red-700 rounded">
      Error: {error}
    </div>
  {/if}
</div>
```

### Using Actions

Create form actions for server-side processing:

```typescript
// src/routes/form-demo/+page.server.ts
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { E2B_API_KEY } from '$env/static/private';
import { fail } from '@sveltejs/kit';

export const actions = {
  execute: async ({ request }) => {
    const data = await request.formData();
    const code = data.get('code') as string;
    const runtime = data.get('runtime') as 'python' | 'node';
    
    if (!code) {
      return fail(400, { error: 'Code is required' });
    }
    
    try {
      compute.setConfig({ 
        provider: e2b({ apiKey: E2B_API_KEY }) 
      });
      
      const sandbox = await compute.sandbox.create();
      const result = await sandbox.runCode(code, runtime);
      
      await compute.sandbox.destroy(sandbox.sandboxId);
      
      return {
        success: true,
        stdout: result.stdout,
        stderr: result.stderr,
        executionTime: result.executionTime
      };
    } catch (error: any) {
      return fail(500, { error: error.message });
    }
  }
};
```

```svelte
<!-- src/routes/form-demo/+page.svelte -->
<script lang="ts">
  import { enhance } from '$app/forms';
  
  export let form;
</script>

<div class="container mx-auto p-8">
  <h1 class="text-3xl font-bold mb-6">Form Action Demo</h1>
  
  <form method="POST" action="?/execute" use:enhance>
    <div class="mb-4">
      <select name="runtime" class="px-3 py-2 border rounded">
        <option value="python">Python</option>
        <option value="node">Node.js</option>
      </select>
    </div>
    
    <textarea
      name="code"
      rows="10"
      class="w-full p-4 border rounded font-mono mb-4"
      placeholder="Enter your code here..."
      value="print('Hello World!')"
    ></textarea>
    
    <button 
      type="submit"
      class="px-4 py-2 bg-blue-500 text-white rounded"
    >
      Execute Code
    </button>
  </form>
  
  {#if form?.success}
    <pre class="mt-4 p-4 bg-gray-100 rounded overflow-x-auto">{form.stdout}</pre>
  {/if}
  
  {#if form?.error}
    <div class="mt-4 p-4 bg-red-100 text-red-700 rounded">
      Error: {form.error}
    </div>
  {/if}
</div>
```

## Advanced Examples

### Data Analysis API

```typescript
// src/routes/api/analyze/+server.ts
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { E2B_API_KEY } from '$env/static/private';
import { json, error } from '@sveltejs/kit';

export async function POST({ request }) {
  try {
    const { csvData } = await request.json();
    
    compute.setConfig({ 
      provider: e2b({ apiKey: E2B_API_KEY }) 
    });
    
    const sandbox = await compute.sandbox.create();
    
    // Save CSV data
    await sandbox.filesystem.writeFile('/data/input.csv', csvData);
    
    // Process data
    const result = await sandbox.runCode(`
import pandas as pd
import json

# Read and analyze data
df = pd.read_csv('/data/input.csv')
analysis = {
    'rows': len(df),
    'columns': len(df.columns),
    'summary': df.describe().to_dict(),
    'missing_values': df.isnull().sum().to_dict()
}

print(json.dumps(analysis, indent=2))
    `);
    
    await compute.sandbox.destroy(sandbox.sandboxId);
    
    return json({
      success: true,
      analysis: JSON.parse(result.stdout)
    });
  } catch (err: any) {
    throw error(500, err.message);
  }
}
```

### File Upload Processing

```typescript
// src/routes/api/upload/+server.ts
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { E2B_API_KEY } from '$env/static/private';
import { json, error } from '@sveltejs/kit';

export async function POST({ request }) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      throw error(400, 'No file provided');
    }
    
    const fileContent = await file.text();
    
    const sandbox = await compute.sandbox.create({
      provider: e2b({ apiKey: E2B_API_KEY })
    });
    
    // Save uploaded file
    await sandbox.filesystem.writeFile(`/uploads/${file.name}`, fileContent);
    
    // Process file
    const result = await sandbox.runCode(`
import os

# Get file info
file_path = '/uploads/${file.name}'
file_size = os.path.getsize(file_path)

with open(file_path, 'r') as f:
    content = f.read()
    lines = len(content.split('\\n'))
    chars = len(content)

print(f"File: ${file.name}")
print(f"Size: {file_size} bytes")
print(f"Lines: {lines}")
print(f"Characters: {chars}")
    `);
    
    await compute.sandbox.destroy(sandbox.sandboxId);
    
    return json({
      success: true,
      info: result.stdout
    });
  } catch (err: any) {
    throw error(500, err.message);
  }
}
```

### Multi-Provider Support

```typescript
// src/routes/api/multi-provider/+server.ts
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { vercel } from '@computesdk/vercel';
import { daytona } from '@computesdk/daytona';
import { 
  E2B_API_KEY, 
  VERCEL_TOKEN, 
  DAYTONA_API_KEY 
} from '$env/static/private';
import { json, error } from '@sveltejs/kit';

export async function POST({ request }) {
  try {
    const { provider: providerName, code, runtime } = await request.json();
    
    let provider;
    switch (providerName) {
      case 'e2b':
        provider = e2b({ apiKey: E2B_API_KEY });
        break;
      case 'vercel':
        provider = vercel({ token: VERCEL_TOKEN });
        break;
      case 'daytona':
        provider = daytona({ apiKey: DAYTONA_API_KEY });
        break;
      default:
        throw error(400, 'Invalid provider specified');
    }
    
    const sandbox = await compute.sandbox.create({ provider });
    
    try {
      const result = await sandbox.runCode(code, runtime);
      return json({
        success: true,
        provider: providerName,
        result: result.stdout
      });
    } finally {
      await compute.sandbox.destroy(sandbox.sandboxId);
    }
  } catch (err: any) {
    throw error(500, err.message);
  }
}
```

### Real-time Updates with Stores

```typescript
// src/routes/api/stream/+server.ts
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { E2B_API_KEY } from '$env/static/private';

export async function POST({ request }) {
  const { code } = await request.json();
  
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      
      try {
        controller.enqueue(encoder.encode('data: Starting execution...\n\n'));
        
        const sandbox = await compute.sandbox.create({
          provider: e2b({ apiKey: E2B_API_KEY })
        });
        
        controller.enqueue(encoder.encode('data: Sandbox created\n\n'));
        
        const result = await sandbox.runCode(code);
        
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'result',
          stdout: result.stdout,
          executionTime: result.executionTime
        })}\n\n`));
        
        await compute.sandbox.destroy(sandbox.sandboxId);
        controller.enqueue(encoder.encode('data: Execution completed\n\n'));
        
        controller.close();
      } catch (error: any) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'error',
          message: error.message
        })}\n\n`));
        controller.close();
      }
    }
  });
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}
```

### Load Functions with Server-Side Data

```typescript
// src/routes/data-demo/+page.server.ts
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { E2B_API_KEY } from '$env/static/private';

export async function load() {
  try {
    compute.setConfig({ 
      provider: e2b({ apiKey: E2B_API_KEY }) 
    });
    
    const sandbox = await compute.sandbox.create();
    
    // Generate sample data on the server
    const result = await sandbox.runCode(`
import json
import random

# Generate sample data
data = []
for i in range(10):
    data.append({
        'id': i + 1,
        'name': f'Item {i + 1}',
        'value': round(random.uniform(10, 100), 2)
    })

print(json.dumps(data))
    `);
    
    await compute.sandbox.destroy(sandbox.sandboxId);
    
    return {
      data: JSON.parse(result.stdout)
    };
  } catch (error) {
    return {
      data: [],
      error: error.message
    };
  }
}
```

```svelte
<!-- src/routes/data-demo/+page.svelte -->
<script lang="ts">
  export let data;
</script>

<div class="container mx-auto p-8">
  <h1 class="text-3xl font-bold mb-6">Server-Side Data Demo</h1>
  
  {#if data.error}
    <div class="p-4 bg-red-100 text-red-700 rounded">
      Error: {data.error}
    </div>
  {:else}
    <div class="grid gap-4">
      {#each data.data as item}
        <div class="p-4 border rounded">
          <h3 class="font-bold">{item.name}</h3>
          <p>ID: {item.id}</p>
          <p>Value: ${item.value}</p>
        </div>
      {/each}
    </div>
  {/if}
</div>
```

## Best Practices

### 1. Environment Variable Management

```typescript
// src/lib/server/env.ts
import { 
  E2B_API_KEY, 
  VERCEL_TOKEN, 
  VERCEL_TEAM_ID, 
  VERCEL_PROJECT_ID,
  DAYTONA_API_KEY 
} from '$env/static/private';
import { e2b } from '@computesdk/e2b';
import { vercel } from '@computesdk/vercel';
import { daytona } from '@computesdk/daytona';

export const getProvider = (providerName?: string) => {
  const provider = providerName || 'e2b';
  
  switch (provider) {
    case 'e2b':
      if (!E2B_API_KEY) throw new Error('E2B API key not configured');
      return e2b({ apiKey: E2B_API_KEY });
      
    case 'vercel':
      if (!VERCEL_TOKEN) throw new Error('Vercel token not configured');
      return vercel({ 
        token: VERCEL_TOKEN,
        teamId: VERCEL_TEAM_ID,
        projectId: VERCEL_PROJECT_ID
      });
      
    case 'daytona':
      if (!DAYTONA_API_KEY) throw new Error('Daytona API key not configured');
      return daytona({ apiKey: DAYTONA_API_KEY });
      
    default:
      throw new Error('Invalid provider specified');
  }
};
```

### 2. Error Handling

```typescript
// src/lib/server/error-handler.ts
import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';

export const handleComputeError = (err: any) => {
  console.error('Sandbox error:', err);
  
  // Don't expose sensitive error details in production
  const message = dev ? err.message : 'Internal server error';
  
  throw error(500, message);
};
```

### 3. Input Validation

```typescript
// src/lib/server/validation.ts
import { z } from 'zod';
import { error } from '@sveltejs/kit';

export const executeSchema = z.object({
  code: z.string().min(1).max(10000),
  runtime: z.enum(['python', 'node']),
  timeout: z.number().optional().default(30000)
});

export const validateExecuteRequest = (body: any) => {
  try {
    return executeSchema.parse(body);
  } catch (err) {
    throw error(400, 'Invalid request data');
  }
};
```

### 4. Resource Management

```typescript
// src/lib/server/sandbox-manager.ts
import { compute } from 'computesdk';

export const withSandbox = async <T>(
  provider: any,
  callback: (sandbox: any) => Promise<T>
): Promise<T> => {
  const sandbox = await compute.sandbox.create({ provider });
  
  try {
    return await callback(sandbox);
  } finally {
    await compute.sandbox.destroy(sandbox.sandboxId);
  }
};
```

### 5. Reusable Components

```svelte
<!-- src/lib/components/CodeExecutor.svelte -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  
  export let initialCode = 'print("Hello World!")';
  export let initialRuntime: 'python' | 'node' = 'python';
  export let disabled = false;
  
  let code = initialCode;
  let runtime = initialRuntime;
  let loading = false;
  
  const dispatch = createEventDispatcher();
  
  async function executeCode() {
    if (!code.trim()) return;
    
    loading = true;
    dispatch('execute-start');
    
    try {
      const response = await fetch('/api/compute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'compute.sandbox.runCode',
          code,
          runtime
        })
      });
      
      const data = await response.json();
      dispatch('execute-complete', data);
    } catch (error) {
      dispatch('execute-error', { error: error.message });
    } finally {
      loading = false;
    }
  }
</script>

<div class="code-executor">
  <div class="mb-4">
    <select bind:value={runtime} class="px-3 py-2 border rounded mr-4" {disabled}>
      <option value="python">Python</option>
      <option value="node">Node.js</option>
    </select>
  </div>
  
  <textarea
    bind:value={code}
    rows="10"
    class="w-full p-4 border rounded font-mono mb-4"
    placeholder="Enter your code here..."
    {disabled}
  />
  
  <button 
    on:click={executeCode} 
    disabled={loading || disabled || !code.trim()}
    class="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
  >
    {loading ? 'Executing...' : 'Execute Code'}
  </button>
</div>
```

## Configuration

### SvelteKit Config

```javascript
// vite.config.js
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  define: {
    // Add any global defines here
  }
});
```

```javascript
// svelte.config.js
import adapter from '@sveltejs/adapter-auto';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),
    csrf: {
      checkOrigin: false  // Only for development
    }
  }
};

export default config;
```

### TypeScript Config

```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "strict": true
  }
}
```

## Deployment

### Environment Variables

Set your environment variables in your deployment platform:

```bash
# Production environment variables
E2B_API_KEY=your_production_e2b_key
VERCEL_TOKEN=your_production_vercel_token
VERCEL_TEAM_ID=your_team_id
VERCEL_PROJECT_ID=your_project_id
DAYTONA_API_KEY=your_production_daytona_key
```

### Docker Deployment

```dockerfile
# Dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json .
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --production

FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/build build/
COPY --from=builder /app/node_modules node_modules/
COPY package.json .
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "build"]
```

## Troubleshooting

**Environment variables not loading?**
- Use `$env/static/private` for server-side variables
- Use `$env/static/public` only for public variables (not API keys)
- Restart dev server after changes to `.env`
- Check that variables are properly exported in deployment platform

**Sandbox creation fails?**
- Verify API keys are correct and have proper format
- Check provider-specific setup requirements
- Monitor rate limits and quotas
- Ensure environment variables are available in server context

**Import errors?**
- ComputeSDK can only be imported in server-side routes (+server.ts files)
- Don't import ComputeSDK in +page.svelte or +layout.svelte files
- Use API routes to bridge between client and ComputeSDK

**Build errors?**
- Ensure all ComputeSDK imports are in server routes only
- Check that environment variables are properly configured
- Verify provider packages are correctly installed

**Form actions not working?**
- Ensure forms have proper method="POST" and action attributes
- Use `use:enhance` for progressive enhancement
- Handle form validation and error states properly

**Stores not updating?**
- Make sure store updates are reactive ($: syntax)
- Use proper store methods (update, set)
- Handle loading and error states in store logic