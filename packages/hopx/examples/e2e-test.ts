/**
 * End-to-End Test: HopX Provider with ComputeSDK
 * 
 * This script demonstrates a realistic data processing workflow using
 * the HopX provider through ComputeSDK:
 * 
 * 1. Create a sandbox using the HopX provider
 * 2. Write a Python data processing script to the sandbox
 * 3. Execute the script to generate JSON results
 * 4. Read back the results via filesystem API
 * 5. Run shell commands to verify files
 * 6. Clean up the sandbox
 * 
 * Usage:
 *   HOPX_API_KEY=your_key npx tsx examples/e2e-test.ts
 */

import { hopx } from '../src/index.js';

// Color helpers for console output
const colors = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

// Test result tracking
interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

const results: TestResult[] = [];

/**
 * Run a test step and track the result
 */
async function runTest(name: string, fn: () => Promise<void>): Promise<boolean> {
  const start = Date.now();
  process.stdout.write(`  ${colors.dim('○')} ${name}...`);
  
  try {
    await fn();
    const duration = Date.now() - start;
    results.push({ name, passed: true, duration });
    console.log(`\r  ${colors.green('✓')} ${name} ${colors.dim(`(${duration}ms)`)}`);
    return true;
  } catch (error) {
    const duration = Date.now() - start;
    const errorMsg = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, duration, error: errorMsg });
    console.log(`\r  ${colors.red('✗')} ${name} ${colors.dim(`(${duration}ms)`)}`);
    console.log(`    ${colors.red('Error:')} ${errorMsg}`);
    return false;
  }
}

/**
 * Main test execution
 */
