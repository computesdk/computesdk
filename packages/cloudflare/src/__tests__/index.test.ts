import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cloudflare, CloudflareEnv } from '../index';
import type { ExecutionError } from 'computesdk';

// Mock the global Cloudflare Workers environment
const mockGlobals = () => {
  (global as any).DurableObject = {};
  (global as any).WebSocketPair = {};
  (global as any).caches = {};
};

const clearMocks = () => {
  delete (global as any).DurableObject;
  delete (global as any).WebSocketPair;
  delete (global as any).caches;
};

// Mock the @cloudflare/sandbox module
vi.mock('@cloudflare/sandbox', () => ({
  getSandbox: vi.fn((namespace: any, id: string) => ({
    exec: vi.fn(async (command: string, args: string[]) => {
      // Simulate some execution time
      await new Promise(resolve => setTimeout(resolve, 10));
      
      if (command === 'python3' && args[0] === '-c') {
        return {
          stdout: 'Hello from Python',
          stderr: '',
          exitCode: 0,
          success: true
        };
      }
      if (command === 'node' && args[0] === '-e') {
        return {
          stdout: 'Hello from Node.js',
          stderr: '',
          exitCode: 0,
          success: true
        };
      }
      if (command === 'ls' && args.includes('-la')) {
        return {
          stdout: 'total 8\n-rw-r--r-- 1 user user   13 2024-01-01 12:00:00 test.txt\ndrwxr-xr-x 2 user user 4096 2024-01-01 12:00:00 subdir',
          stderr: '',
          exitCode: 0,
          success: true
        };
      }
      if (command === 'test' && args[0] === '-e') {
        return {
          stdout: '',
          stderr: '',
          exitCode: 0,
          success: true
        };
      }
      throw new Error('Unknown command');
    }),
    readFile: vi.fn(async (path: string) => 'Hello World'),
    writeFile: vi.fn(async (path: string, content: string) => {}),
    mkdir: vi.fn(async (path: string) => {}),
    deleteFile: vi.fn(async (path: string) => {})
  }))
}));

