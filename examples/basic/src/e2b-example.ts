/**
 * E2B Provider Example
 * 
 * This example shows how to use the E2B provider for Python code execution
 * with filesystem and terminal support.
 */

import { e2b } from '@computesdk/e2b';
import { executeSandbox, FullComputeSandbox } from 'computesdk';

async function main() {
  // Make sure E2B_API_KEY is set in environment variables
  if (!process.env.E2B_API_KEY) {
    console.error('Please set E2B_API_KEY environment variable');
    process.exit(1);
  }
  
  try {
    // Create E2B sandbox (defaults to Python)
    // E2B returns a FullComputeSandbox with filesystem and terminal support
    const sandbox = e2b() as FullComputeSandbox;
    
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
    
    // Demonstrate filesystem operations
    console.log('\n--- Filesystem Operations ---');
    
    // Write a Python script to a file
    await sandbox.filesystem.writeFile('/tmp/script.py', `
def greet(name):
    return f"Hello, {name}!"

if __name__ == "__main__":
    print(greet("E2B"))
    print("This script was written via the filesystem API!")
`.trim());
    
    // Read the file back
    const scriptContent = await sandbox.filesystem.readFile('/tmp/script.py');
    console.log('Script content:', scriptContent);
    
    // Execute the script from the filesystem
    const scriptResult = await sandbox.execute('python /tmp/script.py');
    console.log('Script output:', scriptResult.stdout);
    
    // Create a directory and list contents
    await sandbox.filesystem.mkdir('/tmp/data');
    await sandbox.filesystem.writeFile('/tmp/data/numbers.txt', '1\n2\n3\n4\n5');
    
    const files = await sandbox.filesystem.readdir('/tmp');
    console.log('\nFiles in /tmp:', files.map(f => f.name));
    
    // Demonstrate terminal operations
    console.log('\n--- Terminal Operations ---');
    
    // Create an interactive terminal session
    const terminal = await sandbox.terminal.create({
      cols: 80,
      rows: 24
    });
    
    console.log('Created terminal with PID:', terminal.pid);
    
    // Send commands to the terminal
    await terminal.write('python --version\n');
    await terminal.write('echo "Hello from terminal!"\n');
    
    // List active terminals
    const terminals = await sandbox.terminal.list();
    console.log('Active terminals:', terminals.length);
    
    // Kill the terminal
    await terminal.kill();
    
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
print("\nStatistics:")
print(df.describe())
      `.trim()
    });
    console.log(result2)
    console.log('\nData Science Output:', result2.stdout);
    
    // Clean up
    await sandbox.kill();
    console.log('\nSandbox cleaned up successfully');
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();