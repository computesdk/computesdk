# Remix

Use ComputeSDK to execute code in secure sandboxes from your Remix action and loader functions.

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

### Resource Route with Request Handler

The simplest way to use ComputeSDK in Remix is with the built-in request handler:

```typescript
// app/routes/api.compute.tsx
import { handleComputeRequest } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import type { ActionFunctionArgs } from '@remix-run/node';

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    throw new Response('Method Not Allowed', { status: 405 });
  }

  const body = await request.json();
  
  const response = await handleComputeRequest({
    request: body,
    provider: e2b({ apiKey: process.env.E2B_API_KEY! })
  });

  return Response.json(response, {
    status: response.success ? 200 : 500
  });
}
```

### Custom Resource Route

For more control, create a custom resource route:

```typescript
// app/routes/api.sandbox.tsx
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';

export async function action({ request }: ActionFunctionArgs) {
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
    
    return json({
      success: true,
      stdout: result.stdout,
      stderr: result.stderr,
      executionTime: result.executionTime
    });
  } catch (error: any) {
    return json({
      success: false,
      error: error.message || 'Unknown error'
    }, { status: 500 });
  }
}
```

### Frontend Integration with Actions

Use Remix actions for form-based interactions:

```typescript
// app/routes/playground.tsx
import { useState } from 'react';
import { Form, useActionData, useNavigation } from '@remix-run/react';
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const code = formData.get('code') as string;
  const runtime = formData.get('runtime') as 'python' | 'node';
  
  if (!code) {
    return json({ error: 'Code is required' }, { status: 400 });
  }
  
  try {
    compute.setConfig({ 
      provider: e2b({ apiKey: process.env.E2B_API_KEY! }) 
    });
    
    const sandbox = await compute.sandbox.create();
    const result = await sandbox.runCode(code, runtime);
    
    await compute.sandbox.destroy(sandbox.sandboxId);
    
    return json({
      success: true,
      stdout: result.stdout,
      stderr: result.stderr,
      executionTime: result.executionTime
    });
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
}

export default function Playground() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isExecuting = navigation.state === 'submitting';

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Code Executor</h1>
      
      <Form method="post" className="space-y-4">
        <div>
          <select 
            name="runtime" 
            defaultValue="python"
            className="px-3 py-2 border rounded"
          >
            <option value="python">Python</option>
            <option value="node">Node.js</option>
          </select>
        </div>
        
        <textarea
          name="code"
          rows={10}
          className="w-full p-4 border rounded font-mono"
          placeholder="Enter your code here..."
          defaultValue="print('Hello World!')"
        />
        
        <button 
          type="submit" 
          disabled={isExecuting}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
        >
          {isExecuting ? 'Executing...' : 'Execute Code'}
        </button>
      </Form>
      
      {actionData?.success && (
        <pre className="mt-4 p-4 bg-gray-100 rounded overflow-x-auto">
          {actionData.stdout}
        </pre>
      )}
      
      {actionData?.error && (
        <div className="mt-4 p-4 bg-red-100 text-red-700 rounded">
          Error: {actionData.error}
        </div>
      )}
    </div>
  );
}
```

### Using Loaders for Server-Side Data

