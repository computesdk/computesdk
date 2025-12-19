import type { Command } from '../types.js';

/**
 * Git version control commands
 */
export const git = {
  /**
   * Clone repository
   * @example git.clone('https://github.com/user/repo.git')
   * @example git.clone('https://github.com/user/repo.git', { depth: 1 })
   */
  clone: (url: string, options?: { depth?: number; branch?: string; dir?: string }): Command => {
    const args = ['git', 'clone'];
    if (options?.depth) args.push('--depth', String(options.depth));
    if (options?.branch) args.push('-b', options.branch);
    args.push(url);
    if (options?.dir) args.push(options.dir);
    return args as Command;
  },

  /**
   * Pull latest changes
   * @example git.pull()
   */
  pull: (): Command => ['git', 'pull'],

  /**
   * Checkout branch
   * @example git.checkout('main')
   * @example git.checkout('feature', { create: true })
   */
  checkout: (branch: string, options?: { create?: boolean }): Command => {
    return options?.create
      ? ['git', 'checkout', '-b', branch]
      : ['git', 'checkout', branch];
  },

  /**
   * Git status
   * @example git.status()
   */
  status: (): Command => ['git', 'status'],

  /**
   * Stage files
   * @example git.add('.')
   * @example git.add('src/index.ts')
   */
  add: (path: string, options?: { all?: boolean }): Command => {
    return options?.all ? ['git', 'add', '-A', path] : ['git', 'add', path];
  },

  /**
   * Commit staged changes
   * @example git.commit('feat: add new feature')
   * @example git.commit('fix: bug fix', { all: true })
   */
  commit: (message: string, options?: { all?: boolean }): Command => {
    return options?.all
      ? ['git', 'commit', '-a', '-m', message]
      : ['git', 'commit', '-m', message];
  },

  /**
   * Push to remote
   * @example git.push()
   * @example git.push({ remote: 'origin', branch: 'main' })
   * @example git.push({ setUpstream: true, branch: 'feature' })
   */
  push: (options?: { remote?: string; branch?: string; setUpstream?: boolean; force?: boolean }): Command => {
    const args = ['git', 'push'];
    if (options?.setUpstream) args.push('-u');
    if (options?.force) args.push('--force');
    if (options?.remote) args.push(options.remote);
    if (options?.branch) args.push(options.branch);
    return args as Command;
  },

  /**
   * List or create branches
   * @example git.branch()
   * @example git.branch({ all: true })
   * @example git.branch('new-feature', { create: true })
   */
  branch: (name?: string, options?: { all?: boolean; delete?: boolean; create?: boolean }): Command => {
    const args = ['git', 'branch'];
    if (options?.all) args.push('-a');
    if (options?.delete) args.push('-d');
    if (name) args.push(name);
    return args as Command;
  },

  /**
   * Show changes
   * @example git.diff()
   * @example git.diff({ staged: true })
   * @example git.diff({ file: 'src/index.ts' })
   */
  diff: (options?: { staged?: boolean; file?: string }): Command => {
    const args = ['git', 'diff'];
    if (options?.staged) args.push('--staged');
    if (options?.file) args.push(options.file);
    return args as Command;
  },

  /**
   * Show commit history
   * @example git.log()
   * @example git.log({ oneline: true, count: 10 })
   */
  log: (options?: { oneline?: boolean; count?: number }): Command => {
    const args = ['git', 'log'];
    if (options?.oneline) args.push('--oneline');
    if (options?.count) args.push('-n', String(options.count));
    return args as Command;
  },

  /**
   * Stash changes
   * @example git.stash()
   * @example git.stash({ pop: true })
   * @example git.stash({ list: true })
   */
  stash: (options?: { pop?: boolean; list?: boolean; drop?: boolean; message?: string }): Command => {
    const args = ['git', 'stash'];
    if (options?.pop) args.push('pop');
    else if (options?.list) args.push('list');
    else if (options?.drop) args.push('drop');
    else if (options?.message) args.push('push', '-m', options.message);
    return args as Command;
  },

  /**
   * Fetch from remote
   * @example git.fetch()
   * @example git.fetch({ all: true })
   */
  fetch: (options?: { remote?: string; all?: boolean; prune?: boolean }): Command => {
    const args = ['git', 'fetch'];
    if (options?.all) args.push('--all');
    if (options?.prune) args.push('--prune');
    if (options?.remote) args.push(options.remote);
    return args as Command;
  },

  /**
   * Reset changes
   * @example git.reset()
   * @example git.reset({ hard: true })
   * @example git.reset({ ref: 'HEAD~1' })
   */
  reset: (options?: { hard?: boolean; soft?: boolean; ref?: string }): Command => {
    const args = ['git', 'reset'];
    if (options?.hard) args.push('--hard');
    if (options?.soft) args.push('--soft');
    if (options?.ref) args.push(options.ref);
    return args as Command;
  },

  /**
   * Initialize repository
   * @example git.init()
   */
  init: (): Command => ['git', 'init'],
};
