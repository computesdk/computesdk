import { describe, expect, it, vi } from "vitest";

import { RunnerClient, loadRunnerExports } from "../runner-entry";

type Exports = Awaited<ReturnType<typeof loadRunnerExports>>;

const leanExports = { RunnerClient: class Lean {} } as unknown as Exports;
const rootExports = { RunnerClient: class Root {} } as unknown as Exports;

describe("runner entry", () => {
  it("should load the lean entry first and use it when it is present", async () => {
    const load = vi.fn(async (specifier: string) =>
      specifier === "@miosa/sdk/runner" ? leanExports : rootExports,
    );

    const actual = await loadRunnerExports(load);

    expect(actual).toBe(leanExports);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith("@miosa/sdk/runner");
  });

  it("should fall back to the root entry when the SDK has no lean entry", async () => {
    const load = vi.fn(async (specifier: string) => {
      if (specifier === "@miosa/sdk/runner") {
        throw Object.assign(new Error("Package subpath './runner' is not defined"), {
          code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
        });
      }
      return rootExports;
    });

    const actual = await loadRunnerExports(load);

    expect(actual).toBe(rootExports);
    expect(load.mock.calls.map(([specifier]) => specifier)).toEqual([
      "@miosa/sdk/runner",
      "@miosa/sdk",
    ]);
  });

  it("should raise the root entry's error when neither entry loads", async () => {
    const rootFailure = new Error("Cannot find package '@miosa/sdk'");
    const load = async (specifier: string): Promise<Exports> => {
      throw specifier === "@miosa/sdk" ? rootFailure : new Error("no subpath");
    };

    await expect(loadRunnerExports(load)).rejects.toBe(rootFailure);
  });

  it("should export a constructible RunnerClient from the installed SDK", () => {
    expect(typeof RunnerClient).toBe("function");
  });
});
