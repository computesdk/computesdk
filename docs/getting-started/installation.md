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
# E2B provider - Full development environment
npm install @computesdk/e2b

# Vercel provider - Scalable serverless execution  
npm install @computesdk/vercel

# Daytona provider - Development workspaces
npm install @computesdk/daytona

# Modal provider - GPU-accelerated Python workloads
npm install @computesdk/modal

# CodeSandbox provider - Collaborative sandboxes
npm install @computesdk/codesandbox

# Frontend integration (optional)
npm install @computesdk/ui
```

## Provider Setup

### E2B - Full Development Environment

E2B provides full filesystem and terminal support with data science libraries:

```bash
export E2B_API_KEY=e2b_your_api_key_here
```

### Vercel - Scalable Serverless Execution

Vercel provides reliable execution with up to 45 minutes runtime:

```bash
# Method 1: OIDC Token (Recommended)
vercel env pull  # Downloads VERCEL_OIDC_TOKEN

# Method 2: Traditional
export VERCEL_TOKEN=your_vercel_token_here
export VERCEL_TEAM_ID=your_team_id_here
export VERCEL_PROJECT_ID=your_project_id_here
```

### Daytona - Development Workspaces

Daytona provides development workspace environments:

```bash
export DAYTONA_API_KEY=your_daytona_api_key_here
```

### Modal - GPU-Accelerated Python Workloads

Modal provides serverless cloud compute with GPU support:

```bash
export MODAL_TOKEN_ID=your_modal_token_id_here
export MODAL_TOKEN_SECRET=your_modal_token_secret_here
```

### CodeSandbox - Collaborative Sandboxes

CodeSandbox provides collaborative development environments:

```bash
export CSB_API_KEY=your_codesandbox_api_key_here
```

