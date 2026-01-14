/**
 * Provider Compatibility Test
 *
 * Tests all sandbox patterns to validate ComputeSDK works
 * consistently across different providers.
 *
 * Run: TEST_PROVIDER=e2b pnpm test provider-compatibility
 *
 * Requirements:
 * - TEST_PROVIDER environment variable (e2b, vercel, daytona, modal)
 * - COMPUTESDK_API_KEY environment variable
 * - Provider-specific keys (E2B_API_KEY, VERCEL_TOKEN, etc.)
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { compute } from '../index';
import type { Sandbox } from '../client';
import type { TerminalInstance } from '../client/terminal';

// Determine which provider to test
const testProvider = process.env.TEST_PROVIDER || 'e2b';

// Check if we have the required keys for the selected provider
function hasRequiredKeys(): boolean {
  if (!process.env.COMPUTESDK_API_KEY) return false;
  
  switch (testProvider) {
    case 'e2b':
      return !!process.env.E2B_API_KEY;
    case 'vercel':
      return !!process.env.VERCEL_TOKEN && !!process.env.VERCEL_TEAM_ID && !!process.env.VERCEL_PROJECT_ID;
    case 'daytona':
      return !!process.env.DAYTONA_API_KEY;
    case 'modal':
      return !!process.env.MODAL_TOKEN_ID && !!process.env.MODAL_TOKEN_SECRET;
    default:
      return false;
  }
}

// Cache the result so we don't recompute
const shouldRunTests = hasRequiredKeys();

// Get provider config based on TEST_PROVIDER
function getProviderConfig(): Record<string, unknown> {
  const baseConfig = {
    provider: testProvider,
    computesdkApiKey: process.env.COMPUTESDK_API_KEY!,
  };
  
  switch (testProvider) {
    case 'e2b':
      return {
        ...baseConfig,
        e2b: { 
          apiKey: process.env.E2B_API_KEY!, 
          templateId: process.env.E2B_TEMPLATE_ID || 'base',
        },
      };
    case 'vercel':
      return {
        ...baseConfig,
        vercel: { 
          token: process.env.VERCEL_TOKEN!,
          teamId: process.env.VERCEL_TEAM_ID!,
          projectId: process.env.VERCEL_PROJECT_ID!,
        },
      };
    case 'daytona':
      return {
        ...baseConfig,
        daytona: { 
          apiKey: process.env.DAYTONA_API_KEY!,
        },
      };
    case 'modal':
      return {
        ...baseConfig,
        modal: { 
          tokenId: process.env.MODAL_TOKEN_ID!,
          tokenSecret: process.env.MODAL_TOKEN_SECRET!,
        },
      };
    default:
      throw new Error(`Unknown provider: ${testProvider}`);
  }
}

// Get create options (some providers need templateId, others don't)
function getCreateOptions(): Record<string, unknown> {
  const baseOptions = {
    envs: { TEST_VAR: 'test-value' },
    metadata: { devServerId: 'test-123' },
  };
  
  if (testProvider === 'e2b') {
    return {
      ...baseOptions,
      templateId: process.env.E2B_TEMPLATE_ID || 'base',
    };
  }
  
  return baseOptions;
}

describe.skipIf(!shouldRunTests)(`Provider Compatibility (${testProvider})`, () => {
  let sandbox: Sandbox;
  let sandboxId: string;

  beforeAll(async () => {
    // Only configure if we have the required keys (extra guard)
    if (shouldRunTests) {
      compute.setConfig(getProviderConfig() as any);
    }
  });

  afterAll(async () => {
    if (sandboxId) {
      try {
        await compute.sandbox.destroy(sandboxId);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });

  // ==========================================================================
  // SANDBOX LIFECYCLE
  // ==========================================================================

  describe('Sandbox Lifecycle', () => {
    it('Sandbox.create({ envs, metadata })', async () => {
      // ComputeSDK: compute.sandbox.create({ envs, metadata })
      sandbox = await compute.sandbox.create(getCreateOptions() as any);

      expect(sandbox).toBeDefined();
      expect(sandbox.sandboxId).toBeDefined();
      sandboxId = sandbox.sandboxId;
    }, 60000);

    it('Sandbox.connect(sandboxId, { domain })', async () => {
      // E2B: E2BInstance.connect(e2bInstanceId, { domain: 'e2b.dev' })
      // ComputeSDK: compute.sandbox.getById(sandboxId)
      const connected = await compute.sandbox.getById(sandboxId);
      expect(connected).toBeDefined();
      expect(connected?.sandboxId).toBe(sandboxId);
    }, 30000);

    it('sandbox.sandboxId', async () => {
      // E2B: e2bInstance.sandboxId
      // ComputeSDK: sandbox.sandboxId (same)
      expect(sandbox.sandboxId).toBe(sandboxId);
      expect(typeof sandbox.sandboxId).toBe('string');
    });

    // TODO: Gateway feature not implemented yet
    it.skip('sandbox.setTimeout(ms) -> extendTimeout', async () => {
      // E2B: await e2bInstance.setTimeout(minDurationMs)
      // ComputeSDK: await compute.sandbox.extendTimeout(sandboxId, { duration: ms })
      await compute.sandbox.extendTimeout(sandboxId, { duration: 300000 });
      // No error means success
    }, 30000);
  });

  // ==========================================================================
  // FILE OPERATIONS (DevServer.ts, expo files patterns)
  // ==========================================================================

  // Note: Using relative paths (e.g., 'testfiles/') instead of absolute paths (e.g., '/tmp/')
  // because absolute path handling is inconsistent in the daemon. See daemon team for fix.
  describe('File Operations', () => {
    const testDir = 'testfiles';

    it('sandbox.files.write(path, content)', async () => {
      // E2B: await sandbox.files.write(path, content)
      // ComputeSDK: await sandbox.filesystem.writeFile(path, content)
      await sandbox.filesystem.mkdir(testDir);
      await sandbox.filesystem.writeFile(`${testDir}/test.txt`, 'Hello World');
      await sandbox.filesystem.writeFile(
        `${testDir}/app.json`,
        JSON.stringify({ name: 'test', version: '1.0.0' })
      );
    }, 30000);

    it('sandbox.files.write([{path, data}], opts) - batch write', async () => {
      // E2B: await sandbox.files.write([{path, data}], { requestTimeoutMs })
      // ComputeSDK: use batchWriteFiles or multiple writeFile calls
      // Note: ComputeSDK has sandbox.file.batchWrite() for this
      await sandbox.file.batchWrite([
        { path: `${testDir}/batch1.txt`, operation: 'write', content: 'file1' },
        { path: `${testDir}/batch2.txt`, operation: 'write', content: 'file2' },
      ]);

      const content1 = await sandbox.filesystem.readFile(`${testDir}/batch1.txt`);
      const content2 = await sandbox.filesystem.readFile(`${testDir}/batch2.txt`);
      expect(content1).toBe('file1');
      expect(content2).toBe('file2');
    }, 30000);

    it('sandbox.files.read(path)', async () => {
      // E2B: const content = await sandbox.files.read(path)
      // ComputeSDK: const content = await sandbox.filesystem.readFile(path)
      const content = await sandbox.filesystem.readFile(`${testDir}/test.txt`);
      expect(content).toBe('Hello World');
    }, 30000);

    it('sandbox.files.exists(path)', async () => {
      // E2B: const exists = await sandbox.files.exists(path)
      // ComputeSDK: const exists = await sandbox.filesystem.exists(path)
      const exists = await sandbox.filesystem.exists(`${testDir}/test.txt`);
      expect(exists).toBe(true);

      const notExists = await sandbox.filesystem.exists(`${testDir}/nonexistent.txt`);
      expect(notExists).toBe(false);
    }, 30000);

    it('sandbox.files.remove(path, opts)', async () => {
      // E2B: await sandbox.files.remove(path, { requestTimeoutMs })
      // ComputeSDK: await sandbox.filesystem.remove(path)
      await sandbox.filesystem.writeFile(`${testDir}/to-delete.txt`, 'delete me');
      await sandbox.filesystem.remove(`${testDir}/to-delete.txt`);

      const exists = await sandbox.filesystem.exists(`${testDir}/to-delete.txt`);
      expect(exists).toBe(false);
    }, 30000);

    it('sandbox.files.list(path) -> readdir', async () => {
      // E2B: const files = await sandbox.files.list(path)
      // ComputeSDK: const files = await sandbox.filesystem.readdir(path)
      const files = await sandbox.filesystem.readdir(testDir);
      expect(Array.isArray(files)).toBe(true);

      const testFile = files.find((f) => f.name === 'test.txt');
      expect(testFile).toBeDefined();
      expect(testFile?.type).toBe('file');
    }, 30000);

    it('sandbox.files.mkdir(path)', async () => {
      // E2B: via commands or files API
      // ComputeSDK: await sandbox.filesystem.mkdir(path)
      await sandbox.filesystem.mkdir(`${testDir}/newdir`);
      const exists = await sandbox.filesystem.exists(`${testDir}/newdir`);
      expect(exists).toBe(true);
    }, 30000);
  });

  // ==========================================================================
  // COMMAND EXECUTION (DevServer.ts, expo patterns)
  // ==========================================================================

  describe('Command Execution', () => {
    it('sandbox.commands.run(cmd, { cwd, env, timeoutMs })', async () => {
      // E2B: await sandbox.commands.run(cmd, { cwd, envs, timeoutMs })
      // ComputeSDK: await sandbox.runCommand(cmd, { cwd, env })
      const result = await sandbox.runCommand('echo "hello"');
      expect(result.stdout.trim()).toBe('hello');
      expect(result.exitCode).toBe(0);
    }, 30000);

    it('command with cwd option', async () => {
      // Using relative path - absolute paths have inconsistent handling in daemon
      await sandbox.filesystem.mkdir('cmdtest');
      await sandbox.filesystem.writeFile('cmdtest/file.txt', 'content');

      const result = await sandbox.runCommand('ls', { cwd: 'cmdtest' });
      expect(result.stdout).toContain('file.txt');
      expect(result.exitCode).toBe(0);
    }, 30000);

    it('command with env option', async () => {
      const result = await sandbox.runCommand('echo $MY_VAR', {
        env: { MY_VAR: 'my-value' },
      });
      expect(result.stdout.trim()).toBe('my-value');
    }, 30000);

    it('command with background option', async () => {
      // E2B: await sandbox.commands.run(cmd, { background: true })
      // ComputeSDK: await sandbox.runCommand(cmd, { background: true })
      const result = await sandbox.runCommand('sleep 1 && echo done', {
        background: true,
      });
      // Background commands return immediately
      expect(result.exitCode).toBeDefined();
    }, 30000);

    it('command exit codes', async () => {
      const result = await sandbox.runCommand('exit 42');
      expect(result.exitCode).toBe(42);
    }, 30000);

    it('command stdout and stderr', async () => {
      const result = await sandbox.runCommand(
        'echo "stdout" && echo "stderr" >&2'
      );
      expect(result.stdout).toContain('stdout');
      expect(result.stderr).toContain('stderr');
    }, 30000);

    it('command with streaming callbacks (waits for completion)', async () => {
      let stdoutCalled = false;

      const result = await sandbox.runCommand('echo "hello"', {
        onStdout: () => { stdoutCalled = true; },
      });

      // Streaming without background waits for completion
      expect(stdoutCalled).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('hello');
    }, 30000);

    it('command with background + streaming (returns immediately)', async () => {
      // Use promise to wait for callback instead of fixed timeout
      const stdoutPromise = new Promise<void>((resolve) => {
        sandbox.runCommand('echo "hello"', {
          background: true,
          onStdout: () => resolve(),
        }).then((result) => {
          // Background + streaming returns immediately
          // stdout/stderr are empty since we didn't wait
          expect(result.stdout).toBe('');
          expect(result.stderr).toBe('');
          expect(result.exitCode).toBe(0);
        });
      });

      // Wait for stdout callback (with timeout fallback)
      await Promise.race([
        stdoutPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for stdout')), 10000))
      ]);
    }, 30000);
  });

  // ==========================================================================
  // PTY TERMINAL (interactive-terminal patterns - CRITICAL)
  // ==========================================================================

  describe('PTY Terminal', () => {
    let terminal: TerminalInstance;

    afterEach(async () => {
      if (terminal) {
        try {
          await terminal.destroy();
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    });

    it('sandbox.pty.create({ cols, rows, cwd, onData })', async () => {
      // E2B: shell = await sandbox.pty.create({ cols, rows, cwd, timeoutMs, onData })
      // ComputeSDK: terminal = await sandbox.terminal.create({ pty: true })
      //             terminal.on('output', callback)
      terminal = await sandbox.terminal.create({ pty: true });

      expect(terminal).toBeDefined();
      expect(terminal.id).toBeDefined();
      expect(terminal.pty).toBe(true);
    }, 30000);

    it('sandbox.pty.sendInput(pid, data)', async () => {
      // E2B: await sandbox.pty.sendInput(shell.pid, new Uint8Array(Buffer.from(cmd)))
      // ComputeSDK: terminal.write(input)
      terminal = await sandbox.terminal.create({ pty: true });

      // Set up output promise BEFORE writing
      const outputPromise = new Promise<void>((resolve) => {
        terminal.on('output', () => resolve());
      });

      // Use sleep to give subscription time to propagate, then echo
      terminal.write('sleep 1 && echo "test"\n');

      // Wait for output event (with timeout fallback)
      await Promise.race([
        outputPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for output')), 10000))
      ]);
    }, 30000);

    it('terminal.on("output", callback) - streaming output', async () => {
      // E2B: onData callback in pty.create
      // ComputeSDK: terminal.on('output', callback)
      terminal = await sandbox.terminal.create({ pty: true });

      // Set up output promise BEFORE writing
      const outputPromise = new Promise<void>((resolve) => {
        terminal.on('output', () => resolve());
      });

      // Use sleep to give subscription time to propagate, then echo
      terminal.write('sleep 1 && echo "test"\n');

      // Wait for output event (with timeout fallback)
      await Promise.race([
        outputPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for output')), 10000))
      ]);
    }, 30000);

    it('sandbox.pty.kill(pid) -> terminal.destroy()', async () => {
      // E2B: await sandbox.pty.kill(shell.pid)
      // ComputeSDK: await terminal.destroy()
      terminal = await sandbox.terminal.create({ pty: true });
      const terminalId = terminal.id;

      await terminal.destroy();

      // Terminal should be stopped
      expect(terminal.status).toBe('stopped');
    }, 30000);

    it('PTY with shell option', async () => {
      // E2B implicitly uses default shell
      // ComputeSDK: can specify shell
      terminal = await sandbox.terminal.create({
        pty: true,
        shell: '/bin/bash',
      });

      expect(terminal.pty).toBe(true);
    }, 30000);
  });

  // ==========================================================================
  // EXEC TERMINAL (command tracking mode)
  // ==========================================================================

  describe('Exec Terminal', () => {
    let terminal: TerminalInstance;

    afterEach(async () => {
      if (terminal) {
        try {
          await terminal.destroy();
        } catch (e) {
          // Ignore
        }
      }
    });

    it('create exec terminal', async () => {
      // ComputeSDK exec mode for command tracking
      terminal = await sandbox.terminal.create({ pty: false });

      expect(terminal.pty).toBe(false);
    }, 30000);

    it('execute and track command', async () => {
      terminal = await sandbox.terminal.create({ pty: false });

      // Run command and get result
      const result = await terminal.execute('echo "exec-test"');
      expect(result.data.stdout).toContain('exec-test');
    }, 30000);
  });

  // ==========================================================================
  // URL GENERATION (E2BSandbox.ts patterns)
  // ==========================================================================

  describe('URL Generation', () => {
    it('getUrl for different ports', async () => {
      // E2B: https://${port}-${sandboxId}.e2b.dev
      // ComputeSDK: sandbox.getUrl({ port })
      const webUrl = await sandbox.getUrl({ port: 4000 });
      const expoUrl = await sandbox.getUrl({ port: 8081 });
      const healthUrl = await sandbox.getUrl({ port: 9000 });

      expect(webUrl).toContain('4000');
      expect(expoUrl).toContain('8081');
      expect(healthUrl).toContain('9000');
    }, 30000);
  });

  // ==========================================================================
  // SERVER MANAGEMENT (supervisor/daemon patterns)
  // ==========================================================================

  describe('Server Management', () => {
    const testSlug = 'test-server';

    afterEach(async () => {
      // Clean up any test servers
      try {
        await sandbox.server.stop(testSlug);
      } catch {
        // Ignore - server may not exist
      }
    });

    it('sandbox.server.start({ slug, command })', async () => {
      // Start a basic server
      const server = await sandbox.server.start({
        slug: testSlug,
        command: 'python3 -m http.server 8080',
      });

      expect(server.slug).toBe(testSlug);
      expect(server.command).toBe('python3 -m http.server 8080');
      expect(server.status).toBeDefined();
    }, 30000);

    it('sandbox.server.start with environment variables', async () => {
      // Start server with inline environment variables
      const server = await sandbox.server.start({
        slug: testSlug,
        command: 'echo $TEST_VAR && sleep 10',
        environment: { TEST_VAR: 'hello-world' },
      });

      expect(server.slug).toBe(testSlug);
      // Note: environment field only returned after server-core PR #89 is deployed
      if (server.environment !== undefined) {
        expect(server.environment).toEqual({ TEST_VAR: 'hello-world' });
      }
    }, 30000);

    it('sandbox.server.start with restart_policy', async () => {
      // Start server with supervisor settings
      const server = await sandbox.server.start({
        slug: testSlug,
        command: 'python3 -m http.server 8080',
        restart_policy: 'on-failure',
        max_restarts: 3,
        restart_delay_ms: 1000,
        stop_timeout_ms: 5000,
      });

      expect(server.slug).toBe(testSlug);
      // Note: supervisor fields only returned after server-core PR #89 is deployed
      if (server.restart_policy !== undefined) {
        expect(server.restart_policy).toBe('on-failure');
        expect(server.max_restarts).toBe(3);
      }
    }, 30000);

    it('sandbox.server.list()', async () => {
      // Start a server first
      await sandbox.server.start({
        slug: testSlug,
        command: 'sleep 60',
      });

      // List servers
      const servers = await sandbox.server.list();

      expect(Array.isArray(servers)).toBe(true);
      const found = servers.find((s) => s.slug === testSlug);
      expect(found).toBeDefined();
    }, 30000);

    it('sandbox.server.retrieve(slug)', async () => {
      // Start a server first
      await sandbox.server.start({
        slug: testSlug,
        command: 'sleep 60',
      });

      // Retrieve server
      const server = await sandbox.server.retrieve(testSlug);

      expect(server.slug).toBe(testSlug);
      expect(server.pid).toBeDefined();
    }, 30000);

    it('sandbox.server.stop(slug) - graceful shutdown', async () => {
      // Start a server first
      await sandbox.server.start({
        slug: testSlug,
        command: 'sleep 60',
      });

      // Stop server (SIGTERM → wait → SIGKILL)
      await sandbox.server.stop(testSlug);

      // Server should be stopped or removed from list
      const servers = await sandbox.server.list();
      const found = servers.find((s) => s.slug === testSlug);
      // Server may be 'stopped' or removed from list entirely depending on backend
      if (found) {
        expect(found.status).toBe('stopped');
      }
    }, 30000);

    it('sandbox.server.restart(slug)', async () => {
      // Start a server first
      await sandbox.server.start({
        slug: testSlug,
        command: 'sleep 60',
      });

      // Restart server
      const restarted = await sandbox.server.restart(testSlug);

      expect(restarted.slug).toBe(testSlug);
      expect(['starting', 'running', 'restarting']).toContain(restarted.status);
    }, 30000);
  });

  // ==========================================================================
  // FILESYSTEM OVERLAYS (template directories)
  // ==========================================================================

  describe('Filesystem Overlays', () => {
    let overlayId: string | null = null;

    afterEach(async () => {
      // Clean up any test overlays
      if (overlayId) {
        try {
          await sandbox.filesystem.overlay.destroy(overlayId);
        } catch {
          // Ignore - overlay may not exist
        }
        overlayId = null;
      }
    });

    it('sandbox.filesystem.overlay.create({ source, target })', async () => {
      // First create a source directory to overlay from
      await sandbox.filesystem.mkdir('overlay-source');
      await sandbox.filesystem.writeFile('overlay-source/index.js', 'console.log("hello");');
      await sandbox.filesystem.writeFile('overlay-source/package.json', '{"name": "test"}');
      await sandbox.filesystem.mkdir('overlay-source/src');
      await sandbox.filesystem.writeFile('overlay-source/src/app.js', 'export default {}');

      // Get the absolute path to the source directory
      const pwdResult = await sandbox.runCommand('pwd');
      const workingDir = pwdResult.stdout.trim();
      const absoluteSource = `${workingDir}/overlay-source`;

      // Create overlay
      const overlay = await sandbox.filesystem.overlay.create({
        source: absoluteSource,
        target: 'overlay-target',
      });

      overlayId = overlay.id;

      expect(overlay.id).toBeDefined();
      expect(overlay.source).toBe(absoluteSource);
      expect(overlay.target).toBe('overlay-target');
      expect(overlay.copyStatus).toBeDefined();
      expect(['pending', 'in_progress', 'complete']).toContain(overlay.copyStatus);
      expect(overlay.stats).toBeDefined();
      expect(typeof overlay.stats.symlinkedFiles).toBe('number');
      expect(typeof overlay.stats.symlinkedDirs).toBe('number');
    }, 30000);

    it('sandbox.filesystem.overlay.list()', async () => {
      // Create a source directory and overlay first
      await sandbox.filesystem.mkdir('overlay-list-source');
      await sandbox.filesystem.writeFile('overlay-list-source/file.txt', 'content');

      const pwdResult = await sandbox.runCommand('pwd');
      const workingDir = pwdResult.stdout.trim();
      const absoluteSource = `${workingDir}/overlay-list-source`;

      const overlay = await sandbox.filesystem.overlay.create({
        source: absoluteSource,
        target: 'overlay-list-target',
      });
      overlayId = overlay.id;

      // List overlays
      const overlays = await sandbox.filesystem.overlay.list();

      expect(Array.isArray(overlays)).toBe(true);
      const found = overlays.find((o) => o.id === overlay.id);
      expect(found).toBeDefined();
      expect(found?.source).toBe(absoluteSource);
    }, 30000);

    it('sandbox.filesystem.overlay.retrieve(id) - polling copy status', async () => {
      // Create a source directory and overlay
      await sandbox.filesystem.mkdir('overlay-retrieve-source');
      await sandbox.filesystem.writeFile('overlay-retrieve-source/file.txt', 'content');

      const pwdResult = await sandbox.runCommand('pwd');
      const workingDir = pwdResult.stdout.trim();
      const absoluteSource = `${workingDir}/overlay-retrieve-source`;

      const overlay = await sandbox.filesystem.overlay.create({
        source: absoluteSource,
        target: 'overlay-retrieve-target',
      });
      overlayId = overlay.id;

      // Retrieve overlay (useful for polling copy status)
      const retrieved = await sandbox.filesystem.overlay.retrieve(overlay.id);

      expect(retrieved.id).toBe(overlay.id);
      expect(retrieved.copyStatus).toBeDefined();
      // Copy may have completed by now or still in progress
      expect(['pending', 'in_progress', 'complete']).toContain(retrieved.copyStatus);
    }, 30000);

    it('sandbox.filesystem.overlay.destroy(id)', async () => {
      // Create a source directory and overlay
      await sandbox.filesystem.mkdir('overlay-delete-source');
      await sandbox.filesystem.writeFile('overlay-delete-source/file.txt', 'content');

      const pwdResult = await sandbox.runCommand('pwd');
      const workingDir = pwdResult.stdout.trim();
      const absoluteSource = `${workingDir}/overlay-delete-source`;

      const overlay = await sandbox.filesystem.overlay.create({
        source: absoluteSource,
        target: 'overlay-delete-target',
      });

      // Delete overlay
      await sandbox.filesystem.overlay.destroy(overlay.id);

      // Verify it's gone
      const overlays = await sandbox.filesystem.overlay.list();
      const found = overlays.find((o) => o.id === overlay.id);
      expect(found).toBeUndefined();

      // Clear overlayId since we already deleted it
      overlayId = null;
    }, 30000);

    it('overlay files are accessible in target directory', async () => {
      // Create a source directory with files
      await sandbox.filesystem.mkdir('overlay-access-source');
      await sandbox.filesystem.writeFile('overlay-access-source/hello.txt', 'Hello from overlay!');
      await sandbox.filesystem.writeFile('overlay-access-source/config.json', '{"key": "value"}');

      const pwdResult = await sandbox.runCommand('pwd');
      const workingDir = pwdResult.stdout.trim();
      const absoluteSource = `${workingDir}/overlay-access-source`;

      // Create overlay
      const overlay = await sandbox.filesystem.overlay.create({
        source: absoluteSource,
        target: 'overlay-access-target',
      });
      overlayId = overlay.id;

      // Verify files are accessible in target directory
      const helloContent = await sandbox.filesystem.readFile('overlay-access-target/hello.txt');
      expect(helloContent).toBe('Hello from overlay!');

      const configContent = await sandbox.filesystem.readFile('overlay-access-target/config.json');
      expect(configContent).toBe('{"key": "value"}');

      // List files in target directory
      const files = await sandbox.filesystem.readdir('overlay-access-target');
      expect(files.length).toBe(2);
      expect(files.map((f) => f.name).sort()).toEqual(['config.json', 'hello.txt']);
    }, 30000);
  });

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  describe('Cleanup', () => {
    it('Sandbox.kill(sandboxId)', async () => {
      // ComputeSDK: await compute.sandbox.destroy(sandboxId)

      // Create a temporary sandbox to destroy
      const tempSandbox = await compute.sandbox.create(getCreateOptions() as any);
      const tempId = tempSandbox.sandboxId;

      await compute.sandbox.destroy(tempId);

      // Verify it's gone
      const reconnected = await compute.sandbox.getById(tempId);
      expect(reconnected).toBeNull();
    }, 60000);
  });
});

/**
 * ComputeSDK API Summary
 *
 * SANDBOX LIFECYCLE:
 *   compute.sandbox.create({ envs, metadata })
 *   compute.sandbox.getById(id)
 *   compute.sandbox.destroy(id)
 *   sandbox.sandboxId
 *
 * FILE OPERATIONS:
 *   sandbox.filesystem.writeFile(path, content)
 *   sandbox.filesystem.readFile(path)
 *   sandbox.filesystem.exists(path)
 *   sandbox.filesystem.remove(path)
 *   sandbox.filesystem.readdir(path)
 *   sandbox.filesystem.mkdir(path)
 *   sandbox.file.batchWrite([{path, operation, content}])
 *
 * COMMAND EXECUTION:
 *   sandbox.runCommand(cmd, { cwd, env, background })
 *   result.stdout, result.stderr, result.exitCode
 *
 * PTY TERMINAL:
 *   sandbox.terminal.create({ pty: true })
 *   terminal.on('output', callback)
 *   terminal.write(input)
 *   terminal.destroy()
 *   terminal.id, terminal.status
 *
 * EXEC TERMINAL:
 *   sandbox.terminal.create({ pty: false })
 *   terminal.execute(command)
 *
 * URL GENERATION:
 *   sandbox.getUrl({ port })
 *
 * SERVER MANAGEMENT:
 *   sandbox.server.start({ slug, command, environment, restart_policy, ... })
 *   sandbox.server.list()
 *   sandbox.server.retrieve(slug)
 *   sandbox.server.stop(slug)
 *   sandbox.server.restart(slug)
 *   server.slug, server.status, server.pid, server.restart_count, server.exit_code
 *
 * FILESYSTEM OVERLAYS:
 *   sandbox.filesystem.overlay.create({ source, target })
 *   sandbox.filesystem.overlay.list()
 *   sandbox.filesystem.overlay.retrieve(id)
 *   sandbox.filesystem.overlay.destroy(id)
 *   overlay.id, overlay.source, overlay.target, overlay.copyStatus, overlay.stats
 */
