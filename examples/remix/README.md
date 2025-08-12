# ComputeSDK + Remix Example

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

3. **Update the action route** (`app/routes/api.compute.tsx`):
   
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


## Implementation Details

### Action Route (`app/routes/api.compute.tsx`)

```typescript
import type { ActionFunctionArgs } from "@remix-run/node";
import { handleComputeRequest } from "computesdk";
import { e2b } from "@computesdk/e2b";

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const code = formData.get("code") as string;
  
  const response = await handleComputeRequest({
    request: {
      action: 'compute.sandbox.runCode',
      code
    },
    provider: e2b({ apiKey: process.env.E2B_API_KEY! })
  });

  if (response.success) {
    return { output: response.result?.stdout || 'No output' };
  } else {
    return { error: response.error || 'Unknown error' };
  }
};
```
