/**
 * Daytona Provider Example
 * 
 * This example shows how to use the Daytona provider for Python code execution
 * with filesystem support (but without terminal methods).
 * 
 * Prerequisites:
 * Set DAYTONA_API_KEY environment variable
 */

import { daytona } from '@computesdk/daytona';
import { config } from 'dotenv';
config(); // Load environment variables from .env file

async function main() {
  console.log('Daytona Provider Example');
  console.log('========================\n');
  
  if (!process.env.DAYTONA_API_KEY) {
    console.error('Please set DAYTONA_API_KEY environment variable');
    console.error('Get your Daytona API key from https://daytona.io/\n');
    process.exit(1);
  }

  try {
    // Create Daytona sandbox with filesystem capabilities
    const sandbox = daytona();

    console.log('Created Daytona sandbox:', sandbox.sandboxId);

    // Execute Python code
    const result = await sandbox.execute(`
import sys
print(f"Python version: {sys.version}")
print("Hello from Daytona!")

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
    console.log('Exit code:', result.exitCode);

    // Get sandbox info
    const info = await sandbox.getInfo();
    console.log('\nSandbox Info:', {
      id: info.id,
      runtime: info.runtime,
      status: info.status,
      provider: info.provider
    });

    // Filesystem operations
    console.log('\n--- Filesystem Operations ---');

    // Write and execute a Python script
    await sandbox.filesystem.writeFile('/tmp/script.py', `
def greet(name):
    return f"Hello, {name}!"

print(greet("Daytona"))
print("This script was written via filesystem!")
    `);

    const scriptResult = await sandbox.execute('python /tmp/script.py');
    console.log('Script output:', scriptResult.stdout);

    // Create directory and list files
    await sandbox.filesystem.mkdir('/tmp/data');
    const files = await sandbox.filesystem.readdir('/tmp');
    console.log('Files in /tmp:', files.map((f: any) => f.name));

    // Data science example
    console.log('\n--- Data Science Example ---');
    
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

    // Note about Daytona capabilities
    console.log('\n--- Daytona Features ---');
    console.log('Daytona provides:');
    console.log('- Fast development environment provisioning');
    console.log('- Pre-configured development containers');
    console.log('- Integrated development tools');
    console.log('- Team collaboration features');
    console.log('- Filesystem operations (read/write/mkdir/readdir)');
    console.log('- Code execution in isolated environments');
    console.log('- No terminal operations (by design)');

    // Clean up
    await sandbox.kill();
    console.log('\nDaytona sandbox terminated successfully');

  } catch (error) {
    console.error('❌ Error:', error.message);
    
    if (error.message.includes('API key') || error.message.includes('authentication')) {
      console.error('\n💡 Authentication failed:');
      console.error('- Get your Daytona API key from https://daytona.io/');
      console.error('- Set it as: export DAYTONA_API_KEY=your_key_here');
    } else if (error.message.includes('quota') || error.message.includes('limit')) {
      console.error('\n💡 Usage limit reached:');
      console.error('- Check your Daytona usage dashboard');
      console.error('- Consider upgrading your plan if needed');
    } else if (error.message.includes('not implemented')) {
      console.error('\n💡 Feature not yet implemented:');
      console.error('- Some Daytona features are still in development');
      console.error('- Check the Daytona documentation for current capabilities');
    } else {
      console.error('\n💡 For help with Daytona setup:');
      console.error('- Visit: https://daytona.io/docs');
      console.error('- Check your network connection');
      console.error('- Verify your API key is valid');
    }
  }
}

main();