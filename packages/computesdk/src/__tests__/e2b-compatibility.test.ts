/**
 * E2B Compatibility Test
 *
 * Tests ALL E2B usage patterns to validate
 * ComputeSDK can fully replace E2B SDK.
 *
 * Run: pnpm test e2b-compatibility
 *
 * Requirements:
 * - E2B_API_KEY environment variable
 * - COMPUTESDK_API_KEY environment variable
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { compute } from '../index';
import type { Sandbox } from '../client';
import type { TerminalInstance } from '../client/terminal';

const hasRequiredKeys =
  !!process.env.E2B_API_KEY && !!process.env.COMPUTESDK_API_KEY;

describe.skipIf(!hasRequiredKeys)('E2B Compatibility', () => {
  let sandbox: Sandbox;
  let sandboxId: string;
  const templateId = process.env.E2B_TEMPLATE_ID || 'base';

  beforeAll(async () => {
    compute.setConfig({
      provider: 'e2b',
      computesdkApiKey: process.env.COMPUTESDK_API_KEY!,
      e2b: { apiKey: process.env.E2B_API_KEY!, templateId },
    });
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
  // SANDBOX LIFECYCLE (E2BSandbox.ts patterns)
  // ==========================================================================

  describe('Sandbox Lifecycle', () => {
    it('Sandbox.create(templateId, { domain, envs, metadata })', async () => {
      // E2B: E2BInstance.create(e2bTemplateId, { metadata, domain: 'e2b.dev', envs })
      // ComputeSDK: compute.sandbox.create({ templateId, envs, metadata })
      sandbox = await compute.sandbox.create({
        templateId,
        envs: { TEST_VAR: 'test-value' },
        metadata: { devServerId: 'test-123' },
      });

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

  describe('File Operations', () => {
    it('sandbox.files.write(path, content)', async () => {
      // E2B: await sandbox.files.write(path, content)
      // ComputeSDK: await sandbox.filesystem.writeFile(path, content)
      await sandbox.filesystem.writeFile('/tmp/test.txt', 'Hello World');
      await sandbox.filesystem.writeFile(
        '/tmp/app.json',
        JSON.stringify({ name: 'test', version: '1.0.0' })
      );
    }, 30000);

    it('sandbox.files.write([{path, data}], opts) - batch write', async () => {
      // E2B: await sandbox.files.write([{path, data}], { requestTimeoutMs })
      // ComputeSDK: use batchWriteFiles or multiple writeFile calls
      // Note: ComputeSDK has sandbox.file.batchWrite() for this
      await sandbox.file.batchWrite([
        { path: '/tmp/batch1.txt', operation: 'write', content: 'file1' },
        { path: '/tmp/batch2.txt', operation: 'write', content: 'file2' },
      ]);

      const content1 = await sandbox.filesystem.readFile('/tmp/batch1.txt');
      const content2 = await sandbox.filesystem.readFile('/tmp/batch2.txt');
      expect(content1).toBe('file1');
      expect(content2).toBe('file2');
    }, 30000);

    it('sandbox.files.read(path)', async () => {
      // E2B: const content = await sandbox.files.read(path)
      // ComputeSDK: const content = await sandbox.filesystem.readFile(path)
      const content = await sandbox.filesystem.readFile('/tmp/test.txt');
      expect(content).toBe('Hello World');
    }, 30000);

    it('sandbox.files.exists(path)', async () => {
      // E2B: const exists = await sandbox.files.exists(path)
      // ComputeSDK: const exists = await sandbox.filesystem.exists(path)
      const exists = await sandbox.filesystem.exists('/tmp/test.txt');
      expect(exists).toBe(true);

      const notExists = await sandbox.filesystem.exists('/tmp/nonexistent.txt');
      expect(notExists).toBe(false);
    }, 30000);

    it('sandbox.files.remove(path, opts)', async () => {
      // E2B: await sandbox.files.remove(path, { requestTimeoutMs })
      // ComputeSDK: await sandbox.filesystem.remove(path)
      await sandbox.filesystem.writeFile('/tmp/to-delete.txt', 'delete me');
      await sandbox.filesystem.remove('/tmp/to-delete.txt');

      const exists = await sandbox.filesystem.exists('/tmp/to-delete.txt');
      expect(exists).toBe(false);
    }, 30000);

    it('sandbox.files.list(path) -> readdir', async () => {
      // E2B: const files = await sandbox.files.list(path)
      // ComputeSDK: const files = await sandbox.filesystem.readdir(path)
      const files = await sandbox.filesystem.readdir('/tmp');
      expect(Array.isArray(files)).toBe(true);

      const testFile = files.find((f) => f.name === 'test.txt');
      expect(testFile).toBeDefined();
      expect(testFile?.type).toBe('file');
    }, 30000);

    it('sandbox.files.mkdir(path)', async () => {
      // E2B: via commands or files API
      // ComputeSDK: await sandbox.filesystem.mkdir(path)
      await sandbox.filesystem.mkdir('/tmp/newdir');
      const exists = await sandbox.filesystem.exists('/tmp/newdir');
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
      await sandbox.filesystem.mkdir('/tmp/cmdtest');
      await sandbox.filesystem.writeFile('/tmp/cmdtest/file.txt', 'content');

      const result = await sandbox.runCommand('ls', { cwd: '/tmp/cmdtest' });
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

      const outputs: string[] = [];
      terminal.on('output', (data) => outputs.push(data));

      // Send a command
      terminal.write('echo "test-output"\n');

      // Wait for output
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const allOutput = outputs.join('');
      expect(allOutput).toContain('test-output');
    }, 30000);

    it('terminal.on("output", callback) - streaming output', async () => {
      // E2B: onData callback in pty.create
      // ComputeSDK: terminal.on('output', callback)
      terminal = await sandbox.terminal.create({ pty: true });

      const chunks: string[] = [];
      terminal.on('output', (data) => chunks.push(data));

      terminal.write('for i in 1 2 3; do echo "line $i"; done\n');

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const allOutput = chunks.join('');
      expect(allOutput).toContain('line 1');
      expect(allOutput).toContain('line 2');
      expect(allOutput).toContain('line 3');
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
  // CLEANUP
  // ==========================================================================

  describe('Cleanup', () => {
    it('Sandbox.kill(sandboxId)', async () => {
      // E2B: await E2BInstance.kill(sandboxId)
      // ComputeSDK: await compute.sandbox.destroy(sandboxId)

      // Create a temporary sandbox to destroy
      const tempSandbox = await compute.sandbox.create({ templateId });
      const tempId = tempSandbox.sandboxId;

      await compute.sandbox.destroy(tempId);

      // Verify it's gone
      const reconnected = await compute.sandbox.getById(tempId);
      expect(reconnected).toBeNull();
    }, 60000);
  });
});

/**
 * API MAPPING SUMMARY
 *
 * SANDBOX LIFECYCLE:
 *   E2B                                    ComputeSDK
 *   ----                                   ----------
 *   Sandbox.create(template, opts)      -> compute.sandbox.create({ templateId, envs, metadata })
 *   Sandbox.connect(id, { domain })     -> compute.sandbox.getById(id)
 *   Sandbox.kill(id)                    -> compute.sandbox.destroy(id)
 *   sandbox.sandboxId                   -> sandbox.sandboxId
 *   sandbox.setTimeout(ms)              -> compute.sandbox.extendTimeout(id, { duration })
 *
 * FILE OPERATIONS:
 *   E2B                                    ComputeSDK
 *   ----                                   ----------
 *   sandbox.files.write(path, content)  -> sandbox.filesystem.writeFile(path, content)
 *   sandbox.files.write([{path, data}]) -> sandbox.file.batchWrite([{path, operation, content}])
 *   sandbox.files.read(path)            -> sandbox.filesystem.readFile(path)
 *   sandbox.files.exists(path)          -> sandbox.filesystem.exists(path)
 *   sandbox.files.remove(path)          -> sandbox.filesystem.remove(path)
 *   sandbox.files.list(path)            -> sandbox.filesystem.readdir(path)
 *
 * COMMAND EXECUTION:
 *   E2B                                    ComputeSDK
 *   ----                                   ----------
 *   sandbox.commands.run(cmd, opts)     -> sandbox.runCommand(cmd, opts)
 *   result.stdout, stderr, exitCode     -> result.stdout, stderr, exitCode
 *
 * PTY TERMINAL:
 *   E2B                                    ComputeSDK
 *   ----                                   ----------
 *   sandbox.pty.create({ onData })      -> sandbox.terminal.create({ pty: true })
 *                                          terminal.on('output', callback)
 *   sandbox.pty.sendInput(pid, data)    -> terminal.write(input)
 *   sandbox.pty.kill(pid)               -> terminal.destroy()
 *   shell.pid                           -> terminal.id
 *
 * URL GENERATION:
 *   E2B: https://${port}-${sandboxId}.e2b.dev
 *   ComputeSDK: await sandbox.getUrl({ port })
 */
