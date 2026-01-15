# Railway

## Deploy sandboxes on Railway with ComputeSDK

Deploy and manage containerized sandboxes on Railway's infrastructure with ComputeSDK.

---

Railway is an infrastructure platform with instant deployments and automatic SSL. With ComputeSDK's Railway provider, you can self-host your own sandbox execution environment.

---

**Prerequisites**:

- A <a href="https://console.computesdk.com/register" target="_blank">ComputeSDK account</a> with an API key
- A <a href="https://railway.app/" target="_blank">Railway account</a> with the [ComputeSDK sandbox template deployed](#deploying-the-railway-sandbox-template)
- Node.js 18+ installed

---

### Step 1: Install ComputeSDK

Install the ComputeSDK package in your application:

```bash
npm install computesdk
```

---

### Step 2: Configure environment variables

Add your credentials to a `.env` file:

```bash
# ComputeSDK credentials
COMPUTESDK_API_KEY=your_computesdk_api_key

# Railway credentials
RAILWAY_API_KEY=your_railway_api_key
RAILWAY_PROJECT_ID=your_railway_project_id
RAILWAY_ENVIRONMENT_ID=your_railway_environment_id
```

See [Getting your Railway credentials](#getting-your-railway-credentials) for how to obtain these values.

---

### Step 3: Create and manage sandboxes

ComputeSDK auto-detects Railway as your provider from the environment variables:

```typescript
import { compute } from 'computesdk';

// Create a new sandbox
const sandbox = await compute.sandbox.create();
console.log(`Sandbox created: ${sandbox.sandboxId}`);

// Get sandbox info
const info = await sandbox.getInfo();
console.log(`Sandbox status: ${info.status}`);

// Clean up when done
await sandbox.destroy();
```

Your sandboxes are now running on your self-hosted Railway infrastructure!

---

### Explicit provider configuration (optional)

If you prefer to configure the provider programmatically—useful for multi-provider setups or dynamic configuration—pass credentials directly:

```typescript
import { compute } from 'computesdk';

const sandbox = await compute({
  provider: 'railway',
  computesdkApiKey: 'your_computesdk_api_key',
  railway: {
    apiToken: 'your_railway_api_key',
    projectId: 'your_railway_project_id',
    environmentId: 'your_railway_environment_id'
  }
}).sandbox.create();
```

---

### Configuration reference

The Railway provider accepts the following configuration options:

| Option | Environment Variable | Required | Description |
|--------|---------------------|----------|-------------|
| `apiToken` | `RAILWAY_API_KEY` | Yes | Your Railway API token |
| `projectId` | `RAILWAY_PROJECT_ID` | Yes | The project ID where you deployed the sandbox template |
| `environmentId` | `RAILWAY_ENVIRONMENT_ID` | Yes | The target environment within the project |

```typescript
interface RailwayConfig {
  /** Railway API token - if not provided, uses RAILWAY_API_KEY env var */
  apiToken?: string;
  /** Railway Project ID - if not provided, uses RAILWAY_PROJECT_ID env var */
  projectId?: string;
  /** Railway Environment ID - if not provided, uses RAILWAY_ENVIRONMENT_ID env var */
  environmentId?: string;
}
```

---

## Deploying the Railway sandbox template

Before using Railway as a sandbox provider, you need to deploy the ComputeSDK sandbox infrastructure to your Railway account. This only needs to be done once.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/sandbox)

**What this deploys:**

The template deploys a lightweight binary (`computesdk/compute`) that converts Railway's infrastructure into a sandbox provider. It handles:

- Sandbox lifecycle management
- Code execution
- File system operations
- Resource isolation

Click the button above or visit [railway.com/deploy/sandbox](https://railway.com/deploy/sandbox) and click **"Deploy Now"** to create the project.

---

## Getting your Railway credentials

Once you've deployed the template, collect these three values:

**API Key**

1. Go to [Railway Dashboard → Account Settings → Tokens](https://railway.app/account/tokens)
2. Click **"Create Token"**
3. Name it (e.g., "ComputeSDK Integration")
4. Copy the generated token

**Project ID**

Find it in the URL when viewing your deployed sandbox project:

```
https://railway.app/project/{PROJECT_ID}
                            ^^^^^^^^^^^^
                            Copy this value
```

**Environment ID**

1. Open your Railway project
2. Go to **Settings** → **Environments**
3. Click on your target environment
4. Copy the Environment ID from the details panel


---

## Next steps

- Learn about [sandbox lifecycle management](/docs/reference/computesandbox)
- Explore [event handling](/docs/reference/computeevents) for sandbox events
- Check out [example projects](https://github.com/computesdk/computesdk/tree/main/examples)
- View the [@computesdk/railway package](https://github.com/computesdk/computesdk/blob/main/packages/railway/README.md)
