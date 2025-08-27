/**
 * Cloudflare Provider Tests
 */

import { vi } from 'vitest';
import { runProviderTestSuite } from '@computesdk/test-utils';
import { cloudflare } from '../index.js';

// Determine if we're running integration tests
const hasCredentials = !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
const skipIntegration = !hasCredentials;

// Only mock Cloudflare SDK for unit tests (when credentials are not provided)
if (skipIntegration) {
  vi.mock('@cloudflare/sandbox', () => ({
    getSandbox: vi.fn(() => {
      const mockSandbox = {
        setEnvVars: vi.fn(),
        ping: vi.fn(),
        killAllProcesses: vi.fn(),
        runCode: vi.fn().mockImplementation((code: string, _options?: any) => {
          // Context-aware mock responses for unit tests
          if (code.includes('console.log("Hello, World!")')) {
            return Promise.resolve({
              results: [{ text: 'Hello, World!\n' }]
            });
          }
          if (code.includes('Python version')) {
            return Promise.resolve({
              results: [{ text: 'Python version: 3.11.0\nHello from Python!\n' }]
            });
          }
          if (code.includes('throw new Error("Test error")')) {
            return Promise.resolve({
              results: [{ text: '', error: 'Error: Test error' }]
            });
          }
          if (code.includes('invalid syntax here!!!')) {
            throw new Error('SyntaxError: invalid syntax');
          }
          if (code.includes('json.dumps')) {
            return Promise.resolve({
              results: [{ text: '{\n  "message": "Hello",\n  "timestamp": "2024-01-01T00:00:00"\n}\n' }]
            });
          }
          return Promise.resolve({
            results: [{ text: `Mock execution of: ${code}\n` }]
          });
        }),
        exec: vi.fn().mockImplementation((command: string) => {
          // Context-aware mock responses for commands
          if (command.includes('echo') && command.includes('Hello from command')) {
            return Promise.resolve({
              stdout: 'Hello from command\n',
              stderr: '',
              exitCode: 0
            });
          }
          if (command.includes('nonexistent-command')) {
            return Promise.resolve({
              stdout: '',
              stderr: 'bash: nonexistent-command-12345: command not found\n',
              exitCode: 127
            });
          }
          if (command.includes('throw new Error')) {
            return Promise.resolve({
              stdout: '',
              stderr: 'Error: Test error\n    at <anonymous>:1:7\n',
              exitCode: 1
            });
          }
          if (command.startsWith('ls -la')) {
            const path = command.split(' ').pop() || '/tmp';
            if (path.includes('test-dir')) {
              return Promise.resolve({
                stdout: 'total 0\ndrwxr-xr-x  4 user  staff  128 Jan  1 00:00 .\ndrwxr-xr-x  3 user  staff   96 Jan  1 00:00 ..\n-rw-r--r--  1 user  staff    8 Jan  1 00:00 file1.txt\n-rw-r--r--  1 user  staff    8 Jan  1 00:00 file2.txt\n',
                stderr: '',
                exitCode: 0
              });
            }
          }
          if (command.startsWith('test -e')) {
            const path = command.split(' ').pop();
            // Mock file existence based on context
            if (path?.includes('test.txt') || path?.includes('test-dir')) {
              return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
            }
            if (path?.includes('nonexistent')) {
              return Promise.resolve({ stdout: '', stderr: '', exitCode: 1 });
            }
          }
          return Promise.resolve({
            stdout: `Mock command output: ${command}\n`,
            stderr: '',
            exitCode: 0
          });
        }),
        readFile: vi.fn().mockImplementation((path: string) => {
          if (path.includes('nonexistent')) {
            throw new Error(`ENOENT: no such file or directory, open '${path}'`);
          }
          if (path.includes('test.txt')) {
            return Promise.resolve({ content: 'Hello, ComputeSDK filesystem!' });
          }
          return Promise.resolve({ content: 'Mock file content' });
        }),
        writeFile: vi.fn().mockResolvedValue(undefined),
        mkdir: vi.fn().mockResolvedValue(undefined),
        exposePort: vi.fn().mockResolvedValue({
          url: 'mock-preview.example.com'
        })
      };
      
      // Add remove functionality by patching exec for rm commands
      const originalExec = mockSandbox.exec;
      mockSandbox.exec = vi.fn().mockImplementation((command: string) => {
        if (command.startsWith('rm -rf')) {
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
        }
        if (command.startsWith('test -e') && command.includes('test.txt')) {
          // After removal, file shouldn't exist
          return Promise.resolve({ stdout: '', stderr: '', exitCode: 1 });
        }
        return originalExec(command);
      });
      
      return mockSandbox;
    })
  }));
}

// Create mock or real Durable Object binding based on test mode
const createSandboxBinding = () => {
  if (skipIntegration) {
    // Mock binding for unit tests
    return {
      idFromName: (name: string) => ({ toString: () => `mock-id-${name}` }),
      get: (_id: any) => ({
        fetch: vi.fn().mockResolvedValue(new Response('Mock response'))
      })
    };
  } else {
    // For integration tests, we would need real Durable Object binding
    // This would typically come from your Cloudflare Workers environment
    // For now, return a placeholder that won't be used in pure integration mode
    return {
      idFromName: (name: string) => ({ toString: () => `integration-${name}` }),
      get: (_id: any) => ({
        fetch: async (_request: Request) => {
          // In real integration tests, this would proxy to your deployed worker
          return new Response('Integration test placeholder');
        }
      })
    };
  }
};

// Run the standardized provider test suite
runProviderTestSuite({
  name: 'cloudflare',
  provider: cloudflare({
    sandboxBinding: createSandboxBinding(),
    timeout: 300000,
    runtime: 'python'
  }),
  supportsFilesystem: true,  // Cloudflare supports full filesystem operations
  supportsPython: true,      // Cloudflare supports Python runtime
  timeout: 300000,           // 5 minutes for container operations
  skipIntegration           // Skip integration tests unless credentials are provided
});