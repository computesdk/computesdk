# @computesdk/modal

Modal provider for ComputeSDK - Execute code in serverless Modal sandboxes with full Python support and GPU acceleration.

> **✅ Full Implementation:** This provider uses Modal's official JavaScript SDK (v0.3.16) with complete real API integration. All code execution, filesystem operations, and command execution are implemented using actual Modal Sandbox APIs.

## Installation

```bash
npm install @computesdk/modal
```

## Setup

1. Get your Modal API credentials from [modal.com](https://modal.com/)
2. Set the environment variables:

```bash
export MODAL_TOKEN_ID=your_token_id_here
export MODAL_TOKEN_SECRET=your_token_secret_here
```

## Usage

### With ComputeSDK

```typescript
import { createCompute } from 'computesdk';
import { modal } from '@computesdk/modal';

// Set as default provider
const compute = createCompute({ 
  provider: modal({ 
    tokenId: process.env.MODAL_TOKEN_ID,
    tokenSecret: process.env.MODAL_TOKEN_SECRET
  }) 
});

// Create sandbox
const sandbox = await compute.sandbox.create({});

// Execute Python code with GPU acceleration
const result = await sandbox.runCode(`
import torch
import numpy as np

# Check if CUDA is available
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"GPU device: {torch.cuda.get_device_name()}")

# Create tensor operations
x = torch.randn(1000, 1000)
if torch.cuda.is_available():
    x = x.cuda()

y = torch.matmul(x, x.T)
print(f"Result shape: {y.shape}")
print(f"Mean: {y.mean().item():.4f}")
`);

console.log(result.stdout);

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

### Direct Usage

```typescript
import { modal } from '@computesdk/modal';

// Create provider
const provider = modal({ 
  tokenId: 'your_token_id',
  tokenSecret: 'your_token_secret',
  timeout: 600000 // 10 minutes
});

// Use with compute singleton
const sandbox = await compute.sandbox.create({ provider });
```

## Configuration

### Environment Variables

```bash
export MODAL_TOKEN_ID=your_token_id_here
export MODAL_TOKEN_SECRET=your_token_secret_here
```

### Configuration Options

```typescript
interface ModalConfig {
  /** Modal API token ID - if not provided, will use MODAL_TOKEN_ID env var */
  tokenId?: string;
  /** Modal API token secret - if not provided, will use MODAL_TOKEN_SECRET env var */
  tokenSecret?: string;
  /** Default runtime environment */
  runtime?: 'python' | 'node';
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Modal environment (sandbox or main) */
  environment?: string;
  /** Ports to expose (unencrypted by default) */
  ports?: number[];
}
```

### Port Configuration

To expose ports from your Modal sandbox and access them via public URLs, specify the ports in the config:

```typescript
import { createCompute } from 'computesdk';
import { modal } from '@computesdk/modal';

const compute = createCompute({ 
  provider: modal({ 
    tokenId: process.env.MODAL_TOKEN_ID,
    tokenSecret: process.env.MODAL_TOKEN_SECRET,
    ports: [3000, 8080] // Ports to expose
  }) 
});

const sandbox = await compute.sandbox.create({});

// Start a web server in the sandbox
await sandbox.runCode(`
import http.server
import socketserver

PORT = 3000

Handler = http.server.SimpleHTTPRequestHandler

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Server running on port {PORT}")
    httpd.serve_forever()
`, 'python');

// Get the public URL for the exposed port
const url = await sandbox.getUrl({ port: 3000 });
console.log(`Server accessible at: ${url}`);
```

#### Direct SDK Usage with Ports

```typescript
import { modal } from '@computesdk/modal';

// Create provider with ports
const provider = modal({ 
  tokenId: 'your_token_id',
  tokenSecret: 'your_token_secret',
  ports: [3000, 5000, 8080], // Multiple ports can be exposed
  timeout: 600000 // 10 minutes
});

const sandbox = await compute.sandbox.create({ provider });

