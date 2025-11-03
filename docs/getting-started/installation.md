# Installation

ComputeSDK provides a unified abstraction layer for executing code in secure, isolated sandboxed environments across multiple cloud providers.

<br />

<div class="bg-emerald-100/20 border-l-4 border-emerald-800/20 dark:bg-emerald-800/30 dark:border-emerald-100/20 p-6 my-2 rounded flex flex-col gap-4">
  <strong>For a quick interactive demo of the SDK in action:</strong>
  
  ```bash
  curl -fsSL https://computesdk.com/install.sh | sh
  ```
</div>

<br />

## Start Here

1) Visit https://console.computesdk.com/register to create an account and get your ComputeSDK API key.
2) Next create a .env file in the root of your project and add your API key (this is where you will store your API keys for each of your providers as well):

```bash
COMPUTESDK_API_KEY=your_api_key_here
```


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