async function main() {
  console.log('\n' + colors.blue('═'.repeat(60)));
  console.log(colors.blue('  HopX Provider - End-to-End Test'));
  console.log(colors.blue('═'.repeat(60)) + '\n');

  // Check for API key
  const apiKey = process.env.HOPX_API_KEY;
  if (!apiKey) {
    console.log(colors.red('Error: HOPX_API_KEY environment variable is required'));
    console.log(colors.dim('Usage: HOPX_API_KEY=your_key npx tsx examples/e2e-test.ts'));
    process.exit(1);
  }

  console.log(colors.dim(`Using API key: ${apiKey.substring(0, 20)}...`));
  console.log('');

  // Initialize the HopX provider
  const provider = hopx({ apiKey });
  let sandbox: Awaited<ReturnType<typeof provider.sandbox.create>> | null = null;

  try {
    // =========================================================================
    // Test 1: Create Sandbox
    // =========================================================================
    console.log(colors.yellow('▶ Sandbox Lifecycle'));
    
    await runTest('Create sandbox', async () => {
      sandbox = await provider.sandbox.create({ runtime: 'python' });
      if (!sandbox || !sandbox.sandboxId) {
        throw new Error('Sandbox creation returned invalid result');
      }
    });

    if (!sandbox) {
      throw new Error('Failed to create sandbox');
    }

    await runTest('Get sandbox info', async () => {
      const info = await sandbox!.getInfo();
      if (!info.id || info.provider !== 'hopx') {
        throw new Error(`Invalid sandbox info: ${JSON.stringify(info)}`);
      }
    });

    // =========================================================================
    // Test 2: Filesystem Operations
    // =========================================================================
    console.log('\n' + colors.yellow('▶ Filesystem Operations'));

    const inputData = JSON.stringify({
      users: [
        { name: 'Alice', age: 30, city: 'New York' },
        { name: 'Bob', age: 25, city: 'San Francisco' },
        { name: 'Charlie', age: 35, city: 'Chicago' },
      ]
    }, null, 2);

    await runTest('Write input data file', async () => {
      await sandbox!.filesystem.writeFile('/workspace/input.json', inputData);
    });

    await runTest('Verify file exists', async () => {
      const exists = await sandbox!.filesystem.exists('/workspace/input.json');
      if (!exists) {
        throw new Error('File does not exist after writing');
      }
    });

    await runTest('Read file back', async () => {
      const content = await sandbox!.filesystem.readFile('/workspace/input.json');
      if (content !== inputData) {
        throw new Error('File content does not match');
      }
    });

    // Write the Python processing script
    const pythonScript = `
import json
import sys
from datetime import datetime

# Read input data
with open('/workspace/input.json', 'r') as f:
    data = json.load(f)

# Process data: calculate statistics
users = data['users']
total_age = sum(u['age'] for u in users)
avg_age = total_age / len(users)
cities = list(set(u['city'] for u in users))

# Generate result
result = {
    'processed_at': datetime.now().isoformat(),
    'user_count': len(users),
    'average_age': round(avg_age, 2),
    'total_age': total_age,
    'unique_cities': sorted(cities),
    'oldest_user': max(users, key=lambda u: u['age'])['name'],
    'youngest_user': min(users, key=lambda u: u['age'])['name'],
}

# Write output
with open('/workspace/output.json', 'w') as f:
    json.dump(result, f, indent=2)

# Print summary
print(f"Processed {len(users)} users")
print(f"Average age: {avg_age:.1f}")
print(f"Cities: {', '.join(cities)}")
print("Output written to /workspace/output.json")
`;

    await runTest('Write Python processing script', async () => {
      await sandbox!.filesystem.writeFile('/workspace/process.py', pythonScript);
    });

    // =========================================================================
    // Test 3: Code Execution
    // =========================================================================
    console.log('\n' + colors.yellow('▶ Code Execution'));

    await runTest('Execute Python script', async () => {
      const result = await sandbox!.runCode(`exec(open('/workspace/process.py').read())`, 'python');
      if (result.exitCode !== 0) {
        throw new Error(`Script failed with exit code ${result.exitCode}: ${result.output}`);
      }
      if (!result.output.includes('Processed 3 users')) {
        throw new Error(`Unexpected output: ${result.output}`);
      }
    });

    await runTest('Read generated output file', async () => {
      const outputContent = await sandbox!.filesystem.readFile('/workspace/output.json');
      const output = JSON.parse(outputContent);
      
      if (output.user_count !== 3) {
        throw new Error(`Expected 3 users, got ${output.user_count}`);
      }
      if (output.average_age !== 30) {
        throw new Error(`Expected average age 30, got ${output.average_age}`);
      }
      if (output.oldest_user !== 'Charlie') {
        throw new Error(`Expected oldest user Charlie, got ${output.oldest_user}`);
      }
      
      console.log(colors.dim(`      Output: ${JSON.stringify(output, null, 2).split('\n').join('\n      ')}`));
    });

    // Run inline Python code
    await runTest('Execute inline Python code', async () => {
      const code = `
import sys
import json
print(f"Python version: {sys.version_info.major}.{sys.version_info.minor}")
data = {"status": "ok", "message": "Hello from HopX!"}
print(json.dumps(data))
`;
      const result = await sandbox!.runCode(code, 'python');
      if (result.exitCode !== 0) {
        throw new Error(`Code failed: ${result.output}`);
      }
      if (!result.output.includes('"status": "ok"')) {
        throw new Error(`Unexpected output: ${result.output}`);
      }
    });

    // =========================================================================
    // Test 4: Shell Commands
    // =========================================================================
    console.log('\n' + colors.yellow('▶ Shell Commands'));

    await runTest('List workspace directory', async () => {
      const result = await sandbox!.runCommand('ls', ['-la', '/workspace']);
      if (result.exitCode !== 0) {
        throw new Error(`ls failed: ${result.stderr}`);
      }
      if (!result.stdout.includes('input.json') || !result.stdout.includes('output.json')) {
        throw new Error(`Expected files not found in output: ${result.stdout}`);
      }
    });

    await runTest('Cat output file via shell', async () => {
      const result = await sandbox!.runCommand('cat', ['/workspace/output.json']);
      if (result.exitCode !== 0) {
        throw new Error(`cat failed: ${result.stderr}`);
      }
      const output = JSON.parse(result.stdout);
      if (output.user_count !== 3) {
        throw new Error('Invalid JSON output');
      }
    });

    await runTest('Check Python version', async () => {
      const result = await sandbox!.runCommand('python3', ['--version']);
      if (result.exitCode !== 0) {
        throw new Error(`python3 --version failed: ${result.stderr}`);
      }
      if (!result.stdout.includes('Python') && !result.stderr.includes('Python')) {
        throw new Error(`Unexpected output: ${result.stdout} ${result.stderr}`);
      }
    });

    // =========================================================================
    // Test 5: Directory Operations
    // =========================================================================
    console.log('\n' + colors.yellow('▶ Directory Operations'));

    await runTest('Create directory', async () => {
      await sandbox!.filesystem.mkdir('/workspace/reports');
    });

    await runTest('Write file to new directory', async () => {
      await sandbox!.filesystem.writeFile('/workspace/reports/summary.txt', 'Test completed successfully!');
    });

    await runTest('List directory contents', async () => {
      const entries = await sandbox!.filesystem.readdir('/workspace');
      const names = entries.map(e => e.name);
      if (!names.includes('input.json') || !names.includes('output.json') || !names.includes('reports')) {
        throw new Error(`Missing expected files: ${names.join(', ')}`);
      }
    });

    await runTest('Remove file', async () => {
      await sandbox!.filesystem.remove('/workspace/reports/summary.txt');
      const exists = await sandbox!.filesystem.exists('/workspace/reports/summary.txt');
      if (exists) {
        throw new Error('File still exists after removal');
      }
    });

    // =========================================================================
    // Test 6: Cleanup
    // =========================================================================
    console.log('\n' + colors.yellow('▶ Cleanup'));

    await runTest('Destroy sandbox', async () => {
      await sandbox!.destroy();
      sandbox = null;
    });

  } catch (error) {
    console.log('\n' + colors.red('Fatal error:'), error);
  } finally {
    // Ensure cleanup happens
    if (sandbox) {
      console.log(colors.dim('\nCleaning up sandbox...'));
      try {
        await sandbox.destroy();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('\n' + colors.blue('═'.repeat(60)));
  console.log(colors.blue('  Test Summary'));
  console.log(colors.blue('═'.repeat(60)));
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`\n  Total tests: ${results.length}`);
  console.log(`  ${colors.green(`Passed: ${passed}`)}`);
  if (failed > 0) {
    console.log(`  ${colors.red(`Failed: ${failed}`)}`);
  }
  console.log(`  Duration: ${(totalDuration / 1000).toFixed(2)}s\n`);

  if (failed > 0) {
    console.log(colors.red('  Some tests failed!\n'));
    process.exit(1);
  } else {
    console.log(colors.green('  All tests passed!\n'));
    process.exit(0);
  }
}

// Run the tests
main().catch(console.error);
