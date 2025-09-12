# ComputeSDK Usage Guide

## Installation

### Main Package (Similar to Vercel AI SDK)

```bash
# Install the main SDK
npm install computesdk

# Install specific providers as needed
npm install @computesdk/blaxel @computesdk/e2b @computesdk/vercel @computesdk/daytona
```

### Package Structure

- `computesdk` - Main SDK package (like `ai` from Vercel)
- `@computesdk/blaxel` - Blaxel provider
- `@computesdk/e2b` - E2B provider
- `@computesdk/vercel` - Vercel Sandbox provider
- `@computesdk/daytona` - Daytona provider

## Usage Patterns

### 1. Auto-Detection (Recommended)

```typescript
import { ComputeSDK } from 'computesdk';

// Auto-detects provider based on environment variables
const sandbox = ComputeSDK.createSandbox();
const result = await sandbox.execute('print("Hello World")');
```

### 2. Explicit Provider Selection

```typescript
import { blaxel } from '@computesdk/blaxel';
import { e2b } from '@computesdk/e2b';
import { daytona } from '@computesdk/daytona';
import { executeSandbox } from 'computesdk';

// Use Blaxel for AI-powered execution
const blaxelSandbox = blaxel({
  apiKey: process.env.BLAXEL_API_KEY,
  workspace: process.env.BLAXEL_WORKSPACE
});
const blaxelResult = await executeSandbox({
  sandbox: blaxelSandbox,
  code: 'print("Hello from Blaxel!")'
});

// Or use E2B
const sandbox = e2b();
const result = await executeSandbox({
  sandbox,
  code: 'print("Hello from E2B!")'
});

// Or use Daytona
const daytonaSandbox = daytona();
const daytonaResult = await executeSandbox({
  sandbox: daytonaSandbox,
  code: 'print("Hello from Daytona!")'
});
```

### 3. Provider Registry

```typescript
import { createComputeRegistry } from 'computesdk';
import { blaxel } from '@computesdk/blaxel';
import { e2b } from '@computesdk/e2b';
import { vercel } from '@computesdk/vercel';
import { daytona } from '@computesdk/daytona';

const registry = createComputeRegistry({ blaxel, e2b, vercel, daytona });
const sandbox = registry.sandbox('e2b:python');
```

## Environment Variables

Set one of these to enable auto-detection:

```bash
# Blaxel
export BLAXEL_API_KEY=your_blaxel_api_key
export BLAXEL_WORKSPACE=your_blaxel_workspace

# E2B
export E2B_API_KEY=your_e2b_key

# Vercel
export VERCEL_TOKEN=your_vercel_token  

# Daytona
export DAYTONA_API_KEY=your_daytona_api_key


```

## Package Comparison

This structure mirrors Vercel's AI SDK:

```typescript
// Vercel AI SDK
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';

// ComputeSDK
import { blaxel } from '@computesdk/blaxel';
import { e2b } from '@computesdk/e2b';
import { daytona } from '@computesdk/daytona';
import { executeSandbox } from 'computesdk';
```

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run examples
cd examples/basic
pnpm run auto
```