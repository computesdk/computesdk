# Nuxt

Use ComputeSDK to execute code in secure sandboxes from your Nuxt server API routes.

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

Navigate to [http://localhost:3000](http://localhost:3000)

## Implementation

### Server API Route with Request Handler

The simplest way to use ComputeSDK in Nuxt is with the built-in request handler:

```typescript
// server/api/compute.post.ts
import { handleComputeRequest } from 'computesdk';
import { e2b } from '@computesdk/e2b';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  
  const response = await handleComputeRequest({
    request: body,
    provider: e2b({ apiKey: useRuntimeConfig().e2bApiKey })
  });

  if (!response.success) {
    throw createError({
      statusCode: 500,
      statusMessage: response.error
    });
  }

  return response;
});
```

### Custom Server API Route

For more control, create a custom server API route:

```typescript
// server/api/sandbox.post.ts
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

export default defineEventHandler(async (event) => {
  try {
    const { code, runtime } = await readBody(event);
    
    // Set provider
    compute.setConfig({ 
      provider: e2b({ apiKey: useRuntimeConfig().e2bApiKey }) 
    });
    
    // Create sandbox and execute code
    const sandbox = await compute.sandbox.create();
    const result = await sandbox.runCode(code, runtime);
    
    // Clean up
    await compute.sandbox.destroy(sandbox.sandboxId);
    
    return {
      success: true,
      stdout: result.stdout,
      stderr: result.stderr,
      executionTime: result.executionTime
    };
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Unknown error'
    });
  }
});
```

### Frontend Integration

Call your API from Nuxt components:

```vue
// pages/playground.vue
<template>
  <div class="container mx-auto p-8">
    <h1 class="text-3xl font-bold mb-6">Code Executor</h1>
    
    <div class="mb-4">
      <select 
        v-model="runtime"
        class="px-3 py-2 border rounded mr-4"
      >
        <option value="python">Python</option>
        <option value="node">Node.js</option>
      </select>
    </div>
    
    <textarea
      v-model="code"
      rows="10"
      class="w-full p-4 border rounded font-mono mb-4"
      placeholder="Enter your code here..."
    />
    
    <button 
      @click="executeCode" 
      :disabled="loading"
      class="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
    >
      {{ loading ? 'Executing...' : 'Execute Code' }}
    </button>
    
    <pre 
      v-if="output" 
      class="mt-4 p-4 bg-gray-100 rounded overflow-x-auto"
    >{{ output }}</pre>
  </div>
</template>

<script setup>
const code = ref('print("Hello World!")');
const output = ref('');
const loading = ref(false);
const runtime = ref('python');

const executeCode = async () => {
  loading.value = true;
  try {
    const { data } = await $fetch('/api/compute', {
      method: 'POST',
      body: {
        action: 'compute.sandbox.runCode',
        code: code.value,
        runtime: runtime.value
      }
    });
    
    if (data.success) {
      output.value = data.result.stdout;
    } else {
      output.value = `Error: ${data.error}`;
    }
  } catch (error) {
    output.value = `Error: ${error.message}`;
  } finally {
    loading.value = false;
  }
};
</script>
```

### Using Composables

Create a composable for reusable functionality:

```typescript
// composables/useCompute.ts
export const useCompute = () => {
  const loading = ref(false);
  const result = ref(null);
  const error = ref(null);

  const execute = async (code: string, runtime: 'python' | 'node' = 'python') => {
    loading.value = true;
    error.value = null;
    
    try {
      const response = await $fetch('/api/compute', {
        method: 'POST',
        body: {
          action: 'compute.sandbox.runCode',
          code,
          runtime
        }
      });
      
      if (response.success) {
        result.value = response.result;
      } else {
        error.value = response.error;
      }
    } catch (err: any) {
      error.value = err.message;
    } finally {
      loading.value = false;
    }
  };

  return {
    execute,
    loading: readonly(loading),
    result: readonly(result),
    error: readonly(error)
  };
};
```

```vue
<!-- pages/composable-demo.vue -->
<template>
  <div class="container mx-auto p-8">
    <h1 class="text-3xl font-bold mb-6">Composable Demo</h1>
    
    <textarea
      v-model="code"
      rows="8"
      class="w-full p-4 border rounded font-mono mb-4"
    />
    
    <button 
      @click="compute.execute(code, 'python')" 
      :disabled="compute.loading.value"
      class="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
    >
      Execute Python Code
    </button>
    
    <div v-if="compute.loading.value" class="mt-4">
      Executing...
    </div>
    
    <pre v-if="compute.result.value" class="mt-4 p-4 bg-gray-100 rounded">
{{ compute.result.value.stdout }}
    </pre>
    
    <div v-if="compute.error.value" class="mt-4 p-4 bg-red-100 text-red-700 rounded">
      Error: {{ compute.error.value }}
    </div>
  </div>
</template>

<script setup lang="ts">
const code = ref('print("Hello from composable!");')
const compute = useCompute()
</script>
```

## Advanced Examples

### Data Analysis API

```typescript
// server/api/analyze.post.ts
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

export default defineEventHandler(async (event) => {
  try {
    const { csvData } = await readBody(event);
    
    compute.setConfig({ 
      provider: e2b({ apiKey: useRuntimeConfig().e2bApiKey }) 
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
    
    return {
      success: true,
      analysis: JSON.parse(result.stdout)
    };
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    });
  }
});
```

### File Upload Processing

```typescript
// server/api/upload.post.ts
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

export default defineEventHandler(async (event) => {
  try {
    const form = await readMultipartFormData(event);
    const file = form?.find(item => item.name === 'file');
    
    if (!file) {
      throw createError({
        statusCode: 400,
        statusMessage: 'No file provided'
      });
    }
    
    const fileContent = file.data.toString();
    const filename = file.filename || 'uploaded_file';
    
    const sandbox = await compute.sandbox.create({
      provider: e2b({ apiKey: useRuntimeConfig().e2bApiKey })
    });
    
    // Save uploaded file
    await sandbox.filesystem.writeFile(`/uploads/${filename}`, fileContent);
    
    // Process file
    const result = await sandbox.runCode(`
import os

# Get file info
file_path = '/uploads/${filename}'
file_size = os.path.getsize(file_path)

with open(file_path, 'r') as f:
    content = f.read()
    lines = len(content.split('\\n'))
    chars = len(content)

print(f"File: ${filename}")
print(f"Size: {file_size} bytes")
print(f"Lines: {lines}")
print(f"Characters: {chars}")
    `);
    
    await compute.sandbox.destroy(sandbox.sandboxId);
    
    return {
      success: true,
      info: result.stdout
    };
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    });
  }
});
```

### Multi-Provider Support

```typescript
// server/api/multi-provider.post.ts
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { vercel } from '@computesdk/vercel';
import { daytona } from '@computesdk/daytona';

export default defineEventHandler(async (event) => {
  try {
    const { provider: providerName, code, runtime } = await readBody(event);
    const config = useRuntimeConfig();
    
    let provider;
    switch (providerName) {
      case 'e2b':
        provider = e2b({ apiKey: config.e2bApiKey });
        break;
      case 'vercel':
        provider = vercel({ token: config.vercelToken });
        break;
      case 'daytona':
        provider = daytona({ apiKey: config.daytonaApiKey });
        break;
      default:
        throw createError({
          statusCode: 400,
          statusMessage: 'Invalid provider specified'
        });
    }
    
    const sandbox = await compute.sandbox.create({ provider });
    
    try {
      const result = await sandbox.runCode(code, runtime);
      return {
        success: true,
        provider: providerName,
        result: result.stdout
      };
    } finally {
      await compute.sandbox.destroy(sandbox.sandboxId);
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    });
  }
});
```

### Workflow API with Steps

```typescript
// server/api/workflow.post.ts
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

export default defineEventHandler(async (event) => {
  const sandbox = await compute.sandbox.create({
    provider: e2b({ apiKey: useRuntimeConfig().e2bApiKey })
  });
  
  try {
    const steps: any[] = [];
    
    // Step 1: Setup environment
    await sandbox.filesystem.mkdir('/workspace');
    const setupResult = await sandbox.runCommand('pip', ['install', 'requests', 'beautifulsoup4']);
    steps.push({ step: 1, action: 'setup', output: setupResult.stdout });
    
    // Step 2: Fetch data
    const fetchResult = await sandbox.runCode(`
import requests
import json

# Simulate data fetch
data = {"message": "Hello World", "timestamp": "2024-01-01"}

# Save to file
with open('/workspace/data.json', 'w') as f:
    json.dump(data, f)
    
print("Data fetched and saved")
    `);
    steps.push({ step: 2, action: 'fetch', output: fetchResult.stdout });
    
    // Step 3: Process data
    const processResult = await sandbox.runCode(`
import json

with open('/workspace/data.json', 'r') as f:
    data = json.load(f)

# Process data
result = {
    'original': data,
    'processed': data['message'].upper(),
    'length': len(data['message'])
}

print(json.dumps(result))
    `);
    steps.push({ 
      step: 3, 
      action: 'process', 
      result: JSON.parse(processResult.stdout) 
    });
    
    return {
      success: true,
      steps
    };
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    });
  } finally {
    await compute.sandbox.destroy(sandbox.sandboxId);
  }
});
```

### Real-time Code Execution with SSE

```typescript
// server/api/stream.post.ts
export default defineEventHandler(async (event) => {
  const { code } = await readBody(event);
  
  setHeader(event, 'Content-Type', 'text/event-stream');
  setHeader(event, 'Cache-Control', 'no-cache');
  setHeader(event, 'Connection', 'keep-alive');
  
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      
      try {
        controller.enqueue(encoder.encode('data: Starting execution...\n\n'));
        
        const sandbox = await compute.sandbox.create({
          provider: e2b({ apiKey: useRuntimeConfig().e2bApiKey })
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
  
  return stream;
});
```

## Best Practices

### 1. Runtime Configuration

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  runtimeConfig: {
    // Private keys (only available on server-side)
    e2bApiKey: process.env.E2B_API_KEY,
    vercelToken: process.env.VERCEL_TOKEN,
    vercelTeamId: process.env.VERCEL_TEAM_ID,
    vercelProjectId: process.env.VERCEL_PROJECT_ID,
    daytonaApiKey: process.env.DAYTONA_API_KEY,
    
    // Public keys (exposed to client-side)
    public: {
      // Only put non-sensitive config here
    }
  }
});
```

### 2. Error Handling Utility

```typescript
// server/utils/error-handler.ts
export const handleComputeError = (error: any) => {
  console.error('Sandbox error:', error);
  
  // Don't expose sensitive error details in production
  const message = process.env.NODE_ENV === 'development' ? error.message : 'Internal server error';
  
  throw createError({
    statusCode: 500,
    statusMessage: message
  });
};
```

### 3. Input Validation

```typescript
// server/utils/validation.ts
import { z } from 'zod';

