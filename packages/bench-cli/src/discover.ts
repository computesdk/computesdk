import fs from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';

const PATTERNS = ['**/*.bench.ts', '**/*.bench.mts', '**/*.bench.cts', '**/*.bench.js', '**/*.bench.mjs'];

export interface DiscoveryOptions {
  cwd?: string;
  /** Glob patterns to use for explicit file paths. */
  include?: string[];
}

export async function discoverBenchFiles(
  inputs: readonly string[],
  options: DiscoveryOptions = {},
): Promise<string[]> {
  const cwd = options.cwd ?? process.cwd();
  if (inputs.length === 0) {
    return discoverInDirectory(path.join(cwd, 'benchmarks'), options);
  }

  const found = new Set<string>();
  for (const input of inputs) {
    const resolved = path.resolve(cwd, input);
    if (fs.existsSync(resolved)) {
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        for (const file of await discoverInDirectory(resolved, options)) found.add(file);
      } else {
        const relative = path.relative(cwd, resolved);
        if (isBenchFile(relative)) found.add(resolved);
      }
    } else {
      // Treat as a glob pattern and search.
      for (const file of await globPatterns(options.include ?? PATTERNS, resolved, cwd)) found.add(file);
    }
  }
  return [...found].sort();
}

async function discoverInDirectory(directory: string, options: DiscoveryOptions): Promise<string[]> {
  if (!fs.existsSync(directory)) return [];
  const files: string[] = [];
  for await (const file of iterPatterns(options.include ?? PATTERNS, directory)) {
    files.push(file);
  }
  files.sort();
  return files;
}

async function globPatterns(include: readonly string[], pattern: string, cwd: string): Promise<string[]> {
  try {
    const matches = await glob(pattern, { cwd, absolute: true, ignore: ['**/node_modules/**'] });
    return matches.filter((file) => matchesInclude(file, include));
  } catch {
    return [];
  }
}

async function* iterPatterns(include: readonly string[], cwd: string): AsyncGenerator<string> {
  for (const pattern of include) {
    const matches = await glob(pattern, { cwd, absolute: true, ignore: ['**/node_modules/**'] });
    for (const match of matches) yield match;
  }
}

function isBenchFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return (
    lower.endsWith('.bench.ts') ||
    lower.endsWith('.bench.mts') ||
    lower.endsWith('.bench.cts') ||
    lower.endsWith('.bench.js') ||
    lower.endsWith('.bench.mjs')
  );
}

function matchesInclude(filePath: string, include: readonly string[]): boolean {
  return include.some((pattern) => pathMatches(filePath, pattern));
}

function pathMatches(filePath: string, pattern: string): boolean {
  const file = filePath.toLowerCase();
  const needle = pattern.toLowerCase();
  if (needle.startsWith('**/')) return file.endsWith(needle.slice(3));
  return file.endsWith(needle);
}
