import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compute } from "computesdk";

const guards = vi.hoisted(() => ({
  http2Connect: vi.fn(() => { throw new Error("Unexpected HTTP/2 connection"); }),
  runner: vi.fn(() => { throw new Error("Unexpected native runner"); }),
}));

vi.mock("node:http2", () => ({ connect: guards.http2Connect }));
vi.mock("../runner-entry", () => ({ RunnerClient: guards.runner }));

const BASE_URL = "https://miosa.example.test/api/v1";
const OWNER_ID = "snapshot-source";
const CREATED_AT = "2026-07-11T01:02:03.456Z";
const nativeSnapshot = {
  id: "snapshot-boundary",
  sandbox_id: OWNER_ID,
  status: "ready",
  comment: "boundary fixture",
  created_at: CREATED_AT,
  size_bytes: 4096,
};

describe("Miosa snapshots through ComputeSDK", () => {
  let providerModule: typeof import("../index");
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    guards.http2Connect.mockClear();
    guards.runner.mockClear();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("MIOSA_PRECONNECT", "0");
    vi.stubEnv("MIOSA_API_KEY", "");
    vi.stubEnv("MIOSA_BASE_URL", BASE_URL);
    vi.stubEnv("MIOSA_RUNNER_MODE", "0");
    fetchMock = vi.fn();
    fetchMock.mockImplementation(() => { throw new Error("Unexpected fetch request"); });
    vi.stubGlobal("fetch", fetchMock);
    providerModule = await import("../index");
  });

  afterEach(() => {
    providerModule.closeMiosaConnections();
    expect(guards.http2Connect).not.toHaveBeenCalled();
    expect(guards.runner).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function sdk() {
    return compute({
      provider: providerModule.miosa({
        apiKey: "msk_mock_snapshot_boundary",
        baseUrl: BASE_URL,
        runnerMode: false,
      }),
    });
  }

  it.each(["instanceId", "sandboxId"] as const)(
    "should preserve native fields and expose exact common fields for %s listing",
    async (scope) => {
      fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
        expect(url).toBe(`${BASE_URL}/sandboxes/${OWNER_ID}/snapshots`);
        expect(init.method).toBe("GET");
        return new Response(JSON.stringify({ data: [nativeSnapshot] }));
      });

      const snapshots = await sdk().snapshot.list({ [scope]: OWNER_ID });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(snapshots).toEqual([{
        ...nativeSnapshot,
        provider: "miosa",
        createdAt: new Date(CREATED_AT),
        instanceId: OWNER_ID,
        sandboxId: OWNER_ID,
      }]);
      expect(snapshots[0].createdAt.toISOString()).toBe(CREATED_AT);
    },
  );

  it.each(["instanceId", "sandboxId"] as const)(
    "should use the %s listing scope when the native record omits sandbox_id",
    async (scope) => {
      const record: Partial<typeof nativeSnapshot> = { ...nativeSnapshot };
      delete record.sandbox_id;
      fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
        expect(url).toBe(`${BASE_URL}/sandboxes/${OWNER_ID}/snapshots`);
        expect(init.method).toBe("GET");
        return new Response(JSON.stringify({ data: [record] }));
      });

      const snapshots = await sdk().snapshot.list({ [scope]: OWNER_ID });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(snapshots).toEqual([{
        ...record,
        provider: "miosa",
        createdAt: new Date(CREATED_AT),
        instanceId: OWNER_ID,
        sandboxId: OWNER_ID,
      }]);
      expect(snapshots[0].createdAt.toISOString()).toBe(CREATED_AT);
    },
  );

  it("should expose the same common fields when creating through ComputeSDK", async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      expect(url).toBe(`${BASE_URL}/sandboxes/${OWNER_ID}/snapshots`);
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual({ comment: "checkpoint" });
      return new Response(JSON.stringify({ data: nativeSnapshot }), { status: 201 });
    });

    const snapshot = await sdk().snapshot.create(OWNER_ID, { name: "checkpoint" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(snapshot).toEqual({
      ...nativeSnapshot,
      provider: "miosa",
      createdAt: new Date(CREATED_AT),
      instanceId: OWNER_ID,
      sandboxId: OWNER_ID,
    });
    expect(snapshot.createdAt.toISOString()).toBe(CREATED_AT);
  });

  function compactSnapshot(createdAt?: string) {
    const record: Partial<typeof nativeSnapshot> = { ...nativeSnapshot };
    delete record.created_at;
    if (createdAt !== undefined) record.created_at = createdAt;
    return record;
  }

  describe.each([undefined, "not-a-date"])("native created_at %j", (createdAt) => {
    it.each(["instanceId", "sandboxId"] as const)(
      "should hydrate only the date for %s listing without discarding records or changing status",
      async (scope) => {
        const compact = { ...compactSnapshot(createdAt), id: "snapshot-compact", status: "uploading" };
        fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
          expect(init.method).toBe("GET");
          if (url === `${BASE_URL}/sandboxes/${OWNER_ID}/snapshots`) {
            return new Response(JSON.stringify({ data: [nativeSnapshot, compact] }));
          }
          expect(url).toBe(`${BASE_URL}/snapshots/${compact.id}`);
          return new Response(JSON.stringify({ data: { ...nativeSnapshot, id: compact.id }, dependents: [] }));
        });

        const snapshots = await sdk().snapshot.list({ [scope]: OWNER_ID });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(snapshots).toEqual([nativeSnapshot, compact].map((record) => ({
          ...record,
          provider: "miosa",
          instanceId: OWNER_ID,
          sandboxId: OWNER_ID,
          createdAt: new Date(CREATED_AT),
        })));
        expect(snapshots[1].createdAt.toISOString()).toBe(CREATED_AT);
      },
    );

    it("should hydrate compact creation only after native readiness has completed", async () => {
      const compact = compactSnapshot(createdAt);
      fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
        if (url === `${BASE_URL}/sandboxes/${OWNER_ID}/snapshots`) {
          if (init.method === "POST") {
            return new Response(JSON.stringify({ data: { ...compact, status: "pending" } }), { status: 201 });
          }
          expect(init.method).toBe("GET");
          return new Response(JSON.stringify({ data: [compact] }));
        }
        expect(url).toBe(`${BASE_URL}/snapshots/${nativeSnapshot.id}`);
        expect(init.method).toBe("GET");
        return new Response(JSON.stringify({ data: nativeSnapshot, dependents: [] }));
      });

      const snapshot = await sdk().snapshot.create(OWNER_ID);

      expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
        [`${BASE_URL}/sandboxes/${OWNER_ID}/snapshots`, "POST"],
        [`${BASE_URL}/sandboxes/${OWNER_ID}/snapshots`, "GET"],
        [`${BASE_URL}/snapshots/${nativeSnapshot.id}`, "GET"],
      ]);
      expect(snapshot).toEqual({
        ...compact,
        provider: "miosa",
        createdAt: new Date(CREATED_AT),
        instanceId: OWNER_ID,
        sandboxId: OWNER_ID,
      });
      expect(snapshot.createdAt.toISOString()).toBe(CREATED_AT);
    });

    it("should report unavailable native date metadata explicitly, not return an Invalid Date", async () => {
      const compact = compactSnapshot(createdAt);
      fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
        expect(init.method).toBe("GET");
        if (url === `${BASE_URL}/sandboxes/${OWNER_ID}/snapshots`) {
          return new Response(JSON.stringify({ data: [compact] }));
        }
        expect(url).toBe(`${BASE_URL}/snapshots/${nativeSnapshot.id}`);
        return new Response(JSON.stringify({ data: compact, dependents: [] }));
      });

      await expect(sdk().snapshot.list({ instanceId: OWNER_ID })).rejects.toThrow(
        /snapshot-boundary.*valid creation date/,
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
