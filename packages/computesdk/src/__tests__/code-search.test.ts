/**
 * Tests for sandbox.filesystem.codeSearch() powered by Morph WarpGrep
 */

import path from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { executeCodeSearch, buildRemoteCommands, type CodeSearchResult } from '../code-search';
import type { Sandbox } from '../types/universal-sandbox';

/**
 * Create a minimal mock sandbox that satisfies the Sandbox interface
 * for executeCodeSearch (only runCommand is needed).
 */
function createMockSandbox(
  runCommandImpl?: (command: string, opts?: any) => Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }>
): Sandbox {
  const defaultRunCommand = async (command: string) => ({
    stdout: '',
    stderr: '',
    exitCode: 0,
    durationMs: 10,
  });

  return {
    sandboxId: 'test-sandbox',
    provider: 'mock',
    runCode: vi.fn() as any,
    runCommand: runCommandImpl ?? defaultRunCommand,
    getInfo: vi.fn() as any,
    getUrl: vi.fn() as any,
    destroy: vi.fn() as any,
    filesystem: {} as any,
  } as unknown as Sandbox;
}

/**
 * Create a sandbox whose runCommand shells out locally via execSync.
 * This lets WarpGrep actually run rg/sed/find on the local filesystem.
 */
function createLocalExecSandbox(): Sandbox {
  return createMockSandbox(async (command: string, opts?: { cwd?: string }) => {
    try {
      const stdout = execSync(command, {
        cwd: opts?.cwd,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10 MB
        timeout: 30_000,
      });
      return { stdout, stderr: '', exitCode: 0, durationMs: 0 };
    } catch (err: any) {
      // rg exits with code 1 when no matches found -- that's expected
      return {
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? '',
        exitCode: err.status ?? 1,
        durationMs: 0,
      };
    }
  });
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe('executeCodeSearch', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('API key validation', () => {
    it('throws a clear error when no MORPH_API_KEY is set and none passed in options', async () => {
      delete process.env.MORPH_API_KEY;

      const sandbox = createMockSandbox();
      await expect(
        executeCodeSearch(sandbox, 'find something', '/home/user', {})
      ).rejects.toThrow(
        'codeSearch requires a Morph API key. Set MORPH_API_KEY or pass morphApiKey in options. Get yours at https://morphllm.com/dashboard'
      );
    });

    it('does not throw when morphApiKey is provided in options', async () => {
      delete process.env.MORPH_API_KEY;

      const sandbox = createMockSandbox();
      // It will throw from WarpGrepClient (network), not from our key validation
      await expect(
        executeCodeSearch(sandbox, 'find something', '/home/user', {
          morphApiKey: 'test-key-that-wont-actually-work',
        })
      ).rejects.not.toThrow(/codeSearch requires a Morph API key/);
    });

    it('does not throw when MORPH_API_KEY env var is set', async () => {
      process.env.MORPH_API_KEY = 'env-key-that-wont-actually-work';

      const sandbox = createMockSandbox();
      // It will throw from WarpGrepClient (network), not from our key validation
      await expect(
        executeCodeSearch(sandbox, 'find something', '/home/user', {})
      ).rejects.not.toThrow(/codeSearch requires a Morph API key/);
    });
  });

});

// ---------------------------------------------------------------------------
// Shell injection prevention (input validation in buildRemoteCommands)
// ---------------------------------------------------------------------------

