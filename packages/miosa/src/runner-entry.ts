/**
 * Where `RunnerClient` comes from.
 *
 * `@miosa/sdk/runner` loads only the runner client; the root entry loads the
 * whole SDK, which on a cold process costs tens of milliseconds that a latency
 * sensitive caller would otherwise pay inside its own timer. SDK versions that
 * predate the subpath fall back to the root entry, which exports the same
 * class.
 *
 * The load is awaited here, while this module evaluates, so it is finished
 * before any caller can start a timer around the first request. The CommonJS
 * build swaps this file for runner-entry.cjs.ts, which cannot await.
 */

type RunnerExports = Pick<typeof import("@miosa/sdk"), "RunnerClient">;

const RUNNER_ENTRY = "@miosa/sdk/runner";
const ROOT_ENTRY = "@miosa/sdk";

/**
 * Loads `RunnerClient` from the lean entry, or from the root entry when the
 * installed SDK has no such subpath. Any failure of the lean entry falls back:
 * the root entry exports the same class, and if that fails too its error is
 * the one worth raising.
 */
export async function loadRunnerExports(
  load: (specifier: string) => Promise<RunnerExports>,
): Promise<RunnerExports> {
  try {
    return await load(RUNNER_ENTRY);
  } catch {
    return load(ROOT_ENTRY);
  }
}

// A variable specifier keeps the type checker and the bundler from resolving
// the subpath at build time, so an SDK without it still builds.
export const { RunnerClient } = await loadRunnerExports(
  (specifier) => import(specifier) as Promise<RunnerExports>,
);
