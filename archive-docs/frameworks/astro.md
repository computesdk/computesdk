# Astro

Use ComputeSDK to execute code in secure sandboxes from your Astro API endpoints.

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

Navigate to [http://localhost:4321](http://localhost:4321)

## Implementation

### API Route with Request Handler

The simplest way to use ComputeSDK in Astro is with the built-in request handler:

```typescript
// src/pages/api/compute.ts
import type { APIRoute } from 'astro';
import { handleComputeRequest } from 'computesdk';
import { e2b } from '@computesdk/e2b';

export const POST: APIRoute = async ({ request }) => {
  const computeRequest = await request.json();
  
  const response = await handleComputeRequest({
    request: computeRequest,
    provider: e2b({ apiKey: import.meta.env.E2B_API_KEY! })
  });

  return new Response(
    JSON.stringify(response),
    {
      status: response.success ? 200 : 500,
      headers: { 'Content-Type': 'application/json' }
    }
  );
};
```

### Custom API Route

For more control, create a custom API route:

```typescript
// src/pages/api/sandbox.ts
import type { APIRoute } from 'astro';
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { code, runtime } = await request.json();
    
    // Set provider
    compute.setConfig({ 
      provider: e2b({ apiKey: import.meta.env.E2B_API_KEY! }) 
    });
    
    // Create sandbox and execute code
    const sandbox = await compute.sandbox.create();
    const result = await sandbox.runCode(code, runtime);
    
    // Clean up
    await compute.sandbox.destroy(sandbox.sandboxId);
    
    return new Response(JSON.stringify({
      success: true,
      stdout: result.stdout,
      stderr: result.stderr,
      executionTime: result.executionTime
    }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Unknown error'
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
```

### Frontend Integration

Call your API from Astro components:

```astro
---
// src/pages/playground.astro
---

<html lang="en">
<head>
  <meta charset="utf-8" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <meta name="viewport" content="width=device-width" />
  <title>ComputeSDK Playground</title>
</head>
<body>
  <div class="container">
    <h1>Code Executor</h1>
    
    <textarea 
      id="code" 
      rows="10" 
      cols="80"
      placeholder="Enter your code here..."
    >print("Hello World!")</textarea>
    
    <div class="controls">
      <select id="runtime">
        <option value="python">Python</option>
        <option value="node">Node.js</option>
      </select>
      
      <button id="execute">Execute Code</button>
    </div>
    
    <pre id="output" style="display: none;"></pre>
  </div>

  <script>
    const executeButton = document.getElementById('execute');
    const codeInput = document.getElementById('code');
    const runtimeSelect = document.getElementById('runtime');
    const outputPre = document.getElementById('output');

    executeButton?.addEventListener('click', async () => {
      const code = codeInput?.value;
      const runtime = runtimeSelect?.value;
      
      if (!code) return;

      executeButton.disabled = true;
      executeButton.textContent = 'Executing...';

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
          outputPre.textContent = data.result.stdout;
        } else {
          outputPre.textContent = `Error: ${data.error}`;
        }
        
        outputPre.style.display = 'block';
      } catch (error) {
        outputPre.textContent = `Error: ${error.message}`;
        outputPre.style.display = 'block';
      } finally {
        executeButton.disabled = false;
        executeButton.textContent = 'Execute Code';
      }
    });
  </script>

  <style>
    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
      font-family: Arial, sans-serif;
    }
    
    textarea {
      width: 100%;
      font-family: 'Courier New', monospace;
      padding: 1rem;
      border: 1px solid #ccc;
      border-radius: 4px;
      margin-bottom: 1rem;
    }
    
    .controls {
      margin-bottom: 1rem;
    }
    
    select, button {
      padding: 0.5rem;
      margin-right: 0.5rem;
    }
    
    button {
      background: #007bff;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    #output {
      background: #f5f5f5;
      padding: 1rem;
      border-radius: 4px;
      overflow-x: auto;
    }
  </style>
</body>
</html>
```

### With React Component

```tsx
// src/components/CodeExecutor.tsx
import { useState } from 'react';

export default function CodeExecutor() {
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
    <div className="code-executor">
      <h2>Code Executor</h2>
      
      <div className="controls">
        <select value={runtime} onChange={(e) => setRuntime(e.target.value as 'python' | 'node')}>
          <option value="python">Python</option>
          <option value="node">Node.js</option>
        </select>
      </div>
      
      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        rows={10}
        cols={80}
        placeholder="Enter your code here..."
      />
      
      <button onClick={executeCode} disabled={loading}>
        {loading ? 'Executing...' : 'Execute Code'}
      </button>
      
      {output && <pre className="output">{output}</pre>}
    </div>
  );
}
```

```astro
---
// src/pages/react-playground.astro
import CodeExecutor from '../components/CodeExecutor.tsx';
---

<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>React Playground</title>
</head>
<body>
  <CodeExecutor client:load />
</body>
</html>
```

## Advanced Examples

### Data Analysis API

```typescript
// src/pages/api/analyze.ts
import type { APIRoute } from 'astro';
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { csvData } = await request.json();
    
    compute.setConfig({ 
      provider: e2b({ apiKey: import.meta.env.E2B_API_KEY! }) 
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
    
    return new Response(JSON.stringify({
      success: true,
      analysis: JSON.parse(result.stdout)
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
```

### File Upload Processing

```typescript
// src/pages/api/upload.ts
import type { APIRoute } from 'astro';
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

export const POST: APIRoute = async ({ request }) => {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No file provided'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const fileContent = await file.text();
    
    const sandbox = await compute.sandbox.create({
      provider: e2b({ apiKey: import.meta.env.E2B_API_KEY! })
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
    
    return new Response(JSON.stringify({
      success: true,
      info: result.stdout
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
```

### Multi-Provider Support

```typescript
// src/pages/api/multi-provider.ts
import type { APIRoute } from 'astro';
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { vercel } from '@computesdk/vercel';
import { daytona } from '@computesdk/daytona';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { provider: providerName, code, runtime } = await request.json();
    
    let provider;
    switch (providerName) {
      case 'e2b':
        provider = e2b({ apiKey: import.meta.env.E2B_API_KEY! });
        break;
      case 'vercel':
        provider = vercel({ token: import.meta.env.VERCEL_TOKEN! });
        break;
      case 'daytona':
        provider = daytona({ apiKey: import.meta.env.DAYTONA_API_KEY! });
        break;
      default:
        return new Response(JSON.stringify({
          success: false,
          error: 'Invalid provider specified'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
    }
    
    const sandbox = await compute.sandbox.create({ provider });
    
    try {
      const result = await sandbox.runCode(code, runtime);
      return new Response(JSON.stringify({
        success: true,
        provider: providerName,
        result: result.stdout
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } finally {
      await compute.sandbox.destroy(sandbox.sandboxId);
    }
  } catch (error: any) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
```

### Workflow API

```typescript
// src/pages/api/workflow.ts
import type { APIRoute } from 'astro';
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

export const POST: APIRoute = async ({ request }) => {
  const sandbox = await compute.sandbox.create({
    provider: e2b({ apiKey: import.meta.env.E2B_API_KEY! })
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
    
    return new Response(JSON.stringify({
      success: true,
      steps
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  } finally {
    await compute.sandbox.destroy(sandbox.sandboxId);
  }
};
```

### Server-Side Rendering with Data

```astro
---
// src/pages/ssr-demo.astro
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

let data;
let error;

try {
  compute.setConfig({ 
    provider: e2b({ apiKey: import.meta.env.E2B_API_KEY! }) 
  });
  
  const sandbox = await compute.sandbox.create();
  
  // Generate data on the server
  const result = await sandbox.runCode(`
import json
import random

# Generate sample data
products = []
for i in range(5):
    products.append({
        'id': i + 1,
        'name': f'Product {i + 1}',
        'price': round(random.uniform(10, 100), 2),
        'category': random.choice(['Electronics', 'Books', 'Clothing'])
    })

print(json.dumps(products))
  `);
  
  data = JSON.parse(result.stdout);
  await compute.sandbox.destroy(sandbox.sandboxId);
} catch (err) {
  error = err.message;
}
---

<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>SSR Demo</title>
</head>
<body>
  <div class="container">
    <h1>Server-Side Rendered Data</h1>
    
    {error ? (
      <div class="error">
        Error: {error}
      </div>
    ) : (
      <div class="products">
        {data.map((product) => (
          <div class="product-card">
            <h3>{product.name}</h3>
            <p>Category: {product.category}</p>
            <p>Price: ${product.price}</p>
          </div>
        ))}
      </div>
    )}
  </div>
  
  <style>
    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
    }
    
    .products {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1rem;
    }
    
    .product-card {
      border: 1px solid #ccc;
      border-radius: 8px;
      padding: 1rem;
      background: #f9f9f9;
    }
    
    .error {
      background: #fee;
      color: #c33;
      padding: 1rem;
      border-radius: 4px;
    }
  </style>
</body>
</html>
```

## Best Practices

### 1. Environment Variables

```typescript
// src/utils/env.ts
export const getProvider = () => {
  if (import.meta.env.E2B_API_KEY) {
    return e2b({ apiKey: import.meta.env.E2B_API_KEY });
  }
  if (import.meta.env.VERCEL_TOKEN) {
    return vercel({ 
      token: import.meta.env.VERCEL_TOKEN,
      teamId: import.meta.env.VERCEL_TEAM_ID,
      projectId: import.meta.env.VERCEL_PROJECT_ID
    });
  }
  if (import.meta.env.DAYTONA_API_KEY) {
    return daytona({ apiKey: import.meta.env.DAYTONA_API_KEY });
  }
  throw new Error('No compute provider configured');
};
```

### 2. Error Handling

```typescript
// src/utils/error-handler.ts
export const handleComputeError = (error: any): Response => {
  console.error('Sandbox error:', error);
  
  // Don't expose sensitive error details in production
  const message = import.meta.env.DEV ? error.message : 'Internal server error';
  
  return new Response(JSON.stringify({
    success: false,
    error: message
  }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' }
  });
};
```

### 3. Input Validation

```typescript
// src/utils/validation.ts
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
// src/utils/sandbox-manager.ts
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

```astro
---
// src/components/CodeEditor.astro
const { initialCode = 'print("Hello World!")', id = 'code-editor' } = Astro.props;
---

<div class="code-editor" id={id}>
  <div class="toolbar">
    <select class="runtime-select">
      <option value="python">Python</option>
      <option value="node">Node.js</option>
    </select>
    <button class="execute-btn">Execute Code</button>
  </div>
  
  <textarea class="code-input" rows="10">{initialCode}</textarea>
  
  <div class="output-container" style="display: none;">
    <h4>Output:</h4>
    <pre class="output"></pre>
  </div>
</div>

<script define:vars={{ id }}>
  const editor = document.getElementById(id);
  const executeBtn = editor.querySelector('.execute-btn');
  const codeInput = editor.querySelector('.code-input');
  const runtimeSelect = editor.querySelector('.runtime-select');
  const outputContainer = editor.querySelector('.output-container');
  const outputPre = editor.querySelector('.output');

  executeBtn.addEventListener('click', async () => {
    const code = codeInput.value;
    const runtime = runtimeSelect.value;
    
    if (!code.trim()) return;

    executeBtn.disabled = true;
    executeBtn.textContent = 'Executing...';
    outputContainer.style.display = 'none';

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
        outputPre.textContent = data.result.stdout;
      } else {
        outputPre.textContent = `Error: ${data.error}`;
      }
      
      outputContainer.style.display = 'block';
    } catch (error) {
      outputPre.textContent = `Error: ${error.message}`;
      outputContainer.style.display = 'block';
    } finally {
      executeBtn.disabled = false;
      executeBtn.textContent = 'Execute Code';
    }
  });