// Access different services on different ports
const webUrl = await sandbox.getUrl({ port: 3000 });
const apiUrl = await sandbox.getUrl({ port: 8080 });
```

**Note**: Ports are exposed with unencrypted tunnels by default for maximum compatibility. The tunnels are publicly accessible URLs managed by Modal.

## Features

- ✅ **Code Execution** - Real Python code execution using Modal Sandbox.exec()
- ✅ **Command Execution** - Real shell command execution in Modal containers
- ✅ **Filesystem Operations** - Real file system access via Modal open() and exec() APIs
- ✅ **Serverless Scaling** - Automatic scaling to thousands of containers
- ✅ **GPU Support** - Easy GPU access with Modal's native GPU support
- ✅ **Full Modal Integration** - Complete real implementation using Modal JavaScript SDK

## Implementation Status

This provider uses Modal's **official JavaScript SDK** (v0.3.16) with **complete real API integration**:

✅ **Real Modal SDK Integration** - Uses the official `modal` npm package  
✅ **Authentication** - Full Modal API token handling with initializeClient()  
✅ **Sandbox Management** - Real create, connect, and destroy Modal sandboxes  
✅ **Code Execution** - Real Python execution using Modal Sandbox.exec()  
✅ **Filesystem Operations** - Real file operations using Modal open() API with fallbacks  
✅ **Command Execution** - Real shell command execution in Modal containers  
✅ **Status Monitoring** - Real sandbox status using Modal poll() API  

### Current Status
- **Package**: Uses `modal@0.3.16` from npm
- **Authentication**: Fully implemented with MODAL_TOKEN_ID/MODAL_TOKEN_SECRET
- **Core Structure**: Complete ComputeSDK provider interface
- **Execution**: **Real Modal API calls** for all operations
- **Filesystem**: Dual approach using Modal file API + command fallbacks
- **Error Handling**: Comprehensive error handling with Modal-specific errors

### Production Ready
This provider is **production ready** with real Modal API integration:
1. ✅ Real code execution via Modal Sandbox.exec()
2. ✅ Real filesystem operations via Modal open() + command fallbacks
3. ✅ Real command execution in Modal containers
4. ✅ Real sandbox lifecycle management
5. ✅ Comprehensive error handling and stream management

## Planned API Reference

### Code Execution

```typescript
// Execute Python code with real Modal Sandbox.exec()
const result = await sandbox.runCode(`
import torch
import numpy as np

# Check GPU availability
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name()}")

# Create tensor operations
x = torch.randn(1000, 1000).cuda() if torch.cuda.is_available() else torch.randn(1000, 1000)
y = torch.matmul(x, x.T)
print(f"Result shape: {y.shape}")
`, 'python');

console.log(result.stdout); // Real output from Modal sandbox
console.log(result.stderr); // Real errors if any
console.log(result.exitCode); // Real exit code

// Auto-detection (defaults to Python for Modal)
const result = await sandbox.runCode('print("Hello from real Modal sandbox!")');
```

### Command Execution

```typescript
// List files using real Modal exec()
const result = await sandbox.runCommand('ls', ['-la']);
console.log(result.stdout); // Real directory listing

// Install packages in real Modal container
const result = await sandbox.runCommand('pip', ['install', 'transformers', 'torch']);
console.log(result.stdout); // Real pip installation output

// Run ML training script in Modal
const result = await sandbox.runCommand('python', ['train.py', '--epochs', '10']);
console.log(result.stdout); // Real training output

// System commands with real GPU info
const result = await sandbox.runCommand('nvidia-smi');
console.log(result.stdout); // Real GPU information from Modal
```

### Filesystem Operations

```typescript
// Write files using real Modal file API
await sandbox.filesystem.writeFile('/app/train.py', `
import torch
import torch.nn as nn

class SimpleModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.linear = nn.Linear(10, 1)
    
    def forward(self, x):
        return self.linear(x)

model = SimpleModel()
print("Model created successfully!")
`);

// Read real file content from Modal sandbox
const content = await sandbox.filesystem.readFile('/app/train.py');
console.log(content); // Actual file content from Modal

// Create directories in real Modal filesystem
await sandbox.filesystem.mkdir('/app/data');
await sandbox.filesystem.mkdir('/app/models');

// List real directory contents from Modal
const files = await sandbox.filesystem.readdir('/app');
console.log(files); // Real file listing with metadata

// Check real file existence in Modal
const exists = await sandbox.filesystem.exists('/app/train.py');
console.log('File exists:', exists); // true if file actually exists

// Remove files from real Modal filesystem
await sandbox.filesystem.remove('/app/temp_file.txt');
```

### Sandbox Management

```typescript
// Get sandbox info
const info = await sandbox.getInfo();
console.log(info.id, info.provider, info.status);