export const executeSchema = z.object({
  code: z.string().min(1).max(10000),
  runtime: z.enum(['python', 'node']),
  timeout: z.number().optional().default(30000)
});

export const validateExecuteRequest = (body: any) => {
  try {
    return executeSchema.parse(body);
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request data'
    });
  }
};
```

### 4. Provider Factory

```typescript
// server/utils/providers.ts
import { e2b } from '@computesdk/e2b';
import { vercel } from '@computesdk/vercel';
import { daytona } from '@computesdk/daytona';

export const getProvider = (providerName?: string) => {
  const config = useRuntimeConfig();
  
  const provider = providerName || 'e2b';
  
  switch (provider) {
    case 'e2b':
      if (!config.e2bApiKey) throw createError({ statusCode: 500, statusMessage: 'E2B API key not configured' });
      return e2b({ apiKey: config.e2bApiKey });
      
    case 'vercel':
      if (!config.vercelToken) throw createError({ statusCode: 500, statusMessage: 'Vercel token not configured' });
      return vercel({ 
        token: config.vercelToken,
        teamId: config.vercelTeamId,
        projectId: config.vercelProjectId
      });
      
    case 'daytona':
      if (!config.daytonaApiKey) throw createError({ statusCode: 500, statusMessage: 'Daytona API key not configured' });
      return daytona({ apiKey: config.daytonaApiKey });
      
    default:
      throw createError({ statusCode: 400, statusMessage: 'Invalid provider specified' });
  }
};
```

### 5. Resource Management Composable

```typescript
// server/utils/sandbox-manager.ts
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

