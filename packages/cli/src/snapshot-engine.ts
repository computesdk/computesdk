/** Adapter around the exact OCI checkpoint engine shipped by the platform. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import type { ActionsClient } from './actions-client.js';
import { execCommand } from './exec.js';
import { treeOperation, type SyncEntry, type TreeRequest } from './sync-fs.js';
import { createRequire } from 'node:module';

const executeFile = promisify(execFile);
export const ENGINE_FILE = fileURLToPath(new URL('../checkpoint.cjs', import.meta.url));
const RUNNER_FILE = fileURLToPath(new URL('../checkpoint-runner.cjs', import.meta.url));
export interface IndexEntry { type: 'dir' | 'file' | 'symlink'; mode: number; sha?: string; link?: string; layer: number; size?: number; mtime?: number }
export interface CheckpointConfig {
  kind: string; files: Record<string, IndexEntry>; capture: { paths: string[]; exclude: string[] };
  [key: string]: unknown;
}
export interface CaptureResult { manifestKey: string; configDigest: string; layers: { root: string; digest: string }[] }
export interface EngineDiff { added: string[]; changed: { path: string }[]; deleted: string[] }
export type EngineEndpoint = { local: string } | { id: string; remote: string };
export const endpointRoot = (e: EngineEndpoint): string => 'local' in e ? e.local : e.remote;
const requireModule = createRequire(import.meta.url);

/** Snapshot selectors are globs; fail rather than accidentally widen an exact path. */
export function exactSelector(value: string): string {
  if (/[*?]/.test(value)) throw new Error('Snapshot sync cannot address literal * or ? in a path: ' + value);
  return value.split(path.sep).join('/');
}
export function ignoredPaths(root: string, exclude?: (name: string, directory: boolean) => boolean): string[] {
  const paths = ['**/.git', '**/.git/**'];
  if (!exclude || !fs.existsSync(root)) return paths;
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const name = dir ? dir + '/' + entry.name : entry.name;
      if (entry.name === '.git' || exclude(name, entry.isDirectory())) paths.push(exactSelector(path.join(root, name)));
      else if (entry.isDirectory()) visit(name);
    }
  };
  visit('');
  return paths;
}