// List all sandboxes (Modal Apps)
const sandboxes = await compute.sandbox.list(provider);

// Get existing sandbox by ID
const existing = await compute.sandbox.getById(provider, 'app-id');

// Destroy sandbox
await compute.sandbox.destroy(provider, 'app-id');
```

## Modal-Specific Features

### GPU Acceleration

```typescript
// Modal automatically handles GPU allocation
const result = await sandbox.runCode(`
import torch
print(f"CUDA available: {torch.cuda.is_available()}")

# Use GPU if available
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
model = model.to(device)
`);
```

### Serverless Scaling

```typescript
// Modal automatically scales based on demand
// No configuration needed - just execute code
const results = await Promise.all([
  sandbox.runCode(task1),
  sandbox.runCode(task2),
  sandbox.runCode(task3)
]);
```

### Container Images

```typescript
// Modal supports custom container images
const provider = modal({
  tokenId: process.env.MODAL_TOKEN_ID,
  tokenSecret: process.env.MODAL_TOKEN_SECRET,
  // Custom image configuration would be specified here
});
```

## Error Handling

```typescript
try {
  const result = await sandbox.runCode('invalid python code');
} catch (error) {
  if (error.message.includes('Missing Modal API credentials')) {
    console.error('Set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET environment variables');
  } else if (error.message.includes('authentication failed')) {
    console.error('Check your Modal API credentials');
  } else if (error.message.includes('quota exceeded')) {
    console.error('Modal usage limits reached');
  } else if (error.message.includes('Syntax error')) {
    console.error('Code has syntax errors');
  }
}
```

## Web Framework Integration

Use with web frameworks via the request handler:

```typescript
import { handleComputeRequest } from 'computesdk';
import { modal } from '@computesdk/modal';

export async function POST(request: Request) {
  return handleComputeRequest({
    request,
    provider: modal({ 
      tokenId: process.env.MODAL_TOKEN_ID,
      tokenSecret: process.env.MODAL_TOKEN_SECRET
    })
  });
}
```

## Examples

### Machine Learning Pipeline

```typescript
const sandbox = await compute.sandbox.create({});

// Create ML project structure
await sandbox.filesystem.mkdir('/ml-project');
await sandbox.filesystem.mkdir('/ml-project/data');
await sandbox.filesystem.mkdir('/ml-project/models');

// Write training script
const trainScript = `
import torch
import torch.nn as nn
import numpy as np
from torch.utils.data import DataLoader, TensorDataset

# Generate sample data
X = torch.randn(1000, 10)
y = torch.randn(1000, 1)

# Create dataset
dataset = TensorDataset(X, y)
dataloader = DataLoader(dataset, batch_size=32)

# Define model
class SimpleModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.linear = nn.Linear(10, 1)
    
    def forward(self, x):
        return self.linear(x)

# Train model
model = SimpleModel()
criterion = nn.MSELoss()
optimizer = torch.optim.Adam(model.parameters())

for epoch in range(10):
    for batch_x, batch_y in dataloader:
        optimizer.zero_grad()
        outputs = model(batch_x)
        loss = criterion(outputs, batch_y)
        loss.backward()
        optimizer.step()
    
    print(f"Epoch {epoch+1}, Loss: {loss.item():.4f}")

# Save model
torch.save(model.state_dict(), '/ml-project/models/model.pt')
print("Model saved!")
`;

await sandbox.filesystem.writeFile('/ml-project/train.py', trainScript);

// Run training
const result = await sandbox.runCode(`
import subprocess
result = subprocess.run(['python', '/ml-project/train.py'], 
                       capture_output=True, text=True)
print(result.stdout)
if result.stderr:
    print("Errors:", result.stderr)
`);

console.log(result.stdout);

// Verify model was saved
const modelExists = await sandbox.filesystem.exists('/ml-project/models/model.pt');
console.log('Model saved:', modelExists);
```

### GPU-Accelerated Inference

```typescript
const sandbox = await compute.sandbox.create({});

