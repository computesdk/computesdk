/**
 * Code search powered by Morph WarpGrep
 *
 * Runs semantic code search inside a remote sandbox by delegating
 * file operations (grep, read, listDir) through `sandbox.runCommand()`.
 */

import { WarpGrepClient } from '@morphllm/morphsdk';
import type { WarpGrepContext } from '@morphllm/morphsdk';
import type { Sandbox } from './types/universal-sandbox';

/**
 * Remote command executors delegated to the sandbox.
 * Duplicated here because @morphllm/morphsdk does not export RemoteCommands.
 */
interface RemoteCommands {
  grep: (pattern: string, path: string, glob?: string) => Promise<string>;
  read: (path: string, start: number, end: number) => Promise<string>;
  listDir: (path: string, maxDepth: number) => Promise<string>;
}

/**
 * A single code search result containing the matched file, content, and line ranges.
 */
export interface CodeSearchResult {
  /** File path relative to the search directory */
  file: string;
  /** Content of the relevant code section */
  content: string;
  /** Line ranges (e.g. [[1,50],[100,150]]) or '*' for the full file */
  lines?: '*' | Array<[number, number]>;
}

/**
 * Options for code search
 */
export interface CodeSearchOptions {
  /** Morph API key. Falls back to MORPH_API_KEY env var. */
  morphApiKey?: string;
  /** Glob patterns to exclude from search */
  excludes?: string[];
  /** Glob patterns to include in search */
  includes?: string[];
}

/**
 * Shell-escape a single argument for safe interpolation into a command string.
 */
function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Build `RemoteCommands` that delegate to `sandbox.runCommand()`.
 */
/** @internal Exported for testing only. */
export function buildRemoteCommands(sandbox: Sandbox, cwd?: string): RemoteCommands {
  const opts = cwd ? { cwd } : undefined;

  return {
    grep: async (pattern: string, path: string, glob?: string): Promise<string> => {
      const args = ['-rl'];
      if (glob) args.push('--glob', shellEscape(glob));
      args.push('--', shellEscape(pattern), shellEscape(path));
      const result = await sandbox.runCommand(`rg ${args.join(' ')}`, opts);
      return result.stdout;
    },

    read: async (path: string, start: number, end: number): Promise<string> => {
      const s = Math.floor(Number(start));
      const e = Math.floor(Number(end));
      if (!Number.isFinite(s) || !Number.isFinite(e) || s < 1 || e < 1) {
        throw new Error(`Invalid line range: ${start}-${end}`);
      }
      const result = await sandbox.runCommand(
        `sed -n '${s},${e}p' ${shellEscape(path)}`,
        opts,
      );
      return result.stdout;
    },

    listDir: async (path: string, maxDepth: number): Promise<string> => {
      const d = Math.floor(Number(maxDepth));
      if (!Number.isFinite(d) || d < 0) {
        throw new Error(`Invalid maxDepth: ${maxDepth}`);
      }
      const result = await sandbox.runCommand(
        `find ${shellEscape(path)} -maxdepth ${d}`,
        opts,
      );
      return result.stdout;
    },
  };
}

/**
 * Execute a semantic code search inside a sandbox using Morph WarpGrep.
 *
 * The WarpGrep model loop runs locally via the SDK while grep, read, and
 * listDir operations execute inside the sandbox through `runCommand()`.
 *
 * @param sandbox - The sandbox instance to search in
 * @param query - Natural-language description of what to find
 * @param directory - Root directory to search (defaults to "/home/user")
 * @param options - Optional configuration (API key, excludes, includes)
 * @returns Array of code search results
 * @throws Error if no Morph API key is available
 *
 * @example
 * ```typescript
 * const results = await executeCodeSearch(sandbox, 'Find authentication middleware');
 * for (const r of results) {
 *   console.log(`${r.file}: ${r.content.slice(0, 100)}`);
 * }
 * ```
 */
export async function executeCodeSearch(
  sandbox: Sandbox,
  query: string,
  directory: string = '/home/user',
  options: CodeSearchOptions = {},
): Promise<CodeSearchResult[]> {
  const morphApiKey = options.morphApiKey
    ?? (typeof process !== 'undefined' ? process.env?.MORPH_API_KEY : undefined);
  if (!morphApiKey) {
    throw new Error(
      'codeSearch requires a Morph API key. Set MORPH_API_KEY or pass morphApiKey in options. Get yours at https://morphllm.com/dashboard',
    );
  }

  const client = new WarpGrepClient({ morphApiKey });
  const remoteCommands = buildRemoteCommands(sandbox, directory);

  const result = await client.execute({
    searchTerm: query,
    repoRoot: directory,
    remoteCommands,
    excludes: options.excludes,
    includes: options.includes,
  });

  if (!result.success) {
    throw new Error(`Code search failed: ${result.error ?? 'unknown error'}`);
  }

  return (result.contexts ?? []).map((ctx: WarpGrepContext) => ({
    file: ctx.file,
    content: ctx.content,
    lines: ctx.lines,
  }));
}