export function indexEntries(config: CheckpointConfig, root: string): SyncEntry[] {
  const result: SyncEntry[] = [];
  for (const [absolute, entry] of Object.entries(config.files)) {
    if (absolute === root) continue;
    const relative = path.posix.relative(root, absolute);
    if (!relative || relative.startsWith('/') || relative.includes('\\') || relative.split('/').some((p) => !p || p === '..' || p === '.' || p === '.git') || relative.includes('\0')) throw new Error('Unsafe checkpoint file index.');
    if (!['dir', 'file', 'symlink'].includes(entry.type)) throw new Error('Unsupported checkpoint entry.');
    result.push({ path: relative, type: entry.type === 'dir' ? 'directory' : entry.type, mode: entry.mode & 0o777,
      ...(entry.sha ? { hash: entry.sha } : {}), ...(entry.link !== undefined ? { link: entry.link } : {}) });
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

export class SnapshotSession {
  readonly temp = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'compute-sync-')));
  private remoteRoots = new Map<string, string>();
  constructor(private c?: ActionsClient) {}
  async command(id: string, script: string): Promise<string> {
    const result = await this.c!.post<{ exitCode: number; stdout: string; stderr: string }>(`/api/v1/sandboxes/${id}/commands`, {
      command: execCommand(['node', '--input-type=commonjs', '-e', script]), timeoutMs: 290_000,
    });
    if (result.exitCode !== 0) throw new Error(`Snapshot sync failed: ${result.stderr || result.stdout || 'Node.js is required in the sandbox.'}`);
    return result.stdout;
  }
  async remoteRoot(id: string): Promise<string> {
    const existing = this.remoteRoots.get(id);
    if (existing) return existing;
    const root = JSON.parse(await this.command(id, `const fs=require('node:fs');console.log(JSON.stringify(fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'compute-sync-'))))`));
    if (typeof root !== 'string' || !root.startsWith('/') || !path.posix.basename(root).startsWith('compute-sync-')) throw new Error('Invalid snapshot work directory.');
    this.remoteRoots.set(id, root);
    await this.write(id, path.posix.join(root, 'checkpoint.cjs'), fs.readFileSync(ENGINE_FILE, 'utf8'));
    await this.write(id, path.posix.join(root, 'runner.cjs'), fs.readFileSync(RUNNER_FILE, 'utf8'));
    return root;
  }
  async write(id: string, file: string, content: string): Promise<void> {
    await this.c!.post(`/api/v1/sandboxes/${id}/files`, { path: file, content });
  }
  async read(id: string, file: string): Promise<string> {
    const response = await this.c!.get<{ type: string; content?: string }>(`/api/v1/sandboxes/${id}/files`, { path: file });
    if (response.type !== 'file' || response.content === undefined) throw new Error('Snapshot result file is unavailable.');
    return response.content;
  }
  async operation<T>(id: string | undefined, operation: string, args: Record<string, unknown>): Promise<T> {
    const root = id ? await this.remoteRoot(id) : this.temp;
    const payload = path.join(root, randomUUID() + '.args.json');
    const resultPath = path.join(root, randomUUID() + '.result.json');
    const json = JSON.stringify({ ...args, resultPath });
    if (id) {
      await this.write(id, payload, json);
      const res = await this.c!.post<{ exitCode: number; stderr: string; stdout: string }>(`/api/v1/sandboxes/${id}/commands`, {
        command: execCommand(['node', path.posix.join(root, 'runner.cjs'), path.posix.join(root, 'checkpoint.cjs'), operation, payload]), timeoutMs: 290_000,
      });
      if (res.exitCode !== 0) {
        let detail = res.stderr || res.stdout;
        try { detail = await this.read(id, resultPath); } catch { /* no result if startup failed */ }
        throw new Error(`Snapshot ${operation} failed: ${detail}`);
      }
      return JSON.parse(await this.read(id, resultPath));
    }
    fs.writeFileSync(payload, json, { mode: 0o600 });
    try { await executeFile(process.execPath, [RUNNER_FILE, ENGINE_FILE, operation, payload], { timeout: 300_000, maxBuffer: 1024 * 1024 }); }
    catch (error) {
      const detail = fs.existsSync(resultPath) ? fs.readFileSync(resultPath, 'utf8') : (error as Error).message;
      throw new Error(`Snapshot ${operation} failed: ${detail}`);
    }
    return JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  }
  async guard(endpoint: EngineEndpoint, request: Omit<TreeRequest, 'root'>): Promise<SyncEntry[]> {
    const input = { root: endpointRoot(endpoint), ...request };
    if ('local' in endpoint) return treeOperation(input, requireModule);
    const root = await this.remoteRoot(endpoint.id);
    const payload = path.posix.join(root, randomUUID() + '.guard.json');
    const resultPath = payload + '.result';
    await this.write(endpoint.id, payload, JSON.stringify(input));
    await this.command(endpoint.id, `const fs=require('node:fs');(${treeOperation.toString()})(JSON.parse(fs.readFileSync(${JSON.stringify(payload)},'utf8')),require).then(entries=>fs.writeFileSync(${JSON.stringify(resultPath)},JSON.stringify(entries))).catch(e=>{console.error(e.message);process.exitCode=1})`);
    return JSON.parse(await this.read(endpoint.id, resultPath));
  }
  async scan(endpoint: EngineEndpoint, destination = false, exclude?: (name: string, directory: boolean) => boolean): Promise<{ config: CheckpointConfig; entries: SyncEntry[] }> {
    const root = endpointRoot(endpoint);
    await this.guard(endpoint, { missing: destination });
    const result = await this.operation<{ config: CheckpointConfig; missing: string[] }>('id' in endpoint ? endpoint.id : undefined, 'scan', {
      paths: [root], exclude: 'local' in endpoint ? ignoredPaths(root, exclude) : ['**/.git', '**/.git/**'],
    });
    if (result.missing.length && !(destination && result.missing.length === 1 && result.missing[0] === root)) throw new Error('Snapshot scan could not read all project paths: ' + result.missing.join(', '));
    const entries = await this.guard(endpoint, { missing: destination, destination, entries: indexEntries(result.config, root) });
    return { config: result.config, entries };
  }
  async diff(source: SyncEntry[], destination: SyncEntry[]): Promise<EngineDiff> {
    const toConfig = (entries: SyncEntry[]) => ({ files: Object.fromEntries(entries.map((e) => [e.path, { type: e.type === 'directory' ? 'dir' : e.type, mode: e.mode, sha: e.hash, link: e.link }])) });
    const a = path.join(this.temp, randomUUID() + '.json'), b = path.join(this.temp, randomUUID() + '.json');
    fs.writeFileSync(a, JSON.stringify(toConfig(destination)), { mode: 0o600 });
    fs.writeFileSync(b, JSON.stringify(toConfig(source)), { mode: 0o600 });
    return (await this.operation<{ diff: EngineDiff }>(undefined, 'diff', { a: { configPath: a }, b: { configPath: b } })).diff;
  }
  async close(): Promise<void> {
    try {
      for (const [id, root] of this.remoteRoots) {
        try { await this.command(id, `require('node:fs').rmSync(${JSON.stringify(root)},{recursive:true,force:true})`); } catch { /* private scratch only; do not mask a transfer failure */ }
      }
    } finally { fs.rmSync(this.temp, { recursive: true, force: true }); }
  }
}