describe('buildRemoteCommands input validation', () => {
  /**
   * We call the returned closures directly so we can trigger validation
   * without a real WarpGrep model loop.
   */
  const sandbox = createMockSandbox();

  describe('read – line range validation', () => {
    const cmds = buildRemoteCommands(sandbox);

    it('throws "Invalid line range" for NaN start', async () => {
      await expect(cmds.read('/tmp/file.ts', NaN, 10)).rejects.toThrow('Invalid line range');
    });

    it('throws "Invalid line range" for NaN end', async () => {
      await expect(cmds.read('/tmp/file.ts', 1, NaN)).rejects.toThrow('Invalid line range');
    });

    it('throws "Invalid line range" for negative start', async () => {
      await expect(cmds.read('/tmp/file.ts', -5, 10)).rejects.toThrow('Invalid line range');
    });

    it('throws "Invalid line range" for zero start', async () => {
      await expect(cmds.read('/tmp/file.ts', 0, 10)).rejects.toThrow('Invalid line range');
    });

    it('throws "Invalid line range" for negative end', async () => {
      await expect(cmds.read('/tmp/file.ts', 1, -3)).rejects.toThrow('Invalid line range');
    });

    it('throws "Invalid line range" for Infinity', async () => {
      await expect(cmds.read('/tmp/file.ts', 1, Infinity)).rejects.toThrow('Invalid line range');
    });

    it('throws "Invalid line range" for non-integer coerced via Number() (string input)', async () => {
      // TypeScript signatures say `number` but at runtime WarpGrep may pass anything
      await expect(cmds.read('/tmp/file.ts', '1; rm -rf /' as any, 10)).rejects.toThrow('Invalid line range');
    });
  });

  describe('listDir – maxDepth validation', () => {
    const cmds = buildRemoteCommands(sandbox);

    it('throws "Invalid maxDepth" for NaN', async () => {
      await expect(cmds.listDir('/tmp', NaN)).rejects.toThrow('Invalid maxDepth');
    });

    it('throws "Invalid maxDepth" for negative value', async () => {
      await expect(cmds.listDir('/tmp', -1)).rejects.toThrow('Invalid maxDepth');
    });

    it('throws "Invalid maxDepth" for Infinity', async () => {
      await expect(cmds.listDir('/tmp', Infinity)).rejects.toThrow('Invalid maxDepth');
    });

    it('throws "Invalid maxDepth" for non-numeric string coerced via Number()', async () => {
      await expect(cmds.listDir('/tmp', '3; cat /etc/passwd' as any)).rejects.toThrow('Invalid maxDepth');
    });

    it('accepts zero maxDepth (valid edge case)', async () => {
      // maxDepth 0 means only list the directory itself – should NOT throw
      await expect(cmds.listDir('/tmp', 0)).resolves.toBeDefined();
    });
  });

  describe('grep – shell escaping of arguments', () => {
    it('passes shell-escaped pattern and path to runCommand', async () => {
      const spy = vi.fn().mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 0,
      });
      const spySandbox = createMockSandbox(spy);
      const cmds = buildRemoteCommands(spySandbox);

      await cmds.grep("hello'world", '/tmp/te st');

      expect(spy).toHaveBeenCalledOnce();
      const cmd: string = spy.mock.calls[0][0];
      // Pattern and path should be single-quote escaped
      expect(cmd).toContain("'hello'\\''world'");
      expect(cmd).toContain("'/tmp/te st'");
    });

    it('passes shell-escaped glob to runCommand', async () => {
      const spy = vi.fn().mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 0,
      });
      const spySandbox = createMockSandbox(spy);
      const cmds = buildRemoteCommands(spySandbox);

      await cmds.grep('pattern', '/src', '*.ts');

      expect(spy).toHaveBeenCalledOnce();
      const cmd: string = spy.mock.calls[0][0];
      expect(cmd).toContain('--glob');
      expect(cmd).toContain("'*.ts'");
    });
  });

  describe('read – shell escaping of path and correct sed command', () => {
    it('uses integer-floored line numbers in sed command', async () => {
      const spy = vi.fn().mockResolvedValue({
        stdout: 'line content\n',
        stderr: '',
        exitCode: 0,
        durationMs: 0,
      });
      const spySandbox = createMockSandbox(spy);
      const cmds = buildRemoteCommands(spySandbox);

      await cmds.read('/tmp/file.ts', 5.7, 10.3);

      expect(spy).toHaveBeenCalledOnce();
      const cmd: string = spy.mock.calls[0][0];
      // Math.floor(5.7)=5, Math.floor(10.3)=10
      expect(cmd).toContain("sed -n '5,10p'");
      expect(cmd).toContain("'/tmp/file.ts'");
    });
  });
});

// ---------------------------------------------------------------------------
// Integration test: real WarpGrep search on local codebase
// ---------------------------------------------------------------------------

