# Runloop

Runloop provider for ComputeSDK - Execute code in cloud-based devboxes with full development environments.

## Installation

```bash
npm install @computesdk/runloop
```

## Usage

### With ComputeSDK

```typescript
import { createCompute } from 'computesdk';
import { runloop } from '@computesdk/runloop';

// Set as default provider
const compute = createCompute({ 
  provider: runloop({ apiKey: process.env.RUNLOOP_API_KEY }) 
});

// Create devbox
const sandbox = await compute.sandbox.create();

// Get instance
const instance = sandbox.getInstance();

// Execute commands
const result = await sandbox.runCommand('python', ['-c', 'print("Hello from Runloop!")']);
console.log(result.stdout); // "Hello from Runloop!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

### Direct Usage

```typescript
import { runloop } from '@computesdk/runloop';

// Create provider
const provider = runloop({ 
  apiKey: 'your-api-key',
  timeout: 300000
});

// Use with compute singleton
const sandbox = await compute.sandbox.create({ provider });
```

## Configuration

### Environment Variables

```bash
export RUNLOOP_API_KEY=your_runloop_api_key_here
```

### Configuration Options

```typescript
interface RunloopConfig {
  /** Runloop API key - if not provided, will use RUNLOOP_API_KEY env var */
  apiKey?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
}
```

## API Reference

### Command Execution

```typescript
// Execute Python commands
const result = await sandbox.runCommand('python', ['-c', `
import sys
import json

data = {
    "python_version": sys.version,
    "message": "Hello from Python",
    "timestamp": "2023-12-01"
}

print(json.dumps(data, indent=2))
`]);

// Execute Node.js commands  
const result = await sandbox.runCommand('node', ['-e', `
const data = {
  nodeVersion: process.version,
  platform: process.platform,
  message: "Hello from Node.js"
};

console.log(JSON.stringify(data, null, 2));
`]);

// Install packages
const result = await sandbox.runCommand('npm', ['install', 'lodash', 'axios']);

// Run shell commands
const result = await sandbox.runCommand('ls', ['-la']);
```

### Filesystem Operations

```typescript
// Write file
await sandbox.filesystem.writeFile('/app/main.py', `
def greet(name):
    return f"Hello, {name}!"

def calculate_fibonacci(n):
    if n <= 1:
        return n
    return calculate_fibonacci(n-1) + calculate_fibonacci(n-2)

# Main execution
if __name__ == "__main__":
    print(greet("Runloop"))
    print(f"Fibonacci(10): {calculate_fibonacci(10)}")
`);

// Read file
const content = await sandbox.filesystem.readFile('/app/main.py');

// Create directory
await sandbox.filesystem.mkdir('/app/src');

// List directory contents
const files = await sandbox.filesystem.readdir('/app');

// Check if file exists
const exists = await sandbox.filesystem.exists('/app/main.py');

// Remove file or directory
await sandbox.filesystem.remove('/app/main.py');
```

### Sandbox Management

```typescript
// Get sandbox info
const info = await sandbox.getInfo();
console.log(info.id, info.provider, info.status);

// Get tunnel URL for port
const url = await sandbox.getUrl({ port: 8080 });
console.log('Access your app at:', url);

// List all sandboxes
const sandboxes = await compute.sandbox.list();

// Get existing sandbox
const existing = await compute.sandbox.getById('devbox-id');

// Destroy sandbox
await compute.sandbox.destroy('devbox-id');
```

## Blueprint Management

Runloop supports creating custom blueprints (templates) for devboxes:

```typescript
// Create custom blueprint
const blueprint = await compute.template.create({
  name: 'python-ml-environment',
  dockerfile: `
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \\
    build-essential \\
    curl \\
    git \\
    && rm -rf /var/lib/apt/lists/*

# Install Python packages
RUN pip install numpy pandas scikit-learn matplotlib jupyter

WORKDIR /app
  `,
  systemSetupCommands: [
    'pip install --upgrade pip',
    'pip install tensorflow torch'
  ],
  launchCommands: [
    'echo "ML environment ready!"'
  ],
  fileMounts: {
    '/app/requirements.txt': 'numpy\\npandas\\nscikit-learn\\nmatplotlib\\njupyter',
    '/app/README.md': '# Machine Learning Environment\\nThis devbox comes pre-configured with ML tools.'
  },
  resourceSize: 'LARGE',
  availablePorts: [8888, 8080]
});

// Use blueprint to create devbox
const mlSandbox = await compute.sandbox.create({
  options: { templateId: blueprint.id }
});

// List available blueprints
const blueprints = await compute.template.list();

// Delete blueprint
await compute.template.delete(blueprint.id);
```

## Snapshot Management

Create and restore devbox snapshots:

```typescript
// Create snapshot of current devbox state
const snapshot = await compute.snapshot.create(sandbox.sandboxId, {
  name: 'after-setup',
  metadata: { 
    description: 'Devbox after initial setup and package installation',
    packages: ['numpy', 'pandas', 'flask']
  }
});

