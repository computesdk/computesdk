/**
 * Tensorlake standard sizes (mock-only; no sandboxes are booted).
 *
 * Tensorlake takes arbitrary `cpus` / `memoryMb` (1024–8192 MiB per vCPU, up
 * to 16 vCPU / 64 GB on Pro) and `diskMb` (10240–102400 MiB), so each class
 * maps to its exact profile plus the 10240 MiB disk the platform pins.
 *
 * Ways the mapping could fail, each covered below:
 * - Wrong shape: a class resolves to other CPU/RAM than its profile, or
 *   `resolved` omits/misstates the 10240 MiB disk.
 * - Unlisted size accepted: 3xl (32 vCPU, above every listed plan) resolves
 *   as supported instead of `unsupported`.
 * - Silent default boot: `sizeClass` reaches `Sandbox.create` but `cpus`,
 *   `memoryMb` or `diskMb` are missing, so Tensorlake boots 1 vCPU / 1 GiB.
 * - Dropped field: the create path forwards only some native fields, or
 *   leaks the SDK-only `sizeClass` to the vendor.
 * - Conflict accepted: a native `cpus` / `memoryMb` / `diskMb` /
 *   `ephemeralDiskMb` alongside `sizeClass` silently wins or loses instead of
 *   throwing `InstanceSizeError('conflict')` before any create.
 * - Restore path: `snapshotId` with `sizeClass` creates a sandbox whose
 *   resources come from a memory snapshot instead of the requested size.
 * - Refusal still creates: an unsupported class calls `Sandbox.create`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { create } = vi.hoisted(() => ({
  create: vi.fn(async (_params: Record<string, unknown>) => ({ sandboxId: "sb-size" })),
}));

vi.mock("tensorlake", () => ({
  Sandbox: { create: (params: Record<string, unknown>) => create(params) },
  SandboxClient: {},
  SandboxStatus: { RUNNING: "RUNNING" },
  OutputMode: { DISCARD: "discard" },
  ProcessStatus: {},
}));

import { tensorlake } from "../index";

const DISK_MIB = 10240;
const profiles = [
  ["xs", 1, 1024],
  ["sm", 1, 2048],
  ["md", 2, 4096],
  ["lg", 4, 8192],
  ["xl", 8, 16384],
  ["2xl", 16, 32768],
] as const;

describe("Tensorlake standard sizes", () => {
  beforeEach(() => {
    create.mockClear();
  });

  it("lists xs through 2xl as supported at their exact profile and refuses 3xl", () => {
    const sizes = tensorlake({ apiKey: "test" }).sizes;
    const list = sizes.list();
    expect(list.filter((r) => r.status === "supported").map((r) => r.requested.sizeClass))
      .toEqual(profiles.map(([sizeClass]) => sizeClass));
    const threeXl = sizes.resolve("3xl");
    expect(threeXl).toMatchObject({ status: "unsupported" });
    expect(threeXl.status === "unsupported" && threeXl.reason).toMatch(/16 vCPU/);
  });

  it.each(profiles)("resolves %s to %i vCPU / %i MiB with a 10240 MiB disk", (sizeClass, vcpus, memoryMiB) => {
    const resolution = tensorlake({ apiKey: "test" }).sizes.resolve(sizeClass);
    expect(resolution).toEqual({
      requested: { sizeClass, vcpus, memoryMiB },
      provenance: "adapter-declared",
      status: "supported",
      resolved: { vcpus, memoryMiB, diskMiB: DISK_MIB },
      nativeOptions: { cpus: vcpus, memoryMb: memoryMiB, diskMb: DISK_MIB },
    });
    expect(resolution).not.toHaveProperty("belowStandard");
  });

  it.each(profiles)("boots %s with cpus, memoryMb and diskMb forwarded to Sandbox.create", async (sizeClass, vcpus, memoryMiB) => {
    const instance = await tensorlake({ apiKey: "test" }).instances.create({ sizeClass, envs: { A: "1" } });
    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0][0];
    expect(params).toMatchObject({ cpus: vcpus, memoryMb: memoryMiB, diskMb: DISK_MIB });
    expect(params).not.toHaveProperty("sizeClass");
    expect(instance.sizing).toEqual({
      requested: { sizeClass, vcpus, memoryMiB },
      resolved: { vcpus, memoryMiB, diskMiB: DISK_MIB },
      provenance: "adapter-declared",
    });
  });

  it("keeps a named (ephemeral: false) create sized", async () => {
    await tensorlake({ apiKey: "test" }).instances.create({ sizeClass: "lg", ephemeral: false });
    expect(create.mock.calls[0][0]).toMatchObject({ cpus: 4, memoryMb: 8192, diskMb: DISK_MIB, name: expect.any(String) });
  });

  it.each([
    [{ sizeClass: "md", cpus: 2 }, "conflict"],
    [{ sizeClass: "md", memoryMb: 4096 }, "conflict"],
    [{ sizeClass: "md", diskMb: 20480 }, "conflict"],
    [{ sizeClass: "md", ephemeralDiskMb: 20480 }, "conflict"],
    [{ sizeClass: "md", snapshotId: "snap-1" }, "unsupported"],
    [{ sizeClass: "3xl" }, "unsupported"],
  ] as const)("rejects %j with %s before creating", async (options, code) => {
    await expect(tensorlake({ apiKey: "test" }).instances.create(options as never))
      .rejects.toMatchObject({ name: "InstanceSizeError", code, fallback: false });
    expect(create).not.toHaveBeenCalled();
  });

  it("leaves native sizing untouched without sizeClass", async () => {
    await tensorlake({ apiKey: "test" }).instances.create({ cpus: 3, memoryMb: 6000, diskMb: 20480 });
    expect(create.mock.calls[0][0]).toMatchObject({ cpus: 3, memoryMb: 6000, diskMb: 20480 });
  });
});
