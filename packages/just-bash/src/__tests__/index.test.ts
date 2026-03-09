import { describe, it, expect, afterEach } from 'vitest';
import * as indexExports from '../index';
import { justBash } from '../index';

describe('just-bash provider', () => {
  let provider: ReturnType<typeof justBash>;
  let sandboxId: string | null = null;

  afterEach(async () => {
    if (sandboxId && provider) {
      await provider.sandbox.destroy(sandboxId);
      sandboxId = null;
    }
  });

  it('should be resolvable via camelCase conversion of the hyphenated provider name', () => {
    // Workbench resolves hyphenated provider names by converting to camelCase:
    // 'just-bash' -> 'justBash'. This test guards against regressions in that contract.
    const exportName = 'just-bash'.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    expect(typeof (indexExports as Record<string, unknown>)[exportName]).toBe('function');
  });

  it('should create a provider with the correct name', () => {
    provider = justBash({});
    expect(provider.name).toBe('just-bash');
  });

  it('should create and destroy a sandbox', async () => {
    provider = justBash({});
    const sandbox = await provider.sandbox.create();
    sandboxId = sandbox.sandboxId;

    expect(sandbox.sandboxId).toBeTruthy();
    expect(sandbox.provider).toBe('just-bash');

    await sandbox.destroy();
    sandboxId = null;
  });

  it('should run shell commands', async () => {
    provider = justBash({});
    const sandbox = await provider.sandbox.create();
    sandboxId = sandbox.sandboxId;

    const result = await sandbox.runCommand('echo "hello world"');
    expect(result.stdout.trim()).toBe('hello world');
    expect(result.exitCode).toBe(0);
  });

  it('should support filesystem operations', async () => {
    provider = justBash({});
    const sandbox = await provider.sandbox.create();
    sandboxId = sandbox.sandboxId;

    // Write a file
    await sandbox.filesystem.writeFile('/tmp/test.txt', 'hello from just-bash');

    // Read it back
    const content = await sandbox.filesystem.readFile('/tmp/test.txt');
    expect(content).toBe('hello from just-bash');

    // Check existence
    const exists = await sandbox.filesystem.exists('/tmp/test.txt');
    expect(exists).toBe(true);

    // Remove it
    await sandbox.filesystem.remove('/tmp/test.txt');
    const existsAfter = await sandbox.filesystem.exists('/tmp/test.txt');
    expect(existsAfter).toBe(false);
  });

  it('should run code as bash scripts', async () => {
    provider = justBash({});
    const sandbox = await provider.sandbox.create();
    sandboxId = sandbox.sandboxId;

    const result = await sandbox.runCode('echo "computed: $((2 + 3))"');
    expect(result.output.trim()).toBe('computed: 5');
    expect(result.exitCode).toBe(0);
  });

  it('should support environment variables', async () => {
    provider = justBash({ env: { MY_VAR: 'test_value' } });
    const sandbox = await provider.sandbox.create();
    sandboxId = sandbox.sandboxId;

    const result = await sandbox.runCommand('echo $MY_VAR');
    expect(result.stdout.trim()).toBe('test_value');
  });

  it('should support initial files', async () => {
    provider = justBash({ files: { '/data/config.json': '{"key": "value"}' } });
    const sandbox = await provider.sandbox.create();
    sandboxId = sandbox.sandboxId;

    const result = await sandbox.runCommand('cat /data/config.json');
    expect(result.stdout.trim()).toBe('{"key": "value"}');
  });

  it('should support pipes and complex commands', async () => {
    provider = justBash({});
    const sandbox = await provider.sandbox.create();
    sandboxId = sandbox.sandboxId;

    const result = await sandbox.runCommand('echo -e "banana\\napple\\ncherry" | sort');
    expect(result.stdout.trim()).toBe('apple\nbanana\ncherry');
  });

  it('should get sandbox info', async () => {
    provider = justBash({});
    const sandbox = await provider.sandbox.create();
    sandboxId = sandbox.sandboxId;

    const info = await sandbox.getInfo();
    expect(info.provider).toBe('just-bash');
    expect(info.status).toBe('running');
    expect(info.id).toBe(sandboxId);
  });

  it('should list sandboxes', async () => {
    provider = justBash({});
    const sandbox = await provider.sandbox.create();
    sandboxId = sandbox.sandboxId;

    const list = await provider.sandbox.list();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.some(s => s.sandboxId === sandboxId)).toBe(true);
  });

  it('should get sandbox by ID', async () => {
    provider = justBash({});
    const sandbox = await provider.sandbox.create();
    sandboxId = sandbox.sandboxId;

    const retrieved = await provider.sandbox.getById(sandboxId);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.sandboxId).toBe(sandboxId);
  });

  it('should throw on getUrl (not supported)', async () => {
    provider = justBash({});
    const sandbox = await provider.sandbox.create();
    sandboxId = sandbox.sandboxId;

    await expect(sandbox.getUrl({ port: 3000 })).rejects.toThrow('local sandbox');
  });

  it('should support mkdir and readdir', async () => {
    provider = justBash({});
    const sandbox = await provider.sandbox.create();
    sandboxId = sandbox.sandboxId;

    await sandbox.filesystem.mkdir('/tmp/testdir');
    await sandbox.filesystem.writeFile('/tmp/testdir/file1.txt', 'content1');
    await sandbox.filesystem.writeFile('/tmp/testdir/file2.txt', 'content2');

    const entries = await sandbox.filesystem.readdir('/tmp/testdir');
    const names = entries.map(e => e.name).sort();
    expect(names).toContain('file1.txt');
    expect(names).toContain('file2.txt');
  });

  it('should support cwd option in runCommand', async () => {
    provider = justBash({});
    const sandbox = await provider.sandbox.create();
    sandboxId = sandbox.sandboxId;

    await sandbox.runCommand('mkdir -p /workspace');
    await sandbox.filesystem.writeFile('/workspace/hello.txt', 'hi');

    const result = await sandbox.runCommand('cat hello.txt', { cwd: '/workspace' });
    expect(result.stdout.trim()).toBe('hi');
  });
});