// Create new devbox from snapshot
const restoredSandbox = await compute.sandbox.create({
  options: { templateId: snapshot.id }
});

// List all snapshots
const snapshots = await compute.snapshot.list();

// Delete snapshot
await compute.snapshot.delete(snapshot.id);
```

## Error Handling

```typescript
try {
  const result = await sandbox.runCommand('invalid-command');
} catch (error) {
  if (error.message.includes('command not found')) {
    console.error('Command does not exist in devbox');
  } else if (error.message.includes('authentication failed')) {
    console.error('Check your RUNLOOP_API_KEY');
  } else if (error.message.includes('execution failed')) {
    console.error('Command execution failed');
  }
}
```

## Web Framework Integration

Use with web frameworks via the request handler:

```typescript
import { handleComputeRequest } from 'computesdk';
import { runloop } from '@computesdk/runloop';

export async function POST(request: Request) {
  return handleComputeRequest({
    request,
    provider: runloop({ apiKey: process.env.RUNLOOP_API_KEY })
  });
}
```

## Examples

### Python Data Science

```typescript
// Create devbox with Python environment
const sandbox = await compute.sandbox.create();

// Install data science packages
await sandbox.runCommand('pip', ['install', 'pandas', 'numpy', 'matplotlib', 'seaborn']);

// Create data analysis script
await sandbox.filesystem.writeFile('/app/analysis.py', `
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns

# Create sample dataset
np.random.seed(42)
data = {
    'sales': np.random.normal(1000, 200, 100),
    'marketing_spend': np.random.normal(500, 100, 100),
    'region': np.random.choice(['North', 'South', 'East', 'West'], 100)
}

df = pd.DataFrame(data)

# Basic analysis
print("Dataset Overview:")
print(df.describe())
print("\\nCorrelation between sales and marketing spend:")
print(f"Correlation: {df['sales'].corr(df['marketing_spend']):.3f}")

# Regional analysis
print("\\nSales by Region:")
regional_stats = df.groupby('region')['sales'].agg(['mean', 'std', 'count'])
print(regional_stats)

# Save processed data
df.to_csv('/app/sales_data.csv', index=False)
print("\\nData saved to sales_data.csv")
`);

// Run analysis
const result = await sandbox.runCommand('python', ['/app/analysis.py']);
console.log('Analysis Output:', result.stdout);

// Read the generated CSV
const csvData = await sandbox.filesystem.readFile('/app/sales_data.csv');
console.log('Generated CSV:', csvData.slice(0, 200) + '...');
```

### Node.js Web Server

```typescript
// Create devbox
const sandbox = await compute.sandbox.create();

// Create Express server
await sandbox.filesystem.writeFile('/app/server.js', `
const express = require('express');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());

// Sample data
const tasks = [
  { id: 1, title: 'Setup Runloop devbox', completed: true, priority: 'high' },
  { id: 2, title: 'Build API endpoints', completed: false, priority: 'medium' },
  { id: 3, title: 'Add authentication', completed: false, priority: 'low' }
];

// Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'Runloop Task API',
    endpoints: {
      'GET /tasks': 'List all tasks',
      'POST /tasks': 'Create new task',
      'PUT /tasks/:id': 'Update task',
      'DELETE /tasks/:id': 'Delete task'
    }
  });
});

app.get('/tasks', (req, res) => {
  const { priority, completed } = req.query;
  let filteredTasks = tasks;
  
  if (priority) {
    filteredTasks = filteredTasks.filter(t => t.priority === priority);
  }
  
  if (completed !== undefined) {
    const isCompleted = completed === 'true';
    filteredTasks = filteredTasks.filter(t => t.completed === isCompleted);
  }
  
  res.json({ tasks: filteredTasks, total: filteredTasks.length });
});

app.post('/tasks', (req, res) => {
  const { title, priority = 'medium' } = req.body;
  
  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }
  
  const newTask = {
    id: Math.max(...tasks.map(t => t.id)) + 1,
    title,
    completed: false,
    priority
  };
  
  tasks.push(newTask);
  res.status(201).json(newTask);
});

app.put('/tasks/:id', (req, res) => {
  const taskId = parseInt(req.params.id);
  const task = tasks.find(t => t.id === taskId);
  
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  Object.assign(task, req.body);
  res.json(task);
});

app.delete('/tasks/:id', (req, res) => {
  const taskId = parseInt(req.params.id);
  const index = tasks.findIndex(t => t.id === taskId);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  tasks.splice(index, 1);
  res.status(204).send();
});

app.listen(port, () => {
  console.log(\`Task API server running on port \${port}\`);
});
`);

