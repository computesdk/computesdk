# Installation

ComputeSDK provides a unified abstraction layer for executing code in secure, isolated sandboxed environments across multiple cloud providers.


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

## Provider Setup

### Environment Variables

```bash

# daytona
export DAYTONA_API_KEY=your_daytona_api_key_here

# e2b
export E2B_API_KEY=e2b_your_api_key_here

# modal
export MODAL_TOKEN_ID=your_modal_token_id_here
export MODAL_TOKEN_SECRET=your_modal_token_secret_here

# railway
export RAILWAY_API_KEY=your_railway_api_key_here
export RAILWAY_PROJECT_ID=your_railway_project_id_here
export RAILWAY_ENVIRONMENT_ID=your_railway_environment_id_here

# vercel
export VERCEL_TOKEN=your_vercel_token_here
export VERCEL_TEAM_ID=your_team_id_here
export VERCEL_PROJECT_ID=your_project_id_here

```
