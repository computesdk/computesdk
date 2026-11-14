import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import ignore, { type Ignore } from 'ignore';
import * as tar from 'tar';
import { Command } from 'commander';
import { client, fail, output, safeTerm, type CommonOpts } from './actions.js';
import type { ActionsClient } from './actions-client.js';
import { isUuid, resolveInstanceId } from './current-instance.js';
import { execCommand } from './exec.js';
import { localTree, treeOperation, type SyncEntry, type TreeRequest } from './sync-fs.js';

export type SyncEndpoint = { local: string } | { id: string; remote: string };
export interface SyncOptions extends CommonOpts { delete?: boolean; dryRun?: boolean; watch?: boolean }
export interface SyncPlan { copy: SyncEntry[]; remove: SyncEntry[] }

export function syncEndpoint(value: string, opts: CommonOpts): SyncEndpoint {
  const match = /^([^:]*):(\/.*)$/.exec(value);
  if (!match || /^[a-zA-Z]:[\\/]/.test(value)) return { local: path.resolve(value) };
  const id = match[1] || resolveInstanceId(undefined, opts)?.id;
  if (!id || !isUuid(id)) throw new Error('Use a sandbox UUID or select one with compute new / compute use <id>.');
  const remote = path.posix.normalize(match[2]);
  if (remote === '/' || remote.split('/').includes('.git')) throw new Error('Sync requires a project directory outside .git.');
  return { id, remote };
}

