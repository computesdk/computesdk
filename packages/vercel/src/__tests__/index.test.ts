import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { vercel, VercelProvider } from '../index';
import { Sandbox } from '@vercel/sandbox';

// Mock the @vercel/sandbox module
vi.mock('@vercel/sandbox');

// Mock ms module
vi.mock('ms', () => ({
  default: (timeStr: string) => {
    if (timeStr.endsWith('ms')) {
      return parseInt(timeStr.slice(0, -2));
    }
    return 300000; // Default
  },
}));

describe('VercelProvider', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let mockSandbox: any;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = {
      ...originalEnv,
      VERCEL_TOKEN: 'test-token',
      VERCEL_TEAM_ID: 'test-team-id',
      VERCEL_PROJECT_ID: 'test-project-id',
    };

    // Create a proper mock for runCommand that returns a stream-like object
    const createMockStream = (data?: string) => ({
      on: vi.fn((event: string, callback: Function) => {
        if (event === 'data' && data) {
          // Simulate async data emission
          setImmediate(() => callback(Buffer.from(data)));
        } else if (event === 'end') {
          // Simulate async end event
          setImmediate(() => callback());
        }
        return this;
      }),
    });

    const createMockProcess = (exitCode = 0) => ({
      stdout: createMockStream(''),
      stderr: createMockStream(''),
      on: vi.fn((event: string, callback: Function) => {
        if (event === 'exit') {
          // Simulate async exit event
          setImmediate(() => callback(exitCode));
        }
        return this;
      }),
    });

    mockSandbox = {
      runCommand: vi.fn().mockResolvedValue(createMockProcess()),
      stop: vi.fn().mockResolvedValue(undefined),
      id: 'test-sandbox-id',
    };

    vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox as any);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  describe('constructor', () => {
    it('should create a VercelProvider instance with default config', () => {
      const provider = vercel();
      
      expect(provider).toBeInstanceOf(VercelProvider);
      expect(provider.provider).toBe('vercel');
      expect(provider.specificationVersion).toBe('v1');
      expect(provider.sandboxId).toMatch(/^vercel-\d+-\w+$/);
    });

    it('should create a VercelProvider instance with custom config', () => {
      const provider = vercel({
        runtime: 'python',
        timeout: 600000,
      });
      
      expect(provider).toBeInstanceOf(VercelProvider);
    });

    it('should throw error when VERCEL_TOKEN is missing', () => {
      delete process.env.VERCEL_TOKEN;
      
      expect(() => vercel()).toThrow('Missing Vercel token');
    });

    it('should throw error when VERCEL_TEAM_ID is missing', () => {
      delete process.env.VERCEL_TEAM_ID;
      
      expect(() => vercel()).toThrow('Missing Vercel team ID');
    });

    it('should throw error when VERCEL_PROJECT_ID is missing', () => {
      delete process.env.VERCEL_PROJECT_ID;
      
      expect(() => vercel()).toThrow('Missing Vercel project ID');
    });

    it('should throw error for invalid runtime', () => {
      expect(() => vercel({ runtime: 'invalid' as any })).toThrow(
        'Vercel provider only supports Node.js and Python runtimes'
      );
    });
  });

  describe('doExecute', () => {
    it('should execute Node.js code successfully', async () => {
      const provider = vercel({ runtime: 'node' });
      
      // Create specific mock for this test
      const mockProcess = {
        stdout: {
          on: vi.fn((event: string, callback: Function) => {
            if (event === 'data') {
              callback(Buffer.from('Hello World'));
            } else if (event === 'end') {
              setImmediate(() => callback());
            }
          }),
        },
        stderr: {
          on: vi.fn((event: string, callback: Function) => {
            if (event === 'end') {
              setImmediate(() => callback());
            }
          }),
        },
        on: vi.fn((event: string, callback: Function) => {
          if (event === 'exit') {
            setImmediate(() => callback(0));
          }
        }),
      };

      mockSandbox.runCommand.mockResolvedValue(mockProcess);

      const result = await provider.doExecute('console.log("Hello World");');

      expect(mockSandbox.runCommand).toHaveBeenCalledWith({
        cmd: 'node',
        args: ['-e', 'console.log("Hello World");'],
      });

      expect(result).toEqual({
        stdout: 'Hello World',
        stderr: '',
        exitCode: 0,
        executionTime: expect.any(Number),
        sandboxId: provider.sandboxId,
        provider: 'vercel',
      });
    });

    it('should execute Python code successfully', async () => {
      const provider = vercel({ runtime: 'python' });
      
      // Create specific mock for this test
      const mockProcess = {
        stdout: {
          on: vi.fn((event: string, callback: Function) => {
            if (event === 'data') {
              callback(Buffer.from('Hello Python'));
            } else if (event === 'end') {
              setImmediate(() => callback());
            }
          }),
        },
        stderr: {
          on: vi.fn((event: string, callback: Function) => {
            if (event === 'end') {
              setImmediate(() => callback());
            }
          }),
        },
        on: vi.fn((event: string, callback: Function) => {
          if (event === 'exit') {
            setImmediate(() => callback(0));
          }
        }),
      };

      mockSandbox.runCommand.mockResolvedValue(mockProcess);

      const result = await provider.doExecute('print("Hello Python")');

      expect(mockSandbox.runCommand).toHaveBeenCalledWith({
        cmd: 'python',
        args: ['-c', 'print("Hello Python")'],
      });

      expect(result).toEqual({
        stdout: 'Hello Python',
        stderr: '',
        exitCode: 0,
        executionTime: expect.any(Number),
        sandboxId: provider.sandboxId,
        provider: 'vercel',
      });
    });

    it('should handle execution errors', async () => {
      const provider = vercel();
      
      // Create specific mock for this test
      const mockProcess = {
        stdout: {
          on: vi.fn((event: string, callback: Function) => {
            if (event === 'end') {
              setImmediate(() => callback());
            }
          }),
        },
        stderr: {
          on: vi.fn((event: string, callback: Function) => {
            if (event === 'data') {
              callback(Buffer.from('Error message'));
            } else if (event === 'end') {
              setImmediate(() => callback());
            }
          }),
        },
        on: vi.fn((event: string, callback: Function) => {
          if (event === 'exit') {
            setImmediate(() => callback(1));
          }
        }),
      };

      mockSandbox.runCommand.mockResolvedValue(mockProcess);

      const result = await provider.doExecute('throw new Error("Test error");');

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('Error message');
    });

    it('should handle timeout errors', async () => {
      const provider = vercel();
      vi.mocked(Sandbox.create).mockRejectedValue(new Error('timeout'));

      await expect(provider.doExecute('console.log("test");')).rejects.toThrow(
        'Vercel execution timeout'
      );
    });

    it('should handle memory errors', async () => {
      const provider = vercel();
      vi.mocked(Sandbox.create).mockRejectedValue(new Error('Memory limit exceeded'));

      await expect(provider.doExecute('console.log("test");')).rejects.toThrow(
        'Vercel execution failed due to memory limits'
      );
    });

    it('should throw error for invalid runtime', async () => {
      const provider = vercel();

      await expect(provider.doExecute('code', 'invalid' as any)).rejects.toThrow(
        'Vercel provider only supports Node.js and Python runtimes'
      );
    });
  });

  describe('doKill', () => {
    it('should kill sandbox successfully', async () => {
      const provider = vercel();
      
      // First ensure sandbox is created
      await provider.doGetInfo();
      
      await provider.doKill();
      
      expect(mockSandbox.stop).toHaveBeenCalled();
    });

    it('should handle kill when no sandbox exists', async () => {
      const provider = vercel();
      
      await expect(provider.doKill()).resolves.not.toThrow();
    });

    it('should handle kill errors', async () => {
      const provider = vercel();
      
      // First ensure sandbox is created
      await provider.doGetInfo();
      
      mockSandbox.stop.mockRejectedValue(new Error('Kill failed'));
      
      await expect(provider.doKill()).rejects.toThrow('Failed to kill Vercel sandbox');
    });
  });

  describe('doGetInfo', () => {
    it('should return sandbox info', async () => {
      const provider = vercel({ runtime: 'python', timeout: 600000 });
      
      const info = await provider.doGetInfo();
      
      expect(info).toEqual({
        id: provider.sandboxId,
        provider: 'vercel',
        runtime: 'python',
        status: 'running',
        createdAt: expect.any(Date),
        timeout: 600000,
        metadata: {
          vercelSandboxId: provider.sandboxId,
          teamId: 'test-team-id',
          projectId: 'test-project-id',
          vcpus: 2,
          region: 'global',
        },
      });
    });
  });

  describe('ensureSandbox', () => {
    it('should create sandbox with correct parameters', async () => {
      const provider = vercel({ runtime: 'python', timeout: 600000 });
      
      await provider.doGetInfo();
      
      expect(vi.mocked(Sandbox.create)).toHaveBeenCalledWith({
        runtime: 'python3.13',
        timeout: 600000,
        resources: { vcpus: 2 },
      });
    });

    it('should reuse existing sandbox', async () => {
      const provider = vercel();
      
      await provider.doGetInfo();
      await provider.doGetInfo();
      
      expect(vi.mocked(Sandbox.create)).toHaveBeenCalledTimes(1);
    });

    it('should handle authentication errors', async () => {
      const provider = vercel();
      
      vi.mocked(Sandbox.create).mockRejectedValue(new Error('unauthorized'));
      
      await expect(provider.doGetInfo()).rejects.toThrow(
        'Vercel authentication failed'
      );
    });

    it('should handle team/project errors', async () => {
      const provider = vercel();
      
      vi.mocked(Sandbox.create).mockRejectedValue(new Error('team not found'));
      
      await expect(provider.doGetInfo()).rejects.toThrow(
        'Vercel team/project configuration error'
      );
    });

    it('should handle quota errors', async () => {
      const provider = vercel();
      
      vi.mocked(Sandbox.create).mockRejectedValue(new Error('quota exceeded'));
      
      await expect(provider.doGetInfo()).rejects.toThrow(
        'Vercel quota exceeded'
      );
    });
  });
});