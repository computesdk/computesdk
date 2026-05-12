# @computesdk/daytona

Daytona provider for ComputeSDK - Execute code in Daytona development workspaces.

## Installation

```bash
npm install @computesdk/daytona
```

## Quick Start

```typescript
import { daytona } from '@computesdk/daytona';

const compute = daytona({
  apiKey: process.env.DAYTONA_API_KEY
});

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand('python -c "print(\"Hello from Daytona!\")"');
console.log(result.stdout);

await sandbox.destroy();
```

## Configuration

### Environment Variables

```bash
export DAYTONA_API_KEY=your_api_key_here
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

## Features

- ✅ **Command Execution** - Run shell commands in workspace
- ✅ **Filesystem Operations** - Full file system access
- ❌ **Interactive Terminals** - Not supported by Daytona SDK

## API Reference

### Command Execution

```typescript
// Run Python code via heredoc
const result = await sandbox.runCommand(`python - <<'PY'
import json
data = {"message": "Hello from Python"}
print(json.dumps(data))
PY`);

// Run Node.js code via heredoc
const result = await sandbox.runCommand(`node - <<'JS'
const data = { message: "Hello from Node.js" };
console.log(JSON.stringify(data));
JS`);

// List files
const result = await sandbox.runCommand('ls -la');

// Install packages
const result = await sandbox.runCommand('pip install requests');

// Run scripts
const result = await sandbox.runCommand('python script.py');
```

### Filesystem Operations

```typescript
// Write file
await sandbox.filesystem.writeFile('/workspace/hello.py', 'print("Hello World")');

// Read file
const content = await sandbox.filesystem.readFile('/workspace/hello.py');

// Create directory
await sandbox.filesystem.mkdir('/workspace/data');

// List directory contents
const files = await sandbox.filesystem.readdir('/workspace');

// Check if file exists
const exists = await sandbox.filesystem.exists('/workspace/hello.py');

// Remove file or directory
await sandbox.filesystem.remove('/workspace/hello.py');
```

### Sandbox Management

```typescript
// Get sandbox info
const info = await sandbox.getInfo();
console.log(info.id, info.provider, info.status);

// List all sandboxes
const sandboxes = await compute.sandbox.list();

// Get existing sandbox
const existing = await compute.sandbox.getById('sandbox-id');

// Destroy sandbox
await compute.sandbox.destroy('sandbox-id');
```

## Error Handling

```typescript
import { daytona } from '@computesdk/daytona';

try {
  const compute = daytona({ apiKey: process.env.DAYTONA_API_KEY });
  const sandbox = await compute.sandbox.create();
  
  const result = await sandbox.runCommand('invalid code');
} catch (error) {
  if (error.message.includes('Syntax error')) {
    console.error('Code has syntax errors');
  } else if (error.message.includes('authentication failed')) {
    console.error('Check your DAYTONA_API_KEY');
  } else if (error.message.includes('quota exceeded')) {
    console.error('Daytona usage limits reached');
  }
}
```

## Examples

### Data Processing

```typescript
import { daytona } from '@computesdk/daytona';

const compute = daytona({ apiKey: process.env.DAYTONA_API_KEY });
const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand(`python - <<'PY'
import json

# Process data
data = [1, 2, 3, 4, 5]
result = {
    "sum": sum(data),
    "average": sum(data) / len(data),
    "max": max(data)
}

print(json.dumps(result))
PY`);

const output = JSON.parse(result.stdout);
console.log(output); // { sum: 15, average: 3, max: 5 }

await sandbox.destroy();
```

### File Processing

```typescript
import { daytona } from '@computesdk/daytona';

const compute = daytona({ apiKey: process.env.DAYTONA_API_KEY });
const sandbox = await compute.sandbox.create();

// Create data file
await sandbox.filesystem.writeFile('/workspace/data.json', 
  JSON.stringify({ users: ['Alice', 'Bob', 'Charlie'] })
);

// Process file
const result = await sandbox.runCommand(`python - <<'PY'
import json

with open('/workspace/data.json', 'r') as f:
    data = json.load(f)

# Process users
user_count = len(data['users'])
print(f"Found {user_count} users")

# Save result
result = {"user_count": user_count, "processed": True}
with open('/workspace/result.json', 'w') as f:
    json.dump(result, f)
PY`);

// Read result
const resultData = await sandbox.filesystem.readFile('/workspace/result.json');
console.log(JSON.parse(resultData));

await sandbox.destroy();
```

## License

MIT
