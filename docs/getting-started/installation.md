# Installation

## Install a Provider Package

Install the provider package for the platform you want to use:

```bash
# Pick one (or more) providers
npm install @computesdk/blaxel
npm install @computesdk/cloudflare
npm install @computesdk/codesandbox
npm install @computesdk/daytona
npm install @computesdk/e2b
npm install @computesdk/hopx
npm install @computesdk/modal
npm install @computesdk/namespace
npm install @computesdk/runloop
npm install @computesdk/vercel
```

You only need to install the providers your project uses.

## Provider Credentials

Each provider requires its own API credentials. Add them to a `.env` file in the root of your project or export them in your shell:

### Blaxel
```bash
BL_API_KEY=your_blaxel_api_key
BL_WORKSPACE=your_blaxel_workspace
```

### Cloudflare

```bash
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
```

### CodeSandbox

```bash
CSB_API_KEY=your_codesandbox_api_key
```

### Daytona

```bash
DAYTONA_API_KEY=your_daytona_api_key
```

### E2B

```bash
E2B_API_KEY=your_e2b_api_key
```

### HopX
```bash
HOPX_API_KEY=your_hopx_api_key
```

### Modal

```bash
MODAL_TOKEN_ID=your_modal_token_id
MODAL_TOKEN_SECRET=your_modal_token_secret
```

### Namespace
```bash
NSC_TOKEN=your_namespace_nsc_token
```

### Runloop

```bash
RUNLOOP_API_KEY=your_runloop_api_key
```

### Vercel

```bash
VERCEL_TOKEN=your_vercel_token
VERCEL_TEAM_ID=your_team_id
VERCEL_PROJECT_ID=your_project_id
```

Refer to each provider's documentation page for the full list of supported environment variables and configuration options.

## Verify Your Setup

After installing a provider and setting credentials, verify everything works:

```typescript
import { e2b } from '@computesdk/e2b';

const compute = e2b({ apiKey: process.env.E2B_API_KEY });
const sandbox = await compute.sandbox.create();

const result = await sandbox.runCode('print("Hello from ComputeSDK!")');
console.log(result.output); // "Hello from ComputeSDK!"

await sandbox.destroy();
```

Replace the import and configuration with whichever provider you installed.
