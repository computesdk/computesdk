import { describe, it, expect, vi, beforeEach } from 'vitest';
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

// Create mock result that matches the Vercel Sandbox API format
const createMockResult = (exitCode = 0, stdoutData = '', stderrData = '') => ({
  exitCode,
  stdout: vi.fn().mockResolvedValue(stdoutData),
  stderr: vi.fn().mockResolvedValue(stderrData),
});

// Create a comprehensive mock that matches the Vercel Sandbox interface
const createMockSandbox = () => ({
  id: 'vercel-sandbox-123',
  runCommand: vi.fn(),
  stop: vi.fn().mockResolvedValue(undefined),
});

describe('VercelProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('VERCEL_TOKEN', 'vercel_test_token_1234567890abcdef');
    vi.stubEnv('VERCEL_TEAM_ID', 'team_test_1234567890abcdef');
    vi.stubEnv('VERCEL_PROJECT_ID', 'prj_test_1234567890abcdef');
  });

  describe('constructor', () => {
    it('should create provider with default config', () => {
      const provider = new VercelProvider({});
      
      expect(provider.provider).toBe('vercel');
      expect(provider.sandboxId).toBeDefined();
      expect(typeof provider.sandboxId).toBe('string');
    });

    it('should throw error without VERCEL_TOKEN', () => {
      vi.unstubAllEnvs();
      
      expect(() => new VercelProvider({})).toThrow(
        'Missing Vercel token. Provide \'token\' in config or set VERCEL_TOKEN environment variable.'
      );
    });

    it('should throw error without VERCEL_TEAM_ID', () => {
      vi.unstubAllEnvs();
      vi.stubEnv('VERCEL_TOKEN', 'test-token');
      
      expect(() => new VercelProvider({})).toThrow(
        'Missing Vercel team ID. Provide \'teamId\' in config or set VERCEL_TEAM_ID environment variable.'
      );
    });

    it('should throw error without VERCEL_PROJECT_ID', () => {
      vi.unstubAllEnvs();
      vi.stubEnv('VERCEL_TOKEN', 'test-token');
      vi.stubEnv('VERCEL_TEAM_ID', 'test-team');
      
      expect(() => new VercelProvider({})).toThrow(
        'Missing Vercel project ID. Provide \'projectId\' in config or set VERCEL_PROJECT_ID environment variable.'
      );
    });

    it('should accept different runtimes', () => {
      const provider = new VercelProvider({ runtime: 'node' });
      expect(provider).toBeDefined();
    });

    it('should accept python runtime', () => {
      const provider = new VercelProvider({ runtime: 'python' });
      expect(provider).toBeDefined();
    });

    it('should throw error for invalid runtime', () => {
      expect(() => vercel({ runtime: 'invalid' as any })).toThrow(
        'Vercel provider only supports Node.js and Python runtimes'
      );
    });
  });

  describe('doExecute', () => {
    let mockSandbox: ReturnType<typeof createMockSandbox>;

    beforeEach(() => {
      mockSandbox = createMockSandbox();
      vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox as any);
    });

    it('should execute Node.js code', async () => {
      const mockExecution = createMockResult(0, 'Hello World');
      mockSandbox.runCommand.mockResolvedValue(mockExecution);
      
      const provider = new VercelProvider({});
      const result = await provider.doExecute('console.log("Hello World")');
      
      expect(result.stdout).toBe('Hello World');
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.provider).toBe('vercel');
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it('should execute code with different runtimes', async () => {
      const mockExecution = createMockResult(0, 'Hello Python');
      mockSandbox.runCommand.mockResolvedValue(mockExecution);
      
      const provider = new VercelProvider({});
      const result = await provider.doExecute('print("Hello Python")', 'python');
      
      expect(result.stdout).toBe('Hello Python');
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
    });

    it('should handle Vercel execution errors', async () => {
      vi.mocked(Sandbox.create).mockRejectedValue(new Error('Vercel connection failed'));

      const provider = new VercelProvider({});
      
      await expect(provider.doExecute('console.log("test")'))
        .rejects.toThrow('Failed to initialize Vercel sandbox: Vercel connection failed');
    });

    it('should handle execution errors with exit codes', async () => {
      const mockExecution = createMockResult(1, '', 'Error: Test error');
      mockSandbox.runCommand.mockResolvedValue(mockExecution);
      
      const provider = new VercelProvider({});
      const result = await provider.doExecute('throw new Error("Test error")');
      
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('Error: Test error');
    });
  });

  describe('doKill', () => {
    let mockSandbox: ReturnType<typeof createMockSandbox>;

    beforeEach(() => {
      mockSandbox = createMockSandbox();
      vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox as any);
    });

    it('should close Vercel session', async () => {
      const mockExecution = createMockResult(0, 'test');
      mockSandbox.runCommand.mockResolvedValue(mockExecution);
      
      const provider = new VercelProvider({});
      
      // Initialize session by calling doExecute
      await provider.doExecute('console.log("test")');
      
      await provider.doKill();
      
      expect(mockSandbox.stop).toHaveBeenCalled();
    });

    it('should handle no active session', async () => {
      const provider = new VercelProvider({});
      
      await expect(provider.doKill()).resolves.not.toThrow();
    });
  });

  describe('doGetInfo', () => {
    let mockSandbox: ReturnType<typeof createMockSandbox>;

    beforeEach(() => {
      mockSandbox = createMockSandbox();
      vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox as any);
    });

    it('should return sandbox information', async () => {
      const provider = new VercelProvider({});
      const info = await provider.doGetInfo();
      
      expect(info.provider).toBe('vercel');
      expect(info.runtime).toBe('node');
      expect(info.status).toBe('running');
      expect(info.metadata?.vercelSandboxId).toBe(provider.sandboxId);
    });
  });

  describe('filesystem operations', () => {
    let mockSandbox: ReturnType<typeof createMockSandbox>;

    beforeEach(() => {
      mockSandbox = createMockSandbox();
      vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox as any);
    });

    describe('readFile', () => {
      it('should read file contents', async () => {
        mockSandbox.runCommand.mockResolvedValue(createMockResult(0, 'Hello, World!'));

        const provider = new VercelProvider({});
        const content = await provider.filesystem.readFile('/test/file.txt');
        
        expect(content).toBe('Hello, World!');
        expect(mockSandbox.runCommand).toHaveBeenCalledWith({
          cmd: 'cat',
          args: ['/test/file.txt'],
        });
      });

      it('should handle file read errors', async () => {
        mockSandbox.runCommand.mockResolvedValue(createMockResult(1, '', 'No such file or directory'));

        const provider = new VercelProvider({});
        
        await expect(provider.filesystem.readFile('/nonexistent.txt'))
          .rejects.toThrow('Failed to read file');
      });
    });

    describe('writeFile', () => {
      it('should write file contents', async () => {
        mockSandbox.runCommand.mockResolvedValue(createMockResult(0));

        const provider = new VercelProvider({});
        await provider.filesystem.writeFile('/test/output.txt', 'Hello, World!');
        
        expect(mockSandbox.runCommand).toHaveBeenCalledWith({
          cmd: 'sh',
          args: ['-c', "echo 'Hello, World!' > '/test/output.txt'"],
        });
      });

      it('should handle write errors', async () => {
        mockSandbox.runCommand.mockResolvedValue(createMockResult(1, '', 'Permission denied'));

        const provider = new VercelProvider({});
        
        await expect(provider.filesystem.writeFile('/readonly.txt', 'content'))
          .rejects.toThrow('Failed to write file');
      });
    });

    describe('exists', () => {
      it('should check if file exists', async () => {
        mockSandbox.runCommand.mockResolvedValue(createMockResult(0));

        const provider = new VercelProvider({});
        const exists = await provider.filesystem.exists('/test/file.txt');
        
        expect(exists).toBe(true);
        expect(mockSandbox.runCommand).toHaveBeenCalledWith({
          cmd: 'test',
          args: ['-e', '/test/file.txt'],
        });
      });

      it('should return false for non-existent files', async () => {
        mockSandbox.runCommand.mockResolvedValue(createMockResult(1));

        const provider = new VercelProvider({});
        const exists = await provider.filesystem.exists('/nonexistent.txt');
        
        expect(exists).toBe(false);
      });

      it('should return false on error', async () => {
        mockSandbox.runCommand.mockRejectedValue(new Error('Access denied'));

        const provider = new VercelProvider({});
        const exists = await provider.filesystem.exists('/protected.txt');
        
        expect(exists).toBe(false);
      });
    });

    describe('readdir', () => {
      it('should list directory contents', async () => {
        const lsOutput = 'total 8\n-rw-r--r-- 1 user user 1024 2024-01-01 12:00 file1.txt\ndrwxr-xr-x 2 user user 4096 2024-01-01 12:00 subdir';
        mockSandbox.runCommand.mockResolvedValue(createMockResult(0, lsOutput));

        const provider = new VercelProvider({});
        const entries = await provider.filesystem.readdir('/test');
        
        expect(entries).toHaveLength(2);
        expect(entries[0].name).toBe('file1.txt');
        expect(entries[0].isDirectory).toBe(false);
        expect(entries[1].name).toBe('subdir');
        expect(entries[1].isDirectory).toBe(true);
        expect(mockSandbox.runCommand).toHaveBeenCalledWith({
          cmd: 'ls',
          args: ['-la', '--time-style=iso', '/test'],
        });
      });

      it('should handle readdir errors', async () => {
        mockSandbox.runCommand.mockResolvedValue(createMockResult(1, '', 'Directory not found'));

        const provider = new VercelProvider({});
        
        await expect(provider.filesystem.readdir('/nonexistent'))
          .rejects.toThrow('Failed to read directory');
      });
    });

    describe('mkdir', () => {
      it('should create directory', async () => {
        mockSandbox.runCommand.mockResolvedValue(createMockResult(0));

        const provider = new VercelProvider({});
        await provider.filesystem.mkdir('/test/newdir');
        
        expect(mockSandbox.runCommand).toHaveBeenCalledWith({
          cmd: 'mkdir',
          args: ['-p', '/test/newdir'],
        });
      });

      it('should handle mkdir errors', async () => {
        mockSandbox.runCommand.mockResolvedValue(createMockResult(1, '', 'Permission denied'));

        const provider = new VercelProvider({});
        
        await expect(provider.filesystem.mkdir('/readonly/dir'))
          .rejects.toThrow('Failed to create directory');
      });
    });

    describe('remove', () => {
      it('should remove file or directory', async () => {
        mockSandbox.runCommand.mockResolvedValue(createMockResult(0));

        const provider = new VercelProvider({});
        await provider.filesystem.remove('/test/file.txt');
        
        expect(mockSandbox.runCommand).toHaveBeenCalledWith({
          cmd: 'rm',
          args: ['-rf', '/test/file.txt'],
        });
      });

      it('should handle remove errors', async () => {
        mockSandbox.runCommand.mockResolvedValue(createMockResult(1, '', 'File not found'));

        const provider = new VercelProvider({});
        
        await expect(provider.filesystem.remove('/nonexistent.txt'))
          .rejects.toThrow('Failed to remove');
      });
    });
  });

  describe('ensureSandbox', () => {
    let mockSandbox: ReturnType<typeof createMockSandbox>;

    beforeEach(() => {
      mockSandbox = createMockSandbox();
      vi.mocked(Sandbox.create).mockResolvedValue(mockSandbox as any);
    });

    it('should create sandbox with correct parameters', async () => {
      const provider = vercel({ runtime: 'python', timeout: 600000 });
      
      await provider.doGetInfo();
      
      expect(vi.mocked(Sandbox.create)).toHaveBeenCalledWith({
        token: 'vercel_test_token_1234567890abcdef',
        teamId: 'team_test_1234567890abcdef',
        projectId: 'prj_test_1234567890abcdef',
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

describe('vercel factory function', () => {
  beforeEach(() => {
    vi.stubEnv('VERCEL_TOKEN', 'vercel_test_token_1234567890abcdef');
    vi.stubEnv('VERCEL_TEAM_ID', 'team_test_1234567890abcdef');
    vi.stubEnv('VERCEL_PROJECT_ID', 'prj_test_1234567890abcdef');
  });

  it('should create Vercel provider with default config', () => {
    const sandbox = vercel();
    
    expect(sandbox).toBeInstanceOf(VercelProvider);
    expect(sandbox.provider).toBe('vercel');
  });

  it('should create Vercel provider with custom config', () => {
    const sandbox = vercel({ timeout: 60000 });
    
    expect(sandbox).toBeInstanceOf(VercelProvider);
  });
});