// Create package.json
const packageJson = {
  name: 'runloop-task-api',
  version: '1.0.0',
  main: 'server.js',
  scripts: {
    start: 'node server.js',
    dev: 'node server.js'
  },
  dependencies: {
    express: '^4.18.0',
    cors: '^2.8.5'
  }
};

await sandbox.filesystem.writeFile('/app/package.json', JSON.stringify(packageJson, null, 2));

// Install dependencies
console.log('Installing dependencies...');
await sandbox.runCommand('npm', ['install'], { cwd: '/app' });

// Start server (non-blocking)
console.log('Starting server...');
await sandbox.runCommand('node', ['server.js'], { cwd: '/app', timeout: 5000 });

// Get the public URL
const serverUrl = await sandbox.getUrl({ port: 8080 });
console.log('🚀 Task API available at:', serverUrl);

// Test the API
const testResult = await sandbox.runCommand('curl', ['-s', 'http://localhost:8080/tasks']);
console.log('API Response:', testResult.stdout);
```

### Machine Learning Model Training

```typescript
// Create devbox for ML workload
const sandbox = await compute.sandbox.create();

// Install ML packages
await sandbox.runCommand('pip', [
  'install', 
  'scikit-learn', 
  'pandas', 
  'numpy', 
  'matplotlib', 
  'joblib'
]);

// Create training script
await sandbox.filesystem.writeFile('/app/train_model.py', `
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, accuracy_score
import joblib
import json

# Generate synthetic dataset
np.random.seed(42)
n_samples = 1000

# Features: age, income, credit_score, debt_ratio
data = {
    'age': np.random.randint(18, 80, n_samples),
    'income': np.random.lognormal(10.5, 0.5, n_samples),
    'credit_score': np.random.randint(300, 850, n_samples),
    'debt_ratio': np.random.beta(2, 5, n_samples)
}

# Create target (loan approval) based on realistic criteria
df = pd.DataFrame(data)
df['loan_approved'] = (
    (df['credit_score'] > 600) & 
    (df['income'] > 40000) & 
    (df['debt_ratio'] < 0.4) &
    (df['age'] > 21)
).astype(int)

print("Dataset created:")
print(f"Samples: {len(df)}")
print(f"Approval rate: {df['loan_approved'].mean():.2%}")
print("\\nFeature distributions:")
print(df.describe())

# Prepare features
X = df[['age', 'income', 'credit_score', 'debt_ratio']]
y = df['loan_approved']

# Split data
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

# Train model
print("\\nTraining Random Forest model...")
model = RandomForestClassifier(
    n_estimators=100,
    max_depth=10,
    random_state=42,
    class_weight='balanced'
)

model.fit(X_train, y_train)

# Evaluate model
y_pred = model.predict(X_test)
accuracy = accuracy_score(y_test, y_pred)

print(f"\\nModel Performance:")
print(f"Accuracy: {accuracy:.3f}")
print("\\nClassification Report:")
print(classification_report(y_test, y_pred))

# Feature importance
feature_importance = pd.DataFrame({
    'feature': X.columns,
    'importance': model.feature_importances_
}).sort_values('importance', ascending=False)

print("\\nFeature Importance:")
print(feature_importance)

# Save model and metadata
joblib.dump(model, '/app/loan_model.pkl')

model_metadata = {
    'accuracy': float(accuracy),
    'features': list(X.columns),
    'feature_importance': feature_importance.to_dict('records'),
    'training_samples': len(X_train),
    'test_samples': len(X_test)
}

with open('/app/model_metadata.json', 'w') as f:
    json.dump(model_metadata, f, indent=2)

print("\\nModel saved to loan_model.pkl")
print("Metadata saved to model_metadata.json")

# Test prediction
sample_applicant = {
    'age': 35,
    'income': 75000,
    'credit_score': 720,
    'debt_ratio': 0.25
}

sample_features = np.array([[
    sample_applicant['age'],
    sample_applicant['income'],
    sample_applicant['credit_score'],
    sample_applicant['debt_ratio']
]])

prediction = model.predict(sample_features)[0]
probability = model.predict_proba(sample_features)[0][1]

print(f"\\nSample Prediction:")
print(f"Applicant: {sample_applicant}")
print(f"Prediction: {'Approved' if prediction else 'Denied'}")
print(f"Approval Probability: {probability:.3f}")
`);

// Run training
console.log('Training machine learning model...');
const trainingResult = await sandbox.runCommand('python', ['/app/train_model.py']);
console.log('Training Output:', trainingResult.stdout);

// Read model metadata
const metadata = await sandbox.filesystem.readFile('/app/model_metadata.json');
console.log('Model Metadata:', JSON.parse(metadata));

