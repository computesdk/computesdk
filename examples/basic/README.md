# ComputeSDK Basic Examples

This directory contains basic usage examples for ComputeSDK with different providers.

## ⚠️ Current Implementation Status

- **E2B**: ✅ Fully implemented - executes real Python code
- **Vercel**: 🚧 Mock implementation - returns sample responses
- **Cloudflare**: 🚧 Mock implementation - returns sample responses  
- **Fly.io**: 🚧 Mock implementation - returns sample responses

## Prerequisites

### For Real Code Execution (E2B only):
- **E2B**: Set `E2B_API_KEY` (get from [e2b.dev](https://e2b.dev))

### For Mock Demonstrations:
- **Vercel**: Set `VERCEL_TOKEN` (optional - example will use mock data)
- **Cloudflare**: Set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (optional)
- **Fly.io**: Set `FLY_API_TOKEN` (optional)

## Examples

### Auto-detection Example
```bash
pnpm run auto
```
Shows how ComputeSDK automatically selects a provider based on available API keys.

### E2B Example ✅ (Real Implementation)
```bash
pnpm run e2b
```
Demonstrates Python code execution using E2B, including data science operations.
**This executes real code in E2B sandboxes.**

### Vercel Example 🚧 (Mock Implementation)
```bash
pnpm run vercel
```
Shows intended API for Vercel Sandbox. **Currently returns mock responses.**

### Cloudflare Example 🚧 (Mock Implementation)
```bash
pnpm run cloudflare
```
Shows intended API for Cloudflare Containers. **Currently returns mock responses.**

### Fly.io Example 🚧 (Mock Implementation)
```bash
pnpm run fly
```
Shows intended API for Fly.io Machines. **Currently returns mock responses.**

## Running All Examples

First, install dependencies:
```bash
pnpm install
```

Then run individual examples as shown above, or check the source files in the `src/` directory for more details.