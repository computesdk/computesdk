# Installation

ComputeSDK provides a unified abstraction layer for executing code in secure, isolated sandboxed environments across multiple cloud providers.

## Core SDK

Install the core ComputeSDK package:

```bash
npm install computesdk
```

## Provider Packages

ComputeSDK is modular - install only the providers you need:

```bash
# E2B
npm install @computesdk/e2b

# Vercel
npm install @computesdk/vercel

# Daytona
npm install @computesdk/daytona

# Modal
npm install @computesdk/modal

# CodeSandbox
npm install @computesdk/codesandbox

# Frontend integration (optional)
npm install @computesdk/ui
```

## Provider Setup

### Environment Variables

```bash
# blaxel
export BLAXEL_API_KEY=your_blaxel_api_key_here
export BLAXEL_WORKSPACE=your_blaxel_workspace_here

# codesandbox
export CSB_API_KEY=your_codesandbox_api_key_here

# daytona
export DAYTONA_API_KEY=your_daytona_api_key_here

# e2b
export E2B_API_KEY=e2b_your_api_key_here

# modal
export MODAL_TOKEN_ID=your_modal_token_id_here
export MODAL_TOKEN_SECRET=your_modal_token_secret_here

# vercel
export VERCEL_TOKEN=your_vercel_token_here
export VERCEL_TEAM_ID=your_team_id_here
export VERCEL_PROJECT_ID=your_project_id_here

```
