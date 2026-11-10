import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { CommandResult } from 'computesdk';
import { ShellFileSystem } from '../shell-filesystem';

const runLocal = (command: string): Promise<CommandResult> =>
  new Promise((resolve) => {
    execFile('sh', ['-c', command], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof (err as any).code === 'number' ? (err as any).code : 0;
      resolve({ stdout, stderr, exitCode: code, durationMs: 0 });
    });
  });

describe('ShellFileSystem', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'csdk-shellfs-'));
  const fs = new ShellFileSystem(runLocal);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('round-trips text with quotes, newlines and unicode, creating parents', async () => {
    const file = path.join(root, "a b/it's/file.txt");
    const content = `line1\n'single' "double" $HOME \`tick\`\nünïcødé ✓\n`;
    await fs.writeFile(file, content);
    expect(await fs.readFile(file)).toBe(content);
  });

  it('writes content larger than one exec chunk', async () => {
    const file = path.join(root, 'big.txt');
    const content = 'x'.repeat(300 * 1024) + 'end';
    await fs.writeFile(file, content);
    expect(await fs.readFile(file)).toBe(content);
    const leftovers = (await fs.readdir(root)).filter((e) => e.name.includes('.computesdk-'));
    expect(leftovers).toEqual([]);
  });

  it('writes empty files', async () => {
    const file = path.join(root, 'empty.txt');
    await fs.writeFile(file, '');
    expect(await fs.exists(file)).toBe(true);
    expect(await fs.readFile(file)).toBe('');
  });

  it('lists entries with type, size and hidden files', async () => {
    const dir = path.join(root, 'list');
    await fs.mkdir(path.join(dir, 'sub'));
    await fs.writeFile(path.join(dir, 'five.txt'), '12345');
    await fs.writeFile(path.join(dir, '.hidden'), 'h');
    await fs.writeFile(path.join(dir, 'tab\tname'), '');
    const entries = (await fs.readdir(dir)).sort((a, b) => a.name.localeCompare(b.name));
    expect(entries.map((e) => [e.name, e.type])).toEqual([
      ['.hidden', 'file'],
      ['five.txt', 'file'],
      ['sub', 'directory'],
      ['tab\tname', 'file'],
    ]);
    expect(entries.find((e) => e.name === 'five.txt')?.size).toBe(5);
    expect(entries.find((e) => e.name === 'five.txt')?.modified).toBeInstanceOf(Date);
    expect(await fs.readdir(path.join(dir, 'sub'))).toEqual([]);
  });

  it('reports missing paths', async () => {
    const missing = path.join(root, 'nope');
    expect(await fs.exists(missing)).toBe(false);
    await expect(fs.readFile(missing)).rejects.toThrow(/ENOENT/);
    await expect(fs.readdir(missing)).rejects.toThrow(/ENOENT/);
  });

  it('removes files and directories recursively', async () => {
    const dir = path.join(root, 'rm');
    await fs.writeFile(path.join(dir, 'deep/file'), 'x');
    await fs.remove(dir);
    expect(await fs.exists(dir)).toBe(false);
  });
});
