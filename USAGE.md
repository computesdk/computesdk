# ComputeSDK Usage Guide

## Installation

### Main Package (Similar to Vercel AI SDK)

```bash
# Install the main SDK
npm install computesdk

# Install specific providers as needed
npm install @computesdk/e2b @computesdk/vercel @computesdk/cloudflare @computesdk/fly
```

### Package Structure

- `computesdk` - Main SDK package (like `ai` from Vercel)
- `@computesdk/e2b` - E2B provider
- `@computesdk/vercel` - Vercel Sandbox provider  
- `@computesdk/cloudflare` - Cloudflare Containers provider
- `@computesdk/fly` - Fly.io Machines provider

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
import { e2b } from '@computesdk/e2b';
import { executeSandbox } from 'computesdk';

const sandbox = e2b();
const result = await executeSandbox({
  sandbox,
  code: 'print("Hello from E2B!")'
});
```

### 3. Provider Registry

```typescript
import { createComputeRegistry } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { vercel } from '@computesdk/vercel';

const registry = createComputeRegistry({ e2b, vercel });
const sandbox = registry.sandbox('e2b:python');
```

## Environment Variables

Set one of these to enable auto-detection:

```bash
# E2B
export E2B_API_KEY=your_e2b_key

# Vercel
export VERCEL_TOKEN=your_vercel_token  

# Cloudflare
export CLOUDFLARE_API_TOKEN=your_cf_token
export CLOUDFLARE_ACCOUNT_ID=your_cf_account

# Fly.io
export FLY_API_TOKEN=your_fly_token
```

## Package Comparison

This structure mirrors Vercel's AI SDK:

```typescript
// Vercel AI SDK
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';

// ComputeSDK
import { e2b } from '@computesdk/e2b';
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