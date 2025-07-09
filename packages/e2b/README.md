# @computesdk/e2b

E2B provider for ComputeSDK - Execute Python code in secure, isolated E2B sandboxes.

## Installation

```bash
npm install @computesdk/e2b
```

## Setup

1. Get your E2B API key from [e2b.dev](https://e2b.dev/)
2. Set the environment variable:

```bash
export E2B_API_KEY=e2b_your_api_key_here
```

## Usage

### Basic Usage

```typescript
import { e2b } from '@computesdk/e2b';

const provider = e2b();

// Execute Python code
const result = await provider.doExecute('print("Hello from E2B!")');
console.log(result.stdout); // "Hello from E2B!"
```

### With ComputeSDK

```typescript
import { executeSandbox } from 'computesdk';
import { e2b } from '@computesdk/e2b';

const result = await executeSandbox({
  sandbox: e2b(),
  code: 'print("Hello World")',
  runtime: 'python'
});
```

### Configuration

```typescript
import { e2b } from '@computesdk/e2b';

const provider = e2b({
  timeout: 300000,  // 5 minutes (default)
  runtime: 'python' // Only Python is supported
});
```

## API Reference

### `e2b(config?: SandboxConfig)`

Creates a new E2B provider instance.

#### Parameters

- `config` (optional): Configuration object
  - `timeout`: Execution timeout in milliseconds (default: 300000)
  - `runtime`: Runtime environment - only `'python'` is supported

#### Returns

`E2BProvider` instance implementing the `ComputeSpecification` interface.

### Provider Methods

#### `doExecute(code: string, runtime?: Runtime): Promise<ExecutionResult>`

Execute Python code in the E2B sandbox.

```typescript
const result = await provider.doExecute('x = 1 + 1\nprint(x)');
// result.stdout: "2"
// result.stderr: ""
// result.exitCode: 0
```

#### `doKill(): Promise<void>`

Terminates the E2B sandbox session.

```typescript
await provider.doKill();
```

#### `doGetInfo(): Promise<SandboxInfo>`

Get information about the sandbox.

```typescript
const info = await provider.doGetInfo();
// info.provider: "e2b"
// info.runtime: "python"
// info.status: "running" | "stopped"
```

## Error Handling

The provider includes comprehensive error handling:

### Authentication Errors

```typescript
// Missing API key
Error: Missing E2B API key. Set E2B_API_KEY environment variable. Get your API key from https://e2b.dev/

// Invalid API key format
Error: Invalid E2B API key format. E2B API keys should start with 'e2b_'. Check your E2B_API_KEY environment variable.

// Authentication failed
Error: E2B authentication failed. Please check your E2B_API_KEY environment variable. Get your API key from https://e2b.dev/
```

### Runtime Errors

```typescript
// Unsupported runtime
Error: E2B provider currently only supports Python runtime

// Execution timeout
Error: E2B execution timeout (300000ms). Consider increasing the timeout or optimizing your code.

// Memory limits
Error: E2B execution failed due to memory limits. Consider optimizing your code or using smaller data sets.
```

### Quota Errors

```typescript
// Quota exceeded
Error: E2B quota exceeded. Please check your usage at https://e2b.dev/
```

## Examples

### Data Analysis

```typescript
import { e2b } from '@computesdk/e2b';

const provider = e2b();

const code = `
import pandas as pd
import numpy as np

# Create sample data
data = {'A': [1, 2, 3], 'B': [4, 5, 6]}
df = pd.DataFrame(data)

print("DataFrame:")
print(df)
print(f"Sum of column A: {df['A'].sum()}")
`;

const result = await provider.doExecute(code);
console.log(result.stdout);
```

### Machine Learning

```typescript
import { e2b } from '@computesdk/e2b';

const provider = e2b();

const code = `
from sklearn.linear_model import LinearRegression
import numpy as np

# Sample data
X = np.array([[1], [2], [3], [4]])
y = np.array([2, 4, 6, 8])

# Train model
model = LinearRegression()
model.fit(X, y)

# Make prediction
prediction = model.predict([[5]])
print(f"Prediction for x=5: {prediction[0]}")
`;

const result = await provider.doExecute(code);
console.log(result.stdout); // "Prediction for x=5: 10.0"
```

### File Operations

```typescript
import { e2b } from '@computesdk/e2b';

const provider = e2b();

const code = `
# Write to file
with open('data.txt', 'w') as f:
    f.write('Hello from E2B sandbox!')

# Read from file
with open('data.txt', 'r') as f:
    content = f.read()
    print(f"File content: {content}")
`;

const result = await provider.doExecute(code);
console.log(result.stdout);
```

## Limitations

- **Python Only**: E2B provider currently only supports Python runtime
- **Timeout**: Default 5-minute execution timeout
- **Memory**: Subject to E2B sandbox memory limits
- **Network**: Limited network access in sandboxes

## Best Practices

1. **Always handle errors**: Use try-catch blocks for robust error handling
2. **Set appropriate timeouts**: Adjust timeout based on your use case
3. **Clean up resources**: Call `doKill()` when done to free resources
4. **Monitor usage**: Keep track of your E2B API usage and quotas
5. **Optimize code**: Write efficient Python code to avoid timeout/memory issues

## Support

- E2B Documentation: [e2b.dev/docs](https://e2b.dev/docs)
- ComputeSDK Issues: [GitHub Issues](https://github.com/computesdk/computesdk/issues)
- E2B Support: [E2B Support](https://e2b.dev/support)

## License

MIT