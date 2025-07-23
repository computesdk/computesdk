import { describe, it, expect, beforeEach } from 'vitest'
import { browser, BrowserSandbox } from '../../index.js'

/**
 * Integration tests for runtime execution (QuickJS/Pyodide)
 * 
 * These tests require a real browser environment with WebAssembly support.
 * They should be run with Playwright or similar browser automation tools.
 * 
 * To run these tests:
 * 1. Set up Playwright: pnpm add -D playwright @playwright/test
 * 2. Create playwright.config.ts
 * 3. Run: pnpm playwright test
 */
describe('Runtime Integration Tests', () => {
  let sandbox: BrowserSandbox

  beforeEach(async () => {
    sandbox = browser({ resetPersistence: true })
  })

  describe('JavaScript Runtime (QuickJS)', () => {
    it('should execute JavaScript code', async () => {
      const code = 'console.log("Hello from browser sandbox")'
      const result = await sandbox.runCode(code)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Hello from browser sandbox')
      expect(result.stderr).toBe('')
      expect(result.provider).toBe('browser')
      expect(result.sandboxId).toBe(sandbox.sandboxId)
    })

    it('should handle JavaScript errors', async () => {
      const code = 'throw new Error("Test error")'
      const result = await sandbox.runCode(code)

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Test error')
    })

    it('should execute complex JavaScript', async () => {
      const code = `
        function fibonacci(n) {
          if (n <= 1) return n;
          return fibonacci(n - 1) + fibonacci(n - 2);
        }
        console.log('Fibonacci(10):', fibonacci(10));
      `
      const result = await sandbox.runCode(code)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Fibonacci(10): 55')
    })

    it('should handle async JavaScript', async () => {
      const code = `
        async function delay(ms) {
          return new Promise(resolve => setTimeout(resolve, ms));
        }
        
        async function main() {
          await delay(10);
          console.log('Async completed');
        }
        
        main();
      `
      const result = await sandbox.runCode(code)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Async completed')
    })
  })

  describe('Python Runtime (Pyodide)', () => {
    it('should execute Python code', async () => {
      const code = 'print("Hello from Python")'
      const result = await sandbox.runCode(code, 'python')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Hello from Python')
      expect(result.stderr).toBe('')
    })

    it('should handle Python errors', async () => {
      const code = 'raise ValueError("Test Python error")'
      const result = await sandbox.runCode(code, 'python')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('ValueError: Test Python error')
    })

    it('should execute Python with imports', async () => {
      const code = `
import math
result = math.sqrt(16)
print(f"Square root of 16: {result}")
      `
      const result = await sandbox.runCode(code, 'python')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Square root of 16: 4.0')
    })

    it('should handle Python data processing', async () => {
      const code = `
data = [1, 2, 3, 4, 5]
squared = [x**2 for x in data]
print("Original:", data)
print("Squared:", squared)
      `
      const result = await sandbox.runCode(code, 'python')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Original: [1, 2, 3, 4, 5]')
      expect(result.stdout).toContain('Squared: [1, 4, 9, 16, 25]')
    })
  })

  describe('Runtime Integration with Shell', () => {
    it('should execute JavaScript files via node command', async () => {
      // Create a JavaScript file
      await sandbox.filesystem.writeFile('/script.js', 'console.log("Hello from file")')
      
      // Execute via shell command
      const result = await sandbox.runCommand('node /script.js')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Hello from file')
    })

    it('should execute Python files via python command', async () => {
      // Create a Python file
      await sandbox.filesystem.writeFile('/script.py', 'print("Hello from Python file")')
      
      // Execute via shell command
      const result = await sandbox.runCommand('python /script.py')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Hello from Python file')
    })

    it('should handle file system integration', async () => {
      const jsCode = `
        const fs = require('fs'); // Mock fs for browser
        console.log('File system integration test');
      `
      await sandbox.filesystem.writeFile('/fs-test.js', jsCode)
      
      const result = await sandbox.runCommand('node /fs-test.js')
      expect(result.exitCode).toBe(0)
    })
  })

  describe('Performance and Memory', () => {
    it('should handle large computations', async () => {
      const code = `
        let sum = 0;
        for (let i = 0; i < 1000000; i++) {
          sum += i;
        }
        console.log('Sum:', sum);
      `
      const result = await sandbox.runCode(code)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Sum: 499999500000')
    })

    it('should handle memory cleanup', async () => {
      // Execute multiple scripts to test memory management
      for (let i = 0; i < 10; i++) {
        const code = `console.log('Iteration ${i}')`
        const result = await sandbox.runCode(code)
        expect(result.exitCode).toBe(0)
      }
    })

    it('should handle concurrent executions', async () => {
      const promises: Promise<any>[] = []
      
      for (let i = 0; i < 5; i++) {
        const code = `console.log('Concurrent execution ${i}')`
        promises.push(sandbox.runCode(code))
      }
      
      const results = await Promise.all(promises)
      
      results.forEach((result, i) => {
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain(`Concurrent execution ${i}`)
      })
    })
  })

  describe('Error Handling and Edge Cases', () => {
    it('should handle infinite loops with timeout', async () => {
      const code = 'while(true) { /* infinite loop */ }'
      
      // Should timeout and return error
      const result = await sandbox.runCode(code)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('timeout')
    })

    it('should handle memory exhaustion gracefully', async () => {
      const code = `
        let arr = [];
        try {
          while(true) {
            arr.push(new Array(1000000).fill(0));
          }
        } catch(e) {
          console.log('Memory limit reached');
        }
      `
      const result = await sandbox.runCode(code)
      // Should handle gracefully without crashing
      expect(result.exitCode).toBe(0)
    })

    it('should handle syntax errors', async () => {
      const code = 'console.log("missing quote'
      const result = await sandbox.runCode(code)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('SyntaxError')
    })
  })
})