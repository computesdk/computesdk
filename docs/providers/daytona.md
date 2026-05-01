# Daytona

Daytona provider for ComputeSDK - Execute code in Daytona development workspaces.

## Installation & Setup

```bash
npm install @computesdk/daytona
```

Add your Daytona credentials to a `.env` file:

```bash
DAYTONA_API_KEY=your_daytona_api_key
```


## Usage

```typescript
import { daytona } from '@computesdk/daytona';

const compute = daytona({
  apiKey: process.env.DAYTONA_API_KEY,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Daytona!"');
console.log(result.stdout); // "Hello from Daytona!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface DaytonaConfig {
  /** Daytona API key - if not provided, will use DAYTONA_API_KEY env var */
  apiKey?: string;
  /** Default runtime environment (e.g. 'node', 'python') */
  runtime?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
}
```
