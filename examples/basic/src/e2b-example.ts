/**
 * E2B Provider Example
 * 
 * This example shows how to use the E2B provider for Python code execution
 * with filesystem and terminal support.
 */

import { e2b } from '@computesdk/e2b';
import { config } from 'dotenv';
config(); // Load environment variables from .env file

async function main() {
  if (!process.env.E2B_API_KEY) {
    console.error('Please set E2B_API_KEY environment variable');
    process.exit(1);
  }

  try {
    // Create E2B sandbox with full capabilities
    const sandbox = e2b();

    console.log('Created E2B sandbox:', sandbox.sandboxId);

    // Execute Python code
    const result = await sandbox.execute(`
import sys
print(f"Python version: {sys.version}")
print("Hello from E2B!")

# Calculate fibonacci
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

for i in range(5):
    print(f"fibonacci({i}) = {fibonacci(i)}")
    `);

    console.log('Output:', result.stdout);
    console.log('Execution time:', result.executionTime, 'ms');

    // Filesystem operations
    console.log('\n--- Filesystem Operations ---');

    // Write and execute a Python script
    await sandbox.filesystem.writeFile('/tmp/script.py', `
def greet(name):
    return f"Hello, {name}!"

print(greet("E2B"))
print("This script was written via filesystem!")
    `);

    const scriptResult = await sandbox.execute('python /tmp/script.py');
    console.log('Script output:', scriptResult.stdout);

    // Create directory and list files
    await sandbox.filesystem.mkdir('/tmp/data');
    const files = await sandbox.filesystem.readdir('/tmp');
    console.log('Files in /tmp:', files.map(f => f.name));

    // Terminal operations
    console.log('\n--- Terminal Operations ---');

    // Create interactive terminal
    const terminal = await sandbox.terminal.create();
    console.log('Created terminal with PID:', terminal.pid);

    // Send commands
    await terminal.write('echo "Hello from terminal!"\n');
    
    // List active terminals
    const terminals = await sandbox.terminal.list();
    console.log('Active terminals:', terminals.length);

    // Clean up terminal
    await terminal.kill();

    // Data science example
    console.log('\n--- Data Science ---');
    
    const dataResult = await sandbox.execute(`
import pandas as pd
import numpy as np

# Create sample data
data = {'A': [1, 2, 3], 'B': [4, 5, 6]}
df = pd.DataFrame(data)
print("DataFrame:")
print(df)
print(f"Sum: {df.sum().sum()}")
    `);
    
    console.log('Data Science Output:', dataResult.stdout);

    // Clean up
    await sandbox.kill();
    console.log('\nSandbox cleaned up successfully');

  } catch (error) {
    console.error('Error:', error.message);
    if (error.message.includes('API key')) {
      console.error('Get your E2B API key from https://e2b.dev/');
    }
  }
}

main();
