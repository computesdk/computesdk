/**
 * `compute __manifest` — the command tree of the `compute` binary as JSON, in
 * the schema shared with `bench __manifest`. The benchmarks platform vendors
 * it to check that the commands its API surface map names really exist.
 * `bench …` is recorded as a passthrough by the bench versions compute
 * bundles; the bench manifest describes those commands.
 */

import type { Command, Option } from 'commander';
import { createRequire } from 'module';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { BENCH_COMMANDS } from './bench.js';

export const MANIFEST_COMMAND = '__manifest';

export interface ManifestCommand {
  path: string[];
  /** Every other spelling of `path` that commander accepts (aliases at any level). */
  aliases: string[][];
  args: string[];
  flags: string[];
  summary: string;
}

export interface PackageVersion {
  package: string;
  version: string;
}

export interface CliManifest {
  schemaVersion: 1;
  bin: 'compute';
  package: '@computesdk/cli';
  version: string;
  source: { repo: 'computesdk/computesdk'; released: boolean };
  globalFlags: string[];
  commands: ManifestCommand[];
  passthrough: {
    bench: { path: string[]; aliases: string[][]; runner: PackageVersion; cli: PackageVersion };
  };
}

/**
 * Version of `name` as resolved from `fromDir`. Walks up from the resolved
 * entry because the bench packages' `exports` maps hide `./package.json`.
 */
export function resolvedPackage(name: string, fromDir: string): { dir: string; version: string } {
  const require = createRequire(join(fromDir, 'noop.js'));
  let dir = dirname(require.resolve(name));
  for (;;) {
    const file = join(dir, 'package.json');
    if (existsSync(file)) {
      const pkg = JSON.parse(readFileSync(file, 'utf-8')) as { name?: string; version: string };
      if (pkg.name === name) return { dir, version: pkg.version };
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`package.json for ${name} not found from ${fromDir}`);
    dir = parent;
  }
}

/** The bench versions `compute bench` runs: the runner, and the @benchsdk/cli the runner itself loads. */
export function bundledBench(fromDir: string): { runner: PackageVersion; cli: PackageVersion } {
  const runner = resolvedPackage('@benchsdk/runner', fromDir);
  const cli = resolvedPackage('@benchsdk/cli', runner.dir);
  return {
    runner: { package: '@benchsdk/runner', version: runner.version },
    cli: { package: '@benchsdk/cli', version: cli.version },
  };
}

// commander 11 has no public accessor for `{ hidden: true }` on commands.
function isHidden(cmd: Command): boolean {
  return (cmd as unknown as { _hidden?: boolean })._hidden === true;
}

function flagsOf(cmd: Command): string[] {
  const flags = cmd
    .createHelp()
    .visibleOptions(cmd)
    .map((o: Option) => o.long ?? o.short)
    .filter((f): f is string => Boolean(f));
  return [...new Set(flags)];
}

function argsOf(cmd: Command): string[] {
  return cmd.registeredArguments.map((a) => {
    const name = `${a.name()}${a.variadic ? '...' : ''}`;
    return a.required ? `<${name}>` : `[${name}]`;
  });
}

function summaryOf(cmd: Command): string {
  return (cmd.summary() || cmd.description()).split('\n')[0].trim();
}

/** Every combination of names along the path, minus the canonical one. */
function aliasPaths(names: string[][]): string[][] {
  let paths: string[][] = [[]];
  for (const choices of names) paths = paths.flatMap((p) => choices.map((c) => [...p, c]));
  return paths.slice(1);
}

function walk(cmd: Command, ancestors: string[][], skip: Set<string>, out: ManifestCommand[]): void {
  for (const sub of cmd.commands) {
    if (isHidden(sub) || (ancestors.length === 0 && skip.has(sub.name()))) continue;
    const names = [...ancestors, [sub.name(), ...sub.aliases()]];
    out.push({
      path: names.map((n) => n[0]),
      aliases: aliasPaths(names),
      args: argsOf(sub),
      flags: flagsOf(sub),
      summary: summaryOf(sub),
    });
    walk(sub, names, skip, out);
  }
}

export function buildCliManifest(
  program: Command,
  options: { version: string; released: boolean; packageDir: string },
): CliManifest {
  const [benchName, ...benchAliases] = [...BENCH_COMMANDS];
  const commands: ManifestCommand[] = [];
  walk(program, [], new Set([benchName]), commands);
  return {
    schemaVersion: 1,
    bin: 'compute',
    package: '@computesdk/cli',
    version: options.version,
    source: { repo: 'computesdk/computesdk', released: options.released },
    globalFlags: flagsOf(program),
    commands,
    passthrough: {
      bench: {
        path: [benchName],
        aliases: benchAliases.map((a) => [a]),
        ...bundledBench(options.packageDir),
      },
    },
  };
}

export function manifestJson(manifest: CliManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Compares a manifest file with the generated one. A `source.ref` stamped by
 * whoever vendored the file is ignored.
 */
export function manifestMatches(fileContent: string, generated: CliManifest): boolean {
  let committed: { source?: Record<string, unknown> };
  try {
    committed = JSON.parse(fileContent);
  } catch {
    return false;
  }
  if (committed.source) delete committed.source.ref;
  return JSON.stringify(committed) === JSON.stringify(generated);
}

/** Registers the hidden `compute __manifest [--released] [--check <file>]`. */
export function registerManifestCommand(
  program: Command,
  options: { version: string; packageDir: string },
): void {
  program
    .command(MANIFEST_COMMAND, { hidden: true })
    .description('Print the command tree as JSON (for the benchmarks platform surface map)')
    .option('--released', 'mark the manifest as describing a version published to npm')
    .option('--check <file>', 'exit 1 unless <file> equals the generated manifest (ignoring source.ref)')
    .action((opts: { released?: boolean; check?: string }) => {
      const manifest = buildCliManifest(program, {
        version: options.version,
        released: Boolean(opts.released),
        packageDir: options.packageDir,
      });
      if (opts.check) {
        if (!manifestMatches(readFileSync(opts.check, 'utf-8'), manifest)) {
          console.error(
            `${opts.check} is out of date. Regenerate it with \`pnpm --filter @computesdk/cli run manifest\`.`,
          );
          process.exit(1);
        }
        console.log(`${opts.check} matches the ${manifest.commands.length}-command manifest.`);
        return;
      }
      process.stdout.write(manifestJson(manifest));
    });
}
