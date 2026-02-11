/**
 * FileSystemAPI adapter for computesdk
 * 
 * Provides a WebContainer-compatible filesystem interface that wraps
 * the computesdk Sandbox filesystem operations.
 */

import type { Sandbox } from 'computesdk';
import type {
  FileSystemAPI,
  FileSystemTree,
  FileNode,
  SymlinkNode,
  DirectoryNode,
  DirEnt,
  MkdirOptions,
  ReaddirOptions,
  RmOptions,
  WatchOptions,
  WatchListener,
  Watcher,
  BufferEncoding,
} from './types';

/**
 * Implementation of DirEnt for readdir with withFileTypes
 */
class DirEntImpl implements DirEnt<string> {
  constructor(
    public readonly name: string,
    private readonly _isDirectory: boolean
  ) {}

  isDirectory(): boolean {
    return this._isDirectory;
  }

  isFile(): boolean {
    return !this._isDirectory;
  }
}

/**
 * Creates a FileSystemAPI implementation that wraps a computesdk Sandbox
 */
export function createFileSystemAPI(sandbox: Sandbox, workdir: string): FileSystemAPI {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // Track active watchers for cleanup
  const watchers = new Map<string, { destroy: () => void }>();

  /**
   * Resolve path relative to workdir
   */
  function resolvePath(path: string): string {
    if (path.startsWith('/')) {
      return path;
    }
    return `${workdir}/${path}`.replace(/\/+/g, '/');
  }

  /**
   * Recursively mount a FileSystemTree
   */
  async function mountTree(tree: FileSystemTree, basePath: string): Promise<void> {
    for (const [name, node] of Object.entries(tree)) {
      const fullPath = `${basePath}/${name}`.replace(/\/+/g, '/');

      if ('file' in node) {
        const fileNode = node as FileNode | SymlinkNode;
        if ('contents' in fileNode.file) {
          // Regular file
          const contents = fileNode.file.contents;
          const content = typeof contents === 'string' 
            ? contents 
            : decoder.decode(contents);
          await sandbox.filesystem.writeFile(fullPath, content);
        } else if ('symlink' in fileNode.file) {
          // Symlink - create via command since filesystem API doesn't have symlink
          const target = (fileNode as SymlinkNode).file.symlink;
          await sandbox.runCommand(`ln -s "${target}" "${fullPath}"`);
        }
      } else if ('directory' in node) {
        // Directory
        const dirNode = node as DirectoryNode;
        await sandbox.filesystem.mkdir(fullPath);
        await mountTree(dirNode.directory, fullPath);
      }
    }
  }

  const fs: FileSystemAPI = {
    async mkdir(path: string, options?: MkdirOptions): Promise<void> {
      const resolvedPath = resolvePath(path);
      if (options?.recursive) {
        await sandbox.runCommand(`mkdir -p "${resolvedPath}"`);
      } else {
        await sandbox.filesystem.mkdir(resolvedPath);
      }
    },

    async readdir(path: string, options?: ReaddirOptions): Promise<string[] | DirEnt<string>[]> {
      const resolvedPath = resolvePath(path);
      const entries = await sandbox.filesystem.readdir(resolvedPath);

      if (options?.withFileTypes) {
        return entries.map(entry => new DirEntImpl(entry.name, entry.type === 'directory'));
      }

      // Just return names
      return entries.map(entry => entry.name);
    },

    async readFile(path: string, encoding?: BufferEncoding | null): Promise<Uint8Array | string> {
      const resolvedPath = resolvePath(path);
      const content = await sandbox.filesystem.readFile(resolvedPath);

      if (encoding === null || encoding === undefined) {
        // Return as Uint8Array
        return encoder.encode(content);
      }

      // Return as string (content is already a string from sandbox)
      return content;
    },

    async rename(oldPath: string, newPath: string): Promise<void> {
      const resolvedOldPath = resolvePath(oldPath);
      const resolvedNewPath = resolvePath(newPath);
      await sandbox.runCommand(`mv "${resolvedOldPath}" "${resolvedNewPath}"`);
    },

    async rm(path: string, options?: RmOptions): Promise<void> {
      const resolvedPath = resolvePath(path);
      let cmd = 'rm';
      
      if (options?.force) {
        cmd += ' -f';
      }
      if (options?.recursive) {
        cmd += ' -r';
      }
      
      await sandbox.runCommand(`${cmd} "${resolvedPath}"`);
    },

    async writeFile(
      path: string, 
      data: string | Uint8Array, 
      options?: string | { encoding?: BufferEncoding | null } | null
    ): Promise<void> {
      const resolvedPath = resolvePath(path);
      const content = typeof data === 'string' ? data : decoder.decode(data);
      await sandbox.filesystem.writeFile(resolvedPath, content);
    },

    watch(
      path: string, 
      optionsOrListener?: WatchOptions | WatchListener, 
      maybeListener?: WatchListener
    ): Watcher {
      const resolvedPath = resolvePath(path);
      let options: WatchOptions = {};
      let listener: WatchListener;

      if (typeof optionsOrListener === 'function') {
        listener = optionsOrListener;
      } else {
        options = optionsOrListener || {};
        listener = maybeListener!;
      }

      // Create watcher using computesdk watcher API
      let watcherInstance: { destroy: () => void } | null = null;
      let closed = false;

      // Start the watcher asynchronously
      (async () => {
        try {
          const ignored = options.recursive ? [] : ['*/**']; // If not recursive, ignore subdirs
          const watcher = await sandbox.watcher.create(resolvedPath, { 
            ignored,
            includeContent: false 
          });

          if (closed) {
            await watcher.destroy();
            return;
          }

          watcherInstance = watcher;
          watchers.set(resolvedPath, watcher);

          // Set up event listener
          watcher.on('change', (event) => {
            // Map computesdk events to WebContainer events
            const wcEvent = event.event === 'create' || event.event === 'delete' 
              ? 'rename' 
              : 'change';
            listener(wcEvent, event.path);
          });
        } catch (error) {
          console.error('Failed to create watcher:', error);
        }
      })();

      return {
        close() {
          closed = true;
          if (watcherInstance) {
            watcherInstance.destroy();
            watchers.delete(resolvedPath);
          }
        }
      };
    }
  };

  // Add internal mount function for use by WebContainer class
  (fs as any)._mount = mountTree;

  return fs;
}