### 6. Frontend Error Handling

```vue
<!-- components/ErrorBoundary.vue -->
<template>
  <div>
    <slot v-if="!error" />
    <div v-else class="error-container p-4 bg-red-100 text-red-700 rounded">
      <h3 class="font-bold mb-2">An error occurred:</h3>
      <p>{{ error }}</p>
      <button 
        @click="retry" 
        class="mt-2 px-3 py-1 bg-red-500 text-white rounded text-sm"
      >
        Retry
      </button>
    </div>
  </div>
</template>

<script setup>
const error = ref(null);

const retry = () => {
  error.value = null;
  emit('retry');
};

const emit = defineEmits(['retry']);

defineExpose({ setError: (err: any) => error.value = err.message });
</script>
```

## Configuration

### Nuxt Config

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  runtimeConfig: {
    e2bApiKey: process.env.E2B_API_KEY,
    vercelToken: process.env.VERCEL_TOKEN,
    vercelTeamId: process.env.VERCEL_TEAM_ID,
    vercelProjectId: process.env.VERCEL_PROJECT_ID,
    daytonaApiKey: process.env.DAYTONA_API_KEY,
    public: {}
  },
  
  nitro: {
    experimental: {
      wasm: true
    }
  },
  
  css: ['~/assets/css/main.css'],
  
  modules: [
    '@nuxtjs/tailwindcss'
  ]
});
```

### TypeScript Config

```json
{
  "extends": "./.nuxt/tsconfig.json"
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
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Build application
RUN npm run build

# Expose port
EXPOSE 3000

# Start application
CMD ["npm", "start"]
```

### Vercel Deployment

```json
{
  "functions": {
    "server/api/**": {
      "maxDuration": 300
    }
  }
}
```

## Troubleshooting

**Environment variables not loading?**
- Use `useRuntimeConfig()` to access variables in server API routes
- Private variables should not be prefixed with `NUXT_PUBLIC_`
- Restart dev server after changes to `.env`
- Use `runtimeConfig` in `nuxt.config.ts` to define variables

**Sandbox creation fails?**
- Verify API keys are correct and have proper format
- Check provider-specific setup requirements
- Monitor rate limits and quotas
- Check server logs for detailed error messages

**Import errors on client-side?**
- ComputeSDK can only be imported in server API routes
- Don't import ComputeSDK in pages, components, or composables that run on client
- Use server API routes to bridge between client and ComputeSDK

**Build errors?**
- Ensure all ComputeSDK imports are in server API routes only
- Check that runtime configuration is properly set up
- Verify provider packages are correctly installed

**SSR/Hydration issues?**
- ComputeSDK operations should happen in server API routes only
- Use `$fetch` or `useFetch` to call APIs from client-side
- Avoid trying to use ComputeSDK in universal code

**Development vs Production differences?**
- Ensure environment variables are set in both environments
- Check that API routes work correctly in production build
- Test with `npm run build && npm run preview` locally before deploying