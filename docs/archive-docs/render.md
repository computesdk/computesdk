# Render

## Deploy sandboxes on Render with ComputeSDK

Deploy and manage containerized sandboxes on Render's infrastructure with ComputeSDK.

---

Render is a unified cloud platform that makes it easy to build and run applications. With ComputeSDK's Render provider, you can self-host your own sandbox execution environment with zero infrastructure setup.

---

**Prerequisites**:

- A <a href="https://console.computesdk.com/register" target="_blank">ComputeSDK account</a> with an API key
- A <a href="https://render.com/" target="_blank">Render account</a> with an API key and Owner ID
- Node.js 18+ installed

---

## Using ComputeSDK with Render

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

# Render credentials
RENDER_API_KEY=your_render_api_key
RENDER_OWNER_ID=your_render_owner_id
```


---

### Step 3: Create and manage sandboxes

ComputeSDK auto-detects Render as your provider from the environment variables:

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

Your sandboxes are now running on your self-hosted Render infrastructure!

---

### Explicit provider configuration (optional)

If you prefer to configure the provider programmatically—useful for multi-provider setups or dynamic configuration—pass credentials directly:

```typescript
import { compute } from 'computesdk';

compute.setConfig({
   computesdkApiKey: process.env.COMPUTESDK_API_KEY,
   provider: 'render',
   render: {
     apiKey: process.env.RENDER_API_KEY,
     ownerId: process.env.RENDER_OWNER_ID
   }
});

const sandbox = await compute.sandbox.create();
```

---

### Configuration reference

The Render provider accepts the following configuration options:

| Option | Environment Variable | Required | Description |
|--------|---------------------|----------|-------------|
| `apiKey` | `RENDER_API_KEY` | Yes | Your Render API key |
| `ownerId` | `RENDER_OWNER_ID` | Yes | Your Render account Owner ID |

```typescript
interface RenderConfig {
  /** Render API key - if not provided, uses RENDER_API_KEY env var */
  apiKey?: string;
  /** Render Owner ID - if not provided, uses RENDER_OWNER_ID env var */
  ownerId?: string;
}
```

---

## Next steps

- Learn about [sandbox lifecycle management](/docs/reference/computesandbox)
- Explore [Sandbox methods](/docs/reference/sandbox)
- View the [@computesdk/render package](https://github.com/computesdk/computesdk/blob/main/packages/render/README.md)
