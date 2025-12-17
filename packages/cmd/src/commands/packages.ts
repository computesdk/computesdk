import type { Command } from '../types.js';

/**
 * npm package manager commands
 */
export const npm = {
  /**
   * Install packages
   * @example npm.install() // ['npm', 'install']
   * @example npm.install('express') // ['npm', 'install', 'express']
   * @example npm.install('express', { dev: true }) // ['npm', 'install', '-D', 'express']
   */
  install: (pkg?: string, options?: { dev?: boolean; global?: boolean }): Command => {
    const args = ['npm', 'install'];
    if (options?.dev) args.push('-D');
    if (options?.global) args.push('-g');
    if (pkg) args.push(pkg);
    return args as Command;
  },

  /**
   * Run npm script
   * @example npm.run('build')
   * @example npm.run('test', ['--coverage'])
   */
  run: (script: string, args?: string[]): Command => {
    return args ? ['npm', 'run', script, '--', ...args] : ['npm', 'run', script];
  },

  /**
   * Initialize new package
   * @example npm.init() // ['npm', 'init', '-y']
   */
  init: (): Command => ['npm', 'init', '-y'],

  /**
   * Uninstall package
   * @example npm.uninstall('lodash')
   */
  uninstall: (pkg: string): Command => ['npm', 'uninstall', pkg],
};

/**
 * pnpm package manager commands
 */
export const pnpm = {
  /**
   * Install packages with pnpm
   * @example pnpm.install()
   * @example pnpm.install('express')
   */
  install: (pkg?: string, options?: { dev?: boolean }): Command => {
    const args = ['pnpm', 'install'];
    if (options?.dev) args.push('-D');
    if (pkg) args.push(pkg);
    return args as Command;
  },

  /**
   * Run pnpm script
   * @example pnpm.run('build')
   */
  run: (script: string, args?: string[]): Command => {
    return args ? ['pnpm', 'run', script, '--', ...args] : ['pnpm', 'run', script];
  },
};

/**
 * yarn package manager commands
 */
export const yarn = {
  /**
   * Install packages with yarn
   * @example yarn.install()
   */
  install: (): Command => ['yarn', 'install'],

  /**
   * Add package
   * @example yarn.add('express')
   * @example yarn.add('typescript', { dev: true })
   */
  add: (pkg: string, options?: { dev?: boolean }): Command => {
    return options?.dev ? ['yarn', 'add', '-D', pkg] : ['yarn', 'add', pkg];
  },

  /**
   * Run yarn script
   * @example yarn.run('build')
   */
  run: (script: string): Command => ['yarn', 'run', script],
};

/**
 * pip Python package manager commands
 */
export const pip = {
  /**
   * Install Python package
   * @example pip.install('requests')
   * @example pip.install('-r requirements.txt')
   */
  install: (pkg: string): Command => ['pip', 'install', pkg],

  /**
   * Uninstall Python package
   * @example pip.uninstall('requests')
   */
  uninstall: (pkg: string): Command => ['pip', 'uninstall', '-y', pkg],
};

/**
 * bun runtime commands
 */
export const bun = {
  /**
   * Install packages with bun
   * @example bun.install()
   * @example bun.install('express')
   */
  install: (pkg?: string, options?: { dev?: boolean }): Command => {
    const args = ['bun', 'install'];
    if (options?.dev) args.push('-D');
    if (pkg) args.push(pkg);
    return args as Command;
  },

  /**
   * Run bun script
   * @example bun.run('build')
   */
  run: (script: string, args?: string[]): Command => {
    return args ? ['bun', 'run', script, ...args] : ['bun', 'run', script];
  },

  /**
   * Run file with bun
   * @example bun.exec('server.ts')
   */
  exec: (file: string, args?: string[]): Command => {
    return args ? ['bun', file, ...args] : ['bun', file];
  },
};

/**
 * deno runtime commands
 */
export const deno = {
  /**
   * Run deno script
   * @example deno.run('server.ts')
   * @example deno.run('server.ts', { allow: ['net', 'read'] })
   */
  run: (file: string, options?: { allow?: string[] }): Command => {
    const args = ['deno', 'run'];
    if (options?.allow) {
      for (const perm of options.allow) {
        args.push(`--allow-${perm}`);
      }
    }
    args.push(file);
    return args as Command;
  },

  /**
   * Install deno package
   * @example deno.install('https://deno.land/std/http/file_server.ts')
   */
  install: (url: string, options?: { name?: string }): Command => {
    const args = ['deno', 'install'];
    if (options?.name) args.push('-n', options.name);
    args.push(url);
    return args as Command;
  },
};

