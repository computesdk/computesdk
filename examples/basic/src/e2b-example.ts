/**
 * E2B Provider Example
 * 
 * This example shows how to use the E2B provider for Python code execution.
 */

import { e2b } from '@computesdk/e2b';
import { executeSandbox } from 'computesdk';

async function main() {
  // Make sure E2B_API_KEY is set in environment variables
  if (!process.env.E2B_API_KEY) {
    console.error('Please set E2B_API_KEY environment variable');
    process.exit(1);
  }
  
  try {
    // Create E2B sandbox (defaults to Python)
    const sandbox = e2b();
    
    console.log('Created E2B sandbox:', sandbox.sandboxId);
    
    // Execute Python code
    const result1 = await executeSandbox({
      sandbox,
      code: `
import sys
print(f"Python version: {sys.version}")
print("Hello from E2B!")

# Calculate fibonacci
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

for i in range(10):
    print(f"fibonacci({i}) = {fibonacci(i)}")
      `.trim()
    });
    
    console.log('Output:', result1.stdout);
    console.log('Execution time:', result1.executionTime, 'ms');
    
    // Execute with data science libraries
    const result2 = await executeSandbox({
      sandbox,
      code: `
import numpy as np
import pandas as pd

# Create a simple dataset
data = {
    'A': np.random.randn(5),
    'B': np.random.randn(5),
    'C': np.random.randn(5)
}

df = pd.DataFrame(data)
print("DataFrame:")
print(df)
print("\\nStatistics:")
print(df.describe())
      `.trim()
    });
    
    console.log('\nData Science Output:', result2.stdout);
    
    // Clean up
    await sandbox.kill();
    console.log('\nSandbox cleaned up successfully');
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();