// Create inference script
await sandbox.filesystem.writeFile('/app/predict.py', `
import joblib
import json
import sys

# Load model
model = joblib.load('/app/loan_model.pkl')

# Get input from command line
if len(sys.argv) != 5:
    print("Usage: python predict.py <age> <income> <credit_score> <debt_ratio>")
    sys.exit(1)

age = float(sys.argv[1])
income = float(sys.argv[2])
credit_score = float(sys.argv[3])
debt_ratio = float(sys.argv[4])

# Make prediction
features = [[age, income, credit_score, debt_ratio]]
prediction = model.predict(features)[0]
probability = model.predict_proba(features)[0][1]

result = {
    'applicant': {
        'age': age,
        'income': income,
        'credit_score': credit_score,
        'debt_ratio': debt_ratio
    },
    'prediction': 'approved' if prediction else 'denied',
    'approval_probability': float(probability)
}

print(json.dumps(result, indent=2))
`);

// Test inference
const predictionResult = await sandbox.runCommand('python', [
  '/app/predict.py', '28', '65000', '750', '0.15'
]);
console.log('Prediction Result:', predictionResult.stdout);
```

### Development Environment Setup

```typescript
// Create blueprint for full-stack development
const devBlueprint = await compute.template.create({
  name: 'fullstack-dev-environment',
  dockerfile: `
FROM ubuntu:22.04

# Install system dependencies
RUN apt-get update && apt-get install -y \\
    curl \\
    git \\
    build-essential \\
    python3 \\
    python3-pip \\
    postgresql-client \\
    redis-tools \\
    && rm -rf /var/lib/apt/lists/*

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \\
    && apt-get install -y nodejs

# Install global tools
RUN npm install -g pm2 nodemon typescript ts-node
RUN pip3 install poetry black flake8 pytest

WORKDIR /workspace
  `,
  systemSetupCommands: [
    'git config --global init.defaultBranch main',
    'echo "export PATH=$PATH:/usr/local/bin" >> ~/.bashrc'
  ],
  launchCommands: [
    'echo "Full-stack development environment ready!"',
    'echo "Available tools: Node.js, Python, PostgreSQL client, Redis client"'
  ],
  fileMounts: {
    '/workspace/.gitconfig': `[user]
    email = dev@example.com
    name = Developer
[core]
    editor = nano`,
    '/workspace/README.md': `# Full-Stack Development Environment

This devbox includes:
- Node.js 18 with npm and global tools
- Python 3 with pip and poetry
- Git with basic configuration
- PostgreSQL and Redis clients
- Development tools (TypeScript, linting, testing)

## Quick Start

### Node.js Project
\`\`\`bash
npm init -y
npm install express
\`\`\`

### Python Project
\`\`\`bash
poetry init
poetry add fastapi uvicorn
\`\`\`
`
  },
  resourceSize: 'MEDIUM',
  availablePorts: [3000, 8000, 5432, 6379]
});

// Create devbox from blueprint
const devSandbox = await compute.sandbox.create({
  options: { templateId: devBlueprint.id }
});

console.log('Development environment created!');
console.log('Blueprint ID:', devBlueprint.id);
console.log('Devbox ID:', devSandbox.sandboxId);

// Verify tools are available
const toolsCheck = await devSandbox.runCommand('bash', ['-c', `
echo "=== Development Tools Check ==="
echo "Node.js: $(node --version)"
echo "npm: $(npm --version)"
echo "Python: $(python3 --version)"
echo "pip: $(pip3 --version)"
echo "Git: $(git --version)"
echo "TypeScript: $(tsc --version)"
echo "Poetry: $(poetry --version)"
echo "============================="
`]);

console.log('Tools Check:', toolsCheck.stdout);
```

## Resource Management

```typescript
// Create devbox with specific resource requirements
const heavyWorkloadSandbox = await compute.sandbox.create({
  provider: runloop({
    apiKey: process.env.RUNLOOP_API_KEY
  }),
  options: {
    templateId: 'bpt_custom_ml',  // Use blueprint with GPU support
    timeout: 3600000,  // 1 hour timeout
    metadata: {
      purpose: 'machine-learning',
      project: 'image-classification',
      team: 'data-science'
    }
  }
});

// Monitor resource usage
const usage = await heavyWorkloadSandbox.runCommand('bash', ['-c', `
echo "=== Resource Usage ==="
echo "CPU Usage:"
top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1
echo "Memory Usage:"
free -h | grep Mem | awk '{print "Used: " $3 "/" $2 " (" $3/$2*100 "%)"}'
echo "Disk Usage:"
df -h / | tail -1 | awk '{print "Used: " $3 "/" $2 " (" $5 ")"}'
echo "===================="
`]);

console.log('Resource Usage:', usage.stdout);
```

This documentation provides comprehensive coverage of the Runloop provider's capabilities, following the same structure and style as the CodeSandbox documentation while highlighting Runloop's unique features like blueprint management, snapshots, and development environment capabilities.