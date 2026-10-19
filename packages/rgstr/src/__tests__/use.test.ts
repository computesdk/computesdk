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
    const first = await runUse({ dir, origin: ORIGIN });
    expect(first.map((c) => [c.file, c.action])).toEqual([
      ['.npmrc', 'written'],
      ['pip.conf', 'written'],
    ]);
    expect(await fs.readFile(path.join(dir, '.npmrc'), 'utf8')).toContain('registry=https://rgstr.org/api/registry');

    const second = await runUse({ dir, origin: ORIGIN });
    expect(second.every((c) => c.action === 'unchanged')).toBe(true);

    const off = await runUse({ dir, origin: ORIGIN, off: true });
    expect(off.map((c) => c.action)).toEqual(['removed', 'removed']);
    expect(await fs.readFile(path.join(dir, '.npmrc'), 'utf8')).toBe(original);
    await expect(fs.access(path.join(dir, 'pip.conf'))).rejects.toThrow();

    const again = await runUse({ dir, origin: ORIGIN, off: true });
    expect(again.map((c) => c.action)).toEqual(['absent', 'absent']);
  });
});
