# @computesdk/blaxel

Blaxel provider for ComputeSDK - Execute code in secure Blaxel cloud sandboxes.

## Installation

```bash
npm install @computesdk/blaxel
```

## Usage

### With ComputeSDK

```typescript
import { createCompute } from 'computesdk';
import { blaxel } from '@computesdk/blaxel';

// Set as default provider
const compute = createCompute({ 
  provider: blaxel({ apiKey: process.env.BL_API_KEY }) 
compute.setConfig({ 
  provider: blaxel({ 
    apiKey: process.env.BLAXEL_API_KEY,
    workspace: process.env.BLAXEL_WORKSPACE 
  }) 
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Execute code
const result = await sandbox.runCode('console.log("Hello from Blaxel!")');
console.log(result.stdout); // "Hello from Blaxel!"

// Clean up
await sandbox.destroy();
```

### Direct Usage

```typescript
import { blaxel } from '@computesdk/blaxel';

// Create provider with configuration
const provider = blaxel({ 
  workspace: 'your-workspace',
  apiKey: 'your-api-key',
  image: 'blaxel/prod-py-app:latest',  // Python image
  memory: 8192,                         // 8GB RAM
  ports: [3000, 8080]                  // Exposed ports
});

// Use with compute singleton
const sandbox = await compute.sandbox.create({ 
  provider,
  options: {
    runtime: 'python',  // Runtime specified at creation time
    timeout: 3600000,   // 1 hour timeout
    envs: { 
      DEBUG: 'true' 
    }
  }
});
```

## Configuration

### Environment Variables

```bash
export BL_WORKSPACE=your_workspace_id
export BL_API_KEY=your_api_key_here
```

### Configuration Options

```typescript
interface BlaxelConfig {
  /** Blaxel workspace ID - fallback to BL_WORKSPACE env var */
  workspace?: string;
  /** Blaxel API key - fallback to BL_API_KEY env var */
  apiKey?: string;
  /** Default image for sandboxes */
  image?: string;
  /** Default region for sandbox deployment */
  region?: string;
  /** Default memory allocation in MB (default: 4096) */
  memory?: number;
  /** Default ports for sandbox (default: [3000]) */
  ports?: number[];
}
```

