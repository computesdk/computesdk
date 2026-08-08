---
description: >-
  NeevCloud provider for ComputeSDK - run commands and manage files in secure
  cloud sandboxes with preview URLs.
layout:
  width: default
  title:
    visible: true
  description:
    visible: false
  tableOfContents:
    visible: true
  outline:
    visible: true
  pagination:
    visible: true
  metadata:
    visible: true
  tags:
    visible: true
  actions:
    visible: true
---

# NeevCloud

[NeevCloud](https://neevcloud.com) provider for ComputeSDK - run commands and manage files in secure cloud sandboxes.

## Installation & Setup

```bash
npm install @computesdk/neevcloud
```

Add your NeevCloud credentials to a `.env` file:

```bash
NEEV_API_KEY=your_neev_api_key
NEEV_ORG_ID=your_neev_org_id
NEEV_PROJECT_ID=your_neev_project_id
```

## Usage

```typescript
import { neevcloud } from '@computesdk/neevcloud';

const compute = neevcloud({
  apiKey: process.env.NEEV_API_KEY,
  orgId: process.env.NEEV_ORG_ID,
  projectId: process.env.NEEV_PROJECT_ID,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from NeevCloud!"');
console.log(result.stdout); // "Hello from NeevCloud!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface NeevCloudConfig {
  /** NeevCloud API key - if not provided, will use NEEV_API_KEY env var */
  apiKey?: string;
  /** Org the sandboxes belong to - if not provided, will use NEEV_ORG_ID env var */
  orgId?: string;
  /** Project the sandboxes belong to - if not provided, will use NEEV_PROJECT_ID env var */
  projectId?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}
```

### Preview URLs

Expose any port over a public HTTPS URL:

```typescript
await sandbox.runCommand('python3 -m http.server 3000', { background: true });
const url = await sandbox.getUrl({ port: 3000 });
```

### Boot Source

Start from a catalogue template, a raw OCI image, or the platform default (`templateId` and `image` are mutually exclusive):

```typescript
await compute.sandbox.create({ templateId: 'sb-ubuntu-24-04-minimal' });
await compute.sandbox.create({ image: 'docker.io/library/python:3.12' });
```
