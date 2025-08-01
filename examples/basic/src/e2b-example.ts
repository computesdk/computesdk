/**
 * E2B Provider Example (Updated for @computesdk/e2b)
 *
 * This demonstrates Python code execution, simulated filesystem, and
 * simple data science in an E2B sandbox using only the supported methods.
 */

import { e2b } from '@computesdk/e2b';

async function main() {
  if (!process.env.E2B_API_KEY) {
    console.error('Please set E2B_API_KEY environment variable');
    process.exit(1);
  }

  const provider = e2b();

  try {
    // --- 1. Python Execution ---
    const result1 = await provider.doExecute(`
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
    `.trim());
    console.log('Output:\n', result1.stdout);

    // --- 2. Filesystem Operations via Python code ---
    const fsResult = await provider.doExecute(`
# Write to file
with open('/tmp/script.py', 'w') as f:
    f.write("""
def greet(name):
    return f'Hello, {name}!'

if __name__ == "__main__":
    print(greet('E2B'))
    print('This script was written via the filesystem API!')
""")

# Read and print file back
with open('/tmp/script.py', 'r') as f:
    content = f.read()
    print('Script content:\\n', content)

# Run the written file in a subprocess
import subprocess
run_result = subprocess.run(['python3', '/tmp/script.py'],
                            capture_output=True, text=True)
print('Script output:\\n', run_result.stdout.strip())
    `.trim());
    console.log('\n--- Filesystem Operations (simulated) ---\n' + fsResult.stdout);

    // --- 3. Directory and "ls" operations ---
    const lsResult = await provider.doExecute(`
import os
os.makedirs('/tmp/data', exist_ok=True)
with open('/tmp/data/numbers.txt', 'w') as f:
    f.write('1\\n2\\n3\\n4\\n5')

print('Files in /tmp:', os.listdir('/tmp'))
print('Files in /tmp/data:', os.listdir('/tmp/data'))
    `.trim());
    console.log('\nDirectory Operations:\n' + lsResult.stdout);

    // --- 4. Simulate Terminal Commands with subprocess ---
    const terminalResult = await provider.doExecute(`
import subprocess

print('--- Terminal Operations ---')
ver = subprocess.run(['python3', '--version'], capture_output=True, text=True)
print('Python version via terminal:', ver.stdout.strip())

echo = subprocess.run(['echo', 'Hello from terminal!'], capture_output=True, text=True)
print('Echo result:', echo.stdout.strip())
    `.trim());
    console.log(terminalResult.stdout);

    // --- 5. Data Science Operations ---
    const dsResult = await provider.doExecute(`
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
    `.trim());
    console.log('\nData Science Output:\n' + dsResult.stdout);

    // --- 6. Sandbox Info ---
    const info = await provider.doGetInfo();
    console.log('\nSandbox Info:', info);

  } catch (error: any) {
    console.error('Error:', error.message || error);
  } finally {
    await provider.doKill();
    console.log('\nE2B sandbox cleaned up successfully.');
  }
}

main();
