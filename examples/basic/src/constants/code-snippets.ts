/**
 * Reusable code snippets for ComputeSDK examples
 * 
 * This file contains common code snippets used across different provider examples
 * to make the examples more readable and maintainable.
 */

// ============================================================================
// PYTHON CODE SNIPPETS
// ============================================================================

export const PYTHON_SNIPPETS = {
  // Basic hello world with system info
  HELLO_WORLD: `
import sys
print(f"Python version: {sys.version}")
print("Hello from ComputeSDK!")
print("🎉 Code execution successful!")
  `.trim(),

  // Fibonacci calculation
  FIBONACCI: `
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

print("Fibonacci sequence:")
for i in range(8):
    print(f"fibonacci({i}) = {fibonacci(i)}")
  `.trim(),

  // Data science with pandas/numpy
  DATA_SCIENCE: `
import pandas as pd
import numpy as np

# Create sample data
data = {'Name': ['Alice', 'Bob', 'Charlie'], 'Age': [25, 30, 35], 'Score': [85, 92, 78]}
df = pd.DataFrame(data)

print("DataFrame:")
print(df)
print(f"\\nAverage age: {df['Age'].mean():.1f}")
print(f"Average score: {df['Score'].mean():.1f}")
print(f"Total records: {len(df)}")
  `.trim(),

  // File processing script (for filesystem examples)
  FILE_PROCESSOR: `
def greet(name):
    return f"Hello, {name}! 👋"

def process_data(items):
    return [item.upper() for item in items]

# Main execution
print(greet("ComputeSDK"))
print("This script was written via filesystem operations!")

# Process some sample data
sample_data = ["apple", "banana", "cherry"]
processed = process_data(sample_data)
print(f"Processed data: {processed}")
  `.trim(),

  // Working directory and environment info
  ENVIRONMENT_INFO: `
import os
import sys
from datetime import datetime

print("=== Environment Information ===")
print(f"Current working directory: {os.getcwd()}")
print(f"Python executable: {sys.executable}")
print(f"Platform: {sys.platform}")
print(f"Current time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

# List some environment variables
env_vars = ['PATH', 'HOME', 'USER', 'SHELL']
print("\\n=== Environment Variables ===")
for var in env_vars:
    value = os.environ.get(var, 'Not set')
    print(f"{var}: {value[:50]}{'...' if len(value) > 50 else ''}")
  `.trim(),

  // Simple greeting for auto-detection
  SIMPLE_GREETING: (provider: string) => `
print("Hello from ${provider.toUpperCase()}!")
print("🚀 Auto-detection working perfectly!")
print("This code was executed automatically.")
  `.trim()
};

// ============================================================================
// NODE.JS CODE SNIPPETS
// ============================================================================

export const NODE_SNIPPETS = {
  // Basic hello world with system info
  HELLO_WORLD: `
console.log('Node.js version:', process.version);
console.log('Platform:', process.platform);
console.log('Architecture:', process.arch);
console.log('Hello from ComputeSDK! 🎉');
  `.trim(),

  // Team data processing
  TEAM_PROCESSING: `
const team = [
  { id: 1, name: 'Alice', role: 'Developer', experience: 5 },
  { id: 2, name: 'Bob', role: 'Designer', experience: 3 },
  { id: 3, name: 'Charlie', role: 'Manager', experience: 8 }
];

console.log('\\n=== Team Members ===');
team.forEach(member => {
  console.log(\`- \${member.name} (\${member.role}) - \${member.experience} years\`);
});

const avgExperience = team.reduce((sum, member) => sum + member.experience, 0) / team.length;
console.log(\`\\nAverage experience: \${avgExperience.toFixed(1)} years\`);
  `.trim(),

  // File system operations
  FILE_OPERATIONS: `
const fs = require('fs');
const path = require('path');

// Read configuration
const configPath = '/tmp/config.json';
if (fs.existsSync(configPath)) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log('Configuration loaded:', config.app, 'v' + config.version);
} else {
  console.log('No configuration file found');
}

// Create results
const results = { 
  processed: true, 
  timestamp: new Date().toISOString(),
  nodeVersion: process.version
};

fs.writeFileSync('/tmp/results.json', JSON.stringify(results, null, 2));
console.log('Results written to filesystem');
  `.trim(),

  // Simple greeting for auto-detection
  SIMPLE_GREETING: (provider: string) => `
console.log("Hello from ${provider.toUpperCase()}!");
console.log("🚀 Auto-detection working perfectly!");
console.log("This code was executed automatically.");
  `.trim()
};

// ============================================================================
// FILE CONTENT TEMPLATES
// ============================================================================

export const FILE_TEMPLATES = {
  // Python script for filesystem examples
  PYTHON_SCRIPT: `
def greet(name):
    return f"Hello, {name}!"

print(greet("ComputeSDK"))
print("This script was written via filesystem!")
  `.trim(),

  // Configuration file
  CONFIG_JSON: {
    app: 'ComputeSDK Demo',
    version: '1.0.0',
    environment: 'example',
    features: ['code-execution', 'filesystem', 'terminal']
  },

  // Sample data file
  SAMPLE_DATA: {
    users: [
      { name: 'Alice', age: 30, role: 'developer' },
      { name: 'Bob', age: 25, role: 'designer' }
    ],
    metadata: {
      created: new Date().toISOString(),
      source: 'ComputeSDK Example'
    }
  }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export const CODE_UTILS = {
  // Get appropriate greeting code based on provider and runtime
  getGreetingCode: (provider: string, runtime: 'python' | 'node' = 'python') => {
    if (runtime === 'python') {
      return PYTHON_SNIPPETS.SIMPLE_GREETING(provider);
    } else {
      return NODE_SNIPPETS.SIMPLE_GREETING(provider);
    }
  },

  // Get hello world code based on runtime
  getHelloWorldCode: (runtime: 'python' | 'node' = 'python') => {
    return runtime === 'python' ? PYTHON_SNIPPETS.HELLO_WORLD : NODE_SNIPPETS.HELLO_WORLD;
  },

  // Format JSON for file writing
  formatJSON: (obj: any) => JSON.stringify(obj, null, 2)
};