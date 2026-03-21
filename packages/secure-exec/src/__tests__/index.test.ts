import { describe, it, expect, afterEach } from 'vitest';
import * as indexExports from '../index';
import { secureExec } from '../index';

describe('secure-exec provider', () => {
  let provider: ReturnType<typeof secureExec>;
  let sandboxId: string | null = null;

  afterEach(async () => {
    if (sandboxId && provider) {
      await provider.sandbox.destroy(sandboxId);
      sandboxId = null;
    }
  });

  it('should be resolvable via camelCase conversion of the hyphenated provider name', () => {
    const exportName = 'secureExec';
    expect(typeof (indexExports as Record<string, unknown>)[exportName]).toBe('function');
  });

  it('should create a provider with the correct name', () => {
    provider = secureExec();
    expect(provider.name).toBe('secure-exec');
  });

  it('should create a provider with no args (default config)', () => {
    provider = secureExec();
    expect(provider.name).toBe('secure-exec');
  });

  it('should create and destroy a sandbox', async () => {
    provider = secureExec();
    const sandbox = await provider.sandbox.create();
    sandboxId = sandbox.sandboxId;

    expect(sandbox.sandboxId).toBeTruthy();
    expect(sandbox.provider).toBe('secure-exec');

    await sandbox.destroy();
    sandboxId = null;
  });

  // Blocked: secure-exec@0.1.1-rc.3 on npm is missing dist/generated/ bootstrap
  // files, so runtime.run() and runtime.exec() always return code: 1.
  // Uncomment once a fixed secure-exec version is published.

  // it('should run JS via runCommand and return JSON', async () => {
  //   provider = secureExec();
  //   const sandbox = await provider.sandbox.create();
  //   sandboxId = sandbox.sandboxId;
  //
  //   const result = await sandbox.runCommand('module.exports = 1 + 1;');
  //   expect(result.exitCode).toBe(0);
  //   expect(result.stdout).toBe('2');
  // });

  // it('should run code and capture console output', async () => {
  //   provider = secureExec();
  //   const sandbox = await provider.sandbox.create();
  //   sandboxId = sandbox.sandboxId;
  //
  //   const result = await sandbox.runCode('console.log("hello world")');
  //   expect(result.exitCode).toBe(0);
  //   expect(result.output.trim()).toBe('hello world');
  //   expect(result.language).toBe('javascript');
  // });

  // it('should return JSON objects from runCommand', async () => {
  //   provider = secureExec();
  //   const sandbox = await provider.sandbox.create();
  //   sandboxId = sandbox.sandboxId;
  //
  //   const result = await sandbox.runCommand('module.exports = { a: 1, b: "two" };');
  //   expect(result.exitCode).toBe(0);
  //   expect(JSON.parse(result.stdout)).toEqual({ a: 1, b: 'two' });
  // });

  // it('should support filesystem operations', async () => {
  //   provider = secureExec();
  //   const sandbox = await provider.sandbox.create();
  //   sandboxId = sandbox.sandboxId;
  //
  //   await sandbox.filesystem.writeFile('/tmp/test.txt', 'hello from secure-exec');
  //
  //   const content = await sandbox.filesystem.readFile('/tmp/test.txt');
  //   expect(content).toBe('hello from secure-exec');
  //
  //   const exists = await sandbox.filesystem.exists('/tmp/test.txt');
  //   expect(exists).toBe(true);
  //
  //   await sandbox.filesystem.remove('/tmp/test.txt');
  //   const existsAfter = await sandbox.filesystem.exists('/tmp/test.txt');
  //   expect(existsAfter).toBe(false);
  // });

  // it('should support mkdir and readdir', async () => {
  //   provider = secureExec();
  //   const sandbox = await provider.sandbox.create();
  //   sandboxId = sandbox.sandboxId;
  //
  //   await sandbox.filesystem.mkdir('/tmp/testdir');
  //   await sandbox.filesystem.writeFile('/tmp/testdir/file1.txt', 'content1');
  //   await sandbox.filesystem.writeFile('/tmp/testdir/file2.txt', 'content2');
  //
  //   const entries = await sandbox.filesystem.readdir('/tmp/testdir');
  //   const names = entries.map(e => e.name).sort();
  //   expect(names).toContain('file1.txt');
  //   expect(names).toContain('file2.txt');
  // });

  it('should get sandbox info', async () => {
    provider = secureExec();
    const sandbox = await provider.sandbox.create();
    sandboxId = sandbox.sandboxId;

    const info = await sandbox.getInfo();
    expect(info.provider).toBe('secure-exec');
    expect(info.status).toBe('running');
    expect(info.id).toBe(sandboxId);
  });

  it('should list sandboxes', async () => {
    provider = secureExec();
    const sandbox = await provider.sandbox.create();
    sandboxId = sandbox.sandboxId;

    const list = await provider.sandbox.list();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.some(s => s.sandboxId === sandboxId)).toBe(true);
  });

  it('should get sandbox by ID', async () => {
    provider = secureExec();
    const sandbox = await provider.sandbox.create();
    sandboxId = sandbox.sandboxId;

    const retrieved = await provider.sandbox.getById(sandboxId);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.sandboxId).toBe(sandboxId);
  });

  it('should throw on getUrl (not supported)', async () => {
    provider = secureExec();
    const sandbox = await provider.sandbox.create();
    sandboxId = sandbox.sandboxId;

    await expect(sandbox.getUrl({ port: 3000 })).rejects.toThrow('V8 isolate sandbox');
  });

  it('should handle runtime errors gracefully', async () => {
    provider = secureExec();
    const sandbox = await provider.sandbox.create();
    sandboxId = sandbox.sandboxId;

    const result = await sandbox.runCommand('throw new Error("test error")');
    expect(result.exitCode).not.toBe(0);
  });
});
