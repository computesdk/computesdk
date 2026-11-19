import { beforeEach, describe, expect, it, vi } from "vitest";
import { InstanceSizeError } from "@computesdk/provider";

import { runloop } from "../index";

// Failure cases: wrong CPU/RAM pair or GiB conversion, incorrect disk metadata,
// an unsupported class silently booting the default, sizing fields dropped on
// fresh, blueprint or snapshot creates, native conflicts accepted, or an
// unsized create unexpectedly receiving a standard size.
const { createAndAwaitRunning } = vi.hoisted(() => ({
  createAndAwaitRunning: vi.fn(),
}));

vi.mock("@runloop/api-client", () => ({
  RunloopSDK: vi.fn(() => ({ api: { devboxes: { createAndAwaitRunning } } })),
}));

const provider = runloop({ apiKey: "test-key" });

beforeEach(() => {
  createAndAwaitRunning.mockReset().mockResolvedValue({ id: "dbx_test" });
});

describe("Runloop standard sizes", () => {
  it.each([
    ["xs", 1, 2048, 4096, 2, 4],
    ["sm", 1, 2048, 4096, 2, 4],
    ["md", 2, 4096, 8192, 4, 8],
    ["lg", 4, 8192, 16384, 8, 16],
    ["xl", 8, 16384, 16384, 16, 16],
    ["2xl", 16, 32768, 16384, 32, 16],
  ] as const)("resolves and creates %s", async (sizeClass, vcpus, memoryMiB, diskMiB, memoryGiB, diskGiB) => {
    const launch_parameters = {
      resource_size_request: "CUSTOM_SIZE",
      custom_cpu_cores: vcpus,
      custom_gb_memory: memoryGiB,
      custom_disk_size: diskGiB,
    };
    const resolved = { vcpus, memoryMiB, diskMiB };

    expect(provider.sizes!.resolve(sizeClass)).toMatchObject({
      status: "supported",
      requested: { sizeClass, vcpus },
      resolved,
      nativeOptions: { launch_parameters },
    });
    expect(createAndAwaitRunning).not.toHaveBeenCalled();

    const sandbox = await provider.instances.create({ sizeClass, timeout: 3000, envs: { TEST: "1" } });
    expect(sandbox.sizing?.resolved).toEqual(resolved);
    expect(createAndAwaitRunning).toHaveBeenCalledOnce();
    expect(createAndAwaitRunning.mock.calls[0][0]).toMatchObject({
      launch_parameters: { keep_alive_time_seconds: 3, ...launch_parameters },
      environment_variables: { TEST: "1" },
    });
    expect(createAndAwaitRunning.mock.calls[0][0]).not.toHaveProperty("sizeClass");
  });

  it.each([
    [{ snapshotId: "snp_test" }, { snapshot_id: "snp_test" }],
    [{ templateId: "snp_test" }, { snapshot_id: "snp_test" }],
    [{ templateId: "bpt_test" }, { blueprint_id: "bpt_test" }],
    [{ blueprint_name: "my-blueprint" }, { blueprint_name: "my-blueprint" }],
  ])("forwards sizing when starting from %j", async (options, nativeSource) => {
    await provider.sandbox.create({ ...options, sizeClass: "lg" });

    expect(createAndAwaitRunning).toHaveBeenCalledOnce();
    expect(createAndAwaitRunning.mock.calls[0][0]).toMatchObject({
      ...nativeSource,
      launch_parameters: {
        resource_size_request: "CUSTOM_SIZE",
        custom_cpu_cores: 4,
        custom_gb_memory: 8,
        custom_disk_size: 16,
      },
    });
  });

  it.each(["3xl"] as const)("rejects %s before making a Runloop request", async (sizeClass) => {
    const resolution = provider.sizes!.resolve(sizeClass);
    expect(resolution).toMatchObject({ status: "unsupported", reason: expect.any(String) });
    await expect(provider.instances.create({ sizeClass })).rejects.toMatchObject({
      code: "unsupported",
      fallback: false,
      resolution,
    });
    expect(createAndAwaitRunning).not.toHaveBeenCalled();
  });

  it.each([
    { launch_parameters: { custom_cpu_cores: 2 } },
    { launch_parameters: { custom_gb_memory: 4 } },
    { resource_size_request: "MEDIUM" },
    { custom_cpu_cores: 2 },
    { custom_gb_memory: 4 },
    { custom_disk_size: 8 },
  ])("rejects competing native fields %j", async (options) => {
    expect(() => provider.sizes!.resolve("md", options)).toThrow(InstanceSizeError);
    await expect(provider.instances.create({ ...options, sizeClass: "md" })).rejects.toMatchObject({
      code: "conflict",
      fallback: false,
    });
    expect(createAndAwaitRunning).not.toHaveBeenCalled();
  });

  it("preserves legacy native launch parameters when sizeClass is omitted", async () => {
    const sandbox = await provider.instances.create({ launch_parameters: { resource_size_request: "LARGE" } });

    expect(sandbox.sizing).toBeUndefined();
    expect(createAndAwaitRunning.mock.calls[0][0].launch_parameters).toEqual({
      keep_alive_time_seconds: 1800,
      resource_size_request: "LARGE",
    });
  });
});
