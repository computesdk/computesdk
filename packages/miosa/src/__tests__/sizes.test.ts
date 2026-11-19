/**
 * Standard sizes on MIOSA: named resource contracts picked with `size`.
 *
 * Ways the mapping could fail, each covered below:
 * - Wrong shape: a class lands on a contract below its profile (sm on a
 *   1 GiB shape) or on a bigger one than needed (md on `medium`).
 * - Wrong disk: `resolved.diskMiB` disagrees with the contract's fixed disk.
 * - Silent default boot: `size` never reaches POST /sandboxes, so MIOSA
 *   boots its `small` default for every class.
 * - Dropped field: the account fallback (or a template create) strips
 *   `size`, or the legacy CPU/RAM hint logic overwrites it.
 * - Regional endpoint: a non-xs size is served by the runner (which only
 *   runs xs) instead of falling back to the account API with `size` intact.
 * - Clamped request: `3xl` is quietly turned into `xl` (16 vCPU / 32 GiB)
 *   like the legacy hint mapping does.
 * - Conflict accepted: sizeClass combined with a native size, CPU, memory
 *   or disk field is not rejected, so two shapes compete.
 * - Snapshot restore accepted: sizeClass with snapshotId pretends to size a
 *   sandbox whose resources come from the snapshot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MIOSA_SIZE_CONTRACTS, miosa } from "../index";
import type { MiosaSandboxRecord } from "../index";

const runnerSpies = vi.hoisted(() => ({
  createSandbox: vi.fn(),
  fallbackCreate: undefined as
    | ((params: Record<string, unknown>) => Promise<unknown>)
    | undefined,
}));

vi.mock("@miosa/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@miosa/sdk")>();
  return {
    ...actual,
    RunnerClient: vi
      .fn()
      .mockImplementation(
        (options: { fallbackCreate?: (params: Record<string, unknown>) => Promise<unknown> }) => {
          runnerSpies.fallbackCreate = options.fallbackCreate;
          return {
            createSandbox: runnerSpies.createSandbox,
            get: vi.fn().mockResolvedValue({ state: "ready" }),
            close: vi.fn().mockResolvedValue(undefined),
          };
        },
      ),
  };
});

const API_KEY = "msk_test_0123456789abcdef";

function sandboxRecord(): MiosaSandboxRecord {
  return {
    id: "a1b2c3d4-0000-0000-0000-000000000001",
    slug: "a1b2c3d4",
    name: "test-sandbox",
    state: "running",
    template_id: "miosa-sandbox",
    cpu_count: 2,
    memory_mb: 4096,
    timeout_sec: 300,
    metadata: { slug: "a1b2c3d4" },
    preview_url: "https://a1b2c3d4.miosa.ai",
    preview_domain: "miosa.ai",
    created_at: "2026-07-11T00:00:00Z",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const EXPECTED = {
  xs: { size: "xs", vcpus: 1, memoryMiB: 2048, diskMiB: 10240 },
  sm: { size: "xs", vcpus: 1, memoryMiB: 2048, diskMiB: 10240 },
  md: { size: "small", vcpus: 2, memoryMiB: 4096, diskMiB: 10240 },
  lg: { size: "medium", vcpus: 4, memoryMiB: 8192, diskMiB: 20480 },
  xl: { size: "large", vcpus: 8, memoryMiB: 16384, diskMiB: 40960 },
  "2xl": { size: "xl", vcpus: 16, memoryMiB: 32768, diskMiB: 81920 },
} as const;

describe("miosa standard sizes", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.MIOSA_RUNNER_MODE = "0";
    fetchMock = vi.fn().mockImplementation(async () => jsonResponse(sandboxRecord(), 201));
    vi.stubGlobal("fetch", fetchMock);
    runnerSpies.createSandbox.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MIOSA_RUNNER_MODE;
  });

  const provider = () => miosa({ apiKey: API_KEY });
  const createBody = (): Record<string, unknown> => {
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith("/sandboxes") && (init as RequestInit)?.method === "POST",
    );
    if (!call) throw new Error("POST /sandboxes was not called");
    return JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;
  };

  describe("resolve", () => {
    for (const [sizeClass, shape] of Object.entries(EXPECTED)) {
      it(`maps ${sizeClass} to the ${shape.size} contract`, async () => {
        const resolution = await provider().sizes.resolve(sizeClass as keyof typeof EXPECTED);
        expect(resolution).toMatchObject({
          status: "supported",
          nativeOptions: { size: shape.size },
          resolved: { vcpus: shape.vcpus, memoryMiB: shape.memoryMiB, diskMiB: shape.diskMiB },
        });
        expect(Object.keys((resolution as { nativeOptions: object }).nativeOptions)).toEqual(["size"]);
      });
    }

    it("exports exactly the expected contracts", () => {
      expect(MIOSA_SIZE_CONTRACTS).toEqual(EXPECTED);
    });

    it("refuses 3xl instead of clamping to xl", async () => {
      const resolution = await provider().sizes.resolve("3xl");
      expect(resolution).toMatchObject({ status: "unsupported", reason: expect.stringMatching(/largest/) });
      expect(resolution).not.toHaveProperty("nativeOptions");
    });
  });

  describe("create", () => {
    for (const [sizeClass, shape] of Object.entries(EXPECTED)) {
      it(`sends size=${shape.size} for ${sizeClass}`, async () => {
        const sandbox = await provider().instances.create({
          sizeClass: sizeClass as keyof typeof EXPECTED,
        });
        const body = createBody();
        expect(body.size).toBe(shape.size);
        expect(body).not.toHaveProperty("sizeClass");
        expect(body).not.toHaveProperty("cpu_count");
        expect(body).not.toHaveProperty("memory_mb");
        expect(sandbox.sizing).toMatchObject({
          requested: { sizeClass },
          resolved: { vcpus: shape.vcpus, memoryMiB: shape.memoryMiB, diskMiB: shape.diskMiB },
        });
      });
    }

    it("keeps size alongside a template", async () => {
      await provider().instances.create({ sizeClass: "lg", templateId: "node-22" });
      expect(createBody()).toMatchObject({ size: "medium", template_id: "node-22" });
    });

    it("forwards a native size without sizeClass", async () => {
      await provider().instances.create({ size: "large" } as never);
      expect(createBody().size).toBe("large");
    });

    it("never boots for an unsupported class", async () => {
      await expect(provider().instances.create({ sizeClass: "3xl" })).rejects.toMatchObject({
        code: "unsupported",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refuses sizeClass with a snapshot restore", async () => {
      await expect(
        provider().instances.create({ sizeClass: "md", snapshotId: "snap-1" }),
      ).rejects.toMatchObject({ code: "unsupported" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    for (const field of [
      "size", "vcpus", "cpus", "cpu", "memory", "memoryMiB", "memoryMb",
      "cpu_count", "cpuCount", "memory_mb", "disk_size_mb", "diskSizeMb", "disk_mb", "diskMb",
    ]) {
      it(`rejects sizeClass combined with ${field}`, async () => {
        await expect(
          provider().instances.create({ sizeClass: "md", [field]: field === "size" ? "large" : 4 } as never),
        ).rejects.toMatchObject({ code: "conflict" });
        expect(fetchMock).not.toHaveBeenCalled();
      });
    }
  });

  describe("regional endpoint", () => {
    beforeEach(() => {
      delete process.env.MIOSA_RUNNER_MODE;
    });

    it("hands size to the runner, and its account fallback keeps it", async () => {
      runnerSpies.createSandbox.mockImplementation(async (params: Record<string, unknown>) => {
        // The SDK runner serves xs only; anything else goes to fallbackCreate.
        expect(params.size).toBe("large");
        const record = await runnerSpies.fallbackCreate!(params);
        return { id: sandboxRecord().id, runnerUrl: "", data: record };
      });
      await provider().instances.create({ sizeClass: "xl" });
      expect(runnerSpies.createSandbox).toHaveBeenCalledTimes(1);
      expect(createBody().size).toBe("large");
    });
  });
});
