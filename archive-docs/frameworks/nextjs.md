# Next.js

Use ComputeSDK to execute code in secure sandboxes from your Next.js API routes.

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

Create a `.env.local` file and add your provider credentials:

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

### App Router API Route with Request Handler

The simplest way to use ComputeSDK in Next.js App Router is with the built-in request handler:

```typescript
// app/api/compute/route.ts
import { handleComputeRequest } from 'computesdk';
import { e2b } from '@computesdk/e2b';

export async function POST(request: Request) {
  return handleComputeRequest({
    request,
    provider: e2b({ apiKey: process.env.E2B_API_KEY! })
  });
}
```

### Pages Router API Route

For Pages Router, create an API route:

```typescript
// pages/api/compute.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { handleComputeRequest } from 'computesdk';
import { e2b } from '@computesdk/e2b';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const response = await handleComputeRequest({
    request: req.body,
    provider: e2b({ apiKey: process.env.E2B_API_KEY! })
  });

  return res.status(response.success ? 200 : 500).json(response);
}
```

### Custom API Route (App Router)

For more control, create a custom API route:

```typescript
// app/api/sandbox/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

export async function POST(request: NextRequest) {
  try {
    const { code, runtime } = await request.json();
    
    // Set provider
    compute.setConfig({ 
      provider: e2b({ apiKey: process.env.E2B_API_KEY! }) 
    });
    
    // Create sandbox and execute code
    const sandbox = await compute.sandbox.create();
    const result = await sandbox.runCode(code, runtime);
    
    // Clean up
    await compute.sandbox.destroy(sandbox.sandboxId);
    
    return NextResponse.json({
      success: true,
      stdout: result.stdout,
      stderr: result.stderr,
      executionTime: result.executionTime
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message || 'Unknown error'
    }, { status: 500 });
  }
}
```

### Frontend Integration (App Router)

```tsx
// app/playground/page.tsx
'use client';

import { useState } from 'react';

export default function Playground() {
  const [code, setCode] = useState('print("Hello World!")');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [runtime, setRuntime] = useState<'python' | 'node'>('python');

  const executeCode = async () => {
    setLoading(true);
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
        setOutput(data.result.stdout);
      } else {
        setOutput(`Error: ${data.error}`);
      }
    } catch (error: any) {
      setOutput(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Code Executor</h1>
      
      <div className="mb-4">
        <select 
          value={runtime} 
          onChange={(e) => setRuntime(e.target.value as 'python' | 'node')}
          className="px-3 py-2 border rounded mr-4"
        >
          <option value="python">Python</option>
          <option value="node">Node.js</option>
        </select>
      </div>
      
      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        rows={10}
        className="w-full p-4 border rounded font-mono mb-4"
        placeholder="Enter your code here..."
      />
      
      <button 
        onClick={executeCode} 
        disabled={loading}
        className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
      >
        {loading ? 'Executing...' : 'Execute Code'}
      </button>
      
      {output && (
        <pre className="mt-4 p-4 bg-gray-100 rounded overflow-x-auto">
          {output}
        </pre>
      )}
    </div>
  );
}
```

### Pages Router Component

```tsx
// pages/playground.tsx
import { useState } from 'react';

export default function Playground() {
  const [code, setCode] = useState('print("Hello World!")');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [runtime, setRuntime] = useState<'python' | 'node'>('python');

  const executeCode = async () => {
    setLoading(true);
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
        setOutput(data.result.stdout);
      } else {
        setOutput(`Error: ${data.error}`);
      }
    } catch (error: any) {
      setOutput(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Code Executor</h1>
      
      <div className="mb-4">
        <select 
          value={runtime} 
          onChange={(e) => setRuntime(e.target.value as 'python' | 'node')}
          className="px-3 py-2 border rounded mr-4"
        >
          <option value="python">Python</option>
          <option value="node">Node.js</option>
        </select>
      </div>
      
      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        rows={10}
        className="w-full p-4 border rounded font-mono mb-4"
        placeholder="Enter your code here..."
      />
      
      <button 
        onClick={executeCode} 
        disabled={loading}
        className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
      >
        {loading ? 'Executing...' : 'Execute Code'}
      </button>
      
      {output && (
        <pre className="mt-4 p-4 bg-gray-100 rounded overflow-x-auto">
          {output}
        </pre>
      )}
    </div>
  );
}
```

