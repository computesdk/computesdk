# ComputeSDK Basic Examples

This directory contains basic usage examples for ComputeSDK with different providers.

## ⚠️ Current Implementation Status

- **E2B**: ✅ Fully implemented - executes real Python code in sandboxes
- **Vercel**: ✅ Fully implemented - executes real code in sandboxes
- **Daytona**: ✅ Fully implemented - executes real code in sandboxes

## Prerequisites
- **E2B**: Set `E2B_API_KEY` (get from [e2b.dev](https://e2b.dev))
- **Daytona**: Set `DAYTONA_API_KEY` (get from [Daytona](https://daytona.io))
- **Vercel**: Set `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID` (get from [Vercel](https://vercel.com))

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

### Vercel Example ✅ (Real Implementation)
```bash
pnpm run vercel
```
Demonstrates code execution using Vercel sandboxes, including filesystem operations.
**This executes real code in Vercel environments.**

### Daytona Example ✅ (Real Implementation)
```bash
pnpm run daytona
```
Demonstrates code execution using Daytona workspaces, including filesystem operations.
**This executes real code in Daytona environments.**



## Running All Examples

First, install dependencies:
```bash
pnpm install
```

Then run individual examples as shown above, or check the source files in the `src/` directory for more details.