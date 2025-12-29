# Sandbox Methods

Below are details related to sandbox methods. These are universal methods that can be used in any sandbox when using ComputeSDK.

<br />

## Prerequisites

### Get an API Key
1) Visit https://console.computesdk.com/register to create an account and get your ComputeSDK API key.
2) Next create a .env file in the root of your project and add your API key (this is where you will store your API keys for each of your providers):
```bash
COMPUTESDK_API_KEY=your_api_key_here
```

### Add provider specific env variables
- wondering which env variables you need from your provider? Supported providers & details found [here](/providers)
```bash
PROVIDER_API_KEY=your_provider_api_key_here
```

### Install computesdk
```bash
npm install computesdk
```


## create()
the create method works out of the box, just ```import { compute } from 'computesdk'```, your provider is auto-detected from your .env file.  To create a sandbox simply use the following method: ```compute.sandbox.create()```

```typescript
import { compute } from 'computesdk';
// auto-detects provider from environment variables

// Create sandbox
const sandbox = await compute.sandbox.create();
```

### Explicit Provider Configuration
If you prefer to set the provider explicitly, you can do so as follows:
```typescript
// Set as explicit provider
const sandbox = compute({ 
  provider: 'your-provider', 
  yourProvider: {
    yourProviderApiKey: process.env.YOUR_PROVIDER_API_KEY,
    // Add other provider-specific env variables here
  },
  apiKey: process.env.COMPUTESDK_API_KEY 
}).sandbox.create();
```

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



## getById()
to get a specific sandbox by id use ```compute.sandbox.getById(sandbox.sandboxId)```

```typescript
// get a sandbox by id
const singleSandbox = await compute.sandbox.getById(sandbox.sandboxId);
console.log(singleSandbox);
```


## list()
to retrieve a list of your active sandboxes from your provider, use ```compute.sandbox.list()```

```typescript
// List all sandboxes
const sandboxes = await compute.sandbox.list();
console.log(`Active sandboxes: ${sandboxes.length}`);
```


## runCommand()

Execute shell commands directly:

```typescript
// Simple command execution
const result = await sandbox.runCommand('ls', ['-la'])
console.log(result.stdout)

// Command with arguments
const result = await sandbox.runCommand('python', ['-c', 'print("Hello")'])

// With options
const result = await sandbox.runCommand('npm', ['install'], {
  cwd: '/app',
  env: { NODE_ENV: 'development' }
})
```

## runCode()

Execute code directly in the sandbox with automatic runtime detection:

```typescript
// Execute JavaScript/Node.js code
const result = await sandbox.runCode('console.log("Hello from Node.js!")')
console.log(result.stdout) // "Hello from Node.js!"

// Execute Python code  
const result = await sandbox.runCode('print("Hello from Python!")')
console.log(result.stdout) // "Hello from Python!"

// Specify runtime explicitly
const result = await sandbox.runCode('console.log("Hello")', 'node')
const result = await sandbox.runCode('print("Hello")', 'python')
```


## getUrl()
To generate a url for the sandbox, provide your port of choice and use ```sandbox.getUrl(port: number)```
```typescript
const result = await sandbox.getUrl(port: number)
```