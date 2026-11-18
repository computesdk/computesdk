import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateosSandboxClient } from "@nodeops-createos/sandbox";
import type { Sandbox } from "@nodeops-createos/sandbox";
import { createosSandbox, CREATEOS_SIZE_SHAPES } from "../index.js";

/*
 * Ways the CreateOS standard-size mapping could fail (each is covered below):
 *  1. Wrong shape: a class maps to a shape below its profile (e.g. sm → s-2vcpu-2gb is fine,
 *     but md → s-2vcpu-2gb, or xs → the 50%-quota s-0.5vcpu-1gb, would be under-provisioned),
 *     or to a bigger shape than the smallest one that fits.
 *  2. Silent default boot: `shape` never reaches `createSandbox`, so the adapter falls back to
 *     its 1 vCPU / 1 GiB FALLBACK_SHAPE, or to the live-catalog pick that clamps oversized
 *     requests to the largest shape.
 *  3. Unlisted classes (2xl, 3xl) resolve as supported, or boot the largest shape instead of
 *     refusing before any API call.
 *  4. Dropped field: the platform disk (`ephemeralDiskMb`) never becomes `disk_mib`, or the
 *     resolved shape omits the disk the sandbox actually gets.
 *  5. Snapshot path: `snapshotId` forks the paused source, whose shape the fork request cannot
 *     change, so a size request there would silently boot the snapshot's size.
 *  6. Conflict accepted: a native `shape` (or cpus/memoryMb) alongside sizeClass wins or is
 *     ignored instead of raising InstanceSizeError('conflict').
 *  7. A caller's explicit `ephemeralDiskMb` is overwritten by the platform disk.
 *  8. Discovery has side effects: list/resolve hit the catalog or create API.
 */

const PROFILES = [
  ["xs", 1, 1024, "s-1vcpu-1gb", undefined, 10240],
  ["sm", 1, 2048, "s-1vcpu-2gb", 10240, 10240],
  ["md", 2, 4096, "s-2vcpu-4gb", 20480, 20480],
  ["lg", 4, 8192, "s-4vcpu-8gb", 40960, 40960],
  ["xl", 8, 16384, "s-8vcpu-16gb", 61440, 61440],
] as const;

const config = { apiKey: "test-key", baseUrl: "https://createos.test" };

function mockClient() {
  const sandbox = { id: "sb-1", destroy: vi.fn(async () => {}) } as unknown as Sandbox;
  const createSandbox = vi.spyOn(CreateosSandboxClient.prototype, "createSandbox").mockResolvedValue(sandbox);
  const listShapes = vi.spyOn(CreateosSandboxClient.prototype, "listShapes").mockResolvedValue([]);
  const getSandbox = vi.spyOn(CreateosSandboxClient.prototype, "getSandbox").mockResolvedValue(sandbox);
  return { createSandbox, listShapes, getSandbox };
}

