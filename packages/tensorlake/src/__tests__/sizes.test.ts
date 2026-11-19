/**
 * Tensorlake standard sizes (mock-only; no sandboxes are booted).
 *
 * Tensorlake takes arbitrary `cpus` / `memoryMb` (1024–8192 MiB per vCPU,
 * capped at 16000 MB per sandbox) and `diskMb` (capped at 10240 MiB), so xs–lg
 * map to their exact profile, xl maps to 8 vCPU / 16000 MB (within the 10%
 * memory tolerance, with `belowStandard` and the 384 MiB shortfall), and every
 * class pins the 10240 MiB disk.
 *
 * Ways the mapping could fail, each covered below:
 * - Wrong shape: a class resolves to other CPU/RAM than its profile, or
 *   `resolved` omits/misstates the 10240 MiB disk.
 * - Below-standard shape unflagged: xl boots 16000 MB without the exact
 *   `belowStandard` note, or asks for 16384 MB above the RAM cap.
 * - Unlisted size accepted: 2xl / 3xl (above the 16000 MB cap) resolve as
 *   supported, or get shrunk below their profile, instead of `unsupported`.
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
] as const;
const RAM_CAP_NOTE = "Tensorlake caps sandbox RAM at 16000 MB";
const XL = { requested: { sizeClass: "xl", vcpus: 8, memoryMiB: 16384 }, resolved: { vcpus: 8, memoryMiB: 16000, diskMiB: DISK_MIB } } as const;

describe("Tensorlake standard sizes", () => {
  beforeEach(() => {
    create.mockClear();
  });

  it("lists xs through xl as supported and refuses 2xl and 3xl at the RAM cap", () => {
    const sizes = tensorlake({ apiKey: "test" }).sizes;
    expect(sizes.list().filter((r) => r.status === "supported").map((r) => r.requested.sizeClass))
      .toEqual([...profiles.map(([sizeClass]) => sizeClass), "xl"]);
    for (const sizeClass of ["2xl", "3xl"] as const) {
      const resolution = sizes.resolve(sizeClass);
      expect(resolution).toMatchObject({ status: "unsupported" });
      expect(resolution).not.toHaveProperty("nativeOptions");
      expect(resolution.status === "unsupported" && resolution.reason).toContain(RAM_CAP_NOTE);
    }
  });

  it("resolves xl to 8 vCPU / 16000 MB, within the memory tolerance", () => {
    expect(tensorlake({ apiKey: "test" }).sizes.resolve("xl")).toEqual({
      ...XL,
      provenance: "adapter-declared",
      status: "supported",
      belowStandard: RAM_CAP_NOTE,
      memoryShortfallMiB: 384,
      nativeOptions: { cpus: 8, memoryMb: 16000, diskMb: DISK_MIB },
    });
  });

  it("boots xl with memoryMb 16000 and reports belowStandard on sizing", async () => {
    const instance = await tensorlake({ apiKey: "test" }).instances.create({ sizeClass: "xl" });
    expect(create.mock.calls[0][0]).toMatchObject({ cpus: 8, memoryMb: 16000, diskMb: DISK_MIB });
    expect(create.mock.calls[0][0]).not.toHaveProperty("sizeClass");
    expect(instance.sizing).toEqual({ ...XL, provenance: "adapter-declared", belowStandard: RAM_CAP_NOTE, memoryShortfallMiB: 384 });
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
    [{ sizeClass: "xl", memoryMb: 16000 }, "conflict"],
    [{ sizeClass: "2xl" }, "unsupported"],
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