> 💡 **Note:** For persistent storage across sandbox sessions, see [Mounting & using sandbox volumes](https://docs.blaxel.ai/Sandboxes/Volumes)

### Default Images

The provider automatically selects images based on runtime:
- **Python:** `blaxel/prod-py-app:latest`
- **Node.js:** `blaxel/prod-ts-app:latest`
- **Default:** `blaxel/prod-base:latest`

## Features

- ✅ **Code Execution** - Python and Node.js runtime support with proper stdout/stderr streaming
- ✅ **Command Execution** - Run shell commands with background support
- ✅ **Filesystem Operations** - Full file system access (read, write, mkdir, ls, rm)
- ✅ **Auto Runtime Detection** - Automatically detects Python vs Node.js from code patterns
- ✅ **Custom Images** - Support for custom Docker images
- ✅ **Memory Configuration** - Configurable memory allocation
- ✅ **Preview URLs** - Public/private preview URLs with TTL, custom domains, and headers
- ✅ **Environment Variables** - Pass custom environment variables to sandboxes
- ✅ **Metadata Labels** - Attach custom metadata to sandboxes
- ✅ **Multi-Port Support** - Configure multiple ports for sandbox access
- ✅ **Status Detection** - Automatic conversion of Blaxel status to standard format

> 📚 For more details, see the [Sandbox technical guide](https://docs.blaxel.ai/Sandboxes/Overview)

## API Reference

### Code Execution

```typescript
// Execute Python code
const result = await sandbox.runCode(`
import json
data = {"message": "Hello from Python"}
print(json.dumps(data))
`, 'python');

// Execute Node.js code  
const result = await sandbox.runCode(`
const data = { message: "Hello from Node.js" };
console.log(JSON.stringify(data));
`, 'node');

// Auto-detection (based on code patterns)
const result = await sandbox.runCode('print("Auto-detected as Python")');
```

### Command Execution

```typescript
// List files
const result = await sandbox.runCommand('ls', ['-la']);

// Install packages
const result = await sandbox.runCommand('pip', ['install', 'requests']);

// Run background process
const bgResult = await sandbox.runCommand('npm', ['start'], { background: true });
console.log('Process started in background');
```

### Filesystem Operations

> 📚 For detailed filesystem API documentation, see the [Sandbox API reference](https://docs.blaxel.ai/api-reference/filesystem/get-file-or-directory-information)

```typescript
// Write file
await sandbox.filesystem.writeFile('/tmp/hello.py', 'print("Hello World")');

// Read file
const content = await sandbox.filesystem.readFile('/tmp/hello.py');

// Create directory
await sandbox.filesystem.mkdir('/tmp/data');

// List directory contents with metadata
const files = await sandbox.filesystem.readdir('/tmp');
// Returns FileEntry[] with name, path, isDirectory, size, lastModified

// Check if file exists
const exists = await sandbox.filesystem.exists('/tmp/hello.py');

// Remove file or directory
await sandbox.filesystem.remove('/tmp/hello.py');
```

### Sandbox Management

```typescript
// Get sandbox info
const info = await sandbox.getInfo();
console.log(info.id, info.provider, info.status, info.runtime);
// Status: 'running', 'stopped', or 'error'
// Runtime: Automatically detected from image name

// Create with specific configuration
const sandbox = await provider.sandbox.create({
  runtime: 'python',              // Selects appropriate image
  timeout: 1800000,               // 30 minutes in milliseconds (converted to "1800s")
  envs: {                         // Environment variables
    API_KEY: 'secret-key',
    NODE_ENV: 'production'
  },
  metadata: {                     // Custom metadata labels
    labels: {
      project: 'my-project',
      environment: 'staging'
    }
  }
});

// Create with custom memory and region
const customSandbox = await provider.sandbox.create({
  memory: 8192,                   // 8GB RAM
  region: 'us-pdx-1',            // See regions documentation below
  ports: [3000, 8080, 9000]      // Multiple ports
});

> 📚 Learn more: [Deployment regions](https://docs.blaxel.ai/Infrastructure/Regions) | [Specifying region when creating sandboxes](https://docs.blaxel.ai/Sandboxes/Overview#create-a-sandbox)

// Reconnect to existing sandbox
const existing = await provider.sandbox.create({ 
  sandboxId: 'blaxel-1234567890' 
});

// Get sandbox by ID
const sandbox = await provider.sandbox.getById('blaxel-1234567890');

// Destroy sandbox
await provider.sandbox.destroy('blaxel-1234567890');
```

### Preview URLs

> 📚 For a complete guide, see [Creating preview URLs & custom domains](https://docs.blaxel.ai/Sandboxes/Preview-url)

```typescript
// getUrl options interface
interface GetUrlOptions {
  port: number;                     // Port number to expose
  ttl?: number;                     // Preview TTL in milliseconds
  prefixUrl?: string;               // Custom prefix URL for the preview
  customDomain?: string;            // Custom domain for the preview
  headers?: {
    response?: Record<string, string>;  // Response headers sent to clients
    request?: Record<string, string>;   // Request headers for internal routing
  };
  authentication?: {
    public?: boolean;               // Create public preview (default: true)
    tokenExpiryMinutes?: number;    // Token expiry for private previews (default: 60)
  };
}

// Create a public preview URL (default headers applied)
const publicUrl = await sandbox.getUrl({ port: 3000 });
console.log(publicUrl); // https://tkmu0oj2bf6iuoag6mmlt8.preview.bl.run

// Create a private preview URL with authentication token
const privateUrl = await sandbox.getUrl({ 
  port: 3000,
  authentication: {
    public: false,
    tokenExpiryMinutes: 30  // Token expires in 30 minutes (default: 60)
  }
});
console.log(privateUrl); 
// https://tkmu0oj2bf6iuoag6mmlt8.preview.bl.run?bl_preview_token=<token>

// Create preview with custom TTL (Time To Live)
const shortLivedUrl = await sandbox.getUrl({
  port: 3000,
  ttl: 300000  // Preview expires in 5 minutes (300,000 ms)
});

// Create preview with custom CORS headers (replaces all defaults)
const customUrl = await sandbox.getUrl({
  port: 3000,
  headers: {
    response: {
      "Access-Control-Allow-Origin": "https://mydomain.com",
      "Access-Control-Allow-Methods": "GET, POST",
      "Access-Control-Allow-Credentials": "true",
      "X-Custom-Header": "custom-value"
    },
    request: {
      "X-Internal-Auth": "internal-token"
    }
  }
});

// Create preview with custom domain
const customDomainUrl = await sandbox.getUrl({
  port: 3000,
  customDomain: "app.example.com"
});

// Create preview with custom prefix URL
const prefixedUrl = await sandbox.getUrl({
  port: 3000,
  prefixUrl: "my-preview"
});
// https://my-preview-my-workspace.preview.bl.run

// Full example with all options
const advancedUrl = await sandbox.getUrl({
  port: 3000,
  ttl: 3600000,  // 1 hour TTL
  prefixUrl: "my-preview",
  customDomain: "preview.myapp.com",
  headers: {
    response: {
      "Access-Control-Allow-Origin": "https://myapp.com",
      "X-Frame-Options": "SAMEORIGIN"
    },
    request: {
      "X-API-Version": "v2"
    }
  },
  authentication: {
    public: false,
    tokenExpiryMinutes: 120  // 2 hour token
  }
});

// The token is automatically appended to the URL for private previews
// You can also pass the token as a header: X-Blaxel-Preview-Token
```

### Direct Instance Access

> 📚 You can also [connect to sandboxes remotely from a terminal](https://docs.blaxel.ai/Sandboxes/Overview#connect-to-a-sandbox-with-a-terminal) for direct access

```typescript
import { createBlaxelCompute } from '@computesdk/blaxel';

const compute = createBlaxelCompute({ 
  workspace: 'your-workspace',
  apiKey: 'your-key',
  memory: 4096,
  ports: [3000]
});

const sandbox = await compute.sandbox.create();
const instance = sandbox.getInstance(); // Typed as SandboxInstance

// Use Blaxel-specific features directly
const result = await instance.process.exec({ 
  command: 'ls -la'
});

// Stream logs from process
const stream = instance.process.streamLogs(result.name, {
  onStdout(data) { console.log('stdout:', data); },
  onStderr(data) { console.error('stderr:', data); }
});

// Wait for completion
await instance.process.wait(result.name);
stream.close();

// Access Blaxel filesystem API
await instance.fs.write('/tmp/test.txt', 'Hello Blaxel');
const content = await instance.fs.read('/tmp/test.txt');

// Create preview with Blaxel API
const preview = await instance.previews.create({
  spec: {
    port: 3000,
    public: true
  }
});
```

## Runtime Detection

The provider automatically detects the runtime based on code patterns:

**Python indicators:**
- `print(` statements
- `import` statements  
- `def` function definitions
- Python-specific syntax (`f"`, `f'`, `__`, `sys.`, `json.`)

**Default:** Node.js for all other cases

## Error Handling

```typescript
try {
  const result = await sandbox.runCode('invalid code');
} catch (error) {
  if (error.message.includes('Syntax error')) {
    console.error('Code has syntax errors');
  } else if (error.message.includes('authentication')) {
    console.error('Check your BL_API_KEY');
  } else if (error.message.includes('quota')) {
    console.error('Blaxel usage limits reached');
  }
}
```

### Exit Codes
- `0` - Success
- `1` - General error or runtime error
- `127` - Command not found

## Web Framework Integration

Use with web frameworks via the request handler:

```typescript
import { handleComputeRequest } from 'computesdk';
import { blaxel } from '@computesdk/blaxel';

export async function POST(request: Request) {
  return handleComputeRequest({
    request,
    provider: blaxel({ apiKey: process.env.BL_API_KEY })
  });
}
```

## Examples

### Data Processing

```typescript
const result = await sandbox.runCode(`
import json

# Process data
data = [1, 2, 3, 4, 5]
result = {
    "sum": sum(data),
    "average": sum(data) / len(data),
    "max": max(data)
}

print(json.dumps(result))
`);

const output = JSON.parse(result.stdout);
console.log(output); // { sum: 15, average: 3, max: 5 }
```

### File Processing

```typescript
// Create data file
await sandbox.filesystem.writeFile('/tmp/data.json', 
  JSON.stringify({ users: ['Alice', 'Bob', 'Charlie'] })
);

// Process file
const result = await sandbox.runCode(`
import json

with open('/tmp/data.json', 'r') as f:
    data = json.load(f)

# Process users
user_count = len(data['users'])
print(f"Found {user_count} users")

# Save result
result = {"user_count": user_count, "processed": True}
with open('/tmp/result.json', 'w') as f:
    json.dump(result, f)
`);

// Read result
const resultData = await sandbox.filesystem.readFile('/tmp/result.json');
console.log(JSON.parse(resultData));
```

### Web Scraping Example

```typescript
// Install dependencies
await sandbox.runCommand('pip', ['install', 'requests', 'beautifulsoup4']);

// Scrape website
const result = await sandbox.runCode(`
import requests
from bs4 import BeautifulSoup
import json

# Fetch webpage
response = requests.get('https://example.com')
soup = BeautifulSoup(response.text, 'html.parser')

# Extract title
title = soup.find('title').text if soup.find('title') else 'No title'

# Output result
result = {
    "status_code": response.status_code,
    "title": title,
    "content_length": len(response.text)
}

print(json.dumps(result))
`);

console.log(JSON.parse(result.stdout));
```

### API Development

```typescript
// Create a simple API server
await sandbox.filesystem.writeFile('/tmp/server.js', `
const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ 
    message: 'Hello from Blaxel!',
    timestamp: new Date().toISOString()
  }));
});

