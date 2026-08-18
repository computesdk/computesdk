import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeMiosaConnections, miosa, DEFAULT_BASE_URL } from "../index";
import type { MiosaSandboxRecord } from "../index";

const API_KEY = "msk_test_0123456789abcdef";

function sandboxRecord(
  overrides: Partial<MiosaSandboxRecord> = {},
): MiosaSandboxRecord {
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
    ...overrides,
  };
}

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function lastRequest(fetchMock: FetchMock): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error("fetch was not called");
  return { url: String(call[0]), init: (call[1] ?? {}) as RequestInit };
}

function requestBody(fetchMock: FetchMock): Record<string, unknown> {
  const { init } = lastRequest(fetchMock);
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe("miosa provider", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("configuration", () => {
    it("should reject a missing API key when creating", async () => {
      const provider = miosa({});
      delete process.env.MIOSA_API_KEY;
      await expect(provider.sandbox.create()).rejects.toThrow(
        /Missing MIOSA API key/,
      );
    });

    it("should reject a non-msk key", async () => {
      const provider = miosa({ apiKey: "e2b_wrong_provider" });
      await expect(provider.sandbox.create()).rejects.toThrow(
        /start with 'msk_'/,
      );
    });

    it("should honor a custom baseUrl", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(sandboxRecord(), 201));
      const provider = miosa({
        apiKey: API_KEY,
        baseUrl: "https://api.acme.dev/api/v1/",
      });
      await provider.sandbox.create();
      expect(lastRequest(fetchMock).url).toBe(
        "https://api.acme.dev/api/v1/sandboxes",
      );
    });
  });

  describe("sandbox.create", () => {
    it("should POST /sandboxes and wait for command readiness", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(sandboxRecord(), 201));
      const provider = miosa({ apiKey: API_KEY });

      const sandbox = await provider.sandbox.create({
        templateId: "node-22",
        name: "ci-run",
        envs: { FOO: "bar" },
        metadata: { job: "42" },
        timeout: 120_000,
      });

      const { url, init } = lastRequest(fetchMock);
      expect(url).toBe(`${DEFAULT_BASE_URL}/sandboxes`);
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>).authorization).toBe(
        `Bearer ${API_KEY}`,
      );
      expect(requestBody(fetchMock)).toEqual({
        wait: true,
        response_format: "compact",
        persistent: false,
        timeout_sec: 120,
        template_id: "node-22",
        name: "ci-run",
        env: { FOO: "bar" },
        metadata: { job: "42" },
      });
      expect(sandbox.sandboxId).toBe("a1b2c3d4-0000-0000-0000-000000000001");
      expect(sandbox.provider).toBe("miosa");
    });

    it("should map snapshotId to snapshot_id", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(sandboxRecord(), 201));
      const provider = miosa({ apiKey: API_KEY });
      await provider.sandbox.create({ snapshotId: "snap-123" });
      expect(requestBody(fetchMock).snapshot_id).toBe("snap-123");
    });

    it("should surface API error codes", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: { code: "TENANT_RESOLUTION_FAILED" } }, 422),
      );
      const provider = miosa({ apiKey: API_KEY });
      await expect(provider.sandbox.create()).rejects.toThrow(
        /TENANT_RESOLUTION_FAILED/,
      );
    });
  });

  describe("sandbox.getById", () => {
    it("should GET /sandboxes/:id", async () => {
      const record = sandboxRecord();
      fetchMock.mockResolvedValueOnce(jsonResponse(record));
      const provider = miosa({ apiKey: API_KEY });

      const sandbox = await provider.sandbox.getById(record.id);
      const { url, init } = lastRequest(fetchMock);
      expect(url).toBe(`${DEFAULT_BASE_URL}/sandboxes/${record.id}`);
      expect(init.method).toBe("GET");
      expect(sandbox?.sandboxId).toBe(record.id);
    });

    it("should return null on 404", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: { code: "NOT_FOUND" } }, 404),
      );
      const provider = miosa({ apiKey: API_KEY });
      expect(await provider.sandbox.getById("missing-id")).toBeNull();
    });
  });

  describe("sandbox.list", () => {
    it("should GET /sandboxes and unwrap data", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          data: [sandboxRecord(), sandboxRecord({ id: "other-id" })],
        }),
      );
      const provider = miosa({ apiKey: API_KEY });

      const sandboxes = await provider.sandbox.list();
      expect(lastRequest(fetchMock).url).toBe(`${DEFAULT_BASE_URL}/sandboxes`);
      expect(sandboxes).toHaveLength(2);
      expect(sandboxes[1]?.sandboxId).toBe("other-id");
    });
  });

  describe("sandbox.destroy", () => {
    it("should DELETE /sandboxes/:id", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ id: "x", state: "destroyed" }),
      );
      const provider = miosa({ apiKey: API_KEY });

      await provider.sandbox.destroy("x");
      const { url, init } = lastRequest(fetchMock);
      expect(url).toBe(`${DEFAULT_BASE_URL}/sandboxes/x`);
      expect(init.method).toBe("DELETE");
    });

    it("should treat 404 as already destroyed", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: { code: "NOT_FOUND" } }, 404),
      );
      const provider = miosa({ apiKey: API_KEY });
      await expect(provider.sandbox.destroy("gone")).resolves.toBeUndefined();
    });
  });

  describe("runCommand", () => {
    async function createSandbox() {
      fetchMock.mockResolvedValueOnce(jsonResponse(sandboxRecord(), 201));
      const provider = miosa({ apiKey: API_KEY });
      return provider.sandbox.create();
    }

    it("should POST /sandboxes/:id/exec with command, cwd, env, and timeout in seconds", async () => {
      const sandbox = await createSandbox();
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ data: { stdout: "hello\n", stderr: "", exit_code: 0 } }),
      );

      const result = await sandbox.runCommand("echo hello", {
        cwd: "/workspace",
        env: { NODE_ENV: "test" },
        timeout: 30_000,
      });

      const { url } = lastRequest(fetchMock);
      expect(url).toBe(
        `${DEFAULT_BASE_URL}/sandboxes/${sandbox.sandboxId}/exec`,
      );
      expect(requestBody(fetchMock)).toEqual({
        command: "echo hello",
        wait: true,
        wait_timeout_ms: 30_000,
        cwd: "/workspace",
        env: { NODE_ENV: "test" },
        timeout: 30,
      });
      expect(result.stdout).toBe("hello\n");
      expect(result.exitCode).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should wrap background commands in nohup", async () => {
      const sandbox = await createSandbox();
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ data: { stdout: "", stderr: "", exit_code: 0 } }),
      );

      await sandbox.runCommand("sleep 100", { background: true });
      expect(requestBody(fetchMock).command).toBe(
        "nohup sleep 100 > /dev/null 2>&1 &",
      );
      expect(requestBody(fetchMock).wait).toBe(true);
      expect(requestBody(fetchMock).wait_timeout_ms).toBe(120_000);
    });

    it("should return exitCode 127 with the error on API failure", async () => {
      const sandbox = await createSandbox();
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: { code: "SANDBOX_NOT_RUNNING" } }, 409),
      );

      const result = await sandbox.runCommand("echo hi");
      expect(result.exitCode).toBe(127);
      expect(result.stderr).toMatch(/SANDBOX_NOT_RUNNING/);
    });
  });

  describe("getInfo", () => {
    it("should map the refetched sandbox record to SandboxInfo", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(sandboxRecord(), 201));
      const provider = miosa({ apiKey: API_KEY });
      const sandbox = await provider.sandbox.create();

      fetchMock.mockResolvedValueOnce(jsonResponse(sandboxRecord()));
      const info = await sandbox.getInfo();

      expect(lastRequest(fetchMock).url).toBe(
        `${DEFAULT_BASE_URL}/sandboxes/${sandbox.sandboxId}`,
      );
      expect(lastRequest(fetchMock).init.method).toBe("GET");
      expect(info).toMatchObject({
        id: sandbox.sandboxId,
        provider: "miosa",
        status: "running",
        timeout: 300_000,
      });
      expect(info.metadata?.previewUrl).toBe("https://a1b2c3d4.miosa.ai");
    });

    it("should report live state rather than the cached create record", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(sandboxRecord(), 201));
      const provider = miosa({ apiKey: API_KEY });
      const sandbox = await provider.sandbox.create();

      // The sandbox stopped after create; the cached record still says running.
      fetchMock.mockResolvedValueOnce(
        jsonResponse(sandboxRecord({ state: "stopped" })),
      );

      const info = await sandbox.getInfo();
      expect(info.status).toBe("stopped");
    });

    it("should report a destroyed sandbox as stopped", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(sandboxRecord(), 201));
      const provider = miosa({ apiKey: API_KEY });
      const sandbox = await provider.sandbox.create();

      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: { code: "NOT_FOUND" } }, 404),
      );

      const info = await sandbox.getInfo();
      expect(info.status).toBe("stopped");
      expect(info.id).toBe(sandbox.sandboxId);
    });

    it("should tolerate a compact record missing state and created_at", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(sandboxRecord(), 201));
      const provider = miosa({ apiKey: API_KEY });
      const sandbox = await provider.sandbox.create();

      const partial = sandboxRecord();
      delete (partial as Partial<MiosaSandboxRecord>).state;
      delete (partial as Partial<MiosaSandboxRecord>).created_at;
      fetchMock.mockResolvedValueOnce(jsonResponse(partial));

      const info = await sandbox.getInfo();
      expect(info.status).toBe("stopped");
      expect(Number.isNaN(info.createdAt.getTime())).toBe(false);
    });
  });

  describe("connection pooling", () => {
    it("should expose a disposal hook that is safe to call with no pool", () => {
      expect(() => closeMiosaConnections()).not.toThrow();
    });
  });

  describe("getUrl", () => {
    it("should POST /sandboxes/:id/expose and return the server-resolved URL", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(sandboxRecord(), 201));
      const provider = miosa({ apiKey: API_KEY });
      const sandbox = await provider.sandbox.create();

      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          url: "https://3000-a1b2c3d4.miosa.ai",
          preview_id: "p1",
          ready: true,
        }),
      );
      const url = await sandbox.getUrl({ port: 3000 });

      expect(lastRequest(fetchMock).url).toBe(
        `${DEFAULT_BASE_URL}/sandboxes/${sandbox.sandboxId}/expose`,
      );
      expect(requestBody(fetchMock)).toEqual({ port: 3000 });
      expect(url).toBe("https://3000-a1b2c3d4.miosa.ai");
    });
  });

  describe("filesystem", () => {
    async function createSandbox() {
      fetchMock.mockResolvedValueOnce(jsonResponse(sandboxRecord(), 201));
      const provider = miosa({ apiKey: API_KEY });
      return provider.sandbox.create();
    }

    it("readFile should GET /fs/read with encoded path", async () => {
      const sandbox = await createSandbox();
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ path: "/a b.txt", content: "data" }),
      );

      const content = await sandbox.filesystem.readFile("/a b.txt");
      expect(lastRequest(fetchMock).url).toBe(
        `${DEFAULT_BASE_URL}/sandboxes/${sandbox.sandboxId}/fs/read?path=${encodeURIComponent("/a b.txt")}`,
      );
      expect(content).toBe("data");
    });

    it("writeFile should POST /fs/write with path and content", async () => {
      const sandbox = await createSandbox();
      fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }, 201));

      await sandbox.filesystem.writeFile("/workspace/app.js", "console.log(1)");
      expect(lastRequest(fetchMock).url).toBe(
        `${DEFAULT_BASE_URL}/sandboxes/${sandbox.sandboxId}/fs/write`,
      );
      expect(requestBody(fetchMock)).toEqual({
        path: "/workspace/app.js",
        content: "console.log(1)",
      });
    });

    it("mkdir should POST /fs/mkdir with recursive=true", async () => {
      const sandbox = await createSandbox();
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: {} }, 201));

      await sandbox.filesystem.mkdir("/workspace/deep/dir");
      expect(lastRequest(fetchMock).url).toBe(
        `${DEFAULT_BASE_URL}/sandboxes/${sandbox.sandboxId}/fs/mkdir`,
      );
      expect(requestBody(fetchMock)).toEqual({
        path: "/workspace/deep/dir",
        recursive: true,
      });
    });

    it("readdir should GET /fs and map file entries", async () => {
      const sandbox = await createSandbox();
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          path: "/workspace",
          files: [
            {
              name: "src",
              type: "directory",
              size_bytes: 0,
              modified_at: "2026-07-11T00:00:00Z",
            },
            {
              name: "app.js",
              type: "file",
              size_bytes: 42,
              modified_at: "2026-07-11T01:00:00Z",
            },
          ],
        }),
      );

      const entries = await sandbox.filesystem.readdir("/workspace");
      expect(lastRequest(fetchMock).url).toBe(
        `${DEFAULT_BASE_URL}/sandboxes/${sandbox.sandboxId}/fs?path=%2Fworkspace`,
      );
      expect(entries).toEqual([
        {
          name: "src",
          type: "directory",
          size: 0,
          modified: new Date("2026-07-11T00:00:00Z"),
        },
        {
          name: "app.js",
          type: "file",
          size: 42,
          modified: new Date("2026-07-11T01:00:00Z"),
        },
      ]);
    });

    it("exists should compose from exec test -e and read the exit code", async () => {
      const sandbox = await createSandbox();
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ data: { stdout: "", stderr: "", exit_code: 0 } }),
      );
      expect(await sandbox.filesystem.exists("/workspace/app.js")).toBe(true);
      expect(lastRequest(fetchMock).url).toBe(
        `${DEFAULT_BASE_URL}/sandboxes/${sandbox.sandboxId}/exec`,
      );
      expect(requestBody(fetchMock).command).toBe(
        'test -e "/workspace/app.js"',
      );

      fetchMock.mockResolvedValueOnce(
        jsonResponse({ data: { stdout: "", stderr: "", exit_code: 1 } }),
      );
      expect(await sandbox.filesystem.exists("/nope")).toBe(false);
    });

    it("remove should DELETE /fs with encoded path", async () => {
      const sandbox = await createSandbox();
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ success: true, path: "/tmp/x" }),
      );

      await sandbox.filesystem.remove("/tmp/x");
      const { url, init } = lastRequest(fetchMock);
      expect(url).toBe(
        `${DEFAULT_BASE_URL}/sandboxes/${sandbox.sandboxId}/fs?path=%2Ftmp%2Fx`,
      );
      expect(init.method).toBe("DELETE");
    });
  });

  describe("snapshots", () => {
    it("create should POST /sandboxes/:id/snapshots with the name as comment", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          { data: { id: "snap-1", sandbox_id: "sb-1", status: "pending" } },
          201,
        ),
      );
      const provider = miosa({ apiKey: API_KEY });

      const snapshot = await provider.snapshot?.create("sb-1", {
        name: "before-upgrade",
      });
      expect(lastRequest(fetchMock).url).toBe(
        `${DEFAULT_BASE_URL}/sandboxes/sb-1/snapshots`,
      );
      expect(requestBody(fetchMock)).toEqual({ comment: "before-upgrade" });
      expect(snapshot?.id).toBe("snap-1");
    });

    it("list should require a sandboxId scope", async () => {
      const provider = miosa({ apiKey: API_KEY });
      await expect(provider.snapshot!.list()).rejects.toThrow(
        /scoped per sandbox/,
      );
    });

    it("list should GET /sandboxes/:id/snapshots", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ data: [{ id: "snap-1" }] }),
      );
      const provider = miosa({ apiKey: API_KEY });

      const snapshots = await provider.snapshot!.list({ sandboxId: "sb-1" });
      expect(lastRequest(fetchMock).url).toBe(
        `${DEFAULT_BASE_URL}/sandboxes/sb-1/snapshots`,
      );
      expect(snapshots).toHaveLength(1);
    });
  });
});