</script>

<style>
  .code-editor {
    border: 1px solid #ccc;
    border-radius: 8px;
    padding: 1rem;
    background: white;
  }
  
  .toolbar {
    display: flex;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  
  .runtime-select, .execute-btn {
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
  }
  
  .execute-btn {
    background: #007bff;
    color: white;
    cursor: pointer;
  }
  
  .execute-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .code-input {
    width: 100%;
    font-family: 'Courier New', monospace;
    padding: 1rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    resize: vertical;
  }
  
  .output-container {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid #eee;
  }
  
  .output {
    background: #f5f5f5;
    padding: 1rem;
    border-radius: 4px;
    overflow-x: auto;
    margin: 0;
  }
</style>
```

## Configuration

### Astro Config

```typescript
// astro.config.mjs
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  integrations: [react()],
  output: 'server',
  adapter: /* your adapter */
});
```

### TypeScript Config

```json
// tsconfig.json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "types": ["astro/client"]
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

### Build Configuration

Ensure your build includes all necessary dependencies and environment variables are properly configured for your deployment platform.

## Troubleshooting

**Environment variables not loading?**
- Check `.env` file exists and has correct format
- Restart dev server after changes
- Use `import.meta.env` to access variables in Astro
- Ensure variables are not prefixed with `PUBLIC_` if they contain secrets

**Sandbox creation fails?**
- Verify API keys are correct and have proper format
- Check provider-specific setup requirements
- Monitor rate limits and quotas

**Server-side only errors?**
- ComputeSDK must run on server-side only (API endpoints)
- Don't import ComputeSDK in client-side components or scripts
- Use API endpoints to bridge between client and ComputeSDK

**Build errors?**
- Ensure all ComputeSDK imports are in API routes only
- Check that environment variables are properly typed
- Verify provider packages are correctly installed

**Client hydration issues?**
- ComputeSDK operations should happen in API endpoints
- Use `client:load` or other client directives appropriately for interactive components
- Avoid server-side imports in client-side code