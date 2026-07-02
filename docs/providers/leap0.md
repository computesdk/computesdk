# Leap0

[Leap0](https://leap0.dev) provider for ComputeSDK - enterprise-grade cloud sandboxes for AI agents with full filesystem, git, process, and desktop support.


## Installation & Setup

```bash
npm install @computesdk/leap0
```

Add your Leap0 API key to a `.env` file:

```bash
LEAP0_API_KEY=your_leap0_api_key
```

Get your API key at [app.leap0.dev](https://app.leap0.dev/login).


## Usage

```typescript
import { leap0 } from '@computesdk/leap0';

const compute = leap0({
  apiKey: process.env.LEAP0_API_KEY,
  template: 'system/debian:bookworm',
});

// Create sandbox (uses the default template from config)
const sandbox = await compute.sandbox.create();

// Or override the template at create time via templateId
const sandbox2 = await compute.sandbox.create({
  templateId: 'system/code-interpreter:v0.1.0',
});

// Run a command
const result = await sandbox.runCommand('echo "Hello from Leap0!"');
console.log(result.stdout); // "Hello from Leap0!"

// Work with files
await sandbox.filesystem.writeFile('/tmp/hello.py', 'print("Hello World")');
const content = await sandbox.filesystem.readFile('/tmp/hello.py');

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface Leap0Config {
  /** Leap0 API key - if not provided, will use LEAP0_API_KEY env var */
  apiKey?: string;
  /** Base URL for the Leap0 API (default: https://api.leap0.dev) */
  baseUrl?: string;
  /** Sandbox domain for URL generation (default: sandbox.leap0.dev) */
  sandboxDomain?: string;
  /** Client timeout in seconds */
  timeout?: number;
  /** Default template name to use when creating sandboxes (e.g. 'system/debian:bookworm') */
  template?: string;
}
```
