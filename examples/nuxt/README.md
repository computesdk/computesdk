# ComputeSDK + Nuxt Example

This example demonstrates how to integrate ComputeSDK with Nuxt 3 for server-side code execution using the `useCompute` composable.

## Features

- **API Route**: `/api/compute` endpoint using ComputeSDK request handler
- **Multiple Providers**: Support for E2B, Vercel, and Daytona providers
- **Frontend Integration**: Uses `@computesdk/ui` with `useCompute` composable
- **TypeScript**: Full type safety throughout the application
- **Vue 3**: Modern Vue composition API with reactive state management

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and add your provider credentials. You need at least one provider configured:
   
   - **E2B**: Get your API key from [e2b.dev](https://e2b.dev)
     ```bash
     E2B_API_KEY=e2b_your_api_key_here
     ```
   
   - **Vercel**: Get your token from [vercel.com/account/tokens](https://vercel.com/account/tokens)
     ```bash
     # Method 1: OIDC Token (Recommended)
     vercel env pull  # Downloads VERCEL_OIDC_TOKEN
     
     # Method 2: Traditional
     VERCEL_TOKEN=your_vercel_token_here
     VERCEL_TEAM_ID=your_team_id_here
     VERCEL_PROJECT_ID=your_project_id_here
     ```
   
   - **Daytona**: Get your API key from your Daytona instance
     ```bash
     DAYTONA_API_KEY=your_daytona_api_key_here
     ```

3. **Update the API route** (`server/api/compute.post.ts`):
   
   Uncomment and configure your preferred provider:
   ```typescript
   // Choose one provider:
   const provider = e2b({ apiKey: process.env.E2B_API_KEY! })
   // const provider = vercel({ token: process.env.VERCEL_TOKEN!, teamId: process.env.VERCEL_TEAM_ID!, projectId: process.env.VERCEL_PROJECT_ID! })
   // const provider = daytona({ apiKey: process.env.DAYTONA_API_KEY! })
   ```

4. **Run the development server**:
   ```bash
   npm run dev
   ```

5. **Open your browser** and navigate to [http://localhost:3000](http://localhost:3000)

## Usage

1. Click the "Run Code" button to execute Python code in a secure sandbox
2. View the output displayed below the button
3. The example demonstrates creating a sandbox, running code, and cleaning up

## API Reference

### POST /api/compute

Execute code using ComputeSDK's unified request handler.

**Request Body:**
```json
{
  "action": "compute.sandbox.runCode",
  "code": "print('Hello, World!')",
  "runtime": "python"
}
```

**Response (Success):**
```json
{
  "success": true,
  "sandboxId": "sandbox-123",
  "provider": "e2b",
  "result": {
    "stdout": "Hello, World!\n",
    "stderr": "",
    "exitCode": 0,
    "executionTime": 150
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Code is required for runCode action",
  "sandboxId": "",
  "provider": "e2b"
}
```

## Supported Actions

The `/api/compute` endpoint supports all ComputeSDK actions:

- `compute.sandbox.create` - Create new sandbox
- `compute.sandbox.runCode` - Execute code
- `compute.sandbox.runCommand` - Run shell command
- `compute.sandbox.filesystem.readFile` - Read file
- `compute.sandbox.filesystem.writeFile` - Write file
- `compute.sandbox.filesystem.mkdir` - Create directory
- `compute.sandbox.filesystem.readdir` - List directory
- `compute.sandbox.filesystem.exists` - Check if path exists
- `compute.sandbox.filesystem.remove` - Remove file/directory
- `compute.sandbox.terminal.create` - Create terminal (E2B only)
- And more...

## Provider Configuration

The example uses a single provider based on available environment variables. The API route automatically selects the configured provider:

1. **E2B** - Full development environment with data science libraries
2. **Vercel** - Serverless execution with up to 45 minutes runtime
3. **Daytona** - Development workspaces with custom environments

## Implementation Details

### API Route (`server/api/compute.post.ts`)

```typescript
import { handleComputeRequest } from 'computesdk'
import { e2b } from '@computesdk/e2b'

export default defineEventHandler(async (event) => {
  const computeRequest = await readBody(event)
  
  const response = await handleComputeRequest({
    request: computeRequest,
    provider: e2b({ apiKey: process.env.E2B_API_KEY! })
  })
  
  if (!response.success) {
    throw createError({
      statusCode: 500,
      statusMessage: response.error || 'Unknown error occurred'
    })
  }
  
  return response
})
```

### Frontend Integration (`app.vue`)

The example uses the `useCompute` composable from `@computesdk/ui`:

```vue
<script setup>
import { useCompute } from '@computesdk/ui'

const compute = useCompute({ apiEndpoint: '/api/compute' })

async function runCode() {
  const sandbox = await compute.sandbox.create()
  const result = await sandbox.runCode('print("Hello from ComputeSDK!")')
  console.log(result.result?.stdout)
  await sandbox.destroy()
}
</script>
```

## Deployment

This example can be deployed to any platform that supports Nuxt 3:

- **Vercel**: `vercel deploy`
- **Netlify**: Connect your Git repository
- **Railway**: `railway deploy`
- **Cloudflare Pages**: Connect your Git repository

Make sure to configure your environment variables in your deployment platform.

## Security Considerations

- All code execution happens in isolated sandbox environments
- Environment variables are only accessible on the server side
- Input validation is performed by ComputeSDK request handler
- Consider implementing rate limiting for production use
- API keys are never exposed to the client

## Learn More

- [ComputeSDK Documentation](https://github.com/computesdk/computesdk)
- [Nuxt 3 Documentation](https://nuxt.com/docs)
- [E2B Documentation](https://e2b.dev/docs)
- [Vercel Documentation](https://vercel.com/docs)
- [Daytona Documentation](https://daytona.io/docs)