describe('Cloudflare Provider', () => {
  let mockEnv: CloudflareEnv;

  beforeEach(() => {
    mockGlobals();
    mockEnv = {
      Sandbox: {} as any
    };
  });

  afterEach(() => {
    clearMocks();
    vi.clearAllMocks();
  });

  describe('Platform Detection', () => {
    it('should throw an error when not in Cloudflare Workers environment', () => {
      clearMocks(); // Remove the mock globals
      
      expect(() => cloudflare({ env: mockEnv })).toThrow(
        'Cloudflare provider can only be used within Cloudflare Workers environment'
      );
    });

    it('should create provider when in Cloudflare Workers environment', () => {
      const provider = cloudflare({ env: mockEnv });
      expect(provider).toBeDefined();
      expect(provider.provider).toBe('cloudflare');
      expect(provider.specificationVersion).toBe('v1');
    });
  });

  describe('Configuration', () => {
    it('should throw an error when env.Sandbox is missing', () => {
      expect(() => cloudflare({ env: {} as any })).toThrow(
        'Cloudflare provider requires env.Sandbox'
      );
    });

    it('should accept custom timeout', async () => {
      const provider = cloudflare({ env: mockEnv, timeout: 60000 });
      const info = await provider.doGetInfo();
      expect(info.timeout).toBe(60000);
    });

    it('should use default timeout when not specified', async () => {
      const provider = cloudflare({ env: mockEnv });
      const info = await provider.doGetInfo();
      expect(info.timeout).toBe(300000);
    });
  });

  describe('Code Execution', () => {
    it('should execute Python code by default', async () => {
      const provider = cloudflare({ env: mockEnv });
      const result = await provider.doExecute('print("Hello")');
      
      expect(result.stdout).toBe('Hello from Python');
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.provider).toBe('cloudflare');
    });

    it('should execute Python code with explicit runtime', async () => {
      const provider = cloudflare({ env: mockEnv });
      const result = await provider.doExecute('print("Hello")', 'python');
      
      expect(result.stdout).toBe('Hello from Python');
      expect(result.exitCode).toBe(0);
    });

    it('should execute Node.js code', async () => {
      const provider = cloudflare({ env: mockEnv });
      const result = await provider.doExecute('console.log("Hello")', 'node');
      
      expect(result.stdout).toBe('Hello from Node.js');
      expect(result.exitCode).toBe(0);
    });


    it('should throw error for unsupported runtime', async () => {
      const provider = cloudflare({ env: mockEnv });
      
      await expect(provider.doExecute('code', 'ruby' as any)).rejects.toThrow(
        'Unsupported runtime: ruby'
      );
    });

    it('should track execution time', async () => {
      const provider = cloudflare({ env: mockEnv });
      const result = await provider.doExecute('print("Hello")');
      
      expect(result.executionTime).toBeGreaterThan(0);
      expect(result.executionTime).toBeLessThan(1000);
    });
  });

  describe('Sandbox Management', () => {
    it('should get sandbox info', async () => {
      const provider = cloudflare({ env: mockEnv });
      const info = await provider.doGetInfo();
      
      expect(info.provider).toBe('cloudflare');
      expect(info.runtime).toBe('python');
      expect(info.status).toBe('stopped');
      expect(info.metadata).toEqual({
        platform: 'cloudflare-workers',
        sandboxType: 'durable-object'
      });
    });

    it('should handle doKill gracefully', async () => {
      const provider = cloudflare({ env: mockEnv });
      await expect(provider.doKill()).resolves.not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle execution errors', async () => {
      const { getSandbox } = await import('@cloudflare/sandbox');
      const mockSandbox = {
        exec: vi.fn().mockRejectedValue(new Error('Execution failed'))
      };
      (getSandbox as any).mockReturnValueOnce(mockSandbox);

      const provider = cloudflare({ env: mockEnv });
      
      await expect(provider.doExecute('print("Hello")')).rejects.toThrow(
        'Cloudflare execution failed: Execution failed'
      );
    });

    it('should handle sandbox initialization errors', async () => {
      const { getSandbox } = await import('@cloudflare/sandbox');
      (getSandbox as any).mockImplementationOnce(() => {
        throw new Error('Failed to get sandbox');
      });

      const provider = cloudflare({ env: mockEnv });
      
      await expect(provider.doExecute('print("Hello")')).rejects.toThrow(
        'Failed to initialize Cloudflare sandbox: Failed to get sandbox'
      );
    });
  });

  describe('Filesystem Operations', () => {
    it('should have filesystem property', () => {
      const provider = cloudflare({ env: mockEnv });
      expect(provider.filesystem).toBeDefined();
    });

    it('should read file contents', async () => {
      const provider = cloudflare({ env: mockEnv });
      const content = await provider.filesystem.readFile('/test.txt');
      expect(content).toBe('Hello World');
    });

    it('should write file contents', async () => {
      const provider = cloudflare({ env: mockEnv });
      await expect(provider.filesystem.writeFile('/test.txt', 'Hello World')).resolves.not.toThrow();
    });

    it('should create directories', async () => {
      const provider = cloudflare({ env: mockEnv });
      await expect(provider.filesystem.mkdir('/test/dir')).resolves.not.toThrow();
    });

    it('should list directory contents', async () => {
      const provider = cloudflare({ env: mockEnv });
      const entries = await provider.filesystem.readdir('/test');
      
      expect(entries).toHaveLength(2);
      expect(entries[0].name).toBe('test.txt');
      expect(entries[0].isDirectory).toBe(false);
      expect(entries[0].size).toBe(13);
      expect(entries[1].name).toBe('subdir');
      expect(entries[1].isDirectory).toBe(true);
    });

    it('should check if file exists', async () => {
      const provider = cloudflare({ env: mockEnv });
      const exists = await provider.filesystem.exists('/test.txt');
      expect(exists).toBe(true);
    });

    it('should remove files', async () => {
      const provider = cloudflare({ env: mockEnv });
      await expect(provider.filesystem.remove('/test.txt')).resolves.not.toThrow();
    });

    it('should handle filesystem errors gracefully', async () => {
      const { getSandbox } = await import('@cloudflare/sandbox');
      const mockSandbox = {
        readFile: vi.fn().mockRejectedValue(new Error('File not found'))
      };
      (getSandbox as any).mockReturnValueOnce(mockSandbox);

      const provider = cloudflare({ env: mockEnv });
      
      await expect(provider.filesystem.readFile('/nonexistent.txt')).rejects.toThrow(
        'Failed to read file'
      );
    });
  });
});