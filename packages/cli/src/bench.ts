/**
 * `compute bench …` — the benchmarks CLI (`@benchsdk/runner`'s `bench`
 * binary) run in-process. compute's env names and `--org` are mapped onto the
 * names bench reads, so `compute bench` talks to the same platform, with the
 * same key and org, as the rest of `compute`.
 */

import { DEFAULT_BASE_URL } from '@computesdk/platform';
import { withFetchFailureContext } from './net.js';
import { assertComputeKeyDestination } from './session.js';

/** The canonical name first; the rest are dispatch aliases. */
export const BENCH_COMMANDS = new Set(['bench', 'benchmark']);

/** Verbs `@benchsdk/runner` parses itself; its parser has no `--org`. */
const RUNNER_VERBS = new Set(['run', 'check', '__manifest']);

/**
 * `args` is `process.argv.slice(2)`. Returns the bench argv when the
 * invocation is `compute [--org <slug>] bench …`; anything else is left to
 * commander.
 */
export function parseBenchDispatch(args: string[]): { argv: string[]; org?: string } | null {
  let org: string | undefined;
  let i = 0;
  while (i < args.length && !BENCH_COMMANDS.has(args[i])) {
    const arg = args[i];
    if (arg === '--org' && i + 1 < args.length) {
      org = args[i + 1];
      i += 2;
    } else if (arg.startsWith('--org=')) {
      org = arg.slice('--org='.length);
      i += 1;
    } else {
      return null;
    }
  }
  if (i >= args.length) return null;
  const argv = args.slice(i + 1);
  return org ? { argv, org } : { argv };
}

/** bench's own `--base-url <url>` / `--base-url=<url>`, which wins over its env. */
function baseUrlFlag(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') return undefined;
    if (arg === '--base-url') return argv[i + 1];
    if (arg.startsWith('--base-url=')) return arg.slice('--base-url='.length);
  }
  return undefined;
}

function hasOrgFlag(argv: string[]): boolean {
  for (const arg of argv) {
    if (arg === '--') return false;
    if (arg === '--org' || arg.startsWith('--org=')) return true;
  }
  return false;
}

/**
 * Maps compute's env names onto bench's without overriding settings bench
 * already has: COMPUTE_PLATFORM_URL → BENCHMARKS_PLATFORM_URL,
 * COMPUTE_API_KEY → BENCHMARKS_PLATFORM_API_KEY, and the org (compute's
 * leading `--org`, else COMPUTE_ORG) → a leading `--org` unless bench's argv
 * already has one. Empty variables count as unset. COMPUTE_API_KEY is only
 * handed over for a host compute would send it to (bench checks none): the
 * URL bench will use — its `--base-url`, else BENCHMARKS_PLATFORM_URL, else
 * COMPUTE_PLATFORM_URL — must be computesdk.com or loopback, over HTTPS.
 */
export function benchInvocation(
  argv: string[],
  env: NodeJS.ProcessEnv,
  computeOrg?: string,
): { argv: string[]; env: Record<string, string> } {
  const out: Record<string, string> = {};
  if (env.COMPUTE_PLATFORM_URL && !env.BENCHMARKS_PLATFORM_URL) {
    out.BENCHMARKS_PLATFORM_URL = env.COMPUTE_PLATFORM_URL;
  }
  if (env.COMPUTE_API_KEY && !env.BENCHMARKS_PLATFORM_API_KEY) {
    assertComputeKeyDestination(
      baseUrlFlag(argv) || env.BENCHMARKS_PLATFORM_URL || env.COMPUTE_PLATFORM_URL || DEFAULT_BASE_URL,
    );
    out.BENCHMARKS_PLATFORM_API_KEY = env.COMPUTE_API_KEY;
  }
  const org = computeOrg || env.COMPUTE_ORG;
  if (!org || RUNNER_VERBS.has(argv[0]) || hasOrgFlag(argv)) return { argv, env: out };
  return { argv: ['--org', org, ...argv], env: out };
}

/** Runs bench; the runner exits the process itself once the command is done. */
export async function runBench(dispatch: { argv: string[]; org?: string }): Promise<void> {
  const inv = benchInvocation(dispatch.argv, process.env, dispatch.org);
  Object.assign(process.env, inv.env);
  globalThis.fetch = withFetchFailureContext(globalThis.fetch);
  const { run } = await import('@benchsdk/runner');
  await run(inv.argv);
}
