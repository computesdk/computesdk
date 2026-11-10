import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { createRequire } from 'module';
import { existsSync, readFileSync, realpathSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { benchInvocation, parseBenchDispatch } from '../bench.js';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const distEntry = join(pkgDir, 'dist', 'index.js');

/** `package.json` of `name` as resolved from `fromDir`. */
function packageJsonOf(name: string, fromDir: string): { path: string; version: string } {
  const require = createRequire(join(fromDir, 'noop.js'));
  let dir = dirname(require.resolve(name));
  while (!existsSync(join(dir, 'package.json')) || JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).name !== name) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`package.json for ${name} not found`);
    dir = parent;
  }
  const path = join(dir, 'package.json');
  return { path, version: JSON.parse(readFileSync(path, 'utf-8')).version };
}

function atLeast(version: string, min: string): boolean {
  const a = version.split('-')[0].split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

describe('parseBenchDispatch', () => {
  it('dispatches `compute bench …` and the `benchmark` alias', () => {
    expect(parseBenchDispatch(['bench', 'runs', 'list', 'x'])).toEqual({ argv: ['runs', 'list', 'x'] });
    expect(parseBenchDispatch(['benchmark', '--version'])).toEqual({ argv: ['--version'] });
  });

  it('takes compute’s leading --org (both forms) before bench', () => {
    expect(parseBenchDispatch(['--org', 'acme', 'bench', 'auth', 'status'])).toEqual({
      argv: ['auth', 'status'],
      org: 'acme',
    });
    expect(parseBenchDispatch(['--org=acme', 'bench', 'auth', 'status'])).toEqual({
      argv: ['auth', 'status'],
      org: 'acme',
    });
  });

  it('leaves other commands and other leading options to commander', () => {
    expect(parseBenchDispatch(['actions', 'runs'])).toBeNull();
    expect(parseBenchDispatch(['--org', 'acme', 'actions', 'runs'])).toBeNull();
    expect(parseBenchDispatch(['--login', 'bench'])).toBeNull();
    expect(parseBenchDispatch(['--org'])).toBeNull();
    expect(parseBenchDispatch([])).toBeNull();
  });
});

describe('benchInvocation', () => {
  it('passes argv through and sets nothing without compute env', () => {
    expect(benchInvocation(['runs', 'list', 'x'], {})).toEqual({ argv: ['runs', 'list', 'x'], env: {} });
  });

  it('maps COMPUTE_PLATFORM_URL / COMPUTE_API_KEY to the bench names', () => {
    const inv = benchInvocation(['benchmarks', 'list'], {
      COMPUTE_PLATFORM_URL: 'http://localhost:3210',
      COMPUTE_API_KEY: 'bp_k',
    });
    expect(inv.env).toEqual({
      BENCHMARKS_PLATFORM_URL: 'http://localhost:3210',
      BENCHMARKS_PLATFORM_API_KEY: 'bp_k',
    });
  });

  it('does not override BENCHMARKS_* that are already set', () => {
    const inv = benchInvocation(['benchmarks', 'list'], {
      COMPUTE_PLATFORM_URL: 'http://localhost:3210',
      COMPUTE_API_KEY: 'bp_compute',
      BENCHMARKS_PLATFORM_URL: 'http://127.0.0.1:3211',
      BENCHMARKS_PLATFORM_API_KEY: 'bp_bench',
    });
    expect(inv.env).toEqual({});
  });

  it('treats empty variables as unset', () => {
    const inv = benchInvocation(['benchmarks', 'list'], {
      COMPUTE_API_KEY: '',
      COMPUTE_PLATFORM_URL: 'http://localhost:3210',
      BENCHMARKS_PLATFORM_URL: '',
      COMPUTE_ORG: '',
    });
    expect(inv).toEqual({ argv: ['benchmarks', 'list'], env: { BENCHMARKS_PLATFORM_URL: 'http://localhost:3210' } });
  });

  it('prepends COMPUTE_ORG as --org', () => {
    expect(benchInvocation(['auth', 'status', '--json'], { COMPUTE_ORG: 'acme' }).argv).toEqual([
      '--org',
      'acme',
      'auth',
      'status',
      '--json',
    ]);
  });

  it('never duplicates or overrides an explicit bench --org', () => {
    expect(benchInvocation(['--org', 'mine', 'auth', 'status'], { COMPUTE_ORG: 'acme' }).argv).toEqual([
      '--org',
      'mine',
      'auth',
      'status',
    ]);
    expect(benchInvocation(['auth', 'status', '--org=mine'], { COMPUTE_ORG: 'acme' }, 'lead').argv).toEqual([
      'auth',
      'status',
      '--org=mine',
    ]);
  });

  it('prefers compute’s leading --org over COMPUTE_ORG', () => {
    expect(benchInvocation(['auth', 'status'], { COMPUTE_ORG: 'acme' }, 'lead').argv).toEqual([
      '--org',
      'lead',
      'auth',
      'status',
    ]);
  });

  it('ignores --org after a `--` separator when looking for an explicit one', () => {
    expect(benchInvocation(['runs', 'list', '--', '--org'], { COMPUTE_ORG: 'acme' }).argv).toEqual([
      '--org',
      'acme',
      'runs',
      'list',
      '--',
      '--org',
    ]);
  });

  it('does not add --org to the runner verbs, but still maps their env', () => {
    for (const verb of ['run', 'check']) {
      const inv = benchInvocation([verb, 'bench.ts'], { COMPUTE_ORG: 'acme', COMPUTE_API_KEY: 'bp_k' }, 'lead');
      expect(inv.argv).toEqual([verb, 'bench.ts']);
      expect(inv.env).toEqual({ BENCHMARKS_PLATFORM_API_KEY: 'bp_k' });
    }
  });
});

describe('bundled bench versions', () => {
  it('@benchsdk/runner is 0.8.3 or later', () => {
    expect(atLeast(packageJsonOf('@benchsdk/runner', pkgDir).version, '0.8.3')).toBe(true);
  });

  it('the runner’s @benchsdk/cli is 0.9.3 or later and the same copy compute imports', () => {
    const runner = packageJsonOf('@benchsdk/runner', pkgDir);
    const runnerCli = packageJsonOf('@benchsdk/cli', dirname(runner.path));
    const ownCli = packageJsonOf('@benchsdk/cli', pkgDir);
    expect(atLeast(runnerCli.version, '0.9.3')).toBe(true);
    expect(realpathSync(runnerCli.path)).toBe(realpathSync(ownCli.path));
  });
});

// The built CLI end to end. Skipped when dist/ is missing (build first).
describe.skipIf(!existsSync(distEntry))('compute bench (built CLI)', () => {
  const cleanEnv = (): NodeJS.ProcessEnv => {
    const env = { ...process.env };
    for (const k of Object.keys(env)) {
      if (k.startsWith('BENCHMARKS_') || k.startsWith('COMPUTE_')) delete env[k];
    }
    return env;
  };
  const compute = (args: string[], env: NodeJS.ProcessEnv = cleanEnv()) =>
    spawnSync(process.execPath, [distEntry, ...args], { encoding: 'utf-8', env, timeout: 30_000 });

  it('reports the bundled bench CLI version', () => {
    const version = execFileSync(process.execPath, [distEntry, 'bench', '--version'], {
      encoding: 'utf-8',
      env: cleanEnv(),
    }).trim();
    expect(atLeast(version, '0.9.3')).toBe(true);
  });

  it('exposes `bench fork`', () => {
    const res = compute(['bench', 'fork', '--help']);
    expect(res.stdout.split('\n')[0]).toMatch(/^Usage: bench fork/);
  });

  it('rejects an unknown subcommand flag', () => {
    const res = compute(['bench', 'runs', 'list', 'x', '--bogus']);
    expect(res.status).not.toBe(0);
    expect(res.stdout + res.stderr).toMatch(/Unknown option/);
  });

  it('forwards COMPUTE_PLATFORM_URL and COMPUTE_API_KEY to bench', () => {
    const res = compute(['bench', 'benchmarks', 'list'], {
      ...cleanEnv(),
      COMPUTE_PLATFORM_URL: 'http://127.0.0.1:9',
      COMPUTE_API_KEY: 'bp_x',
    });
    const out = res.stdout + res.stderr;
    expect(res.status).not.toBe(0);
    expect(out).toContain('127.0.0.1:9');
    expect(out).not.toContain('platform.computesdk.com');
    expect(out).not.toContain('No credentials found');
  });

  // The bench commands added on the benchmarks branch (since @benchsdk/cli
  // 0.9.4) reach compute only through the linked branch build; published
  // 0.9.3 prints the generic usage for them (it already has `reliability`).
  it('exposes `bench reliability`', () => {
    const res = compute(['bench', 'reliability', '--help']);
    expect(res.status).toBe(0);
    expect(res.stdout.split('\n')[0]).toMatch(/^Usage: bench reliability <benchmark-slug>/);
  });

  it('exposes `bench retrigger` with --wait, --timeout and status', () => {
    const res = compute(['bench', 'retrigger', '--help']);
    expect(res.status).toBe(0);
    expect(res.stdout.split('\n')[0]).toMatch(/^Usage: bench retrigger <benchmark-slug>/);
    for (const text of ['--wait', '--timeout', 'bench retrigger status']) expect(res.stdout).toContain(text);
  });

  it('exposes the benchmark management commands', () => {
    const res = compute(['bench', 'benchmarks', 'pause', '--help']);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/bench benchmarks pause <benchmark-slug> \[--start <iso>\] \[--end <iso>\]/);
    expect(res.stdout).toContain('bench benchmarks describe <benchmark-slug>');
  });

  it('lists the run feed, reliability cards, activity and run archive commands', () => {
    const res = compute(['bench', '--help']);
    for (const text of ['runs feed', 'runs days', 'runs day <YYYY-MM-DD>', 'runs archive|unarchive', 'reliability cards', 'activity [--days N]', 'retrigger <benchmark-slug>']) {
      expect(res.stdout).toContain(text);
    }
  });

  it('`compute bench --version` is the version of the bench build it runs', () => {
    const runner = packageJsonOf('@benchsdk/runner', pkgDir);
    const runnerCli = packageJsonOf('@benchsdk/cli', dirname(runner.path));
    const bin = join(dirname(runner.path), 'dist', 'bin.cjs');
    const own = execFileSync(process.execPath, [distEntry, 'bench', '--version'], { encoding: 'utf-8', env: cleanEnv() }).trim();
    const direct = execFileSync(process.execPath, [bin, '--version'], { encoding: 'utf-8', env: cleanEnv() }).trim();
    expect(own).toBe(runnerCli.version);
    expect(own).toBe(direct);
  });

  it('`compute bench __manifest` is the bundled bench manifest', () => {
    const runner = packageJsonOf('@benchsdk/runner', pkgDir);
    const bin = join(dirname(runner.path), 'dist', 'bin.cjs');
    const own = execFileSync(process.execPath, [distEntry, 'bench', '__manifest'], { encoding: 'utf-8', env: cleanEnv() });
    const direct = execFileSync(process.execPath, [bin, '__manifest'], { encoding: 'utf-8', env: cleanEnv() });
    expect(own).toBe(direct);
    const paths = (JSON.parse(own) as { commands: Array<{ path: string[] }> }).commands.map((c) => c.path.join(' '));
    expect(paths).toEqual(
      expect.arrayContaining(['benchmarks pause', 'runs feed', 'runs day', 'reliability cards', 'activity', 'retrigger status']),
    );
  });
});
