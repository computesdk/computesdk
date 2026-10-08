import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock intercepts the `@miosa/sdk` specifier before module resolution so
// these tests run without the package's real transport. The spies live in
// vi.hoisted() because vi.mock's factory is hoisted above every import in
// this file, including the one below.
type FallbackCreate = (
  params: Record<string, unknown>,
) => Promise<{ id: string; runnerUrl: string; data: Record<string, unknown> }>;

const runnerSpies = vi.hoisted(() => ({
  createSandbox: vi.fn(),
  exec: vi.fn(),
  destroySandbox: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
  constructed: [] as Array<{
    apiKey: string;
    baseDomain?: string;
    fallbackCreate?: FallbackCreate;
  }>,
}));

vi.mock("@miosa/sdk", () => ({
  RunnerClient: vi
    .fn()
    .mockImplementation(
      (options: {
        apiKey: string;
        baseDomain?: string;
        fallbackCreate?: FallbackCreate;
      }) => {
        runnerSpies.constructed.push(options);
        return {
          createSandbox: runnerSpies.createSandbox,
          exec: runnerSpies.exec,
          destroySandbox: runnerSpies.destroySandbox,
          close: runnerSpies.close,
        };
      },
    ),
  // Mirrors the SDK's own classifier closely enough for the fallback path:
  // a transport-level failure means the request never landed.
  isConnectFailure: (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "ECONNREFUSED",
}));

import { closeMiosaRunnerConnections, miosa, DEFAULT_BASE_URL } from "../index";
import type { MiosaSandboxRecord } from "../index";

// The regional endpoint is the default transport, so every test that does
// not opt out reaches for the RunnerClient. Opting out is explicit:
// `runnerMode: false` or MIOSA_RUNNER_MODE=0.
const API_KEY = "msk_test_0123456789abcdef";

function sandboxRecord(
  overrides: Partial<MiosaSandboxRecord> = {}
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

describe("runner transport (RUNNER-CONTRACTS-2026-10-02.md C5/C6)", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    runnerSpies.createSandbox.mockReset();
    runnerSpies.exec.mockReset();
    runnerSpies.destroySandbox.mockReset();
    runnerSpies.constructed.length = 0;
    delete process.env.MIOSA_RUNNER_MODE;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    delete process.env.MIOSA_RUNNER_MODE;
    await closeMiosaRunnerConnections();
  });

  describe("eligibility", () => {
    it("should route through the regional endpoint by default", async () => {
      runnerSpies.createSandbox.mockResolvedValueOnce({
        id: sandboxRecord().id,
        runnerUrl: "https://3.run-us.miosa.ai",
        data: sandboxRecord(),
      });
      const provider = miosa({ apiKey: API_KEY });

      await provider.sandbox.create();

      expect(runnerSpies.createSandbox).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(runnerSpies.constructed[0]?.apiKey).toBe(API_KEY);
    });

    it("should opt out with runnerMode: false", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(sandboxRecord(), 201));
      const provider = miosa({ apiKey: API_KEY, runnerMode: false });

      await provider.sandbox.create();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(runnerSpies.createSandbox).not.toHaveBeenCalled();
    });

    it("should opt out with MIOSA_RUNNER_MODE=0", async () => {
      process.env.MIOSA_RUNNER_MODE = "0";
      fetchMock.mockResolvedValueOnce(jsonResponse(sandboxRecord(), 201));
      const provider = miosa({ apiKey: API_KEY });

      await provider.sandbox.create();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(runnerSpies.createSandbox).not.toHaveBeenCalled();
    });

    it("should keep the default when MIOSA_RUNNER_MODE is set but unrecognised", async () => {
      process.env.MIOSA_RUNNER_MODE = "";
      runnerSpies.createSandbox.mockResolvedValueOnce({
        id: sandboxRecord().id,
        runnerUrl: "https://3.run-us.miosa.ai",
        data: sandboxRecord(),
      });
      const provider = miosa({ apiKey: API_KEY });

      await provider.sandbox.create();

      expect(runnerSpies.createSandbox).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should route through the runner when runnerMode: true", async () => {
      runnerSpies.createSandbox.mockResolvedValueOnce({
        id: sandboxRecord().id,
        runnerUrl: "https://3.run-us.miosa.ai",
        data: sandboxRecord(),
      });
      const provider = miosa({ apiKey: API_KEY, runnerMode: true });

      await provider.sandbox.create();

      expect(runnerSpies.createSandbox).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(runnerSpies.constructed[0]?.apiKey).toBe(API_KEY);
    });

    it("should route through the runner when MIOSA_RUNNER_MODE=1", async () => {
      process.env.MIOSA_RUNNER_MODE = "1";
      runnerSpies.createSandbox.mockResolvedValueOnce({
        id: sandboxRecord().id,
        runnerUrl: "https://3.run-us.miosa.ai",
        data: sandboxRecord(),
      });
      const provider = miosa({ apiKey: API_KEY });

      await provider.sandbox.create();

      expect(runnerSpies.createSandbox).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should let an explicit runnerMode: false override MIOSA_RUNNER_MODE=1", async () => {
      process.env.MIOSA_RUNNER_MODE = "1";
      fetchMock.mockResolvedValueOnce(jsonResponse(sandboxRecord(), 201));
      const provider = miosa({ apiKey: API_KEY, runnerMode: false });

      await provider.sandbox.create();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(runnerSpies.createSandbox).not.toHaveBeenCalled();
    });

    it("should pass runnerBaseDomain through to the RunnerClient", async () => {
      runnerSpies.createSandbox.mockResolvedValueOnce({
        id: sandboxRecord().id,
        runnerUrl: "https://3.run-us.miosa.ai",
        data: sandboxRecord(),
      });
      const provider = miosa({
        apiKey: API_KEY,
        runnerMode: true,
        runnerBaseDomain: "run.staging.internal",
      });

      await provider.sandbox.create();

      expect(runnerSpies.constructed[0]?.baseDomain).toBe(
        "run.staging.internal"
      );
    });
  });

  describe("create", () => {
    it("should unwrap the runner's create response the same way as the control plane", async () => {
      const record = sandboxRecord();
      runnerSpies.createSandbox.mockResolvedValueOnce({
        id: record.id,
        runnerUrl: "https://3.run-us.miosa.ai",
        data: { data: record }, // control-plane-shaped body, per C2
      });
      const provider = miosa({ apiKey: API_KEY, runnerMode: true });

      const sandbox = await provider.sandbox.create({ name: "ci-run" });

      expect(sandbox.sandboxId).toBe(record.id);
      expect(sandbox.provider).toBe("miosa");
      expect(runnerSpies.createSandbox).toHaveBeenCalledWith(
        expect.objectContaining({ name: "ci-run", wait: true })
      );
    });

    it("should throw when the runner's create response carries no id", async () => {
      runnerSpies.createSandbox.mockResolvedValueOnce({
        id: "",
        runnerUrl: "https://3.run-us.miosa.ai",
        data: { state: "running" },
      });
      const provider = miosa({ apiKey: API_KEY, runnerMode: true });

      await expect(provider.sandbox.create()).rejects.toThrow(/without an id/);
    });

    it("should hand a shape the regional endpoint does not serve to the account API", async () => {
      const record = sandboxRecord();
      fetchMock.mockResolvedValueOnce(jsonResponse(record, 201));
      // The SDK routes shapes the regional endpoint does not carry straight
      // to fallbackCreate without reaching the network, so emulating that
      // call is how the wiring is exercised here.
      runnerSpies.createSandbox.mockImplementationOnce(async () => {
        const fallback = runnerSpies.constructed[0]?.fallbackCreate;
        if (!fallback) throw new Error("fallbackCreate was not wired");
        return await fallback({ size: "large" });
      });
      const provider = miosa({ apiKey: API_KEY });

      const sandbox = await provider.sandbox.create({
        vcpus: 8,
        memory: 16384,
      });

      expect(sandbox.sandboxId).toBe(record.id);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain("/sandboxes");
    });

    it("should keep exec and destroy on the account API for a fallback-created sandbox", async () => {
      const record = sandboxRecord();
      fetchMock
        .mockResolvedValueOnce(jsonResponse(record, 201))
        .mockResolvedValueOnce(
          jsonResponse({
            data: { stdout: "v20.20.2\n", stderr: "", exit_code: 0 },
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ data: {} }));
      runnerSpies.createSandbox.mockImplementationOnce(async () => {
        const fallback = runnerSpies.constructed[0]?.fallbackCreate;
        if (!fallback) throw new Error("fallbackCreate was not wired");
        return await fallback({ size: "large" });
      });
      const provider = miosa({ apiKey: API_KEY });

      const sandbox = await provider.sandbox.create({
        vcpus: 8,
        memory: 16384,
      });
      await sandbox.runCommand("node -v");
      await sandbox.destroy();

      // The sandbox lives on the account API, so nothing may address the
      // regional endpoint for it.
      expect(runnerSpies.exec).not.toHaveBeenCalled();
      expect(runnerSpies.destroySandbox).not.toHaveBeenCalled();
    });

    it("should use the account API when the regional endpoint is unreachable", async () => {
      const record = sandboxRecord();
      fetchMock.mockResolvedValueOnce(jsonResponse(record, 201));
      runnerSpies.createSandbox.mockRejectedValueOnce(
        Object.assign(new Error("connect ECONNREFUSED"), {
          code: "ECONNREFUSED",
        }),
      );
      const provider = miosa({ apiKey: API_KEY });

      const sandbox = await provider.sandbox.create();

      expect(sandbox.sandboxId).toBe(record.id);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("should not fall back after a sandbox exists - no double creates", async () => {
      runnerSpies.createSandbox.mockRejectedValueOnce(
        new Error("runner request failed with 503 runtime_busy"),
      );
      const provider = miosa({ apiKey: API_KEY });

      await expect(provider.sandbox.create()).rejects.toThrow(/runtime_busy/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("runCommand", () => {
    async function createRunnerSandbox() {
      runnerSpies.createSandbox.mockResolvedValueOnce({
        id: sandboxRecord().id,
        runnerUrl: "https://3.run-us.miosa.ai",
        data: sandboxRecord(),
      });
      const provider = miosa({ apiKey: API_KEY, runnerMode: true });
      return provider.sandbox.create();
    }

    it("should exec through the RunnerClient and unwrap a { data } response", async () => {
      const sandbox = await createRunnerSandbox();
      runnerSpies.exec.mockResolvedValueOnce({
        data: { stdout: "hello\n", stderr: "", exit_code: 0 },
      });

      const result = await sandbox.runCommand("echo hello", {
        cwd: "/workspace",
        env: { NODE_ENV: "test" },
        timeout: 30_000,
      });

      expect(runnerSpies.exec).toHaveBeenCalledWith(
        sandbox.sandboxId,
        "echo hello",
        { cwd: "/workspace", env: { NODE_ENV: "test" }, timeout: 30 }
      );
      expect(result.stdout).toBe("hello\n");
      expect(result.exitCode).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should unwrap a flat (non-data) runner exec response too", async () => {
      const sandbox = await createRunnerSandbox();
      runnerSpies.exec.mockResolvedValueOnce({
        stdout: "",
        stderr: "boom",
        exit_code: 1,
      });

      const result = await sandbox.runCommand("false");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("boom");
    });

    it("should return exitCode 127 with the error when the runner rejects", async () => {
      const sandbox = await createRunnerSandbox();
      runnerSpies.exec.mockRejectedValueOnce(
        new Error("runner request failed with 503 runtime_busy")
      );

      const result = await sandbox.runCommand("echo hi");
      expect(result.exitCode).toBe(127);
      expect(result.stderr).toMatch(/runtime_busy/);
    });
  });

  describe("destroy", () => {
    it("should destroy through the RunnerClient for a regionally-created sandbox", async () => {
      runnerSpies.createSandbox.mockResolvedValueOnce({
        id: sandboxRecord().id,
        runnerUrl: "https://3.run-us.miosa.ai",
        data: sandboxRecord(),
      });
      runnerSpies.destroySandbox.mockResolvedValueOnce(undefined);
      const provider = miosa({ apiKey: API_KEY, runnerMode: true });
      const sandbox = await provider.sandbox.create();

      await provider.sandbox.destroy(sandbox.sandboxId);

      expect(runnerSpies.destroySandbox).toHaveBeenCalledWith(
        sandbox.sandboxId
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should treat a sandbox missing from both endpoints as already destroyed", async () => {
      // Nothing this process created, and neither endpoint claims it: the
      // account API's 404 alone would not settle it, because a regional 404 is
      // what an account-owned sandbox looks like from the wrong endpoint.
      const notFound = Object.assign(
        new Error("runner request failed with 404"),
        { status: 404 }
      );
      runnerSpies.destroySandbox.mockRejectedValueOnce(notFound);
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: "not found" }, 404));
      const provider = miosa({ apiKey: API_KEY, runnerMode: true });

      await expect(provider.sandbox.destroy("gone")).resolves.toBeUndefined();

      expect(runnerSpies.destroySandbox).toHaveBeenCalledWith("gone");
    });

    it("should propagate a non-404 runner error", async () => {
      const forbidden = Object.assign(
        new Error("runner request failed with 403"),
        { status: 403 }
      );
      runnerSpies.destroySandbox.mockRejectedValueOnce(forbidden);
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: "not found" }, 404));
      const provider = miosa({ apiKey: API_KEY, runnerMode: true });

      await expect(provider.sandbox.destroy("sb-1")).rejects.toThrow(/403/);
    });

    it("should delete an untracked sandbox through the account API instead of trusting a regional 404", async () => {
      // The sandbox was created in another process, so there is no recorded
      // origin. The regional endpoint does not own it and answers 404 - which
      // used to be reported as success while the sandbox kept running.
      const notFound = Object.assign(
        new Error("runner request failed with 404"),
        { status: 404 }
      );
      runnerSpies.destroySandbox.mockRejectedValueOnce(notFound);
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: {} }));
      const provider = miosa({ apiKey: API_KEY, runnerMode: true });

      await provider.sandbox.destroy("sb-untracked");

      const [url, init] = fetchMock.mock.calls[0] as [string, { method: string }];
      expect(url).toBe(`${DEFAULT_BASE_URL}/sandboxes/sb-untracked`);
      expect(init.method).toBe("DELETE");
      expect(runnerSpies.destroySandbox).not.toHaveBeenCalled();
    });

    it("should keep the recorded origin when a destroy fails transiently", async () => {
      const record = sandboxRecord();
      fetchMock
        .mockResolvedValueOnce(jsonResponse(record, 201))
        .mockResolvedValueOnce(jsonResponse({ error: "runtime_busy" }, 503))
        .mockResolvedValueOnce(jsonResponse({ data: {} }));
      runnerSpies.createSandbox.mockImplementationOnce(async () => {
        const fallback = runnerSpies.constructed[0]?.fallbackCreate;
        if (!fallback) throw new Error("fallbackCreate was not wired");
        return await fallback({ size: "large" });
      });
      const provider = miosa({ apiKey: API_KEY });
      const sandbox = await provider.sandbox.create({ vcpus: 8, memory: 16384 });

      await expect(provider.sandbox.destroy(sandbox.sandboxId)).rejects.toThrow(
        /503/
      );
      await provider.sandbox.destroy(sandbox.sandboxId);

      // Both attempts reached the account API. Forgetting the origin after the
      // failure would have sent the retry to the regional endpoint, where a
      // 404 reads as "already destroyed".
      expect(runnerSpies.destroySandbox).not.toHaveBeenCalled();
      const deleteUrls = fetchMock.mock.calls
        .map((call) => String(call[0]))
        .filter((url) => url.endsWith(`/sandboxes/${sandbox.sandboxId}`));
      expect(deleteUrls).toHaveLength(2);
    });
  });

  describe("reattaching a sandbox created through the account API", () => {
    async function createFallbackSandbox(provider: ReturnType<typeof miosa>) {
      fetchMock.mockResolvedValueOnce(jsonResponse(sandboxRecord(), 201));
      runnerSpies.createSandbox.mockImplementationOnce(async () => {
        const fallback = runnerSpies.constructed[0]?.fallbackCreate;
        if (!fallback) throw new Error("fallbackCreate was not wired");
        return await fallback({ size: "large" });
      });
      return provider.sandbox.create({ vcpus: 8, memory: 16384 });
    }

    it("should keep a fallback-created sandbox on the account API when it is fetched by id", async () => {
      const record = sandboxRecord();
      const provider = miosa({ apiKey: API_KEY });
      const created = await createFallbackSandbox(provider);

      fetchMock
        .mockResolvedValueOnce(jsonResponse(record))
        .mockResolvedValueOnce(
          jsonResponse({
            data: { stdout: "ok\n", stderr: "", exit_code: 0 },
          })
        );

      const reattached = await provider.sandbox.getById(created.sandboxId);
      expect(reattached).not.toBeNull();
      await reattached!.runCommand("echo ok");

      expect(runnerSpies.exec).not.toHaveBeenCalled();
      const [execUrl] = fetchMock.mock.calls.at(-1) as [string];
      expect(execUrl).toBe(
        `${DEFAULT_BASE_URL}/sandboxes/${record.id}/exec`
      );
    });

    it("should keep a fallback-created sandbox on the account API when it is listed", async () => {
      const record = sandboxRecord();
      const provider = miosa({ apiKey: API_KEY });
      await createFallbackSandbox(provider);

      fetchMock
        .mockResolvedValueOnce(jsonResponse({ data: [record] }))
        .mockResolvedValueOnce(
          jsonResponse({
            data: { stdout: "ok\n", stderr: "", exit_code: 0 },
          })
        );

      const [listed] = await provider.sandbox.list();
      await listed.runCommand("echo ok");

      expect(runnerSpies.exec).not.toHaveBeenCalled();
      const [execUrl] = fetchMock.mock.calls.at(-1) as [string];
      expect(execUrl).toBe(
        `${DEFAULT_BASE_URL}/sandboxes/${record.id}/exec`
      );
    });
  });

  describe("operations the runner does not cover yet", () => {
    it("should still list sandboxes over the control plane when runnerMode: true", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ data: [sandboxRecord()] })
      );
      const provider = miosa({ apiKey: API_KEY, runnerMode: true });

      const sandboxes = await provider.sandbox.list();

      expect(sandboxes).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(runnerSpies.createSandbox).not.toHaveBeenCalled();
    });

    it("should still expose a port over the control plane when runnerMode: true", async () => {
      runnerSpies.createSandbox.mockResolvedValueOnce({
        id: sandboxRecord().id,
        runnerUrl: "https://3.run-us.miosa.ai",
        data: sandboxRecord(),
      });
      const provider = miosa({ apiKey: API_KEY, runnerMode: true });
      const sandbox = await provider.sandbox.create();

      fetchMock.mockResolvedValueOnce(
        jsonResponse({ url: "https://preview.example.miosa.ai" })
      );
      const url = await sandbox.getUrl({ port: 3000 });

      expect(url).toBe("https://preview.example.miosa.ai");
      const [requestUrl] = fetchMock.mock.calls.at(-1) as [string];
      expect(requestUrl).toBe(
        `${DEFAULT_BASE_URL}/sandboxes/${sandbox.sandboxId}/expose`
      );
    });
  });
});