server.listen(3000, () => {
  console.log('Server running on port 3000');
});
`);

// Start server in background
await sandbox.runCommand('node', ['/tmp/server.js'], { background: true });

// Get the preview URL (public by default)
const url = await sandbox.getUrl({ port: 3000 });
console.log(`API available at: ${url}`);
// Example: https://tkmu0oj2bf6iuoag6mmlt8.preview.bl.run

// Or create a private API endpoint with authentication
const privateUrl = await sandbox.getUrl({ 
  port: 3000,
  authentication: {
    public: false,
    tokenExpiryMinutes: 120  // 2 hour token
  }
});
console.log(`Private API: ${privateUrl}`);
```

## Authentication Methods

1. **Automatic (when running on Blaxel)** - No configuration needed
2. **Via Configuration** - Pass credentials directly
3. **Via Environment Variables** - Set BL_WORKSPACE and BL_API_KEY
4. **Via Blaxel CLI** - Run `bl login` for local development

## Sandbox URLs

Blaxel sandboxes are accessible via dynamically generated preview URLs:
```
https://{unique-id}.preview.bl.run or https://{unique-id}.{region}.preview.bl.run
```

Or with custom domain:
```
https://{unique-id}.{custom-domain}
```

> 📚 Learn more about [preview URLs and custom domains](https://docs.blaxel.ai/Sandboxes/Preview-url)

### Public vs Private Previews

**Public Previews** (default):
- No authentication required
- Accessible to anyone with the URL
- Suitable for public demos and testing

**Private Previews**:
- Require authentication token
- Token can be passed as `bl_preview_token` query parameter
- Token can also be passed as `X-Blaxel-Preview-Token` header
- Configurable token expiry time

### Preview Configuration Options

**TTL (Time To Live)**:
- Controls how long the preview URL remains active
- Specified in milliseconds
- Automatically converted to Blaxel's format (e.g., "300s" for 5 minutes)

**Custom Domain**:
- Use your own domain for preview URLs
- Must be configured in Blaxel settings

**Prefix URL**:
- Add a path prefix to all preview URLs
- Useful for API versioning or routing

**Headers**:
- `response`: Headers sent to clients accessing the preview
- `request`: Headers used for internal routing within Blaxel

**Default Response Headers**:

The provider applies these CORS headers by default when no custom response headers are provided:
```javascript
{
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, X-Blaxel-Preview-Token, X-Blaxel-Authorization",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Expose-Headers": "Content-Length, X-Request-Id",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin"
}
```

**Note:** If you provide custom response headers, they completely replace the defaults. Make sure to include all necessary CORS headers when providing custom headers.

Example:
```typescript
// Public preview with default headers and settings
const url = await sandbox.getUrl({ port: 3000 });

// Private preview with 2-hour token and 24-hour TTL
const secureUrl = await sandbox.getUrl({ 
  port: 3000,
  ttl: 86400000,  // 24 hours in milliseconds
  authentication: {
    public: false,
    tokenExpiryMinutes: 120
  }
});

// Private preview with complete custom headers (replaces all defaults)
const customSecureUrl = await sandbox.getUrl({
  port: 3000,
  authentication: {
    public: false,
    tokenExpiryMinutes: 60
  },
  headers: {
    response: {
      // Must include all necessary CORS headers when providing custom headers, if you want ot
      "Access-Control-Allow-Origin": "https://app.example.com",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Blaxel-Preview-Token",
      "Access-Control-Allow-Credentials": "true",
      "X-Frame-Options": "SAMEORIGIN"
    },
    request: {
      "X-Service-Name": "preview-service",
      "X-Request-ID": "unique-request-id"
    }
  }
});
```

The provider automatically creates appropriate preview URLs with CORS headers configured for broad compatibility.

## Further Reading

### Core Documentation
- [Sandbox technical guide](https://docs.blaxel.ai/Sandboxes/Overview) - Comprehensive overview of Blaxel sandboxes
- [Sandbox API reference](https://docs.blaxel.ai/api-reference/filesystem/get-file-or-directory-information) - Complete API documentation for filesystem operations
- [ComputeSDK documentation](https://github.com/computesdk/computesdk) - Main SDK documentation

### Guides
- [Creating preview URLs & custom domains](https://docs.blaxel.ai/Sandboxes/Preview-url) - Detailed guide on preview configuration
- [Connecting to sandboxes remotely](https://docs.blaxel.ai/Sandboxes/Overview#connect-to-a-sandbox-with-a-terminal) - Terminal access to running sandboxes
- [Deployment regions](https://docs.blaxel.ai/Infrastructure/Regions) - Available regions and selection guide
- [Specifying regions for sandboxes](https://docs.blaxel.ai/Sandboxes/Overview#create-a-sandbox) - Region configuration during sandbox creation
- [Mounting & using sandbox volumes](https://docs.blaxel.ai/Sandboxes/Volumes) - Persistent storage with volumes

### Support
Feel free to reach out if you have any questions — we're here to help!

## License

MIT 