// GPU inference example
const result = await sandbox.runCode(`
import torch
import torch.nn as nn
import time

# Check GPU availability
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name()}")
    device = torch.device('cuda')
else:
    device = torch.device('cpu')

# Create large model for inference
class LargeModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.layers = nn.Sequential(
            nn.Linear(1000, 2000),
            nn.ReLU(),
            nn.Linear(2000, 1000),
            nn.ReLU(),
            nn.Linear(1000, 100)
        )
    
    def forward(self, x):
        return self.layers(x)

# Initialize model and move to GPU
model = LargeModel().to(device)
model.eval()

# Create test data
batch_size = 64
input_data = torch.randn(batch_size, 1000).to(device)

# Run inference
start_time = time.time()
with torch.no_grad():
    outputs = model(input_data)

inference_time = time.time() - start_time
print(f"Inference completed in {inference_time:.4f} seconds")
print(f"Output shape: {outputs.shape}")
print(f"Device: {outputs.device}")
`);

console.log(result.stdout);
```

### Distributed Processing

```typescript
// Process multiple tasks in parallel
const tasks = [
  'task1_data.json',
  'task2_data.json', 
  'task3_data.json'
];

const results = await Promise.all(
  tasks.map(async (taskFile) => {
    const sandbox = await compute.sandbox.create({});
    
    return await sandbox.runCode(`
import json
import numpy as np

# Load task data
with open('/data/${taskFile}', 'r') as f:
    data = json.load(f)

# Process data (example: statistical analysis)
values = np.array(data['values'])
results = {
    'task': '${taskFile}',
    'mean': float(values.mean()),
    'std': float(values.std()),
    'min': float(values.min()),
    'max': float(values.max()),
    'count': len(values)
}

print(json.dumps(results))
`);
  })
);

results.forEach(result => {
  const taskResult = JSON.parse(result.stdout);
  console.log(`Task ${taskResult.task}: mean=${taskResult.mean:.2f}`);
});
```

## Best Practices

1. **Resource Management**: Modal automatically manages resources, but destroy sandboxes when done
2. **Error Handling**: Use try-catch blocks for robust error handling  
3. **GPU Utilization**: Modal provides easy GPU access - leverage it for ML workloads
4. **Parallel Processing**: Use Modal's natural scaling for parallel tasks
5. **Container Images**: Use Modal's pre-built ML images for faster startup
6. **API Security**: Never commit API credentials to version control

## Limitations

- **JavaScript SDK**: No official Modal JavaScript SDK (Python-only)
- **Implementation Required**: This is a stub requiring actual Modal integration
- **Runtime Support**: Primarily Python-focused (Modal's strength)
- **Network Access**: Subject to Modal's networking policies
- **Billing**: Pay-per-use Modal pricing applies

## Modal vs Other Providers

| Feature | Modal | E2B | Vercel | Daytona |
|---------|--------|-----|--------|----------|
| **Primary Runtime** | Python | Python/Node | Node/Python | Any |
| **GPU Support** | ✅ Easy | ❌ | ❌ | ❌ |
| **Auto Scaling** | ✅ Thousands | ❌ | ✅ | ❌ |
| **ML/AI Focus** | ✅ Optimized | ✅ | ❌ | ❌ |
| **Pricing Model** | Pay-per-use | Per sandbox | Per execution | Per workspace |
| **Filesystem** | ✅ | ✅ | Limited | ✅ |

## Implementation Requirements

To complete this provider, one of the following approaches is needed:

### Python Bridge Service

```python
# example_bridge.py
from modal import App, Image, web_endpoint
import json

app = App("computesdk-bridge")

@app.function(
    image=Image.debian_slim().pip_install(["flask", "requests"]),
    port=8080
)
@web_endpoint(method="POST")
def execute_code(request_data: dict):
    """Bridge endpoint for executing code via Modal"""
    code = request_data.get('code')
    runtime = request_data.get('runtime', 'python')
    
    # Execute code in Modal sandbox
    # Return results in ComputeSDK format
    pass
```

### REST API Client

```typescript
// Hypothetical REST API implementation
class ModalRestClient {
  async createSandbox(config: ModalConfig) {
    // POST to Modal API
  }
  
  async executeCode(sandboxId: string, code: string) {
    // POST to Modal API  
  }
  
  async destroySandbox(sandboxId: string) {
    // DELETE from Modal API
  }
}
```

## Support

- [Modal Documentation](https://modal.com/docs)
- [ComputeSDK Issues](https://github.com/computesdk/computesdk/issues)
- [Modal Community](https://modal.com/slack)

## License

MIT