describe('executeCodeSearch integration (real WarpGrep)', () => {
  const MORPH_API_KEY = process.env.MORPH_API_KEY;
  const REPO_ROOT = path.resolve(__dirname, '../../../..');

  // Skip the whole suite if no API key is available (CI, etc.)
  const describeIfKey = MORPH_API_KEY ? describe : describe.skip;

  describeIfKey('live search on computesdk repo', () => {
    it('returns results for a semantic query about provider auto-detection', async () => {
      const sandbox = createLocalExecSandbox();

      const results: CodeSearchResult[] = await executeCodeSearch(
        sandbox,
        'How does auto-detection of providers work?',
        REPO_ROOT,
        { morphApiKey: MORPH_API_KEY },
      );

      // Log results for manual inspection
      console.log('\n=== WarpGrep Results: "How does auto-detection of providers work?" ===');
      console.log(`Found ${results.length} result(s):\n`);
      for (const r of results) {
        console.log(`--- ${r.file} (lines: ${JSON.stringify(r.lines)}) ---`);
        // Show first 500 chars to keep output readable
        console.log(r.content.slice(0, 500));
        console.log('...\n');
      }

      // Assertions
      expect(results.length).toBeGreaterThan(0);

      // Each result should have file and content
      for (const r of results) {
        expect(r.file).toBeTruthy();
        expect(typeof r.file).toBe('string');
        expect(r.content).toBeTruthy();
        expect(typeof r.content).toBe('string');
      }

      // We expect at least one result to reference auto-detect related code
      const allFiles = results.map(r => r.file).join(' ');
      const allContent = results.map(r => r.content).join(' ');
      const mentionsAutoDetect =
        allFiles.includes('auto-detect') ||
        allContent.includes('detectProvider') ||
        allContent.includes('auto') ||
        allContent.includes('detect');
      expect(mentionsAutoDetect).toBe(true);
    }, 60_000); // 60s timeout for network call

    it('returns results for a query about code search implementation', async () => {
      const sandbox = createLocalExecSandbox();

      const results: CodeSearchResult[] = await executeCodeSearch(
        sandbox,
        'Where is codeSearch wired into the sandbox filesystem?',
        REPO_ROOT,
        { morphApiKey: MORPH_API_KEY },
      );

      console.log('\n=== WarpGrep Results: "Where is codeSearch wired into the sandbox filesystem?" ===');
      console.log(`Found ${results.length} result(s):\n`);
      for (const r of results) {
        console.log(`--- ${r.file} (lines: ${JSON.stringify(r.lines)}) ---`);
        console.log(r.content.slice(0, 500));
        console.log('...\n');
      }

      expect(results.length).toBeGreaterThan(0);

      // Should find code-search.ts or client/index.ts or the types file
      const allFiles = results.map(r => r.file).join(' ');
      const allContent = results.map(r => r.content).join(' ');
      const mentionsCodeSearch =
        allFiles.includes('code-search') ||
        allFiles.includes('client/index') ||
        allContent.includes('codeSearch') ||
        allContent.includes('executeCodeSearch');
      expect(mentionsCodeSearch).toBe(true);
    }, 60_000);

    it('accepts excludes option without errors', async () => {
      const sandbox = createLocalExecSandbox();

      const results: CodeSearchResult[] = await executeCodeSearch(
        sandbox,
        'Find configuration constants',
        REPO_ROOT,
        {
          morphApiKey: MORPH_API_KEY,
          excludes: ['node_modules', '.git', 'dist'],
        },
      );

      console.log('\n=== WarpGrep Results with excludes ===');
      console.log(`Found ${results.length} result(s)`);
      for (const r of results) {
        console.log(`  ${r.file}`);
      }

      // Verify the search succeeded and returned results
      expect(results.length).toBeGreaterThan(0);

      // Results should not include node_modules (WarpGrep excludes
      // these by default anyway, but we're verifying the option is
      // accepted and plumbed through without errors)
      for (const r of results) {
        expect(r.file).not.toMatch(/node_modules/);
      }
    }, 60_000);
  });
});
