/**
 * CommonJS stand-in for runner-entry.ts, which awaits an import. Same rule:
 * the lean `@miosa/sdk/runner` entry when the installed SDK has it, the root
 * entry otherwise.
 */

type RunnerExports = Pick<typeof import("@miosa/sdk"), "RunnerClient">;

function loadRunnerExports(): RunnerExports {
  try {
    return require("@miosa/sdk/runner") as RunnerExports;
  } catch {
    return require("@miosa/sdk") as RunnerExports;
  }
}

export const { RunnerClient } = loadRunnerExports();
