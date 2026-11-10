import { describe, it, expect } from 'vitest';
import { execFile, execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { bundledBench, isLinkedPackage, type CliManifest } from '../manifest.js';

// `pretest` builds dist/, so this exercises the real `compute` binary.
const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const distEntry = join(pkgDir, 'dist', 'index.js');
const committedPath = join(pkgDir, 'cli-manifest.json');

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k.startsWith('BENCHMARKS_') || k.startsWith('COMPUTE_')) delete env[k];
  }
  return env;
}

function computeManifest(...args: string[]): string {
  return execFileSync(process.execPath, [distEntry, '__manifest', ...args], {
    encoding: 'utf-8',
    env: cleanEnv(),
  });
}

function helpOf(path: string[]): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [distEntry, ...path, '--help'],
      { encoding: 'utf-8', env: cleanEnv(), timeout: 30_000 },
      (error, stdout) => resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout }),
    );
  });
}

const paths = (m: CliManifest) => m.commands.map((c) => c.path.join(' '));

describe('compute __manifest', () => {
  it('prints exactly the committed cli-manifest.json (regenerate with `pnpm --filter @computesdk/cli run manifest`)', () => {
    expect(computeManifest()).toBe(readFileSync(committedPath, 'utf-8'));
  });

  it('describes the compute binary, its package version and the bench it bundles', () => {
    const manifest = JSON.parse(computeManifest()) as CliManifest;
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'));
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      bin: 'compute',
      package: '@computesdk/cli',
      version: pkg.version,
      source: { repo: 'computesdk/computesdk', released: false },
    });
    expect(manifest.globalFlags).toEqual(['--version', '--login', '--logout', '--org', '--help']);
    expect(manifest.passthrough.bench).toEqual({
      path: ['bench'],
      aliases: [['benchmark']],
      ...bundledBench(pkgDir),
    });
    expect(manifest.passthrough.bench.cli).toMatchObject({ package: '@benchsdk/cli', version: expect.any(String) });
  });

  it('lists nested commands by canonical path, with every alias spelling', () => {
    const manifest = JSON.parse(computeManifest()) as CliManifest;
    expect(paths(manifest)).toEqual(
      expect.arrayContaining(['actions providers configure', 'agents run', 'instances settings set', 'org current']),
    );
    const byPath = new Map(manifest.commands.map((c) => [c.path.join(' '), c]));
    expect(byPath.get('instances')?.aliases).toEqual([['sandboxes'], ['sbx']]);
    expect(byPath.get('actions providers configure')).toMatchObject({
      aliases: [['ci', 'providers', 'configure']],
      args: ['<provider>'],
      flags: expect.arrayContaining(['--key', '--api-key', '--org', '--json', '--help']),
    });
    expect(byPath.get('agents list')?.aliases).toEqual([
      ['agents', 'ls'],
      ['ag', 'list'],
      ['ag', 'ls'],
    ]);
    expect(byPath.get('agents run')?.args).toEqual(['<ref>', '[message]']);
  });

  it('leaves out the bench passthrough and hidden commands', () => {
    const manifest = JSON.parse(computeManifest()) as CliManifest;
    for (const command of manifest.commands) {
      expect(['bench', 'benchmark', '__manifest']).not.toContain(command.path[0]);
      for (const flag of command.flags) expect(flag).toMatch(/^--[a-z][a-z0-9-]*$/);
      expect(new Set(command.flags).size).toBe(command.flags.length);
    }
  });

  it('every listed command prints its own help', async () => {
    const manifest = JSON.parse(computeManifest()) as CliManifest;
    const queue = [...manifest.commands];
    const failures: string[] = [];
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (let command = queue.shift(); command; command = queue.shift()) {
          const { code, stdout } = await helpOf(command.path);
          const [parents, last] = [command.path.slice(0, -1), command.path[command.path.length - 1]];
          const usage = new RegExp(`^Usage: compute ${[...parents, `${last}(\\|\\S+)?`].join(' ')}( |$)`);
          if (code !== 0 || !usage.test(stdout.split('\n')[0])) {
            failures.push(`${command.path.join(' ')}: exit ${code}, ${stdout.split('\n')[0]}`);
          }
        }
      }),
    );
    expect(failures).toEqual([]);
  }, 120_000);

  it('marks a bench linked from a branch build (not installed from npm) as unreleased', () => {
    const manifest = JSON.parse(computeManifest()) as CliManifest;
    const root = JSON.parse(readFileSync(join(pkgDir, '..', '..', 'package.json'), 'utf-8')) as {
      pnpm?: { overrides?: Record<string, string> };
    };
    for (const key of ['runner', 'cli'] as const) {
      const entry = manifest.passthrough.bench[key];
      const override = root.pnpm?.overrides?.[entry.package];
      if (override?.startsWith('link:')) {
        expect(entry).toMatchObject({ linked: true, released: false });
      } else {
        expect(entry).not.toHaveProperty('linked');
        expect(entry).not.toHaveProperty('released');
      }
    }
  });

  it('isLinkedPackage tells an npm install from a linked checkout', () => {
    expect(isLinkedPackage('/repo/node_modules/.pnpm/@benchsdk+cli@0.9.1/node_modules/@benchsdk/cli')).toBe(false);
    expect(isLinkedPackage('/work/benchmarks/packages/benchsdk-cli')).toBe(true);
  });

  it('stamps source.released with --released', () => {
    expect(JSON.parse(computeManifest('--released')).source.released).toBe(true);
  });

  it('--check accepts the committed file and a vendored copy with source.ref', () => {
    expect(computeManifest('--check', committedPath)).toContain('matches');
    const dir = mkdtempSync(join(tmpdir(), 'compute-manifest-'));
    try {
      const vendored = JSON.parse(readFileSync(committedPath, 'utf-8'));
      vendored.source.ref = '0123456789abcdef';
      const file = join(dir, 'vendored.json');
      writeFileSync(file, JSON.stringify(vendored));
      expect(computeManifest('--check', file)).toContain('matches');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--check exits 1 when a command is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'compute-manifest-'));
    try {
      const stale = JSON.parse(readFileSync(committedPath, 'utf-8'));
      stale.commands.pop();
      const file = join(dir, 'stale.json');
      writeFileSync(file, JSON.stringify(stale));
      const res = spawnSync(process.execPath, [distEntry, '__manifest', '--check', file], {
        encoding: 'utf-8',
        env: cleanEnv(),
      });
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('out of date');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits non-zero on an unknown option and stays out of the help listing', () => {
    const res = spawnSync(process.execPath, [distEntry, '__manifest', '--bogus'], { encoding: 'utf-8', env: cleanEnv() });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("unknown option '--bogus'");
    const help = spawnSync(process.execPath, [distEntry, '--help'], { encoding: 'utf-8', env: cleanEnv() });
    expect(help.stdout).not.toContain('__manifest');
  });
});
