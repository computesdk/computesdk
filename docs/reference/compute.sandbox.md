# compute.sandbox


## Overview

Core methods for creating, destroying, listing, and retrieving sandbox instances.


## Prerequisites

### ComputeSDK API Key
```bash
COMPUTESDK_API_KEY=your_api_key_here
```

### Provider API Key / Environment Variables
```bash
PROVIDER_API_KEY=your_provider_api_key_here
```

### Install computesdk
```bash
npm install computesdk
```

<br/>
<br/>

---

## create()
the create method works out of the box, just ```import { compute } from 'computesdk'```, your provider is auto-detected from your .env file.  To create a sandbox simply use the following method: ```compute.sandbox.create()```

```typescript
import { compute } from 'computesdk';
// auto-detects provider from environment variables

// Create sandbox
const sandbox = await compute.sandbox.create();
```

<br/>
<br/>

---

## destroy()
to destroy a sandbox use ```compute.sandbox.destroy(sandbox.sandboxId)```

```typescript
import { compute } from 'computesdk';
// auto-detects provider from environment variables

// Create sandbox
const sandbox = await compute.sandbox.create();

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

<br/>
<br/>

---

## getById()
to get a specific sandbox by id use ```compute.sandbox.getById(sandbox.sandboxId)```

```typescript
// get a sandbox by id
const singleSandbox = await compute.sandbox.getById(sandbox.sandboxId);
console.log(singleSandbox);
```

<br/>
<br/>

---

## list()
to retrieve a list of your active sandboxes from your provider, use ```compute.sandbox.list()```

```typescript
// List all sandboxes
const sandboxes = await compute.sandbox.list();
console.log(`Active sandboxes: ${sandboxes.length}`);
```