/** Nested .gitignore rules, relative to each rule file. Ignored trees are never read. */
export function sourceFilter(root: string): (name: string, directory: boolean) => boolean {
  const git = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  const filterRoot = git.status === 0 ? git.stdout.trim() : root;
  const prefix = path.relative(filterRoot, root).split(path.sep).join('/');
  const cache = new Map<string, { base: string; rules: Ignore }[]>();
  const rulesFor = (dir: string): { base: string; rules: Ignore }[] => {
    if (cache.has(dir)) return cache.get(dir)!;
    const inherited = dir ? rulesFor(path.posix.dirname(dir) === '.' ? '' : path.posix.dirname(dir)) : [];
    let rules = inherited;
    try {
      rules = [...inherited, { base: dir, rules: ignore().add(fs.readFileSync(path.join(filterRoot, dir, '.gitignore'), 'utf8')) }];
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    cache.set(dir, rules);
    return rules;
  };
  return (name, directory) => {
    if (name.split('/').includes('.git')) return true;
    name = prefix ? prefix + '/' + name : name;
    const parent = path.posix.dirname(name);
    let ignored = false;
    for (const { base, rules } of rulesFor(parent === '.' ? '' : parent)) {
      const relative = (base ? name.slice(base.length + 1) : name) + (directory ? '/' : '');
      const result = rules.test(relative);
      if (result.ignored) ignored = true;
      if (result.unignored) ignored = false;
    }
    return ignored;
  };
}

export function planSync(source: SyncEntry[], destination: SyncEntry[], remove: boolean, excluded: (name: string, directory: boolean) => boolean = () => false): SyncPlan {
  const src = new Map(source.map((e) => [e.path, e]));
  const dst = new Map(destination.map((e) => [e.path, e]));
  const copy: SyncEntry[] = [];
  for (const entry of source) {
    const previous = dst.get(entry.path);
    if (previous && previous.type !== entry.type) throw new Error(`Sync type conflict at ${entry.path}; move or remove the destination entry first.`);
    if (!previous || entry.type !== 'directory' && (previous.hash !== entry.hash || previous.link !== entry.link || previous.mode !== entry.mode)) {
      if (previous?.links && previous.links > 1) throw new Error(`Sync cannot overwrite a hard-linked destination file: ${entry.path}. Move or unlink it first.`);
      copy.push(entry);
    }
  }
  // Never delete ignored entries or a directory containing protected children.
  const ignoredPaths = destination.filter((e) => excluded(e.path, e.type === 'directory')).map((e) => e.path);
  const protectedPaths = destination.filter((e) => e.protected || excluded(e.path, e.type === 'directory')).map((e) => e.path);
  const removed = remove ? destination.filter((e) => !e.protected && !src.has(e.path) && !ignoredPaths.some((p) => e.path === p || e.path.startsWith(p + '/')) &&
    !protectedPaths.some((p) => p.startsWith(e.path + '/'))) : [];
  removed.sort((a, b) => b.path.split('/').length - a.path.split('/').length || b.path.localeCompare(a.path));
  return { copy, remove: removed };
}

async function remoteTree(c: ActionsClient, endpoint: { id: string; remote: string }, request: Omit<TreeRequest, 'root'> = {}): Promise<SyncEntry[]> {
  const payload = JSON.stringify({ root: endpoint.remote, ...request });
  const script = `(${treeOperation.toString()})(${payload},require).then(entries=>console.log(JSON.stringify({entries}))).catch(e=>{console.error(e.message);process.exitCode=1})`;
  const result = await c.post<{ exitCode: number; stdout: string; stderr: string }>(`/api/v1/sandboxes/${endpoint.id}/commands`, {
    command: execCommand(['node', '--input-type=commonjs', '-e', script]), timeoutMs: 290_000,
  });
  if (result.exitCode !== 0) throw new Error(`Sync filesystem check failed: ${result.stderr || 'Node.js is required in the sandbox.'}`);
  let entries: SyncEntry[];
  try { entries = JSON.parse(result.stdout).entries; } catch { throw new Error('Incomplete sync manifest from sandbox. Reduce the project size and try again.'); }
  if (!Array.isArray(entries)) throw new Error('Invalid sync manifest from sandbox.');
  for (const entry of entries) {
    if (!entry.path || entry.path.startsWith('/') || entry.path.includes('\0') || entry.path.includes('\\') || entry.path.split('/').some((p) => p === '..' || p === '.' || p === '.git' || p === '') ||
        !['file', 'directory', 'symlink'].includes(entry.type) || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777) throw new Error('Unsafe sync manifest from sandbox.');
  }
  return entries;
}

function transferUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Insecure sync transfer URL.');
  return raw;
}
async function download(c: ActionsClient, source: { id: string; remote: string }, target: string): Promise<string> {
  const created = await c.post<{ downloadUrl: string }>(`/api/v1/sandboxes/${source.id}/transfers`, { direction: 'download', path: source.remote });
  const response = await fetch(transferUrl(created.downloadUrl), { redirect: 'error' });
  if (!response.ok || !response.body) throw new Error(`Sync download failed (${response.status}).`);
  const file = path.join(target, 'source.tar.gz');
  await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), fs.createWriteStream(file, { mode: 0o600 }));
  const wrapper = path.posix.basename(source.remote);
  const validate = (name: string, entry: { type?: string; linkpath?: string }) => {
    const parts = name.replace(/\/$/, '').split('/');
    if (parts[0] !== wrapper || parts.some((p) => p === '..' || p === '' || p === '.') || name.includes('\\')) throw new Error('Unsafe sync archive entry.');
    if (parts.includes('.git')) return false;
    if (!['File', 'Directory', 'SymbolicLink', 'Link'].includes(entry.type ?? '')) throw new Error('Unsupported sync archive entry.');
    if (entry.type === 'Link') {
      const link = entry.linkpath ?? '';
      if (!link.startsWith(wrapper + '/') || link.includes('\\') || link.split('/').some((p) => p === '..' || p === '.' || p === '.git' || p === '')) throw new Error('Unsafe hardlink in sync archive.');
    }
    if (entry.type === 'SymbolicLink') {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), entry.linkpath ?? ''));
      if (!entry.linkpath || path.posix.isAbsolute(entry.linkpath) || !target.startsWith(wrapper + '/') && target !== wrapper) throw new Error('Unsafe symlink in sync archive.');
    }
    return true;
  };
  // Validate the complete archive before writing any of its entries.
  let invalid: unknown;
  await tar.list({ file, onReadEntry: (entry) => {
    try { validate(entry.path, entry); } catch (error) { invalid = error; }
    entry.resume();
  } });
  if (invalid) throw invalid;
  const unpacked = path.join(target, 'unpacked');
  fs.mkdirSync(unpacked);
  await tar.extract({ file, cwd: unpacked, filter: (name, entry) => validate(name, entry as tar.ReadEntry), strict: true });
  return path.join(unpacked, wrapper);
}
async function upload(c: ActionsClient, destination: { id: string; remote: string }, root: string, entries: SyncEntry[], temp: string): Promise<void> {
  if (!entries.length) return;
  const archive = path.join(temp, 'changes.tar.gz');
  await tar.create({ file: archive, gzip: true, cwd: root, noDirRecurse: true, portable: true }, entries.map((e) => e.path));
  const created = await c.post<{ transferId: string; uploadUrl: string }>(`/api/v1/sandboxes/${destination.id}/transfers`, { direction: 'upload', path: destination.remote });
  const response = await fetch(transferUrl(created.uploadUrl), {
    method: 'PUT', redirect: 'error', headers: { 'content-type': 'application/gzip', 'content-length': String(fs.statSync(archive).size) },
    // @ts-expect-error Node fetch accepts a web stream with duplex.
    body: Readable.toWeb(fs.createReadStream(archive)), duplex: 'half',
  });
  if (!response.ok) throw new Error(`Sync upload failed (${response.status}).`);
  await c.post(`/api/v1/sandboxes/${destination.id}/transfers/${created.transferId}/complete`, {});
}