/**
 * Run packages with npx - callable function with additional methods
 * @example npx('create-react-app', ['my-app']) // run package directly
 * @example npx.concurrently(['npm:dev', 'npm:watch']) // run concurrently
 */
export const npx = Object.assign(
  (pkg: string, args?: string[]): Command => {
    return args ? ['npx', pkg, ...args] : ['npx', pkg];
  },
  {
    /**
     * Run commands in parallel with concurrently (requires npx)
     * @example npx.concurrently(['npm:dev', 'npm:watch'])
     * @example npx.concurrently(['npm run dev', 'npm run watch'], { names: ['dev', 'watch'], killOthers: true })
     */
    concurrently: (commands: string[], options?: { names?: string[]; killOthers?: boolean }): Command => {
      const args = ['npx', 'concurrently'];
      if (options?.killOthers) args.push('--kill-others');
      if (options?.names) args.push('--names', options.names.join(','));
      args.push(...commands);
      return args as Command;
    },
  }
);

/**
 * Run packages with bunx - callable function with additional methods
 * @example bunx('create-next-app', ['my-app']) // run package directly
 * @example bunx.concurrently(['npm:dev', 'npm:watch']) // run concurrently
 */
export const bunx = Object.assign(
  (pkg: string, args?: string[]): Command => {
    return args ? ['bunx', pkg, ...args] : ['bunx', pkg];
  },
  {
    /**
     * Run commands in parallel with concurrently (requires bunx)
     * @example bunx.concurrently(['npm:dev', 'npm:watch'])
     */
    concurrently: (commands: string[], options?: { names?: string[]; killOthers?: boolean }): Command => {
      const args = ['bunx', 'concurrently'];
      if (options?.killOthers) args.push('--kill-others');
      if (options?.names) args.push('--names', options.names.join(','));
      args.push(...commands);
      return args as Command;
    },
  }
);

/**
 * uv - Fast Python package manager
 */
export const uv = {
  /**
   * Install Python packages with uv
   * @example uv.install('requests')
   * @example uv.install('-r requirements.txt')
   */
  install: (pkg: string): Command => ['uv', 'pip', 'install', pkg],

  /**
   * Run Python script with uv
   * @example uv.run('script.py')
   */
  run: (script: string, args?: string[]): Command => {
    return args ? ['uv', 'run', script, ...args] : ['uv', 'run', script];
  },

  /**
   * Sync dependencies from pyproject.toml
   * @example uv.sync()
   */
  sync: (): Command => ['uv', 'sync'],

  /**
   * Create virtual environment
   * @example uv.venv()
   * @example uv.venv('.venv')
   */
  venv: (path?: string): Command => {
    return path ? ['uv', 'venv', path] : ['uv', 'venv'];
  },
};

/**
 * poetry - Python dependency management
 */
export const poetry = {
  /**
   * Install dependencies
   * @example poetry.install()
   */
  install: (options?: { noRoot?: boolean }): Command => {
    const args = ['poetry', 'install'];
    if (options?.noRoot) args.push('--no-root');
    return args as Command;
  },

  /**
   * Add a dependency
   * @example poetry.add('requests')
   * @example poetry.add('pytest', { dev: true })
   */
  add: (pkg: string, options?: { dev?: boolean }): Command => {
    return options?.dev
      ? ['poetry', 'add', '--group', 'dev', pkg]
      : ['poetry', 'add', pkg];
  },

  /**
   * Run command in poetry environment
   * @example poetry.run('python', ['script.py'])
   */
  run: (command: string, args?: string[]): Command => {
    return args ? ['poetry', 'run', command, ...args] : ['poetry', 'run', command];
  },

  /**
   * Build package
   * @example poetry.build()
   */
  build: (): Command => ['poetry', 'build'],
};

/**
 * pipx - Install and run Python applications
 */
export const pipx = {
  /**
   * Install application globally
   * @example pipx.install('black')
   */
  install: (pkg: string): Command => ['pipx', 'install', pkg],

  /**
   * Run application without installing
   * @example pipx.run('black', ['--check', '.'])
   */
  run: (pkg: string, args?: string[]): Command => {
    return args ? ['pipx', 'run', pkg, ...args] : ['pipx', 'run', pkg];
  },

  /**
   * Uninstall application
   * @example pipx.uninstall('black')
   */
  uninstall: (pkg: string): Command => ['pipx', 'uninstall', pkg],

  /**
   * Upgrade application
   * @example pipx.upgrade('black')
   */
  upgrade: (pkg: string): Command => ['pipx', 'upgrade', pkg],
};
