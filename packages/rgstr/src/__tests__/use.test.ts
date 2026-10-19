import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyBlock, clientConfigs, detectClients, runUse, stripBlock, unifiedDiff } from '../use.js';

const ORIGIN = 'https://rgstr.org';

describe('rgstr use blocks', () => {
  it('matches the Setup page snippets', () => {
    const [npm, yarn, bun, pip, uv] = clientConfigs(ORIGIN, ['npm', 'yarn', 'bun', 'pip', 'uv']);
    expect(npm).toEqual({ id: 'npm', file: '.npmrc', lines: ['registry=https://rgstr.org/api/registry'] });
    expect(yarn.lines).toEqual(['npmRegistryServer: "https://rgstr.org/api/registry"']);
    expect(bun.lines).toEqual(['[install]', 'registry = "https://rgstr.org/api/registry"']);
    expect(pip.lines).toEqual(['[global]', 'index-url = https://rgstr.org/api/pypi']);
    expect(uv.lines).toEqual(['[[tool.uv.index]]', 'url = "https://rgstr.org/api/pypi"', 'default = true']);
  });

  it.each([
    ['', 'empty file'],
    ['save-exact=true\n', 'trailing newline'],
    ['save-exact=true', 'no trailing newline'],
    ['save-exact=true\n\n', 'blank line at end'],
    ['# comment\nregistry=https://example.com\n', 'another registry line'],
  ])('round-trips byte-for-byte: %s (%s)', (original) => {
    const { next, changed } = applyBlock(original, ['registry=x']);
    expect(changed).toBe(true);
    expect(next).toContain('registry=x');
    expect(applyBlock(next, ['registry=x']).changed).toBe(false);
    const back = stripBlock(next);
    expect(back.found).toBe(true);
    expect(back.content).toBe(original);
  });

  it('refreshes an outdated block in place', () => {
    const v1 = applyBlock('a=1\n', ['registry=old']).next;
    const v2 = applyBlock(v1, ['registry=new']);
    expect(v2.changed).toBe(true);
    expect(v2.next).not.toContain('registry=old');
    expect(stripBlock(v2.next).content).toBe('a=1\n');
  });

  it('leaves files without a block alone on --off', () => {
    expect(stripBlock('registry=https://example.com\n')).toEqual({ content: 'registry=https://example.com\n', found: false });
  });

  it('prints a unified diff of just the block', () => {
    const before = 'a=1\n';
    const after = applyBlock(before, ['registry=x']).next;
    const diff = unifiedDiff('.npmrc', before, after);
    expect(diff.split('\n')[0]).toBe('--- .npmrc');
    expect(diff).toContain('+registry=x');
    expect(diff).not.toContain('-a=1');
  });
});

describe('rgstr use on a project', () => {
  async function tmp(files: Record<string, string>) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rgstr-use-'));
    for (const [f, c] of Object.entries(files)) await fs.writeFile(path.join(dir, f), c);
    return dir;
  }

  it('detects clients from lockfiles', async () => {
    expect(await detectClients(await tmp({ 'package.json': '{}', 'bun.lock': '' }), {})).toEqual(['npm', 'bun']);
    expect(await detectClients(await tmp({ 'pyproject.toml': '', 'uv.lock': '' }), {})).toEqual(['uv']);
    expect(await detectClients(await tmp({ 'package.json': '{}', 'pyproject.toml': '', 'poetry.lock': '' }), {})).toEqual(['npm', 'poetry']);
    expect(await detectClients(await tmp({ 'package.json': '{}' }), { pip: true })).toEqual(['pip']);
    expect(await detectClients(await tmp({}), {})).toEqual([]);
  });

  it('writes, is idempotent, and --off restores the original bytes (and removes files it created)', async () => {
    const original = 'save-exact=true';
    const dir = await tmp({ 'package.json': '{"name":"x"}', '.npmrc': original, 'pyproject.toml': '[project]\nname = "x"\n' });
    await fs.mkdir(path.join(dir, '.venv'));
    const first = await runUse({ dir, origin: ORIGIN });
    expect(first.map((c) => [c.file, c.action])).toEqual([
      ['.npmrc', 'written'],
      ['.venv/pip.conf', 'written'],
    ]);
    expect(await fs.readFile(path.join(dir, '.npmrc'), 'utf8')).toContain('registry=https://rgstr.org/api/registry');

    const second = await runUse({ dir, origin: ORIGIN });
    expect(second.every((c) => c.action === 'unchanged')).toBe(true);

    const off = await runUse({ dir, origin: ORIGIN, off: true });
    expect(off.map((c) => c.action)).toEqual(['removed', 'removed']);
    expect(await fs.readFile(path.join(dir, '.npmrc'), 'utf8')).toBe(original);
    await expect(fs.access(path.join(dir, '.venv/pip.conf'))).rejects.toThrow();

    const again = await runUse({ dir, origin: ORIGIN, off: true });
    expect(again.map((c) => c.action)).toEqual(['absent', 'absent']);
  });
});

describe('rgstr use edge cases', () => {
  async function tmp(files: Record<string, string>) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rgstr-use-'));
    for (const [f, c] of Object.entries(files)) await fs.writeFile(path.join(dir, f), c);
    return dir;
  }

  it('pip without a virtualenv is a manual step (pip reads no project file)', async () => {
    const dir = await tmp({ 'requirements.txt': 'requests\n' });
    const [ch] = await runUse({ dir, origin: ORIGIN });
    expect(ch).toMatchObject({ action: 'manual', command: 'pip config set global.index-url https://rgstr.org/api/pypi' });
    expect(await runUse({ dir, origin: ORIGIN, off: true })).toEqual([]);
  });

  it('extends an existing [install] table in bunfig.toml instead of duplicating it', async () => {
    const original = '[install]\nexact = true\n\n[test]\ncoverage = true\n';
    const dir = await tmp({ 'package.json': '{}', 'bun.lock': '', 'bunfig.toml': original });
    await runUse({ dir, origin: ORIGIN, npm: true });
    const written = await fs.readFile(path.join(dir, 'bunfig.toml'), 'utf8');
    expect(written.match(/\[install\]/g)).toHaveLength(1);
    expect(written).toBe(
      `[install]\n# >>> rgstr (managed by \`rgstr use\`; remove with \`rgstr use --off\`)\nregistry = "https://rgstr.org/api/registry"\n# <<< rgstr\nexact = true\n\n[test]\ncoverage = true\n`,
    );
    expect((await runUse({ dir, origin: ORIGIN, npm: true })).every((c) => c.action === 'unchanged')).toBe(true);
    await runUse({ dir, origin: ORIGIN, off: true });
    expect(await fs.readFile(path.join(dir, 'bunfig.toml'), 'utf8')).toBe(original);
  });

  it('--off still cleans a file whose manifest is gone', async () => {
    const dir = await tmp({ 'package.json': '{}', '.npmrc': 'a=1\n' });
    await runUse({ dir, origin: ORIGIN });
    await fs.rm(path.join(dir, 'package.json'));
    const off = await runUse({ dir, origin: ORIGIN, off: true });
    expect(off.map((c) => [c.file, c.action])).toEqual([['.npmrc', 'removed']]);
    expect(await fs.readFile(path.join(dir, '.npmrc'), 'utf8')).toBe('a=1\n');
  });
});
