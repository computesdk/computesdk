# @computesdk/e2b

E2B provider for ComputeSDK - Execute Python code with full filesystem and terminal support in secure, isolated E2B sandboxes.

## Features

- 🐍 **Python Code Execution** - Run Python scripts with data science libraries
- 📁 **Full Filesystem Access** - Read, write, create directories, and manage files
- 🖥️ **Interactive Terminals** - PTY terminal sessions with real-time I/O
- ⚡ **Command Execution** - Run shell commands directly
- 🔒 **Secure Isolation** - Each sandbox runs in its own isolated environment
- 📊 **Data Science Ready** - Pre-installed pandas, numpy, matplotlib, scikit-learn

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

### Basic Code Execution

```typescript
import { e2b } from '@computesdk/e2b';

const sandbox = e2b();

// Execute Python code
const result = await sandbox.execute(`
import pandas as pd
import numpy as np

data = {'A': [1, 2, 3], 'B': [4, 5, 6]}
df = pd.DataFrame(data)
print(df)
print(f"Sum: {df.sum().sum()}")
`);

console.log(result.stdout);
// Output:
//    A  B
// 0  1  4
// 1  2  5
// 2  3  6
// Sum: 21

await sandbox.kill();
```

### With ComputeSDK Auto-Detection

```typescript
import { ComputeSDK } from 'computesdk';

// Automatically uses E2B if E2B_API_KEY is set
const sandbox = ComputeSDK.createSandbox();

const result = await sandbox.execute('print("Hello from E2B!")');
console.log(result.stdout); // "Hello from E2B!"
```

## Filesystem Operations

E2B provides full filesystem access through the `sandbox.filesystem` interface:

### File Operations

```typescript
import { e2b } from '@computesdk/e2b';

const sandbox = e2b();

// Write a file
await sandbox.filesystem.writeFile('/tmp/data.json', JSON.stringify({
  name: 'ComputeSDK',
  version: '1.0.0'
}));

// Read the file
const content = await sandbox.filesystem.readFile('/tmp/data.json');
console.log(JSON.parse(content)); // { name: 'ComputeSDK', version: '1.0.0' }

// Check if file exists
const exists = await sandbox.filesystem.exists('/tmp/data.json');
console.log(exists); // true

// Remove the file
await sandbox.filesystem.remove('/tmp/data.json');
```

### Directory Operations

```typescript
// Create directories
await sandbox.filesystem.mkdir('/project/data');
await sandbox.filesystem.mkdir('/project/output');

// List directory contents
const entries = await sandbox.filesystem.readdir('/project');
entries.forEach(entry => {
  console.log(`${entry.name} (${entry.isDirectory ? 'dir' : 'file'}) - ${entry.size} bytes`);
});

// Remove directory
await sandbox.filesystem.remove('/project/data');
```

### Data Science Workflow

```typescript
import { e2b } from '@computesdk/e2b';

const sandbox = e2b();

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
const result = await sandbox.execute(`
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
`);

console.log(result.stdout);

// Read the results
const results = await sandbox.filesystem.readFile('/analysis/output/results.json');
console.log('Analysis results:', JSON.parse(results));

// Check if chart was created
const chartExists = await sandbox.filesystem.exists('/analysis/output/age_chart.png');
console.log('Chart created:', chartExists);
```

## Terminal Operations

E2B supports interactive PTY terminals for real-time command execution:

### Basic Terminal Usage

```typescript
import { e2b } from '@computesdk/e2b';

const sandbox = e2b();

// Create a new terminal session
const terminal = await sandbox.terminal.create({
  command: 'bash',
  cols: 80,
  rows: 24
});

console.log(`Terminal created with PID: ${terminal.pid}`);

// Write commands to terminal
await terminal.write('echo "Hello from terminal!"\n');
await terminal.write('ls -la\n');
await terminal.write('python --version\n');

// Set up data handler for terminal output
terminal.onData = (data: Uint8Array) => {
  const output = new TextDecoder().decode(data);
  console.log('Terminal output:', output);
};

// Resize terminal
await terminal.resize(120, 30);

// List all active terminals
const terminals = await sandbox.terminal.list();
console.log(`Active terminals: ${terminals.length}`);

// Clean up
await terminal.kill();
```

### Interactive Python Session

