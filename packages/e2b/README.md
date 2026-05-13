# @computesdk/e2b

E2B provider for ComputeSDK - Execute code in secure, isolated E2B sandboxes with full filesystem and terminal support.

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

## Quick Start

Configure `compute` with the E2B provider and create a sandbox:

```typescript
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

compute.setConfig({
  provider: e2b({ apiKey: process.env.E2B_API_KEY }),
});

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand(`python - <<'PY'
import pandas as pd
import numpy as np

data = {'A': [1, 2, 3], 'B': [4, 5, 6]}
df = pd.DataFrame(data)
print(df)
print(f"Sum: {df.sum().sum()}")
PY`);

console.log(result.stdout);
await sandbox.destroy();
```

Alternatively, call the provider factory directly when you only need one provider:

```typescript
import { e2b } from '@computesdk/e2b';

const sdk = e2b({ apiKey: process.env.E2B_API_KEY });
const sandbox = await sdk.sandbox.create();
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
  /** Execution timeout in milliseconds */
  timeout?: number;
}
```

## Features

- ✅ **Command Execution** - Run shell commands in sandbox (Python/Node.js available)
- ✅ **Filesystem Operations** - Full file system access via E2B API
- ✅ **Data Science Ready** - Pre-installed pandas, numpy, matplotlib, etc.

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
await sandbox.filesystem.writeFile('/tmp/hello.py', 'print("Hello World")');

// Read file
const content = await sandbox.filesystem.readFile('/tmp/hello.py');

// Create directory
await sandbox.filesystem.mkdir('/tmp/data');

// List directory contents
const files = await sandbox.filesystem.readdir('/tmp');

// Check if file exists
const exists = await sandbox.filesystem.exists('/tmp/hello.py');

// Remove file or directory
await sandbox.filesystem.remove('/tmp/hello.py');
```

### Sandbox Management

```typescript
// Get sandbox info
const info = await sandbox.getInfo();
console.log(info.id, info.status, info.createdAt);

// Destroy sandbox
await sandbox.destroy();
```

## Error Handling

```typescript
import { e2b } from '@computesdk/e2b';

try {
  const compute = e2b({ apiKey: process.env.E2B_API_KEY });
  const sandbox = await compute.sandbox.create();
  
  const result = await sandbox.runCommand('invalid code');
} catch (error) {
  if (error.message.includes('Missing E2B API key')) {
    console.error('Set E2B_API_KEY environment variable');
  } else if (error.message.includes('Invalid E2B API key format')) {
    console.error('E2B API keys should start with "e2b_"');
  } else if (error.message.includes('authentication failed')) {
    console.error('Check your E2B API key');
  } else if (error.message.includes('quota exceeded')) {
    console.error('E2B usage limits reached');
  }
}
```

## Examples

### Data Science Workflow

```typescript
import { e2b } from '@computesdk/e2b';

const compute = e2b({ apiKey: process.env.E2B_API_KEY });
const sandbox = await compute.sandbox.create();

// Create project structure
await sandbox.filesystem.mkdir('/analysis');
await sandbox.filesystem.mkdir('/analysis/data');
await sandbox.filesystem.mkdir('/analysis/output');

// Write input data
const csvData = `name,age,city
Alice,25,New York
Bob,30,San Francisco
Charlie,35,Chicago`;

await sandbox.filesystem.writeFile('/analysis/data/people.csv', csvData);

// Process data with Python
const result = await sandbox.runCommand(`python - <<'PY'
import pandas as pd
import matplotlib.pyplot as plt

# Read data
df = pd.read_csv('/analysis/data/people.csv')
print("Data loaded:")
print(df)

# Calculate statistics
avg_age = df['age'].mean()
print(f"\\nAverage age: {avg_age}")

# Create visualization
plt.figure(figsize=(8, 6))
plt.bar(df['name'], df['age'])
plt.title('Age by Person')
plt.xlabel('Name')
plt.ylabel('Age')
plt.savefig('/analysis/output/age_chart.png')
print("\\nChart saved to /analysis/output/age_chart.png")

# Save results
results = {
    'total_people': len(df),
    'average_age': avg_age,
    'cities': df['city'].unique().tolist()
}

import json
with open('/analysis/output/results.json', 'w') as f:
    json.dump(results, f, indent=2)

print("Results saved!")
PY`);

