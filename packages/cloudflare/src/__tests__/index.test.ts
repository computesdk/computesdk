/**
 * Cloudflare Provider Tests
 */

import { vi } from 'vitest';
import { runProviderTestSuite } from '@computesdk/test-utils';
import { cloudflare } from '../index.js';

// Determine if we're running integration tests
const hasCredentials = !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
const skipIntegration = !hasCredentials;

// Mock Cloudflare SDK for unit tests only
if (skipIntegration) {
  vi.mock('@cloudflare/sandbox', () => ({
    getSandbox: vi.fn(() => ({
      setEnvVars: vi.fn(),
      ping: vi.fn(),
      killAllProcesses: vi.fn(),
      runCode: vi.fn().mockResolvedValue({
        results: [{ text: 'Mock output' }]
      }),
      exec: vi.fn().mockResolvedValue({
        stdout: 'Mock command output',
        stderr: '',
        exitCode: 0
      }),
      readFile: vi.fn().mockResolvedValue({
        content: 'Mock file content'
      }),
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      exposePort: vi.fn().mockResolvedValue({
        url: 'mock-preview.example.com'
      })
    }))
  }));
}

// Create mock Durable Object binding for unit tests
const mockSandboxBinding = {
  idFromName: (name: string) => ({ toString: () => `mock-id-${name}` }),
  get: (_id: any) => ({
    fetch: vi.fn().mockResolvedValue(new Response('Mock response'))
  })
};

// Run the standardized provider test suite
runProviderTestSuite({
  name: 'cloudflare',
  provider: cloudflare({
    sandboxBinding: mockSandboxBinding,
    timeout: 300000,
    runtime: 'python'
  }),
  supportsFilesystem: true,  // Cloudflare supports full filesystem operations
  supportsPython: true,      // Cloudflare supports Python runtime
  timeout: 300000,           // 5 minutes for container operations
  skipIntegration           // Skip integration tests unless credentials are provided
});