import { createRequire } from 'node:module';

export interface SyncEntry {
  path: string;
  type: 'file' | 'directory' | 'symlink';
  mode: number;
  protected?: boolean;
  links?: number;
  hash?: string;
  link?: string;
}
export interface TreeRequest {
  root: string;
  missing?: boolean;
  destination?: boolean;
  remove?: SyncEntry[];
  directories?: SyncEntry[];
}

/** Self-contained: the same function runs locally and in a sandbox's Node runtime. */
export async function treeOperation(input: TreeRequest, requireModule: NodeRequire, exclude?: (name: string, directory: boolean) => boolean): Promise<SyncEntry[]> {
  const fs = requireModule('node:fs') as typeof import('node:fs');
  const path = requireModule('node:path') as typeof import('node:path');
  const crypto = requireModule('node:crypto') as typeof import('node:crypto');
  const root = path.resolve(input.root);
  if (root.split(path.sep).includes('.git')) throw new Error('Sync cannot target .git.');
  if (root === path.parse(root).root) throw new Error('Sync requires a project directory, not a filesystem root.');
  // Never follow a destination symlink while applying changes.
  const checked = (relative: string): string => {
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).some((s) => s === '..' || s === '.git') || relative.includes('\0')) {
      throw new Error('Unsafe sync path: ' + relative);
    }
    const full = path.join(root, relative);
    let cursor = path.parse(full).root;
    const parts = full.slice(cursor.length).split(path.sep);
    for (const segment of parts.slice(0, -1)) {
      cursor = path.join(cursor, segment);
      try {
        if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Sync cannot traverse symlink: ' + cursor);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return full;
  };
  checked('');
  try {
    const stat = fs.lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Sync requires a real directory: ' + root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !input.missing) throw error;
    if (!input.directories && !input.remove) return [];
    fs.mkdirSync(root, { recursive: true });
  }
  for (const expected of input.remove ?? []) {
    const relative = expected.path;
    const full = checked(relative);
    if (!relative) throw new Error('Cannot delete the sync root.');
    // Files first, directories last. rmdir refuses unexpected/new children.
    const stat = fs.lstatSync(full);
    const type = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file';
    let hash: string | undefined;
    if (type === 'file') {
      const digest = crypto.createHash('sha256');
      for await (const chunk of fs.createReadStream(full)) digest.update(chunk);
      hash = digest.digest('hex');
    }
    if (type !== expected.type || type === 'file' && (hash !== expected.hash || (stat.mode & 0o777) !== expected.mode) ||
        type === 'symlink' && fs.readlinkSync(full) !== expected.link) throw new Error('Destination changed before deletion: ' + relative);
    if (stat.isDirectory()) fs.rmdirSync(full);
    else fs.unlinkSync(full);
  }
  for (const entry of input.directories ?? []) {
    const full = checked(entry.path);
    try {
      if (!fs.lstatSync(full).isDirectory()) throw new Error('Sync type conflict: ' + entry.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      fs.mkdirSync(full, { mode: entry.mode | 0o700 });
    }
  }
  if (input.remove || input.directories) return [];
  const result: SyncEntry[] = [];
  const walk = async (relative: string): Promise<void> => {
    const entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git') {
        if (input.destination && relative) {
          const parent = result.find((e) => e.path === relative);
          if (parent) parent.protected = true;
        }
        continue;
      }
      if (entry.name.includes('\\')) throw new Error('Unsupported sync filename: ' + entry.name);
      const name = relative ? relative + '/' + entry.name : entry.name;
      const full = path.join(root, name);
      const stat = fs.lstatSync(full);
      if (exclude?.(name, stat.isDirectory())) continue;
      const mode = stat.mode & 0o777;
      if (stat.isSymbolicLink()) {
        const link = fs.readlinkSync(full);
        const target = path.resolve(path.dirname(full), link);
        if (!input.destination && (path.isAbsolute(link) || target !== root && !target.startsWith(root + path.sep))) {
          throw new Error('Symlink points outside sync root: ' + name);
        }
        result.push({ path: name, type: 'symlink', mode, link });
      } else if (stat.isDirectory()) {
        result.push({ path: name, type: 'directory', mode });
        await walk(name);
      } else if (stat.isFile()) {
        const hash = crypto.createHash('sha256');
        for await (const chunk of fs.createReadStream(full)) hash.update(chunk);
        result.push({ path: name, type: 'file', mode, hash: hash.digest('hex'), ...(input.destination && stat.nlink > 1 ? { links: stat.nlink } : {}) });
      } else throw new Error('Unsupported file type: ' + name);
    }
  };
  await walk('');
  return result;
}
export const localTree = (input: TreeRequest, exclude?: (name: string, directory: boolean) => boolean): Promise<SyncEntry[]> => treeOperation(input, createRequire(import.meta.url), exclude);