```typescript
const sandbox = e2b();

// Start Python interpreter in terminal
const pythonTerminal = await sandbox.terminal.create({
  command: 'python3',
  cols: 80,
  rows: 24
});

// Set up output handler
pythonTerminal.onData = (data: Uint8Array) => {
  const output = new TextDecoder().decode(data);
  process.stdout.write(output); // Forward to console
};

// Send Python commands
await pythonTerminal.write('import numpy as np\n');
await pythonTerminal.write('import pandas as pd\n');
await pythonTerminal.write('print("Libraries loaded!")\n');
await pythonTerminal.write('data = np.array([1, 2, 3, 4, 5])\n');
await pythonTerminal.write('print(f"Mean: {data.mean()}")\n');
await pythonTerminal.write('exit()\n');

// Wait a moment for commands to execute
await new Promise(resolve => setTimeout(resolve, 2000));

await pythonTerminal.kill();
```

## Command Execution

Execute shell commands directly with full output capture:

```typescript
import { e2b } from '@computesdk/e2b';

const sandbox = e2b();

// Run shell commands
const lsResult = await sandbox.runCommand('ls', ['-la', '/tmp']);
console.log('Directory listing:', lsResult.stdout);

// Install packages
const pipResult = await sandbox.runCommand('pip', ['install', 'requests']);
console.log('Package installation:', pipResult.stdout);

// Run complex commands
const gitResult = await sandbox.runCommand('git', ['--version']);
console.log('Git version:', gitResult.stdout);

// Check system info
const systemResult = await sandbox.runCommand('uname', ['-a']);
console.log('System info:', systemResult.stdout);
```

## Configuration

```typescript
import { e2b } from '@computesdk/e2b';

const sandbox = e2b({
  timeout: 600000,  // 10 minutes (default: 5 minutes)
  runtime: 'python' // Only Python is supported
});
```

## API Reference

### Core Methods

#### `sandbox.execute(code: string, runtime?: Runtime): Promise<ExecutionResult>`

Execute Python code in the sandbox.

```typescript
const result = await sandbox.execute(`
x = 1 + 1
print(f"Result: {x}")
`);
// Returns: { stdout: "Result: 2", stderr: "", exitCode: 0, executionTime: 45 }
```

#### `sandbox.runCommand(command: string, args?: string[]): Promise<ExecutionResult>`

Execute shell commands.

```typescript
const result = await sandbox.runCommand('python', ['--version']);
// Returns: { stdout: "Python 3.11.0", stderr: "", exitCode: 0, executionTime: 12 }
```

#### `sandbox.getInfo(): Promise<SandboxInfo>`

Get sandbox information.

```typescript
const info = await sandbox.getInfo();
// Returns: { provider: "e2b", runtime: "python", status: "running", ... }
```

#### `sandbox.kill(): Promise<void>`

Terminate the sandbox and clean up resources.

```typescript
await sandbox.kill();
```

### Filesystem API

#### `sandbox.filesystem.readFile(path: string): Promise<string>`

Read file contents as text.

#### `sandbox.filesystem.writeFile(path: string, content: string): Promise<void>`

