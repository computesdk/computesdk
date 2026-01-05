# compute


## Overview
The ComputeSDK is a unified interface for managing compute sandboxes. ComputeSDK supports two configuration approaches:

- **Auto-detection (Recommended)**: Set `COMPUTESDK_API_KEY` and provider-specific environment variables, and ComputeSDK automatically detects and configures your provider
- **Explicit configuration**: Use `compute.setConfig()` to manually specify provider and credentials for more control

## ComputeSDK API Key
1) Visit https://console.computesdk.com/register to create an account and get your ComputeSDK API key.
2) Next create a .env file in the root of your project and add your API key (this is where you will store your API keys for each of your providers):
```bash
COMPUTESDK_API_KEY=your_api_key_here
```

## Provider-specific env variables

```bash
PROVIDER_API_KEY=your_provider_api_key_here
```

## Install computesdk
```bash
npm install computesdk
```

---

## Configuration

### compute.setConfig(config)

Explicitly configure the compute singleton with provider and authentication details. This method provides manual control over provider selection and configuration, as an alternative to the recommended auto-detection approach.

**Parameters:**

- `config` (ExplicitComputeConfig, required): Configuration object
  - `provider` (string, required): Provider name to use (e.g., 'e2b', 'modal', 'railway', 'daytona', 'vercel', 'runloop', 'cloudflare', 'codesandbox', 'blaxel')
  - `apiKey` (string, required): ComputeSDK API key from https://console.computesdk.com
  - `gatewayUrl` (string, optional): Custom gateway URL override for development or self-hosting
  - Provider-specific configurations (object, optional): Each provider accepts specific authentication and configuration options (e.g., `e2b: { apiKey: string }`, `modal: { tokenId: string, tokenSecret: string }`)

**Returns:** `void` - No return value; configures the compute singleton in place

**ExplicitComputeConfig interface:**
```typescript
{
  provider: string;        // Required: Provider name
  apiKey: string;          // Required: ComputeSDK API key
  gatewayUrl?: string;     // Optional: Custom gateway URL
  
  // Provider-specific configurations (optional)
  [providerName]?: {
    // Provider-specific authentication and config options
    // Varies by provider - see provider documentation
  }
}
```

**Examples:**

```typescript
import { compute } from 'computesdk';

// Basic configuration with generic provider
compute.setConfig({
  provider: 'your-provider',
  apiKey: process.env.COMPUTESDK_API_KEY,
  'your-provider': {
    apiKey: process.env.YOUR_PROVIDER_API_KEY
  }
});

// Create sandbox after configuration
const sandbox = await compute.sandbox.create();

// Configuration with environment variables
compute.setConfig({
  provider: 'your-provider',
  apiKey: process.env.COMPUTESDK_API_KEY || 'local',
  'your-provider': {
    apiKey: process.env.YOUR_PROVIDER_API_KEY,
    projectId: process.env.YOUR_PROVIDER_PROJECT_ID
  }
});

// Error handling - missing required apiKey
try {
  compute.setConfig({
    provider: 'your-provider'
    // Missing apiKey - will throw error
  });
} catch (error) {
  console.error('Configuration failed:', error.message);
  // Error: Missing ComputeSDK API key. The 'apiKey' field is required.
}
```

**Notes:**
- **Auto-detection is recommended**: For most use cases, set environment variables and let ComputeSDK auto-detect your provider configuration automatically
- `setConfig()` replaces any existing configuration, including auto-detected settings
- The `apiKey` field is required and will throw an error if missing
- Provider-specific configurations are validated based on the selected provider
- Call `setConfig()` before creating sandboxes or using other compute methods
- Supported providers: e2b, modal, railway, daytona, vercel, runloop, cloudflare, codesandbox, blaxel
- Get your ComputeSDK API key at https://console.computesdk.com/register

<br/>
<br/>

---

## Creating a sandbox

- [compute.sandbox](./computesandbox)


## Sandbox (interface)
- [Sandbox](./sandbox)


## Events
- [compute.events](./computeevents)

<!-- 
## Templates
- [compute.templates](./computetemplates) -->