## Advanced Examples

### Data Analysis API (App Router)

```typescript
// app/api/analyze/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

export async function POST(request: NextRequest) {
  try {
    const { csvData } = await request.json();
    
    compute.setConfig({ 
      provider: e2b({ apiKey: process.env.E2B_API_KEY! }) 
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
    
    return NextResponse.json({
      success: true,
      analysis: JSON.parse(result.stdout)
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
```

### File Upload Processing (App Router)

```typescript
// app/api/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({
        success: false,
        error: 'No file provided'
      }, { status: 400 });
    }
    
    const fileContent = await file.text();
    
    const sandbox = await compute.sandbox.create({
      provider: e2b({ apiKey: process.env.E2B_API_KEY! })
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
    
    return NextResponse.json({
      success: true,
      info: result.stdout
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
```

### Server Actions (App Router)

```tsx
// app/actions/compute.ts
'use server';

import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

export async function executeCode(code: string, runtime: 'python' | 'node') {
  try {
    compute.setConfig({ 
      provider: e2b({ apiKey: process.env.E2B_API_KEY! }) 
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
    return {
      success: false,
      error: error.message || 'Unknown error'
    };
  }
}
```

```tsx
// app/server-action-demo/page.tsx
import { executeCode } from '../actions/compute';

export default function ServerActionDemo() {
  async function handleSubmit(formData: FormData) {
    'use server';
    
    const code = formData.get('code') as string;
    const runtime = formData.get('runtime') as 'python' | 'node';
    
    const result = await executeCode(code, runtime);
    
    // Handle result (redirect, revalidate, etc.)
    console.log(result);
  }

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Server Action Demo</h1>
      
      <form action={handleSubmit} className="space-y-4">
        <div>
          <select name="runtime" className="px-3 py-2 border rounded">
            <option value="python">Python</option>
            <option value="node">Node.js</option>
          </select>
        </div>
        
        <textarea
          name="code"
          rows={10}
          className="w-full p-4 border rounded font-mono"
          placeholder="Enter your code here..."
          defaultValue='print("Hello World!")'
        />
        
        <button 
          type="submit"
          className="px-4 py-2 bg-blue-500 text-white rounded"
        >
          Execute Code
        </button>
      </form>
    </div>
  );
}
```

### Multi-Provider Support

```typescript
// app/api/multi-provider/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { vercel } from '@computesdk/vercel';
import { daytona } from '@computesdk/daytona';

export async function POST(request: NextRequest) {
  try {
    const { provider: providerName, code, runtime } = await request.json();
    
    let provider;
    switch (providerName) {
      case 'e2b':
        provider = e2b({ apiKey: process.env.E2B_API_KEY! });
        break;
      case 'vercel':
        provider = vercel({ token: process.env.VERCEL_TOKEN! });
        break;
      case 'daytona':
        provider = daytona({ apiKey: process.env.DAYTONA_API_KEY! });
        break;
      default:
        return NextResponse.json({
          success: false,
          error: 'Invalid provider specified'
        }, { status: 400 });
    }
    
    const sandbox = await compute.sandbox.create({ provider });
    
    try {
      const result = await sandbox.runCode(code, runtime);
      return NextResponse.json({
        success: true,
        provider: providerName,
        result: result.stdout
      });
    } finally {
      await compute.sandbox.destroy(sandbox.sandboxId);
    }
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
```

### Streaming Results

```typescript
// app/api/stream/route.ts
import { NextRequest } from 'next/server';
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

export async function POST(request: NextRequest) {
  const { code } = await request.json();
  
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const sandbox = await compute.sandbox.create({
          provider: e2b({ apiKey: process.env.E2B_API_KEY! })
        });
        
        controller.enqueue('Starting execution...\n');
        
        const result = await sandbox.runCode(code);
        
        controller.enqueue(`Output: ${result.stdout}\n`);
        controller.enqueue(`Execution time: ${result.executionTime}ms\n`);
        
        await compute.sandbox.destroy(sandbox.sandboxId);
        controller.enqueue('Execution completed.\n');
        
        controller.close();
      } catch (error: any) {
        controller.enqueue(`Error: ${error.message}\n`);
        controller.close();
      }
    }
  });
  
  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain' }
  });
}
```