export async function syncOnce(c: ActionsClient, source: SyncEndpoint, destination: SyncEndpoint, opts: SyncOptions): Promise<SyncPlan> {
  if ('local' in source && 'local' in destination) throw new Error('Sync requires at least one sandbox endpoint ([id]:/path).');
  if ('id' in source && 'id' in destination && source.id === destination.id &&
      (source.remote === destination.remote || source.remote.startsWith(destination.remote + '/') || destination.remote.startsWith(source.remote + '/'))) throw new Error('Source and destination sync directories must not overlap.');
  const excluded = 'local' in source ? sourceFilter(source.local) : () => false;
  const src = 'local' in source ? await localTree({ root: source.local }, excluded) : await remoteTree(c, source);
  const dst = 'local' in destination ? await localTree({ root: destination.local, missing: true, destination: true }) : await remoteTree(c, destination, { missing: true, destination: true });
  const plan = planSync(src, dst, !!opts.delete, excluded);
  if (opts.dryRun) return plan;
  if (!plan.copy.length && !plan.remove.length) {
    if ('local' in destination) await localTree({ root: destination.local, missing: true, directories: [] });
    else await remoteTree(c, destination, { missing: true, directories: [] });
    return plan;
  }
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'compute-sync-')));
  try {
    // Stage before touching the destination. Remote-to-remote relays through this CLI.
    const sourceRoot = 'local' in source ? source.local : await download(c, source, temp);
    const snapshot = path.join(temp, 'snapshot');
    fs.mkdirSync(snapshot);
    for (const entry of plan.copy) {
      const from = path.join(sourceRoot, entry.path);
      const to = path.join(snapshot, entry.path);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      if (entry.type === 'directory') fs.mkdirSync(to, { recursive: true });
      else if (entry.type === 'symlink') fs.symlinkSync(fs.readlinkSync(from), to);
      else { fs.copyFileSync(from, to); fs.chmodSync(to, entry.mode); }
    }
    const staged = await localTree({ root: snapshot });
    const stagedByPath = new Map(staged.map((e) => [e.path, e]));
    for (const entry of plan.copy) {
      const actual = stagedByPath.get(entry.path);
      if (!actual || actual.type !== entry.type || actual.hash !== entry.hash || actual.link !== entry.link) throw new Error('Source changed during sync; rerun to try again.');
    }
    const current = 'local' in destination ? await localTree({ root: destination.local, missing: true, destination: true }) : await remoteTree(c, destination, { missing: true, destination: true });
    if (JSON.stringify(current) !== JSON.stringify(dst)) throw new Error('Destination changed during sync; rerun to try again.');
    const directories = plan.copy.filter((e) => e.type === 'directory');
    if ('local' in destination) {
      await localTree({ root: destination.local, missing: true, directories });
      for (const entry of plan.copy.filter((e) => e.type !== 'directory')) {
        const target = path.join(destination.local, entry.path);
        const pending = path.join(path.dirname(target), `.compute-sync-${process.pid}-${Math.random().toString(16).slice(2)}`);
        try {
          if (entry.type === 'symlink') fs.symlinkSync(entry.link!, pending);
          else { fs.copyFileSync(path.join(snapshot, entry.path), pending, fs.constants.COPYFILE_EXCL); fs.chmodSync(pending, entry.mode); }
          fs.renameSync(pending, target);
        } finally { fs.rmSync(pending, { force: true }); }
      }
      if (plan.remove.length) await localTree({ root: destination.local, remove: plan.remove });
    } else {
      await remoteTree(c, destination, { missing: true, directories });
      await upload(c, destination, snapshot, plan.copy, temp);
      // Delete only after a successful upload/complete.
      if (plan.remove.length) await remoteTree(c, destination, { remove: plan.remove });
    }
    return plan;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

export function printSync(plan: SyncPlan, opts: SyncOptions): void {
  const result = { dryRun: !!opts.dryRun, copied: plan.copy.map((e) => e.path), deleted: plan.remove.map((e) => e.path) };
  if (opts.json) { console.log(JSON.stringify(result)); return; }
  output(opts, result, () => {
    if (opts.dryRun) {
      for (const entry of plan.copy) console.log(`copy ${safeTerm(entry.path)}`);
      for (const entry of plan.remove) console.log(`delete ${safeTerm(entry.path)}`);
    }
    console.log(`${opts.dryRun ? 'Would sync' : 'Synced'} ${plan.copy.length} entries; ${plan.remove.length} deleted${opts.dryRun ? ' (dry run)' : ''}.`);
  });
}
export function registerSyncCommand(program: Command): void {
  program.command('sync <source> <destination>')
    .description('One-way directory sync: local paths or [sandbox-id]:/path (empty ID selects the current sandbox)')
    .option('--delete', 'delete destination-only entries, preserving .git and ignored local source paths')
    .option('--dry-run', 'show changes without modifying the destination')
    .option('--watch', 'repeat one-way sync every 2 seconds until interrupted')
    .option('--api-key <key>').option('--base-url <url>').option('--org <slug>').option('--allow-untrusted-host')
    .option('--json', 'print a JSON result per sync pass (JSON Lines with --watch)')
    .action(async (src: string, dst: string, opts: SyncOptions) => {
      const stop = new AbortController();
      const interrupt = () => stop.abort();
      try {
        if (opts.watch && opts.dryRun) throw new Error('--watch and --dry-run cannot be combined.');
        const source = syncEndpoint(src, opts);
        const destination = syncEndpoint(dst, opts);
        const c = await client(opts);
        if (opts.watch && !opts.json) console.error('Watching for changes (one-way sync, every 2 seconds). Press Ctrl-C to stop.');
        if (opts.watch) { process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt); }
        do {
          const plan = await syncOnce(c, source, destination, opts);
          if (!opts.watch || plan.copy.length || plan.remove.length) printSync(plan, opts);
          if (!opts.watch || stop.signal.aborted) break;
          try { await delay(2000, undefined, { signal: stop.signal }); } catch { break; }
        } while (!stop.signal.aborted);
      } catch (error) { fail(error, opts); }
      finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
    });
}
