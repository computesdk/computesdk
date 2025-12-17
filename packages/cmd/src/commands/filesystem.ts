import type { Command } from '../types.js';

/**
 * Create directory
 *
 * By default, recursive is true (includes -p flag to create parent directories).
 * This differs from standard shell mkdir which requires explicit -p flag.
 *
 * @example mkdir('/app/src') // ['mkdir', '-p', '/app/src']
 * @example mkdir('/app/src', { recursive: false }) // ['mkdir', '/app/src']
 */
export const mkdir = (path: string, options?: { recursive?: boolean }): Command => {
  const recursive = options?.recursive ?? true;
  return recursive ? ['mkdir', '-p', path] : ['mkdir', path];
};

/**
 * Remove file or directory
 * @example rm('/app/tmp') // ['rm', '/app/tmp']
 * @example rm('/app/tmp', { recursive: true }) // ['rm', '-rf', '/app/tmp']
 */
export const rm = (path: string, options?: { recursive?: boolean; force?: boolean }): Command => {
  const flags: string[] = [];
  if (options?.recursive) flags.push('r');
  if (options?.force) flags.push('f');
  return flags.length > 0 ? ['rm', `-${flags.join('')}`, path] : ['rm', path];
};

/**
 * Copy file or directory
 * @example cp('/src/file.txt', '/dest/file.txt')
 */
export const cp = (src: string, dest: string, options?: { recursive?: boolean }): Command => {
  return options?.recursive ? ['cp', '-r', src, dest] : ['cp', src, dest];
};

/**
 * Move/rename file or directory
 * @example mv('/old/path', '/new/path')
 */
export const mv = (src: string, dest: string): Command => ['mv', src, dest];

/**
 * List directory contents
 * @example ls('/app') // ['ls', '/app']
 * @example ls('/app', { all: true, long: true }) // ['ls', '-la', '/app']
 */
export const ls = (path?: string, options?: { all?: boolean; long?: boolean }): Command => {
  const flags: string[] = [];
  if (options?.long) flags.push('l');
  if (options?.all) flags.push('a');
  const flagStr = flags.length > 0 ? `-${flags.join('')}` : '';
  if (flagStr && path) return ['ls', flagStr, path];
  if (flagStr) return ['ls', flagStr];
  if (path) return ['ls', path];
  return ['ls'];
};

/**
 * Print working directory
 * @example pwd() // ['pwd']
 */
export const pwd = (): Command => ['pwd'];

/**
 * Change file permissions
 * @example chmod('755', '/app/script.sh')
 */
export const chmod = (mode: string, path: string, options?: { recursive?: boolean }): Command => {
  return options?.recursive ? ['chmod', '-R', mode, path] : ['chmod', mode, path];
};

/**
 * Change file owner/group
 * @example chown('user', '/app/file.txt')
 * @example chown('user:group', '/app', { recursive: true })
 */
export const chown = (owner: string, path: string, options?: { recursive?: boolean }): Command => {
  return options?.recursive ? ['chown', '-R', owner, path] : ['chown', owner, path];
};

/**
 * Create empty file or update timestamp
 * @example touch('/app/newfile.txt')
 */
export const touch = (path: string): Command => ['touch', path];

/**
 * Read file contents
 * @example cat('/app/file.txt')
 */
export const cat = (path: string): Command => ['cat', path];

/**
 * Create symbolic link
 * @example ln('/app/config', '/etc/app/config')
 * @example ln('/app/config', '/etc/app/config', { symbolic: true, force: true })
 */
export const ln = (target: string, link: string, options?: { symbolic?: boolean; force?: boolean }): Command => {
  const args = ['ln'];
  if (options?.symbolic !== false) args.push('-s'); // symbolic by default
  if (options?.force) args.push('-f');
  args.push(target, link);
  return args as Command;
};

/**
 * Resolve symbolic link
 * @example readlink('/usr/bin/python')
 * @example readlink('/usr/bin/python', { canonical: true })
 */
export const readlink = (path: string, options?: { canonical?: boolean }): Command => {
  return options?.canonical ? ['readlink', '-f', path] : ['readlink', path];
};

/**
 * Filesystem checks (exit 0 if true, 1 if false)
 * @example test.exists('/app/file.txt')
 * @example test.isDir('/app')
 */
export const test = {
  exists: (path: string): Command => ['test', '-e', path],
  isFile: (path: string): Command => ['test', '-f', path],
  isDir: (path: string): Command => ['test', '-d', path],
  isReadable: (path: string): Command => ['test', '-r', path],
  isWritable: (path: string): Command => ['test', '-w', path],
  isExecutable: (path: string): Command => ['test', '-x', path],
  notEmpty: (path: string): Command => ['test', '-s', path],
  isSymlink: (path: string): Command => ['test', '-L', path],
};

/**
 * Sync files/directories with rsync
 * @example rsync('/src/', '/dest/')
 * @example rsync('/src/', 'user@host:/dest/', { archive: true, compress: true })
 */
export const rsync = (src: string, dest: string, options?: {
  archive?: boolean;
  verbose?: boolean;
  compress?: boolean;
  delete?: boolean;
  dryRun?: boolean;
  exclude?: string[];
}): Command => {
  const args = ['rsync'];
  if (options?.archive) args.push('-a');
  if (options?.verbose) args.push('-v');
  if (options?.compress) args.push('-z');
  if (options?.delete) args.push('--delete');
  if (options?.dryRun) args.push('--dry-run');
  if (options?.exclude) {
    for (const pattern of options.exclude) {
      args.push('--exclude', pattern);
    }
  }
  args.push(src, dest);
  return args as Command;
};
