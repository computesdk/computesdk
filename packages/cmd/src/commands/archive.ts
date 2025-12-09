import type { Command } from '../types.js';

/**
 * Tar archive operations
 */
export const tar = {
  /**
   * Extract tar archive
   * @example tar.extract('archive.tar.gz')
   * @example tar.extract('archive.tar.gz', { dir: '/app' })
   */
  extract: (file: string, options?: { dir?: string }): Command => {
    const args = ['tar', '-xzf', file];
    if (options?.dir) args.push('-C', options.dir);
    return args as Command;
  },

  /**
   * Create tar archive
   * @example tar.create('archive.tar.gz', '/app/dist')
   */
  create: (output: string, source: string): Command => {
    return ['tar', '-czf', output, source];
  },
};

/**
 * Unzip archive
 * @example unzip('archive.zip')
 * @example unzip('archive.zip', { dir: '/app' })
 */
export const unzip = (file: string, options?: { dir?: string }): Command => {
  return options?.dir ? ['unzip', '-o', file, '-d', options.dir] : ['unzip', '-o', file];
};