console.log(result.stdout);

// Read the results
const results = await sandbox.filesystem.readFile('/analysis/output/results.json');
console.log('Analysis results:', JSON.parse(results));

// Check if chart was created
const chartExists = await sandbox.filesystem.exists('/analysis/output/age_chart.png');
console.log('Chart created:', chartExists);

await sandbox.destroy();
```

### Machine Learning Pipeline

```typescript
import { e2b } from '@computesdk/e2b';

const compute = e2b({ apiKey: process.env.E2B_API_KEY });
const sandbox = await compute.sandbox.create({ timeout: 600000 }); // 10 minutes for ML tasks

// Create ML project structure
await sandbox.filesystem.mkdir('/ml-project');
await sandbox.filesystem.mkdir('/ml-project/data');
await sandbox.filesystem.mkdir('/ml-project/models');

// Generate and process data
const result = await sandbox.runCommand(`python - <<'PY'
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_squared_error, r2_score
import joblib

# Generate sample dataset
np.random.seed(42)
X = np.random.randn(1000, 5)
y = X.sum(axis=1) + np.random.randn(1000) * 0.1

# Create DataFrame
feature_names = [f'feature_{i}' for i in range(5)]
df = pd.DataFrame(X, columns=feature_names)
df['target'] = y

print(f"Dataset shape: {df.shape}")
print("\\nDataset info:")
print(df.describe())

# Save dataset
df.to_csv('/ml-project/data/dataset.csv', index=False)
print("\\nDataset saved to /ml-project/data/dataset.csv")

# Split data
X_train, X_test, y_train, y_test = train_test_split(
    df[feature_names], df['target'], test_size=0.2, random_state=42
)

# Train model
model = LinearRegression()
model.fit(X_train, y_train)

# Make predictions
y_pred = model.predict(X_test)

# Evaluate
mse = mean_squared_error(y_test, y_pred)
r2 = r2_score(y_test, y_pred)

print(f"\\nModel Performance:")
print(f"MSE: {mse:.4f}")
print(f"R²: {r2:.4f}")

# Save model
joblib.dump(model, '/ml-project/models/linear_model.pkl')
print("\\nModel saved to /ml-project/models/linear_model.pkl")

# Save results
results = {
    'mse': mse,
    'r2': r2,
    'feature_importance': dict(zip(feature_names, model.coef_)),
    'intercept': model.intercept_
}

import json
with open('/ml-project/results.json', 'w') as f:
    json.dump(results, f, indent=2)

print("Results saved!")
PY`);

console.log(result.stdout);

// Read the results
const results = await sandbox.filesystem.readFile('/ml-project/results.json');
console.log('ML Results:', JSON.parse(results));

// Verify model file exists
const modelExists = await sandbox.filesystem.exists('/ml-project/models/linear_model.pkl');
console.log('Model saved:', modelExists);

await sandbox.destroy();
```

## Best Practices

1. **Resource Management**: Always destroy sandboxes when done to free resources
2. **Error Handling**: Use try-catch blocks for robust error handling
3. **Timeouts**: Set appropriate timeouts for long-running tasks
4. **File Organization**: Use the filesystem API to organize project files
5. **API Key Security**: Never commit API keys to version control

## Limitations

- **Sandbox Listing**: E2B doesn't support listing all sandboxes (each is managed individually)
- **Memory Limits**: Subject to E2B sandbox memory constraints
- **Network Access**: Limited outbound network access
- **File Persistence**: Files are not persisted between sandbox sessions
- **Execution Time**: Subject to E2B timeout limits

## Support

- [E2B Documentation](https://e2b.dev/docs)
- [ComputeSDK Issues](https://github.com/computesdk/computesdk/issues)
- [E2B Support](https://e2b.dev/support)

## License

MIT
