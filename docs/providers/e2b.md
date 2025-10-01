# E2B

E2B provider for ComputeSDK - Execute code in full development environments with terminal support.

## Installation

```bash
npm install @computesdk/e2b
```

## Usage

### With ComputeSDK

```typescript
import { createCompute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

// Set as default provider
const compute = createCompute({ 
  provider: e2b({ apiKey: process.env.E2B_API_KEY }) 
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Get instance
const instance = sandbox.getInstance();

// Execute code
const result = await sandbox.runCode('print("Hello from E2B!")');
console.log(result.stdout); // "Hello from E2B!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

### Direct Usage

```typescript
import { e2b } from '@computesdk/e2b';

// Create provider
const provider = e2b({ 
  apiKey: 'your-api-key',
  template: 'base'
});

// Use with compute singleton
const sandbox = await compute.sandbox.create({ provider });
```

## Configuration

### Environment Variables

```bash
export E2B_API_KEY=e2b_your_api_key_here
```

### Configuration Options

```typescript
interface E2BConfig {
  /** E2B API key - if not provided, will use E2B_API_KEY env var */
  apiKey?: string;
  /** Environment template to use */
  template?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Custom API URL */
  apiUrl?: string;
}
```

## API Reference

### Code Execution

```typescript
// Execute Python code
const result = await sandbox.runCode(`
import pandas as pd
import numpy as np
data = pd.DataFrame({'x': [1, 2, 3], 'y': [4, 5, 6]})
print(data.to_json())
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
const result = await sandbox.runCommand('pip', ['install', 'matplotlib']);

// Run Python scripts
const result = await sandbox.runCommand('python', ['script.py']);
```

### Filesystem Operations

```typescript
// Write file
await sandbox.filesystem.writeFile('/tmp/data.py', 'print("Hello World")');

// Read file
const content = await sandbox.filesystem.readFile('/tmp/data.py');

// Create directory
await sandbox.filesystem.mkdir('/tmp/project');

// List directory contents
const files = await sandbox.filesystem.readdir('/tmp');

// Check if file exists
const exists = await sandbox.filesystem.exists('/tmp/data.py');

// Remove file or directory
await sandbox.filesystem.remove('/tmp/data.py');
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

## Runtime Detection

The provider automatically detects the runtime based on code patterns:

**Python indicators:**
- `print(` statements
- `import` statements  
- `def` function definitions
- Python-specific syntax (`f"`, `__`, etc.)

**Default:** Node.js for all other cases

## Error Handling

```typescript
try {
  const result = await sandbox.runCode('invalid code');
} catch (error) {
  if (error.message.includes('Syntax error')) {
    console.error('Code has syntax errors');
  } else if (error.message.includes('authentication failed')) {
    console.error('Check your E2B_API_KEY');
  } else if (error.message.includes('quota exceeded')) {
    console.error('E2B usage limits reached');
  }
}
```

## Web Framework Integration

Use with web frameworks via the request handler:

```typescript
import { handleComputeRequest } from 'computesdk';
import { e2b } from '@computesdk/e2b';

export async function POST(request: Request) {
  return handleComputeRequest({
    request,
    provider: e2b({ apiKey: process.env.E2B_API_KEY })
  });
}
```

## Examples

### Data Science Analysis

```typescript
const result = await sandbox.runCode(`
import pandas as pd
import numpy as np

# Create sample data
data = pd.DataFrame({
    'name': ['Alice', 'Bob', 'Charlie'],
    'age': [25, 30, 35],
    'salary': [50000, 75000, 60000]
})

# Basic analysis
print("Dataset Overview:")
print(data)
print(f"\\nAverage salary: ${data['salary'].mean():,.2f}")
print(f"Age range: {data['age'].min()} - {data['age'].max()}")

# Export results
result = {
    "total_records": len(data),
    "avg_salary": float(data['salary'].mean()),
    "age_stats": {
        "min": int(data['age'].min()),
        "max": int(data['age'].max())
    }
}

import json
print("\\nResults:", json.dumps(result))
`);

const output = JSON.parse(result.stdout.split('Results: ')[1]);
console.log(output);
```

### File Processing with Terminal

```typescript
// Create data file
await sandbox.filesystem.writeFile('/tmp/data.csv', 
  'name,value\nAlice,100\nBob,200\nCharlie,150'
);

// Create terminal for interactive work
const terminal = await sandbox.terminal.create({
  command: 'bash',
  cols: 80,
  rows: 24
});

// Use terminal to process file
await terminal.write('cd /tmp\n');
await terminal.write('python3 -c "import pandas as pd; df=pd.read_csv(\\'data.csv\\'); print(df.describe())"\n');
await terminal.write('wc -l data.csv\n');

// Process with Python code
const result = await sandbox.runCode(`
import pandas as pd
df = pd.read_csv('/tmp/data.csv')

# Calculate statistics
stats = {
    "count": len(df),
    "total_value": df['value'].sum(),
    "average": df['value'].mean()
}

# Save processed data
df['processed'] = df['value'] * 1.1
df.to_csv('/tmp/processed_data.csv', index=False)

print(f"Processed {stats['count']} records")
print(f"Total value: {stats['total_value']}")
`);

// Clean up terminal
await terminal.kill();
```

### Machine Learning Workflow

```typescript
const result = await sandbox.runCode(`
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_squared_error, r2_score

# Generate sample data
np.random.seed(42)
X = np.random.randn(100, 1)
y = 2 * X.flatten() + 1 + np.random.randn(100) * 0.1

# Split data
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# Train model
model = LinearRegression()
model.fit(X_train, y_train)

# Make predictions
y_pred = model.predict(X_test)

# Evaluate
mse = mean_squared_error(y_test, y_pred)
r2 = r2_score(y_test, y_pred)

print(f"Model Performance:")
print(f"R² Score: {r2:.4f}")
print(f"MSE: {mse:.4f}")
print(f"Coefficient: {model.coef_[0]:.4f}")
print(f"Intercept: {model.intercept_:.4f}")

# Save model results
import json
results = {
    "r2_score": float(r2),
    "mse": float(mse),
    "coefficient": float(model.coef_[0]),
    "intercept": float(model.intercept_)
}
print("\\nModel Results:", json.dumps(results))
`);

console.log(result.stdout);
```