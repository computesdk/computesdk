import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleComputeRequest } from '../adapters';
import type { ComputeRequest } from '../types';

// Create a mock provider
const createMockProvider = () => ({
  sandboxId: 'test-sandbox-123',
  provider: 'mock',
  execute: vi.fn().mockResolvedValue({
    stdout: 'Hello World',
    stderr: '',
    exitCode: 0,
    executionTime: 100,
    sandboxId: 'test-sandbox-123',
    provider: 'mock'
  }),
  runCode: vi.fn().mockResolvedValue({
    stdout: 'Hello World',
    stderr: '',
    exitCode: 0,
    executionTime: 100,
    sandboxId: 'test-sandbox-123',
    provider: 'mock'
  }),
  runCommand: vi.fn().mockResolvedValue({
    stdout: 'Command output',
    stderr: '',
    exitCode: 0,
    executionTime: 50,
    sandboxId: 'test-sandbox-123',
    provider: 'mock'
  }),
  getInfo: vi.fn().mockResolvedValue({
    id: 'test-sandbox-123',
    provider: 'mock',
    runtime: 'python',
    status: 'running',
    createdAt: new Date(),
    timeout: 300000
  }),
  kill: vi.fn().mockResolvedValue(undefined),
  filesystem: {
    readFile: vi.fn().mockResolvedValue('file content'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([
      { name: 'file.txt', path: '/tmp/file.txt', isDirectory: false, size: 100, lastModified: new Date() }
    ]),
    exists: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(undefined)
  },
  terminal: {
    create: vi.fn().mockResolvedValue({
      pid: 123,
      command: 'bash',
      status: 'running',
      cols: 80,
      rows: 24,
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      kill: vi.fn().mockResolvedValue(undefined)
    }),
    list: vi.fn().mockResolvedValue([])
  }
});

describe('handleComputeRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('request validation', () => {
    it('should return error for missing operation', async () => {
      const request = { action: 'execute', payload: {} } as ComputeRequest;
      const provider = createMockProvider();
      const response = await handleComputeRequest({ request, provider });
      
      expect(response.success).toBe(false);
      expect(response.error).toContain('Missing required fields');
    });

    it('should return error for missing action', async () => {
      const request = { operation: 'sandbox', payload: {} } as ComputeRequest;
      const provider = createMockProvider();
      const response = await handleComputeRequest({ request, provider });
      
      expect(response.success).toBe(false);
      expect(response.error).toContain('Missing required fields');
    });
  });

  describe('sandbox operations', () => {
    it('should handle execute action', async () => {
      const request: ComputeRequest = {
        operation: 'sandbox',
        action: 'execute',
        payload: { code: 'print("Hello World")', runtime: 'python' }
      };

      const provider = createMockProvider(); const response = await handleComputeRequest({ request, provider });
      
      expect(response.success).toBe(true);
      expect(response.data.stdout).toBe('Hello World');
      expect(response.sandboxId).toBe('test-sandbox-123');
      expect(response.provider).toBe('mock');
    });

    it('should handle runCommand action', async () => {
      const request: ComputeRequest = {
        operation: 'sandbox',
        action: 'runCommand',
        payload: { command: 'ls', args: ['-la'] }
      };

      const provider = createMockProvider(); const response = await handleComputeRequest({ request, provider });
      
      expect(response.success).toBe(true);
      expect(response.data.stdout).toBe('Command output');
    });

    it('should handle getInfo action', async () => {
      const request: ComputeRequest = {
        operation: 'sandbox',
        action: 'getInfo',
        payload: {}
      };

      const provider = createMockProvider(); const response = await handleComputeRequest({ request, provider });
      
      expect(response.success).toBe(true);
      expect(response.data.id).toBe('test-sandbox-123');
      expect(response.data.provider).toBe('mock');
    });

    it('should handle kill action', async () => {
      const request: ComputeRequest = {
        operation: 'sandbox',
        action: 'kill',
        payload: {}
      };

      const provider = createMockProvider(); const response = await handleComputeRequest({ request, provider });
      
      expect(response.success).toBe(true);
      expect(response.data.message).toContain('terminated successfully');
    });

    it('should return error for missing code in execute', async () => {
      const request: ComputeRequest = {
        operation: 'sandbox',
        action: 'execute',
        payload: {}
      };

      const provider = createMockProvider(); const response = await handleComputeRequest({ request, provider });
      
      expect(response.success).toBe(false);
      expect(response.error).toContain('Missing required field: code');
    });

    it('should return error for unknown sandbox action', async () => {
      const request: ComputeRequest = {
        operation: 'sandbox',
        action: 'unknown',
        payload: {}
      };

      const provider = createMockProvider(); const response = await handleComputeRequest({ request, provider });
      
      expect(response.success).toBe(false);
      expect(response.error).toContain('Unknown sandbox action');
    });
  });

  describe('filesystem operations', () => {
    it('should handle readFile action', async () => {
      const request: ComputeRequest = {
        operation: 'filesystem',
        action: 'readFile',
        payload: { path: '/tmp/test.txt' }
      };

      const provider = createMockProvider(); const response = await handleComputeRequest({ request, provider });
      
      expect(response.success).toBe(true);
      expect(response.data.content).toBe('file content');
    });

    it('should handle writeFile action', async () => {
      const request: ComputeRequest = {
        operation: 'filesystem',
        action: 'writeFile',
        payload: { path: '/tmp/test.txt', content: 'Hello World' }
      };

      const provider = createMockProvider(); const response = await handleComputeRequest({ request, provider });
      
      expect(response.success).toBe(true);
      expect(response.data.message).toContain('written successfully');
    });

    it('should handle readdir action', async () => {
      const request: ComputeRequest = {
        operation: 'filesystem',
        action: 'readdir',
        payload: { path: '/tmp' }
      };

      const provider = createMockProvider(); const response = await handleComputeRequest({ request, provider });
      
      expect(response.success).toBe(true);
      expect(response.data.entries).toHaveLength(1);
      expect(response.data.entries[0].name).toBe('file.txt');
    });

    it('should return error for missing path in filesystem operations', async () => {
      const request: ComputeRequest = {
        operation: 'filesystem',
        action: 'readFile',
        payload: {}
      };

      const provider = createMockProvider(); const response = await handleComputeRequest({ request, provider });
      
      expect(response.success).toBe(false);
      expect(response.error).toContain('Missing required field: path');
    });

    it('should return error for unknown filesystem action', async () => {
      const request: ComputeRequest = {
        operation: 'filesystem',
        action: 'unknown',
        payload: { path: '/tmp' }
      };

      const provider = createMockProvider(); const response = await handleComputeRequest({ request, provider });
      
      expect(response.success).toBe(false);
      expect(response.error).toContain('Unknown filesystem action');
    });
  });

  describe('error handling', () => {
    it('should return error for unknown operation', async () => {
      const request: ComputeRequest = {
        operation: 'unknown' as any,
        action: 'test',
        payload: {}
      };

      const provider = createMockProvider(); const response = await handleComputeRequest({ request, provider });
      
      expect(response.success).toBe(false);
      expect(response.error).toContain('Unknown operation');
    });

    it('should include execution time in response', async () => {
      const request: ComputeRequest = {
        operation: 'sandbox',
        action: 'execute',
        payload: { code: 'print("test")' }
      };

      const provider = createMockProvider(); const response = await handleComputeRequest({ request, provider });
      
      expect(response.success).toBe(true);
      expect(typeof response.executionTime).toBe('number');
      expect(response.executionTime).toBeGreaterThanOrEqual(0);
    });
  });
});