## Best Practices

### 1. Environment Variables

```typescript
// lib/env.ts
import { e2b } from '@computesdk/e2b';
import { vercel } from '@computesdk/vercel';
import { daytona } from '@computesdk/daytona';

export const getProvider = () => {
  if (process.env.E2B_API_KEY) {
    return e2b({ apiKey: process.env.E2B_API_KEY });
  }
  if (process.env.VERCEL_TOKEN) {
    return vercel({ 
      token: process.env.VERCEL_TOKEN,
      teamId: process.env.VERCEL_TEAM_ID,
      projectId: process.env.VERCEL_PROJECT_ID
    });
  }
  if (process.env.DAYTONA_API_KEY) {
    return daytona({ apiKey: process.env.DAYTONA_API_KEY });
  }
  throw new Error('No compute provider configured');
};
```

### 2. Error Handling

```typescript
// lib/error-handler.ts
import { NextResponse } from 'next/server';

export const handleComputeError = (error: any) => {
  console.error('Sandbox error:', error);
  
  // Don't expose sensitive error details in production
  const message = process.env.NODE_ENV === 'development' ? error.message : 'Internal server error';
  
  return NextResponse.json({
    success: false,
    error: message
  }, { status: 500 });
};
```

### 3. Input Validation

```typescript
// lib/validation.ts
import { z } from 'zod';

export const executeSchema = z.object({
  code: z.string().min(1).max(10000),
  runtime: z.enum(['python', 'node']),
  timeout: z.number().optional().default(30000)
});

export const validateRequest = async (request: Request) => {
  try {
    const body = await request.json();
    return executeSchema.parse(body);
  } catch (error) {
    throw new Error('Invalid request data');
  }
};
```

### 4. Resource Management

```typescript
// lib/sandbox-manager.ts
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

### 5. Custom Hook for Client-Side

```typescript
// hooks/useCompute.ts
import { useState, useCallback } from 'react';

interface ExecuteOptions {
  code: string;
  runtime: 'python' | 'node';
}

export const useCompute = () => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async ({ code, runtime }: ExecuteOptions) => {
    setLoading(true);
    setError(null);
    
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
        setResult(data.result);
      } else {
        setError(data.error);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { execute, loading, result, error };
};
```

## Configuration

### Next.js Config

```javascript
// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['computesdk']
  }
};

module.exports = nextConfig;
```

### TypeScript Config

```json
{
  "compilerOptions": {
    "target": "es5",
    "lib": ["dom", "dom.iterable", "es6"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
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

### Vercel Deployment

```json
// vercel.json
{
  "functions": {
    "app/api/**/*.ts": {
      "maxDuration": 300
    }
  }
}
```

### Docker Deployment

```dockerfile
# Dockerfile
FROM node:18-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:18-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
ENV PORT 3000

CMD ["node", "server.js"]
```

## Troubleshooting

**Environment variables not loading?**
- Use `.env.local` for local development
- Restart dev server after changes
- Access with `process.env` in API routes and Server Components
- Use `NEXT_PUBLIC_` prefix only for client-side variables (not for API keys)

**Sandbox creation fails?**
- Verify API keys are correct and have proper format
- Check provider-specific setup requirements
- Monitor rate limits and quotas

**Import errors?**
- ComputeSDK can only be imported in API routes and Server Components
- Don't import ComputeSDK in client-side components
- Use API routes to bridge between client and ComputeSDK

**Build errors?**
- Add ComputeSDK to `serverComponentsExternalPackages` in `next.config.js`
- Ensure all ComputeSDK imports are server-side only
- Check that environment variables are properly configured

**App Router vs Pages Router?**
- App Router: Use `app/api/*/route.ts` files
- Pages Router: Use `pages/api/*.ts` files  
- Server Actions only work in App Router
- Choose based on your Next.js version and preferences