```typescript
// app/routes/data-demo.tsx
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { useLoaderData } from '@remix-run/react';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';

export async function loader({}: LoaderFunctionArgs) {
  try {
    compute.setConfig({ 
      provider: e2b({ apiKey: process.env.E2B_API_KEY! }) 
    });
    
    const sandbox = await compute.sandbox.create();
    
    // Generate data on the server
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
    
    return json({
      data: JSON.parse(result.stdout),
      success: true
    });
  } catch (error: any) {
    return json({
      data: [],
      error: error.message,
      success: false
    });
  }
}

export default function DataDemo() {
  const { data, error, success } = useLoaderData<typeof loader>();

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Server-Side Data Demo</h1>
      
      {error && (
        <div className="p-4 bg-red-100 text-red-700 rounded mb-4">
          Error: {error}
        </div>
      )}
      
      {success && (
        <div className="grid gap-4">
          {data.map((item: any) => (
            <div key={item.id} className="p-4 border rounded">
              <h3 className="font-bold">{item.name}</h3>
              <p>ID: {item.id}</p>
              <p>Value: ${item.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Fetcher for Client-Side Interactions

```typescript
// app/routes/fetcher-demo.tsx
import { useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';

export async function action({ request }: ActionFunctionArgs) {
  const { code, runtime } = await request.json();
  
  try {
    compute.setConfig({ 
      provider: e2b({ apiKey: process.env.E2B_API_KEY! }) 
    });
    
    const sandbox = await compute.sandbox.create();
    const result = await sandbox.runCode(code, runtime);
    
    await compute.sandbox.destroy(sandbox.sandboxId);
    
    return json({
      success: true,
      stdout: result.stdout
    });
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
}

export default function FetcherDemo() {
  const [code, setCode] = useState('print("Hello World!")');
  const [runtime, setRuntime] = useState<'python' | 'node'>('python');
  const fetcher = useFetcher<typeof action>();

  const executeCode = () => {
    fetcher.submit(
      { code, runtime },
      { 
        method: 'POST',
        encType: 'application/json'
      }
    );
  };

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Fetcher Demo</h1>
      
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
        disabled={fetcher.state === 'submitting'}
        className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
      >
        {fetcher.state === 'submitting' ? 'Executing...' : 'Execute Code'}
      </button>
      
      {fetcher.data?.success && (
        <pre className="mt-4 p-4 bg-gray-100 rounded overflow-x-auto">
          {fetcher.data.stdout}
        </pre>
      )}
      
      {fetcher.data?.error && (
        <div className="mt-4 p-4 bg-red-100 text-red-700 rounded">
          Error: {fetcher.data.error}
        </div>
      )}
    </div>
  );
}
```

## Advanced Examples

### Data Analysis with File Upload

```typescript
// app/routes/analyze.tsx
import { useState } from 'react';
import { Form, useActionData, useNavigation } from '@remix-run/react';
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import type { ActionFunctionArgs } from '@remix-run/node';
import { json, unstable_createFileUploadHandler, unstable_parseMultipartFormData } from '@remix-run/node';

export async function action({ request }: ActionFunctionArgs) {
  try {
    const formData = await unstable_parseMultipartFormData(
      request,
      unstable_createFileUploadHandler({ maxPartSize: 5_000_000 })
    );
    
    const file = formData.get('csvFile') as File;
    
    if (!file || file.size === 0) {
      return json({ error: 'Please upload a CSV file' }, { status: 400 });
    }
    
    const csvData = await file.text();
    
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

try:
    # Read and analyze data
    df = pd.read_csv('/data/input.csv')
    analysis = {
        'rows': len(df),
        'columns': len(df.columns),
        'column_names': df.columns.tolist(),
        'summary': df.describe().to_dict() if len(df.select_dtypes(include='number').columns) > 0 else {},
        'missing_values': df.isnull().sum().to_dict(),
        'data_types': df.dtypes.astype(str).to_dict()
    }
    
    print(json.dumps(analysis, indent=2))
except Exception as e:
    print(json.dumps({'error': str(e)}))
    `);
    
    await compute.sandbox.destroy(sandbox.sandboxId);
    
    const analysisResult = JSON.parse(result.stdout);
    
    if (analysisResult.error) {
      return json({ error: analysisResult.error }, { status: 400 });
    }
    
    return json({
      success: true,
      analysis: analysisResult,
      filename: file.name
    });
    
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
}

export default function Analyze() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isAnalyzing = navigation.state === 'submitting';

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">CSV Data Analysis</h1>
      
      <Form method="post" encType="multipart/form-data" className="mb-6">
        <div className="space-y-4">
          <div>
            <label htmlFor="csvFile" className="block mb-2 font-medium">
              Upload CSV File:
            </label>
            <input
              type="file"
              id="csvFile"
              name="csvFile"
              accept=".csv"
              required
              className="border rounded px-3 py-2"
            />
          </div>
          
          <button 
            type="submit" 
            disabled={isAnalyzing}
            className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
          >
            {isAnalyzing ? 'Analyzing...' : 'Analyze Data'}
          </button>
        </div>
      </Form>
      
      {actionData?.success && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold">Analysis Results for {actionData.filename}</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-blue-100 rounded">
              <h3 className="font-bold">Rows</h3>
              <p className="text-2xl">{actionData.analysis.rows}</p>
            </div>
            <div className="p-4 bg-green-100 rounded">
              <h3 className="font-bold">Columns</h3>
              <p className="text-2xl">{actionData.analysis.columns}</p>
            </div>
            <div className="p-4 bg-yellow-100 rounded">
              <h3 className="font-bold">Missing Values</h3>
              <p className="text-2xl">
                {Object.values(actionData.analysis.missing_values).reduce((sum: number, val: any) => sum + val, 0)}
              </p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h3 className="text-lg font-bold mb-2">Column Names</h3>
              <ul className="space-y-1">
                {actionData.analysis.column_names.map((name: string) => (
                  <li key={name} className="px-2 py-1 bg-gray-100 rounded text-sm">
                    {name}
                  </li>
                ))}
              </ul>
            </div>
            
            <div>
              <h3 className="text-lg font-bold mb-2">Data Types</h3>
              <ul className="space-y-1">
                {Object.entries(actionData.analysis.data_types).map(([column, type]) => (
                  <li key={column} className="px-2 py-1 bg-gray-100 rounded text-sm">
                    <span className="font-mono">{column}</span>: {type}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
      
      {actionData?.error && (
        <div className="p-4 bg-red-100 text-red-700 rounded">
          Error: {actionData.error}
        </div>
      )}
    </div>
  );
}
```

### Multi-Provider Support

```typescript
// app/routes/multi-provider.tsx
import { useState } from 'react';
import { Form, useActionData, useNavigation } from '@remix-run/react';
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { vercel } from '@computesdk/vercel';
import { daytona } from '@computesdk/daytona';
import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const providerName = formData.get('provider') as string;
  const code = formData.get('code') as string;
  const runtime = formData.get('runtime') as 'python' | 'node';
  
  try {
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
        return json({ error: 'Invalid provider specified' }, { status: 400 });
    }
    
    const sandbox = await compute.sandbox.create({ provider });
    
    try {
      const result = await sandbox.runCode(code, runtime);
      return json({
        success: true,
        provider: providerName,
        result: result.stdout,
        executionTime: result.executionTime
      });
    } finally {
      await compute.sandbox.destroy(sandbox.sandboxId);
    }
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
}

export default function MultiProvider() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isExecuting = navigation.state === 'submitting';

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Multi-Provider Demo</h1>
      
      <Form method="post" className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="provider" className="block mb-2 font-medium">
              Provider:
            </label>
            <select 
              name="provider" 
              id="provider"
              defaultValue="e2b"
              className="w-full px-3 py-2 border rounded"
            >
              <option value="e2b">E2B (Full dev environment)</option>
              <option value="vercel">Vercel (Serverless)</option>
              <option value="daytona">Daytona (Workspaces)</option>
            </select>
          </div>
          
          <div>
            <label htmlFor="runtime" className="block mb-2 font-medium">
              Runtime:
            </label>
            <select 
              name="runtime" 
              id="runtime"
              defaultValue="python"
              className="w-full px-3 py-2 border rounded"
            >
              <option value="python">Python</option>
              <option value="node">Node.js</option>
            </select>
          </div>
        </div>
        
        <div>
          <label htmlFor="code" className="block mb-2 font-medium">
            Code:
          </label>
          <textarea
            name="code"
            id="code"
            rows={10}
            className="w-full p-4 border rounded font-mono"
            placeholder="Enter your code here..."
            defaultValue="print('Hello from multiple providers!')"
          />
        </div>
        
        <button 
          type="submit" 
          disabled={isExecuting}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
        >
          {isExecuting ? 'Executing...' : 'Execute Code'}
        </button>
      </Form>
      
      {actionData?.success && (
        <div className="mt-6 p-4 border rounded">
          <div className="mb-2 text-sm text-gray-600">
            Executed on <strong>{actionData.provider}</strong> in {actionData.executionTime}ms
          </div>
          <pre className="bg-gray-100 p-4 rounded overflow-x-auto">
            {actionData.result}
          </pre>
        </div>
      )}
      
      {actionData?.error && (
        <div className="mt-6 p-4 bg-red-100 text-red-700 rounded">
          Error: {actionData.error}
        </div>
      )}
    </div>
  );
}
```

### Real-time Execution with EventSource

```typescript
// app/routes/api.stream.tsx
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import type { LoaderFunctionArgs } from '@remix-run/node';

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  
  if (!code) {
    return new Response('Code parameter is required', { status: 400 });
  }
  
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      
      try {
        controller.enqueue(encoder.encode('data: {"type":"start","message":"Starting execution..."}\n\n'));
        
        const sandbox = await compute.sandbox.create({
          provider: e2b({ apiKey: process.env.E2B_API_KEY! })
        });
        
        controller.enqueue(encoder.encode('data: {"type":"progress","message":"Sandbox created"}\n\n'));
        
        const result = await sandbox.runCode(code);
        
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'result',
          stdout: result.stdout,
          stderr: result.stderr,
          executionTime: result.executionTime
        })}\n\n`));
        
        await compute.sandbox.destroy(sandbox.sandboxId);
        controller.enqueue(encoder.encode('data: {"type":"complete","message":"Execution completed"}\n\n'));
        
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

```typescript
// app/routes/stream-demo.tsx
import { useState, useEffect, useRef } from 'react';

export default function StreamDemo() {
  const [code, setCode] = useState('print("Hello Stream!")');
  const [output, setOutput] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const executeCode = () => {
    if (isStreaming) return;
    
    setIsStreaming(true);
    setOutput([]);
    
    const eventSource = new EventSource(`/api/stream?code=${encodeURIComponent(code)}`);
    eventSourceRef.current = eventSource;
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      setOutput(prev => [...prev, `[${data.type}] ${data.message || data.stdout || JSON.stringify(data)}`]);
      
      if (data.type === 'complete' || data.type === 'error') {
        eventSource.close();
        setIsStreaming(false);
      }
    };
    
    eventSource.onerror = () => {
      eventSource.close();
      setIsStreaming(false);
      setOutput(prev => [...prev, '[error] Connection failed']);
    };
  };

  const stopExecution = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      setIsStreaming(false);
      setOutput(prev => [...prev, '[info] Execution stopped by user']);
    }
  };

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Real-time Execution</h1>
      
      <div className="space-y-4">
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          rows={6}
          className="w-full p-4 border rounded font-mono"
          disabled={isStreaming}
        />
        
        <div className="flex gap-2">
          <button 
            onClick={executeCode} 
            disabled={isStreaming}
            className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
          >
            {isStreaming ? 'Executing...' : 'Execute Code'}
          </button>
          
          {isStreaming && (
            <button 
              onClick={stopExecution}
              className="px-4 py-2 bg-red-500 text-white rounded"
            >
              Stop
            </button>
          )}
        </div>
        
        {output.length > 0 && (
          <div className="border rounded">
            <div className="bg-gray-50 px-4 py-2 border-b font-medium">
              Execution Log
            </div>
            <div className="p-4 bg-black text-green-400 font-mono text-sm max-h-64 overflow-y-auto">
              {output.map((line, index) => (
                <div key={index}>{line}</div>
              ))}
              {isStreaming && <div className="animate-pulse">▊</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

## Best Practices

### 1. Environment Variable Management

```typescript
// app/lib/env.server.ts
import { e2b } from '@computesdk/e2b';
import { vercel } from '@computesdk/vercel';
import { daytona } from '@computesdk/daytona';

export const getProvider = (providerName?: string) => {
  const provider = providerName || 'e2b';
  
  switch (provider) {
    case 'e2b':
      if (!process.env.E2B_API_KEY) throw new Error('E2B API key not configured');
      return e2b({ apiKey: process.env.E2B_API_KEY });
      
    case 'vercel':
      if (!process.env.VERCEL_TOKEN) throw new Error('Vercel token not configured');
      return vercel({ 
        token: process.env.VERCEL_TOKEN,
        teamId: process.env.VERCEL_TEAM_ID,
        projectId: process.env.VERCEL_PROJECT_ID
      });
      
    case 'daytona':
      if (!process.env.DAYTONA_API_KEY) throw new Error('Daytona API key not configured');
      return daytona({ apiKey: process.env.DAYTONA_API_KEY });
      
    default:
      throw new Error('Invalid provider specified');
  }
};
```

### 2. Error Handling

```typescript
// app/lib/error-handler.server.ts
import { json } from '@remix-run/node';

export const handleComputeError = (error: any) => {
  console.error('Sandbox error:', error);
  
  // Don't expose sensitive error details in production
  const message = process.env.NODE_ENV === 'development' ? error.message : 'Internal server error';
  
  return json({
    success: false,
    error: message
  }, { status: 500 });
};
```

### 3. Input Validation

```typescript
// app/lib/validation.server.ts
import { z } from 'zod';

export const executeSchema = z.object({
  code: z.string().min(1).max(10000),
  runtime: z.enum(['python', 'node']),
  timeout: z.number().optional().default(30000)
});

export const validateExecuteRequest = (data: any) => {
  try {
    return executeSchema.parse(data);
  } catch (error) {
    throw new Error('Invalid request data');
  }
};
```

### 4. Resource Management

```typescript
// app/lib/sandbox-manager.server.ts
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

```typescript
// app/components/CodeEditor.tsx
import { useState } from 'react';
import { useFetcher } from '@remix-run/react';

interface CodeEditorProps {
  initialCode?: string;
  initialRuntime?: 'python' | 'node';
  onResult?: (result: any) => void;
}

export default function CodeEditor({ 
  initialCode = 'print("Hello World!")', 
  initialRuntime = 'python',
  onResult 
}: CodeEditorProps) {
  const [code, setCode] = useState(initialCode);
  const [runtime, setRuntime] = useState<'python' | 'node'>(initialRuntime);
  const fetcher = useFetcher();

  const executeCode = () => {
    fetcher.submit(
      { code, runtime },
      { 
        method: 'POST',
        action: '/api/compute',
        encType: 'application/json'
      }
    );
  };

  // Call onResult when data is available
  if (fetcher.data && onResult) {
    onResult(fetcher.data);
  }

  return (
    <div className="code-editor space-y-4">
      <div className="flex gap-4">
        <select 
          value={runtime} 
          onChange={(e) => setRuntime(e.target.value as 'python' | 'node')}
          className="px-3 py-2 border rounded"
        >
          <option value="python">Python</option>
          <option value="node">Node.js</option>
        </select>
      </div>
      
      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        rows={10}
        className="w-full p-4 border rounded font-mono"
        placeholder="Enter your code here..."
      />
      
      <button 
        onClick={executeCode} 
        disabled={fetcher.state === 'submitting'}
        className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
      >
        {fetcher.state === 'submitting' ? 'Executing...' : 'Execute Code'}
      </button>
      
      {fetcher.data?.success && (
        <pre className="p-4 bg-gray-100 rounded overflow-x-auto">
          {fetcher.data.stdout}
        </pre>
      )}
      
      {fetcher.data?.error && (
        <div className="p-4 bg-red-100 text-red-700 rounded">
          Error: {fetcher.data.error}
        </div>
      )}
    </div>
  );
}
```

## Configuration

### Remix Config

```javascript
// vite.config.ts
import { vitePlugin as remix } from '@remix-run/dev';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [remix()],
  server: {
    port: 5173
  }
});
```

```javascript
// remix.config.js
/** @type {import('@remix-run/dev').AppConfig} */
export default {
  ignoredRouteFiles: ["**/.*"],
  serverDependenciesToBundle: ["computesdk"]
};
```

### TypeScript Config

```json
{
  "include": ["remix.env.d.ts", "**/*.ts", "**/*.tsx"],
  "compilerOptions": {
    "lib": ["DOM", "DOM.Iterable", "ES6"],
    "isolatedModules": true,
    "esModuleInterop": true,
    "jsx": "react-jsx",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "target": "ES2022",
    "strict": true,
    "allowJs": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "baseUrl": ".",
    "paths": {
      "~/*": ["./app/*"]
    },
    "noEmit": true
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
FROM node:18-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# Build application
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN npm prune --production

# Production image
FROM base
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./

EXPOSE 3000
ENV NODE_ENV=production
CMD ["npm", "start"]
```

## Troubleshooting

**Environment variables not loading?**
- Environment variables are automatically loaded from `.env` files in Remix
- Use `process.env` to access variables in loaders and actions
- Restart dev server after changes to `.env`
- Don't expose sensitive variables to client-side code

**Sandbox creation fails?**
- Verify API keys are correct and have proper format
- Check provider-specific setup requirements
- Monitor rate limits and quotas
- Check server logs for detailed error messages

**Import errors?**
- ComputeSDK can only be imported in server-side code (loaders, actions, resource routes)
- Don't import ComputeSDK in client-side components
- Use actions or resource routes to bridge between client and ComputeSDK

**Build errors?**
- Add `computesdk` to `serverDependenciesToBundle` in remix.config.js
- Ensure all ComputeSDK imports are server-side only
- Check that environment variables are properly configured

**Form submission issues?**
- Ensure forms have proper method and action attributes
- Use appropriate encType for file uploads (`multipart/form-data`)
- Handle form validation and error states properly
- Use fetchers for non-navigation form submissions

**TypeScript errors?**
- Ensure proper typing for loader and action data
- Use `typeof loader` and `typeof action` for type inference
- Import types from `@remix-run/node` for server-side functions