
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
  entries?: SyncEntry[];
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
  // The checkpoint engine owns traversal and hashing. This pass only checks
  // planned paths against current filesystem metadata and sync's boundaries.
  for (const entry of input.entries ?? []) {
    const full = checked(entry.path);
    const stat = fs.lstatSync(full);
    const type = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : undefined;
    if (!type || type !== entry.type || (stat.mode & 0o777) !== entry.mode) throw new Error('Project changed during snapshot scan: ' + entry.path);
    if (exclude?.(entry.path, type === 'directory')) continue;
    if (type === 'symlink') {
      const link = fs.readlinkSync(full);
      const target = path.resolve(path.dirname(full), link);
      if (!input.destination && (path.isAbsolute(link) || target !== root && !target.startsWith(root + path.sep))) throw new Error('Symlink points outside sync root: ' + entry.path);
      if (link !== entry.link) throw new Error('Project changed during snapshot scan: ' + entry.path);
    }
    result.push({ ...entry,
      ...(input.destination && type === 'file' && stat.nlink > 1 ? { links: stat.nlink } : {}),
      ...(input.destination && type === 'directory' && fs.existsSync(path.join(full, '.git')) ? { protected: true } : {}),
    });
  }
  return result;
}
export const localTree = async (input: TreeRequest, exclude?: (name: string, directory: boolean) => boolean): Promise<SyncEntry[]> => {
  const { scanLocalTree } = await import('./snapshot-engine.js');
  return scanLocalTree(input, exclude);
};
