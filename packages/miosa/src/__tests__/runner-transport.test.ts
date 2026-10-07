import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `@miosa/sdk` has not published a version containing RunnerClient yet (see
// runner-sdk.d.ts); vi.mock intercepts the specifier before module
// resolution, so this works without the package existing on disk. The
// spies live in vi.hoisted() because vi.mock's factory is hoisted above
// every import in this file, including the one below.
const runnerSpies = vi.hoisted(() => ({
  createSandbox: vi.fn(),
  exec: vi.fn(),
  destroySandbox: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
  constructed: [] as Array<{ apiKey: string; baseDomain?: string }>,
}));

vi.mock("@miosa/sdk", () => ({
  RunnerClient: vi
    .fn()
    .mockImplementation((options: { apiKey: string; baseDomain?: string }) => {
      runnerSpies.constructed.push(options);
      return {
        createSandbox: runnerSpies.createSandbox,
        exec: runnerSpies.exec,
        destroySandbox: runnerSpies.destroySandbox,
        close: runnerSpies.close,
      };
    }),
}));

import { closeMiosaRunnerConnections, miosa, DEFAULT_BASE_URL } from "../index";
import type { MiosaSandboxRecord } from "../index";

// No API key carries a region this release (C5 decision, 2026-10-02), so
// every key in this file is an ordinary key - the only thing that ever
// turns the runner path on is `runnerMode` / MIOSA_RUNNER_MODE.
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
    it("should stay on the control plane by default - no key-based routing", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(sandboxRecord(), 201));
      const provider = miosa({ apiKey: API_KEY });

      await provider.sandbox.create();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(runnerSpies.createSandbox).not.toHaveBeenCalled();
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
    it("should destroy through the RunnerClient when runnerMode: true", async () => {
      runnerSpies.destroySandbox.mockResolvedValueOnce(undefined);
      const provider = miosa({ apiKey: API_KEY, runnerMode: true });

      await provider.sandbox.destroy("sb-1");

      expect(runnerSpies.destroySandbox).toHaveBeenCalledWith("sb-1");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should treat a 404-shaped runner error as already destroyed", async () => {
      const notFound = Object.assign(
        new Error("runner request failed with 404"),
        { status: 404 }
      );
      runnerSpies.destroySandbox.mockRejectedValueOnce(notFound);
      const provider = miosa({ apiKey: API_KEY, runnerMode: true });

      await expect(provider.sandbox.destroy("gone")).resolves.toBeUndefined();
    });

    it("should propagate a non-404 runner error", async () => {
      const forbidden = Object.assign(
        new Error("runner request failed with 403"),
        { status: 403 }
      );
      runnerSpies.destroySandbox.mockRejectedValueOnce(forbidden);
      const provider = miosa({ apiKey: API_KEY, runnerMode: true });

      await expect(provider.sandbox.destroy("sb-1")).rejects.toThrow(/403/);
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
