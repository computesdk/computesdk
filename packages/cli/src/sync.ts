import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import ignore, { type Ignore } from 'ignore';
import * as tar from 'tar';
import { Command } from 'commander';
import { client, fail, output, safeTerm, type CommonOpts } from './actions.js';
import type { ActionsClient } from './actions-client.js';
import { isUuid, resolveInstanceId } from './current-instance.js';
import type { SyncEntry } from './sync-fs.js';
import { SnapshotSession, selectSnapshot, endpointRoot, ignoredPaths, type CaptureResult } from './snapshot-engine.js';
import { randomUUID } from 'node:crypto';

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

export async function planSync(session: SnapshotSession, source: SyncEntry[], destination: SyncEntry[], remove: boolean, excluded: (name: string, directory: boolean) => boolean = () => false): Promise<SyncPlan> {
  const difference = await session.diff(source, destination);
  const changes = new Set([...difference.added, ...difference.changed.map((e) => e.path)]);
  const deleted = new Set(difference.deleted);
  const src = new Map(source.map((e) => [e.path, e]));
  const dst = new Map(destination.map((e) => [e.path, e]));
  const copy: SyncEntry[] = [];
  for (const entry of source) {
    const previous = dst.get(entry.path);
    if (previous && previous.type !== entry.type) throw new Error(`Sync type conflict at ${entry.path}; move or remove the destination entry first.`);
    if (changes.has(entry.path) && (!previous || entry.type !== 'directory')) {
      if (previous?.links && previous.links > 1) throw new Error(`Sync cannot overwrite a hard-linked destination file: ${entry.path}. Move or unlink it first.`);
      copy.push(entry);
    }
  }
  // Never delete ignored entries or a directory containing protected children.
  const ignoredPaths = destination.filter((e) => excluded(e.path, e.type === 'directory')).map((e) => e.path);
  const protectedPaths = destination.filter((e) => e.protected || excluded(e.path, e.type === 'directory')).map((e) => e.path);
  const removed = remove ? destination.filter((e) => !e.protected && deleted.has(e.path) && !src.has(e.path) && !ignoredPaths.some((p) => e.path === p || e.path.startsWith(p + '/')) &&
    !protectedPaths.some((p) => p.startsWith(e.path + '/'))) : [];
  removed.sort((a, b) => b.path.split('/').length - a.path.split('/').length || b.path.localeCompare(a.path));
  return { copy, remove: removed };
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
    if (!['File', 'Directory'].includes(entry.type ?? '')) throw new Error('Unsupported sync archive entry.');
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
  if ('id' in source && 'id' in destination && source.id.toLowerCase() === destination.id.toLowerCase() &&
      (source.remote === destination.remote || source.remote.startsWith(destination.remote + '/') || destination.remote.startsWith(source.remote + '/'))) throw new Error('Source and destination sync directories must not overlap.');
  const session = new SnapshotSession(c);
  try {
    const excluded = 'local' in source ? sourceFilter(source.local) : () => false;
    const src = await session.scan(source, false, 'local' in source ? excluded : undefined);
    const dst = await session.scan(destination, true);
    const plan = await planSync(session, src.entries, dst.entries, !!opts.delete, excluded);
    if (opts.dryRun) return plan;
    if (!plan.copy.length && !plan.remove.length) {
      await session.guard(destination, { missing: true, directories: [] });
      return plan;
    }
    if (plan.copy.length) {
      const sourceRoot = endpointRoot(source);
      const captureRoot = 'id' in source ? await session.remoteRoot(source.id) : session.temp;
      const sourceStore = path.posix.join(captureRoot, 'store');
      const checkpointId = randomUUID();
      const capture = await session.operation<CaptureResult & { missing?: string[] }>('id' in source ? source.id : undefined, 'capture', {
        checkpointId, paths: [sourceRoot, ...src.entries.filter((e) => e.type === 'directory' && !e.path.includes('/')).map((e) => path.posix.join(sourceRoot, e.path))],
        exclude: 'local' in source ? ignoredPaths(source.local, excluded) : ['**/.git', '**/.git/**'],
        store: { kind: 'fs', root: sourceStore },
      });
      if (capture.missing?.length) throw new Error('Source changed during snapshot capture.');
      if (capture.manifestKey !== `manifests/${checkpointId}.json`) throw new Error('Invalid snapshot manifest key.');
      const store = 'local' in source ? sourceStore : path.join(session.temp, 'metadata');
      if ('id' in source) {
        fs.mkdirSync(path.join(store, 'manifests'), { recursive: true });
        fs.mkdirSync(path.join(store, 'blobs'));
        const manifestText = await session.read(source.id, path.posix.join(sourceStore, capture.manifestKey));
        const metadata = JSON.parse(manifestText);
        if (!/^sha256:[a-f0-9]{64}$/.test(metadata.config?.digest)) throw new Error('Invalid snapshot config digest.');
        fs.writeFileSync(path.join(store, capture.manifestKey), manifestText);
        fs.writeFileSync(path.join(store, 'blobs', metadata.config.digest.slice(7)), await session.read(source.id, path.posix.join(sourceStore, 'blobs', metadata.config.digest.slice(7))));
      }
      const manifest = selectSnapshot(store, capture.manifestKey, sourceRoot, plan.copy, dst, endpointRoot(destination));
      // Only the config and layers referenced by this selected OCI view travel.
      let bundle = path.join(session.temp, 'bundle');
      fs.mkdirSync(path.join(bundle, 'blobs'), { recursive: true });
      fs.mkdirSync(path.join(bundle, 'manifests'));
      const selected = JSON.parse(fs.readFileSync(path.join(store, manifest), 'utf8'));
      const refs = [selected.config, ...selected.layers] as { digest: string }[];
      const entries: SyncEntry[] = [
        { path: 'blobs', type: 'directory', mode: 0o700 }, { path: 'manifests', type: 'directory', mode: 0o700 },
        { path: manifest, type: 'file', mode: 0o600 },
      ];
      fs.copyFileSync(path.join(store, manifest), path.join(bundle, manifest));
      for (const ref of refs) {
        if (!/^sha256:[a-f0-9]{64}$/.test(ref.digest)) throw new Error('Invalid snapshot blob digest.');
        const relative = 'blobs/' + ref.digest.slice(7);
        if ('local' in source || ref === selected.config) fs.copyFileSync(path.join(store, relative), path.join(bundle, relative));
        entries.push({ path: relative, type: 'file', mode: 0o600 });
      }
      if ('id' in source) {
        const remoteBundle = path.posix.join(captureRoot, 'selected-store');
        const layers = refs.slice(1).map((ref) => ref.digest.slice(7));
        const layerList = path.posix.join(captureRoot, 'selected-layers.json');
        await session.write(source.id, layerList, JSON.stringify(layers));
        await session.command(source.id, `const fs=require('node:fs'),p=require('node:path'),dest=${JSON.stringify(remoteBundle)},src=${JSON.stringify(sourceStore)};fs.mkdirSync(p.join(dest,'blobs'),{recursive:true});fs.mkdirSync(p.join(dest,'manifests'));for(const hex of JSON.parse(fs.readFileSync(${JSON.stringify(layerList)},'utf8')))fs.copyFileSync(p.join(src,'blobs',hex),p.join(dest,'blobs',hex));`);
        await session.write(source.id, path.posix.join(remoteBundle, manifest), fs.readFileSync(path.join(bundle, manifest), 'utf8'));
        const configFile = 'blobs/' + selected.config.digest.slice(7);
        await session.write(source.id, path.posix.join(remoteBundle, configFile), fs.readFileSync(path.join(bundle, configFile), 'utf8'));
        bundle = await download(c, { id: source.id, remote: remoteBundle }, session.temp);
      }
      let restoreStore = bundle;
      if ('id' in destination) {
        restoreStore = path.posix.join(await session.remoteRoot(destination.id), 'bundle');
        await session.guard({ id: destination.id, remote: restoreStore }, { missing: true, directories: entries.filter((e) => e.type === 'directory') });
        await upload(c, { id: destination.id, remote: restoreStore }, bundle, entries, session.temp);
      }
      const current = await session.scan(destination, true);
      if (JSON.stringify(current.entries) !== JSON.stringify(dst.entries)) throw new Error('Destination changed during sync; rerun to try again.');
      await session.guard(destination, { missing: true, directories: plan.copy.filter((e) => e.type === 'directory') });
      const restored = await session.operation<{ failures: unknown[] }>('id' in destination ? destination.id : undefined, 'restore', {
        checkpointId: 'selected', manifestUrl: undefined,
        // The engine reads the selected manifest from its fs object store.
        store: { kind: 'fs', root: restoreStore }, destDir: endpointRoot(destination), strictArch: false,
      });
      if (restored.failures.length) throw new Error('Snapshot restore was incomplete.');
    }
    if (plan.remove.length) {
      // Delete only after successful capture, transfer and integrity-checked restore.
      await session.guard(destination, { remove: plan.remove });
    }
    return plan;
  } finally { await session.close(); }
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