describe("CreateOS standard size mapping (mock-only)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists xs-xl as supported and refuses 2xl/3xl, without API calls", () => {
    const { createSandbox, listShapes } = mockClient();
    const sizes = createosSandbox(config).sizes;
    const list = sizes.list();
    expect(list.filter((r) => r.status === "supported").map((r) => r.requested.sizeClass)).toEqual([
      "xs", "sm", "md", "lg", "xl",
    ]);
    for (const sizeClass of ["2xl", "3xl"] as const) {
      const r = sizes.resolve(sizeClass);
      expect(r.status).toBe("unsupported");
      expect(r.status !== "supported" && r.reason).toMatch(/s-8vcpu-16gb/);
    }
    expect(createSandbox).not.toHaveBeenCalled();
    expect(listShapes).not.toHaveBeenCalled();
  });

  it("maps every supported class to a listed shape that meets its profile", () => {
    for (const [sizeClass, vcpus, memoryMiB, shape] of PROFILES) {
      expect(CREATEOS_SIZE_SHAPES[sizeClass]).toMatchObject({ id: shape });
      const r = createosSandbox(config).sizes.resolve(sizeClass);
      expect(r.status).toBe("supported");
      if (r.status !== "supported") continue;
      expect(r.resolved.vcpus).toBeGreaterThanOrEqual(vcpus);
      expect(r.resolved.memoryMiB).toBeGreaterThanOrEqual(memoryMiB);
      expect(r.belowStandard).toBeUndefined();
    }
  });

  it.each(PROFILES)(
    "boots %s on its shape with the platform disk",
    async (sizeClass, vcpus, memoryMiB, shape, nativeDisk, diskMiB) => {
      const { createSandbox, listShapes } = mockClient();
      const result = await createosSandbox(config).instances.create({ sizeClass });
      expect(listShapes).not.toHaveBeenCalled();
      expect(createSandbox).toHaveBeenCalledTimes(1);
      const body = createSandbox.mock.calls[0]![0];
      expect(body.shape).toBe(shape);
      expect(body.disk_mib).toBe(nativeDisk);
      expect(body).not.toHaveProperty("sizeClass");
      expect(result.sizing).toEqual({
        requested: { sizeClass, vcpus, memoryMiB },
        resolved: { vcpus, memoryMiB, diskMiB },
        provenance: "adapter-declared",
      });
    },
  );

  it("emits the shape and disk as native options", () => {
    const r = createosSandbox(config).sizes.resolve("md");
    expect(r.status === "supported" && r.nativeOptions).toEqual({ shape: "s-2vcpu-4gb", ephemeralDiskMb: 20480 });
    const xs = createosSandbox(config).sizes.resolve("xs");
    expect(xs.status === "supported" && xs.nativeOptions).toEqual({ shape: "s-1vcpu-1gb" });
  });

  it("keeps a caller's explicit disk and reports it", async () => {
    const { createSandbox } = mockClient();
    const result = await createosSandbox(config).instances.create({ sizeClass: "lg", ephemeralDiskMb: 15360 } as never);
    expect(createSandbox.mock.calls[0]![0]).toMatchObject({ shape: "s-4vcpu-8gb", disk_mib: 15360 });
    expect(result.sizing?.resolved).toEqual({ vcpus: 4, memoryMiB: 8192, diskMiB: 15360 });
  });

  it("overrides a config default shape", async () => {
    const { createSandbox } = mockClient();
    await createosSandbox({ ...config, shape: "s-1vcpu-256mb" }).instances.create({ sizeClass: "xl" });
    expect(createSandbox.mock.calls[0]![0].shape).toBe("s-8vcpu-16gb");
  });

  it.each([
    [{ sizeClass: "md", shape: "s-4vcpu-4gb" }, "conflict"],
    [{ sizeClass: "md", cpus: 2 }, "conflict"],
    [{ sizeClass: "md", memoryMb: 4096 }, "conflict"],
    [{ sizeClass: "md", snapshotId: "sb-paused" }, "unsupported"],
    [{ sizeClass: "2xl" }, "unsupported"],
    [{ sizeClass: "3xl" }, "unsupported"],
  ] as const)("rejects %j before any API call (%s)", async (options, code) => {
    const { createSandbox, listShapes, getSandbox } = mockClient();
    await expect(createosSandbox(config).instances.create(options as never)).rejects.toMatchObject({
      name: "InstanceSizeError",
      code,
      fallback: false,
    });
    expect(createSandbox).not.toHaveBeenCalled();
    expect(listShapes).not.toHaveBeenCalled();
    expect(getSandbox).not.toHaveBeenCalled();
  });

  it("leaves unsized creates on the legacy path", async () => {
    const { createSandbox } = mockClient();
    const result = await createosSandbox(config).instances.create({});
    expect(createSandbox.mock.calls[0]![0].shape).toBe("s-1vcpu-1gb");
    expect(createSandbox.mock.calls[0]![0]).not.toHaveProperty("disk_mib");
    expect(result.sizing).toBeUndefined();
  });
});
