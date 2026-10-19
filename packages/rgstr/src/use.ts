// `rgstr use`: the Setup page as a command. Writes the one-time "point your
// client at rgstr" lines into the project's own config files, inside a marked
// block so `--off` can remove exactly what was written and nothing else.

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const BLOCK_START = '# >>> rgstr (managed by `rgstr use`; remove with `rgstr use --off`)';
export const BLOCK_END = '# <<< rgstr';
const NEEDS_NEWLINE = `${BLOCK_START} +nl`;

export type ClientId = 'npm' | 'yarn' | 'bun' | 'pip' | 'uv' | 'poetry';

export interface ClientConfig {
  id: ClientId;
  file: string;
  /** The exact lines the Setup page shows for this client. */
  lines: string[];
}

export const npmRegistryUrl = (origin: string) => `${origin}/api/registry`;
export const pypiIndexUrl = (origin: string) => `${origin}/api/pypi`;

/** Same snippets as app/components/registry/registry-config.tsx. */
export function clientConfigs(origin: string, ids: ClientId[]): ClientConfig[] {
  const js = npmRegistryUrl(origin);
  const py = pypiIndexUrl(origin);
  const all: Record<ClientId, ClientConfig> = {
    npm: { id: 'npm', file: '.npmrc', lines: [`registry=${js}`] },
    yarn: { id: 'yarn', file: '.yarnrc.yml', lines: [`npmRegistryServer: "${js}"`] },
    bun: { id: 'bun', file: 'bunfig.toml', lines: ['[install]', `registry = "${js}"`] },
    pip: { id: 'pip', file: 'pip.conf', lines: ['[global]', `index-url = ${py}`] },
    uv: { id: 'uv', file: 'pyproject.toml', lines: ['[[tool.uv.index]]', `url = "${py}"`, 'default = true'] },
    poetry: { id: 'poetry', file: 'pyproject.toml', lines: ['[[tool.poetry.source]]', 'name = "rgstr"', `url = "${py}"`, 'priority = "primary"'] },
  };
  return ids.map((id) => all[id]);
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** Which clients this project uses, from its lockfiles and manifests. */
export async function detectClients(dir: string, want: { npm?: boolean; pip?: boolean }): Promise<ClientId[]> {
  const has = async (f: string) => exists(path.join(dir, f));
  const out: ClientId[] = [];
  const explicit = want.npm || want.pip;
  const js = want.npm || (!explicit && (await has('package.json')));
  const py = want.pip || (!explicit && ((await has('pyproject.toml')) || (await has('requirements.txt')) || (await has('setup.py'))));
  if (js) {
    out.push('npm');
    if ((await has('yarn.lock')) || (await has('.yarnrc.yml'))) out.push('yarn');
    if ((await has('bun.lock')) || (await has('bun.lockb')) || (await has('bunfig.toml'))) out.push('bun');
  }
  if (py) {
    if (await has('uv.lock')) out.push('uv');
    else if (await has('poetry.lock')) out.push('poetry');
    else out.push('pip');
  }
  return out;
}

export function renderBlock(lines: string[], needsLeadingNewline: boolean): string {
  return `${needsLeadingNewline ? NEEDS_NEWLINE : BLOCK_START}\n${lines.join('\n')}\n${BLOCK_END}\n`;
}

/** Add or refresh the managed block; unchanged content returns `changed: false`. */
export function applyBlock(current: string | null, lines: string[]): { next: string; changed: boolean } {
  const stripped = stripBlock(current ?? '');
  const base = stripped.content;
  const needsNl = base.length > 0 && !base.endsWith('\n');
  const next = base + (needsNl ? '\n' : '') + renderBlock(lines, needsNl);
  return { next, changed: next !== (current ?? '') };
}

/** Remove the managed block, restoring the original bytes around it. */
export function stripBlock(current: string): { content: string; found: boolean } {
  const start = current.indexOf(BLOCK_START);
  if (start === -1) return { content: current, found: false };
  const endMarker = current.indexOf(BLOCK_END, start);
  if (endMarker === -1) return { content: current, found: false };
  let end = endMarker + BLOCK_END.length;
  if (current[end] === '\n') end += 1;
  const header = current.slice(start, current.indexOf('\n', start));
  const addedNl = header === NEEDS_NEWLINE;
  const before = addedNl && current[start - 1] === '\n' ? current.slice(0, start - 1) : current.slice(0, start);
  return { content: before + current.slice(end), found: true };
}

export function unifiedDiff(file: string, before: string | null, after: string | null): string {
  const a = before == null ? [] : before.split('\n');
  const b = after == null ? [] : after.split('\n');
  if (a.length && a[a.length - 1] === '') a.pop();
  if (b.length && b[b.length - 1] === '') b.pop();
  // Common prefix/suffix is enough here: the change is always one contiguous block.
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const out = [`--- ${before == null ? '/dev/null' : file}`, `+++ ${after == null ? '/dev/null' : file}`];
  const ctx = (line: string) => ` ${line}`;
  out.push(...a.slice(Math.max(0, p - 2), p).map(ctx));
  out.push(...a.slice(p, a.length - s).map((l) => `-${l}`));
  out.push(...b.slice(p, b.length - s).map((l) => `+${l}`));
  out.push(...a.slice(a.length - s, Math.min(a.length, a.length - s + 2)).map(ctx));
  return out.join('\n');
}

export interface UseChange {
  file: string;
  clients: ClientId[];
  action: 'written' | 'unchanged' | 'removed' | 'absent';
  diff?: string;
}

export interface UseOptions {
  dir: string;
  origin: string;
  off?: boolean;
  npm?: boolean;
  pip?: boolean;
  dryRun?: boolean;
}

export async function runUse(opts: UseOptions): Promise<UseChange[]> {
  const ids = await detectClients(opts.dir, { npm: opts.npm, pip: opts.pip });
  const configs = clientConfigs(opts.origin, ids);
  // Several clients can share a file (uv + poetry never co-occur; bun/yarn don't share with npm).
  const byFile = new Map<string, ClientConfig[]>();
  for (const c of configs) byFile.set(c.file, [...(byFile.get(c.file) ?? []), c]);

  const changes: UseChange[] = [];
  for (const [file, cs] of byFile) {
    const full = path.join(opts.dir, file);
    const current = (await exists(full)) ? await fs.readFile(full, 'utf8') : null;
    const clients = cs.map((c) => c.id);
    if (opts.off) {
      if (current == null) {
        changes.push({ file, clients, action: 'absent' });
        continue;
      }
      const { content, found } = stripBlock(current);
      if (!found) {
        changes.push({ file, clients, action: 'absent' });
        continue;
      }
      const after = content.length === 0 ? null : content;
      if (!opts.dryRun) {
        if (after == null) await fs.rm(full);
        else await fs.writeFile(full, after);
      }
      changes.push({ file, clients, action: 'removed', diff: unifiedDiff(file, current, after) });
      continue;
    }
    const lines = cs.flatMap((c, i) => (i === 0 ? c.lines : ['', ...c.lines]));
    const { next, changed } = applyBlock(current, lines);
    if (!changed) {
      changes.push({ file, clients, action: 'unchanged' });
      continue;
    }
    if (!opts.dryRun) await fs.writeFile(full, next);
    changes.push({ file, clients, action: 'written', diff: unifiedDiff(file, current, next) });
  }
  return changes;
}