/** Build a valid, content-addressed OCI view containing only the planned writes. */
export function selectSnapshot(store: string, manifestKey: string, root: string, copy: SyncEntry[], destination: { config: CheckpointConfig; entries: SyncEntry[] }, destinationRoot: string): string {
  if (!/^manifests\/[a-f0-9-]+\.json$/.test(manifestKey)) throw new Error('Invalid snapshot manifest key.');
  const manifest = JSON.parse(fs.readFileSync(path.join(store, manifestKey), 'utf8'));
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.config?.digest)) throw new Error('Invalid snapshot config digest.');
  const configHex = manifest.config.digest.slice(7);
  const bytes = fs.readFileSync(path.join(store, 'blobs', configHex));
  if (createHash('sha256').update(bytes).digest('hex') !== configHex) throw new Error('Snapshot config digest mismatch.');
  const raw = JSON.parse(bytes.toString('utf8'));
  const config: CheckpointConfig = raw.computesdk?.kind === 'sandbox-checkpoint' ? raw.computesdk : raw;
  const files: Record<string, IndexEntry> = {};
  const wantedLayers = new Set<number>();
  const dest = new Map(destination.entries.map((e) => [e.path, e]));
  for (const entry of copy) {
    const absolute = path.posix.join(root, entry.path);
    const captured = config.files[absolute];
    if (!captured || captured.type !== (entry.type === 'directory' ? 'dir' : entry.type) || captured.sha !== entry.hash || captured.link !== entry.link || (captured.mode & 0o777) !== entry.mode) throw new Error('Source changed during snapshot capture; rerun sync.');
    files[absolute] = { ...captured, mode: entry.mode };
    if (entry.type !== 'directory') wantedLayers.add(captured.layer);
    let parent = path.posix.dirname(absolute);
    while (parent === root || parent.startsWith(root + '/')) {
      const index = config.files[parent];
      if (!index || index.type !== 'dir') throw new Error('Snapshot is missing a parent directory.');
      const relative = path.posix.relative(root, parent);
      const mode = relative ? dest.get(relative)?.mode : destination.config.files[destinationRoot]?.mode;
      files[parent] ??= { ...index, mode: (mode ?? index.mode) & 0o777 };
      if (parent === root) break;
      parent = path.posix.dirname(parent);
    }
  }
  config.files = files;
  const allLayers = manifest.layers as { annotations: Record<string, string> }[];
  const indexes = allLayers.map((layer, index) => wantedLayers.has(config.capture.paths.indexOf(layer.annotations['com.computesdk.checkpoint.root'])) ? index : -1).filter((index) => index >= 0);
  manifest.layers = indexes.map((index) => allLayers[index]);
  if (raw.rootfs) raw.rootfs.diff_ids = indexes.map((index) => raw.rootfs.diff_ids[index]);
  const selected = Buffer.from(JSON.stringify(raw));
  const hex = createHash('sha256').update(selected).digest('hex');
  fs.writeFileSync(path.join(store, 'blobs', hex), selected, { mode: 0o600 });
  manifest.config = { ...manifest.config, digest: 'sha256:' + hex, size: selected.length };
  const key = 'manifests/selected.json';
  fs.writeFileSync(path.join(store, key), JSON.stringify(manifest), { mode: 0o600 });
  return key;
}

export async function scanLocalTree(input: TreeRequest, exclude?: (name: string, directory: boolean) => boolean): Promise<SyncEntry[]> {
  const session = new SnapshotSession();
  try {
    if (input.remove || input.directories) return session.guard({ local: input.root }, input);
    return (await session.scan({ local: input.root }, !!input.missing, exclude)).entries;
  } finally { await session.close(); }
}