Write content to a file (creates file if it doesn't exist).

#### `sandbox.filesystem.mkdir(path: string): Promise<void>`

Create directory and parent directories if needed.

#### `sandbox.filesystem.readdir(path: string): Promise<FileEntry[]>`

List directory contents with metadata.

#### `sandbox.filesystem.exists(path: string): Promise<boolean>`

Check if file or directory exists.

#### `sandbox.filesystem.remove(path: string): Promise<void>`

Remove file or directory.

### Terminal API

#### `sandbox.terminal.create(options?: TerminalCreateOptions): Promise<InteractiveTerminalSession>`

Create a new PTY terminal session.

```typescript
const terminal = await sandbox.terminal.create({
  command: 'bash',  // Command to run (default: 'bash')
  cols: 80,         // Terminal width (default: 80)
  rows: 24          // Terminal height (default: 24)
});
```

#### `sandbox.terminal.list(): Promise<InteractiveTerminalSession[]>`

List all active terminal sessions.

#### Terminal Session Methods

- `terminal.write(data: string | Uint8Array): Promise<void>` - Send input to terminal
- `terminal.resize(cols: number, rows: number): Promise<void>` - Resize terminal
- `terminal.kill(): Promise<void>` - Terminate terminal session
- `terminal.onData: (data: Uint8Array) => void` - Output data handler

## Error Handling

```typescript
import { e2b } from '@computesdk/e2b';

try {
  const sandbox = e2b();
  const result = await sandbox.execute('invalid python code');
} catch (error) {
  if (error.message.includes('Missing E2B API key')) {
    console.error('Set E2B_API_KEY environment variable');
  } else if (error.message.includes('Invalid E2B API key format')) {
    console.error('E2B API keys should start with "e2b_"');
  } else if (error.message.includes('authentication failed')) {
    console.error('Check your E2B API key');
  } else if (error.message.includes('quota exceeded')) {
    console.error('E2B usage quota exceeded');
  } else if (error.message.includes('timeout')) {
    console.error('Execution timed out - consider increasing timeout');
  } else if (error.message.includes('memory limits')) {
    console.error('Memory limit exceeded - optimize your code');
  }
}
```

## Examples

### Machine Learning Pipeline

```typescript
import { e2b } from '@computesdk/e2b';

const sandbox = e2b({ timeout: 600000 }); // 10 minutes for ML tasks

// Create ML project structure
await sandbox.filesystem.mkdir('/ml-project');
await sandbox.filesystem.mkdir('/ml-project/data');
await sandbox.filesystem.mkdir('/ml-project/models');

// Generate sample data
const result = await sandbox.execute(`
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
`);

console.log(result.stdout);

// Read the results
const results = await sandbox.filesystem.readFile('/ml-project/results.json');
console.log('ML Results:', JSON.parse(results));

// Verify model file exists
const modelExists = await sandbox.filesystem.exists('/ml-project/models/linear_model.pkl');
console.log('Model saved:', modelExists);

await sandbox.kill();
```

### Web Scraping and Analysis

```typescript
import { e2b } from '@computesdk/e2b';

const sandbox = e2b();

// Install required packages and scrape data
const result = await sandbox.execute(`
import subprocess
import sys

# Install required packages
subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'requests', 'beautifulsoup4'])

import requests
from bs4 import BeautifulSoup
import json
import pandas as pd

# Example: Scrape Python.org news (respecting robots.txt)
url = 'https://www.python.org/jobs/'
headers = {'User-Agent': 'Mozilla/5.0 (compatible; ComputeSDK/1.0)'}

try:
    response = requests.get(url, headers=headers, timeout=10)
    response.raise_for_status()
    
    soup = BeautifulSoup(response.content, 'html.parser')
    
    # Extract job listings (example structure)
    jobs = []
    job_elements = soup.find_all('h2', class_='listing-company-name')[:5]  # Limit to 5
    
    for job_elem in job_elements:
        job_title = job_elem.get_text(strip=True)
        jobs.append({'title': job_title, 'source': 'python.org'})
    
    print(f"Found {len(jobs)} job listings:")
    for i, job in enumerate(jobs, 1):
        print(f"{i}. {job['title']}")
    
    # Save data
    with open('/tmp/jobs.json', 'w') as f:
        json.dump(jobs, f, indent=2)
    
    print("\\nData saved to /tmp/jobs.json")
    
except Exception as e:
    print(f"Error scraping data: {e}")
    # Create sample data instead
    jobs = [
        {'title': 'Senior Python Developer', 'source': 'example.com'},
        {'title': 'Data Scientist', 'source': 'example.com'},
        {'title': 'Backend Engineer', 'source': 'example.com'}
    ]
    
    with open('/tmp/jobs.json', 'w') as f:
        json.dump(jobs, f, indent=2)
    
    print("Created sample data instead")
`);

console.log(result.stdout);

// Read the scraped data
const jobsData = await sandbox.filesystem.readFile('/tmp/jobs.json');
console.log('Scraped jobs:', JSON.parse(jobsData));

await sandbox.kill();
```

## Best Practices

1. **Resource Management**: Always call `sandbox.kill()` when done to free resources
2. **Error Handling**: Use try-catch blocks for robust error handling
3. **Timeouts**: Set appropriate timeouts for long-running tasks
4. **File Organization**: Use the filesystem API to organize your project files
5. **Terminal Sessions**: Clean up terminal sessions with `terminal.kill()`
6. **Memory Usage**: Monitor memory usage for large datasets
7. **API Quotas**: Keep track of your E2B usage and quotas

## Limitations

- **Python Only**: Currently only supports Python runtime
- **Memory Limits**: Subject to E2B sandbox memory constraints
- **Network Access**: Limited outbound network access
- **Execution Time**: Default 5-minute timeout (configurable up to E2B limits)
- **File Persistence**: Files are not persisted between sandbox sessions

## Support

- [E2B Documentation](https://e2b.dev/docs)
- [ComputeSDK Issues](https://github.com/computesdk/computesdk/issues)
- [E2B Support](https://e2b.dev/support)

## License

MIT