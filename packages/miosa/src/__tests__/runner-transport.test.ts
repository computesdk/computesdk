import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock intercepts the `@miosa/sdk` specifier before module resolution so
// these tests run without the package's real transport. The spies live in
// vi.hoisted() because vi.mock's factory is hoisted above every import in
// this file, including the one below.
type FallbackCreate = (
  params: Record<string, unknown>,
) => Promise<{ id: string; runnerUrl: string; data: Record<string, unknown> }>;

import type { RunnerTransport } from "@miosa/sdk";

type ScriptedTransport = RunnerTransport;

const runnerSpies = vi.hoisted(() => ({
  createSandbox: vi.fn(),
  execStream: vi.fn(),
  destroySandbox: vi.fn(),
  // The sandbox is already launched in every test that doesn't script a
  // launch wait, so the readiness poll answers `ready` by default.
  get: vi.fn().mockResolvedValue({ state: "ready" }),
  close: vi.fn().mockResolvedValue(undefined),
  transport: undefined as ScriptedTransport | undefined,
  constructed: [] as Array<{
    apiKey: string;
    baseDomain?: string;
    fallbackCreate?: FallbackCreate;
  }>,
}));

// When `runnerSpies.transport` is set, the mock hands back the SDK's real
// RunnerClient wired to that in-memory transport instead of the spies, so
// the regional endpoint's own create logic (fallback on an unsupported
// shape, retrying the next address on a refusal) runs for real against
// scripted responses.
vi.mock("@miosa/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@miosa/sdk")>();
  return {
    RunnerClient: vi
      .fn()
      .mockImplementation(
        (options: {
          apiKey: string;
          baseDomain?: string;
          fallbackCreate?: FallbackCreate;
        }) => {
          runnerSpies.constructed.push(options);
          if (runnerSpies.transport) {
            return new actual.RunnerClient({
              ...options,
              transport: runnerSpies.transport,
            });
          }
          return {
            createSandbox: runnerSpies.createSandbox,
            execStream: runnerSpies.execStream,
            destroySandbox: runnerSpies.destroySandbox,
            get: runnerSpies.get,
            close: runnerSpies.close,
          };
        },
      ),
    // Real error classes, so a test can raise exactly what the SDK raises.
    RunnerConnectError: actual.RunnerConnectError,
    RunnerTimeoutError: actual.RunnerTimeoutError,
    RunnerError: actual.RunnerError,
  };
});

import { RunnerConnectError, RunnerTimeoutError } from "@miosa/sdk";
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

/** The execStream events a runner emits for a finished command, for the
 * spy client to return. `line` chunks are raw output and carry their own
 * newline. */
function execStreamEvents(body: {
  stdout?: string;
  stderr?: string;
  exit_code?: number;
}): AsyncIterableIterator<
  { type: "stdout" | "stderr"; line: string } | { type: "exit"; exit_code: number }
> {
  return (async function* () {
    if (body.stdout) yield { type: "stdout" as const, line: body.stdout };
    if (body.stderr) yield { type: "stderr" as const, line: body.stderr };
    yield { type: "exit" as const, exit_code: body.exit_code ?? 0 };
  })();
}

/** The SSE text /exec/stream sends for a buffered-exec-shaped reply. */
function execSse(scripted: { status: number; body?: unknown }): string {
  const body = (scripted.body ?? {}) as {
    stdout?: string;
    stderr?: string;
    exit_code?: number;
  };
  const events = [
    ...(body.stdout ? [{ type: "stdout", line: body.stdout }] : []),
    ...(body.stderr ? [{ type: "stderr", line: body.stderr }] : []),
    { type: "exit", exit_code: body.exit_code ?? 0 },
  ];
  return events.map((event) => `data: ${JSON.stringify(event)}\n`).join("");
}

async function* singleChunk(text: string): AsyncIterableIterator<string> {
  yield text;
}

describe("regional sandbox endpoint", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    runnerSpies.createSandbox.mockReset();
    runnerSpies.execStream.mockReset();
    runnerSpies.destroySandbox.mockReset();
    runnerSpies.get.mockReset().mockResolvedValue({ state: "ready" });
    runnerSpies.constructed.length = 0;
    runnerSpies.transport = undefined;
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

  describe("a custom control plane", () => {
    const CUSTOM_BASE = "https://api.example.test/api/v1";

    function customControlPlane(): void {
      fetchMock.mockImplementation(
        async (url: string, init?: { method?: string }) => {
          const method = init?.method ?? "GET";
          if (url.endsWith("/exec")) {
            return jsonResponse({
              data: { stdout: "from-custom\n", stderr: "", exit_code: 0 },
            });
          }
          if (method === "DELETE") return jsonResponse({ data: {} });
          return jsonResponse(sandboxRecord(), method === "POST" ? 201 : 200);
        },
      );
    }

    const urls = (): string[] =>
      fetchMock.mock.calls.map(([url]) => String(url));

    function expectNothingRegional(): void {
      expect(runnerSpies.constructed).toEqual([]);
      expect(runnerSpies.createSandbox).not.toHaveBeenCalled();
      expect(runnerSpies.execStream).not.toHaveBeenCalled();
      expect(runnerSpies.destroySandbox).not.toHaveBeenCalled();
    }

    it("should create, exec and destroy on the configured control plane and never build a regional client", async () => {
      customControlPlane();
      const provider = miosa({ apiKey: API_KEY, baseUrl: CUSTOM_BASE });

      const sandbox = await provider.sandbox.create();
      const result = await sandbox.runCommand("node -v");
      await sandbox.destroy();

      expect(result.stdout).toBe("from-custom\n");
      expect(urls().every((url) => url.startsWith(CUSTOM_BASE))).toBe(true);
      expect(urls()).toHaveLength(3);
      expectNothingRegional();
    });

    it("should look an id up on the configured control plane only", async () => {
      customControlPlane();
      const provider = miosa({ apiKey: API_KEY, baseUrl: CUSTOM_BASE });

      await provider.sandbox.getById(sandboxRecord().id);

      // getById also reads the egress pointer afterwards, on the same host.
      expect(urls()[0]).toBe(`${CUSTOM_BASE}/sandboxes/${sandboxRecord().id}`);
      expect(urls().every((url) => url.startsWith(CUSTOM_BASE))).toBe(true);
      expectNothingRegional();
    });

    it("should follow MIOSA_BASE_URL the same way", async () => {
      process.env.MIOSA_BASE_URL = CUSTOM_BASE;
      try {
        customControlPlane();
        const provider = miosa({ apiKey: API_KEY });

        const sandbox = await provider.sandbox.create();
        await sandbox.runCommand("node -v");
        await sandbox.destroy();

        expect(urls().every((url) => url.startsWith(CUSTOM_BASE))).toBe(true);
        expectNothingRegional();
      } finally {
        delete process.env.MIOSA_BASE_URL;
      }
    });

    it("should not warm a regional client when the provider is constructed", () => {
      miosa({ apiKey: API_KEY, baseUrl: CUSTOM_BASE });

      expect(runnerSpies.constructed).toEqual([]);
    });

    it("should not warm a regional client when the module is imported", async () => {
      process.env.MIOSA_API_KEY = API_KEY;
      process.env.MIOSA_BASE_URL = CUSTOM_BASE;
      try {
        vi.resetModules();
        await import("../index");

        expect(runnerSpies.constructed).toEqual([]);
      } finally {
        delete process.env.MIOSA_API_KEY;
        delete process.env.MIOSA_BASE_URL;
      }
    });

    it("should warm the regional client on import when the base URL is the default API", async () => {
      process.env.MIOSA_API_KEY = API_KEY;
      try {
        vi.resetModules();
        await import("../index");

        expect(runnerSpies.constructed).toHaveLength(1);
      } finally {
        delete process.env.MIOSA_API_KEY;
      }
    });

    it("should still use the regional endpoint for the default API written with a trailing slash", async () => {
      runnerSpies.createSandbox.mockResolvedValueOnce({
        id: sandboxRecord().id,
        runnerUrl: "https://3.run-us.miosa.ai",
        data: sandboxRecord(),
      });
      const provider = miosa({ apiKey: API_KEY, baseUrl: `${DEFAULT_BASE_URL}/` });

      await provider.sandbox.create();

      expect(runnerSpies.createSandbox).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["runnerMode: true", { runnerMode: true as const }],
      [
        "a runnerBaseDomain",
        { runnerBaseDomain: "run.staging.internal" },
      ],
    ])("should use the regional endpoint with a custom base URL when asked by %s", async (_name, extra) => {
      runnerSpies.createSandbox.mockResolvedValueOnce({
        id: sandboxRecord().id,
        runnerUrl: "https://3.run-us.miosa.ai",
        data: sandboxRecord(),
      });
      const provider = miosa({ apiKey: API_KEY, baseUrl: CUSTOM_BASE, ...extra });

      await provider.sandbox.create();

      expect(runnerSpies.createSandbox).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should use the regional endpoint with a custom base URL when MIOSA_RUNNER_MODE=1", async () => {
      process.env.MIOSA_RUNNER_MODE = "1";
      runnerSpies.createSandbox.mockResolvedValueOnce({
        id: sandboxRecord().id,
        runnerUrl: "https://3.run-us.miosa.ai",
        data: sandboxRecord(),
      });
      const provider = miosa({ apiKey: API_KEY, baseUrl: CUSTOM_BASE });

      await provider.sandbox.create();

      expect(runnerSpies.createSandbox).toHaveBeenCalledTimes(1);
    });

    it("should let runnerMode: false win over a runnerBaseDomain", async () => {
      customControlPlane();
      const provider = miosa({
        apiKey: API_KEY,
        baseUrl: CUSTOM_BASE,
        runnerMode: false,
        runnerBaseDomain: "run.staging.internal",
      });

      await provider.sandbox.create();

      expectNothingRegional();
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
      expect(runnerSpies.execStream).not.toHaveBeenCalled();
      expect(runnerSpies.destroySandbox).not.toHaveBeenCalled();
    });

    it("should use the account API when the regional endpoint is unreachable", async () => {
      const record = sandboxRecord();
      fetchMock.mockResolvedValueOnce(jsonResponse(record, 201));
      runnerSpies.createSandbox.mockRejectedValueOnce(
        new RunnerConnectError(
          "run-us.miosa.ai",
          "10.0.0.1",
          Object.assign(new Error("connect ECONNREFUSED"), {
            code: "ECONNREFUSED",
          }),
        ),
      );
      const provider = miosa({ apiKey: API_KEY });

      const sandbox = await provider.sandbox.create();

      expect(sandbox.sandboxId).toBe(record.id);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("should not fall back on a failure that may follow a provisioned sandbox - no double creates", async () => {
      runnerSpies.createSandbox.mockRejectedValueOnce(
        new Error("runner request failed with 500 internal_error"),
      );
      const provider = miosa({ apiKey: API_KEY });

      await expect(provider.sandbox.create()).rejects.toThrow(/internal_error/);
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

    it("should exec through the RunnerClient's stream endpoint", async () => {
      const sandbox = await createRunnerSandbox();
      runnerSpies.execStream.mockReturnValueOnce(
        execStreamEvents({ stdout: "hello\n" }),
      );

      const result = await sandbox.runCommand("echo hello", {
        cwd: "/workspace",
        env: { NODE_ENV: "test" },
        timeout: 30_000,
      });

      expect(runnerSpies.execStream).toHaveBeenCalledWith(
        sandbox.sandboxId,
        "echo hello",
        { cwd: "/workspace", env: { NODE_ENV: "test" }, timeout: 30 }
      );
      expect(result.stdout).toBe("hello\n");
      expect(result.exitCode).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should return a non-zero exit code and stderr from the stream", async () => {
      const sandbox = await createRunnerSandbox();
      runnerSpies.execStream.mockReturnValueOnce(
        execStreamEvents({ stderr: "boom", exit_code: 1 }),
      );

      const result = await sandbox.runCommand("false");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("boom");
    });

    it("should return exitCode 127 with the error when the runner rejects", async () => {
      const sandbox = await createRunnerSandbox();
      runnerSpies.execStream.mockRejectedValueOnce(
        new Error("runner request failed with 503 runtime_busy")
      );

      const result = await sandbox.runCommand("echo hi");
      expect(result.exitCode).toBe(127);
      expect(result.stderr).toMatch(/runtime_busy/);
    });

    it("should wait for a launching sandbox before streaming the exec", async () => {
      // Runner create answers while the machine is still coming up; an exec
      // sent mid-launch dies in the server-side hold. The readiness poll
      // rides out the launch - a 404 on the per-sandbox route just means
      // the runner has not attached the record yet.
      const sandbox = await createRunnerSandbox();
      runnerSpies.get
        .mockReset()
        .mockRejectedValueOnce(
          Object.assign(new Error("not provisioned"), { status: 404 })
        )
        .mockResolvedValue({ state: "ready" });
      runnerSpies.execStream.mockReturnValueOnce(
        execStreamEvents({ stdout: "warm\n" })
      );

      const result = await sandbox.runCommand("echo warm");

      expect(runnerSpies.get).toHaveBeenCalledTimes(2);
      expect(runnerSpies.execStream).toHaveBeenCalledTimes(1);
      expect(result.stdout).toBe("warm\n");
      expect(result.exitCode).toBe(0);
    });

    it("should fail the command when the sandbox is stopping instead of running it", async () => {
      const sandbox = await createRunnerSandbox();
      runnerSpies.get.mockResolvedValue({ state: "stopping" });

      const result = await sandbox.runCommand("echo hi");

      expect(result.exitCode).toBe(127);
      expect(result.stderr).toMatch(/stopping/);
      expect(runnerSpies.execStream).not.toHaveBeenCalled();
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

    it("should retry a SANDBOX_BUSY destroy until the lifecycle op drains", async () => {
      // SANDBOX_BUSY is a refusal, not an attempted destroy: an exec was
      // still running when the first delete arrived. Retrying rides out the
      // drain instead of reporting a leak.
      runnerSpies.createSandbox.mockResolvedValueOnce({
        id: sandboxRecord().id,
        runnerUrl: "https://3.run-us.miosa.ai",
        data: sandboxRecord(),
      });
      runnerSpies.destroySandbox
        .mockRejectedValueOnce(
          Object.assign(
            new Error(
              "SANDBOX_BUSY: Another lifecycle operation is in progress for this sandbox",
            ),
            { status: 409, code: "SANDBOX_BUSY" },
          ),
        )
        .mockRejectedValueOnce(
          Object.assign(
            new Error(
              "SANDBOX_BUSY: Another lifecycle operation is in progress for this sandbox",
            ),
            { status: 409, code: "SANDBOX_BUSY" },
          ),
        )
        .mockResolvedValueOnce(undefined);
      const provider = miosa({ apiKey: API_KEY, runnerMode: true });
      const sandbox = await provider.sandbox.create();

      await provider.sandbox.destroy(sandbox.sandboxId);

      expect(runnerSpies.destroySandbox).toHaveBeenCalledTimes(3);
      expect(fetchMock).not.toHaveBeenCalled();
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

      expect(runnerSpies.execStream).not.toHaveBeenCalled();
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

      expect(runnerSpies.execStream).not.toHaveBeenCalled();
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

  // The tests below run the SDK's real RunnerClient against an in-memory
  // transport, so the regional endpoint's own create logic - client-side
  // shape checks, `400 RUNNER_UNSUPPORTED_REQUEST`, retrying the next runner
  // address on a `429` - runs exactly as it does in production.
  describe("against the SDK's runner client", () => {
    type RunnerCall = {
      addressIndex: number;
      method: string;
      path: string;
      body?: string;
    };
    type RunnerReply = {
      status: number;
      headers?: Record<string, string>;
      body?: unknown;
    };

    const RUNNER_URL = "https://a.run-us.miosa.ai";
    let runnerCalls: RunnerCall[];

    /** Two runner addresses; `reply` scripts every non-/healthz request. */
    function useRunners(
      reply: (call: RunnerCall) => RunnerReply | Promise<RunnerReply>,
      options: { addressCount?: () => Promise<number> } = {},
    ): void {
      runnerCalls = [];
      runnerSpies.transport = {
        protocol: "h2",
        prewarm: () => undefined,
        addressCount: options.addressCount ?? (async () => 2),
        ready: async () => undefined,
        request: async (
          _hostname: string,
          addressIndex: number,
          _authority: string,
          path: string,
          init: { method: string; body?: unknown },
        ) => {
          if (path === "/healthz") {
            return { status: 200, headers: {}, body: "{}" };
          }
          const call: RunnerCall = {
            addressIndex,
            method: init.method,
            path,
            ...(init.body !== undefined ? { body: String(init.body) } : {}),
          };
          runnerCalls.push(call);
          // The adapter's pre-exec readiness poll is adapter plumbing, not
          // part of the test's script: every sandbox answers `ready`.
          if (
            call.method === "GET" &&
            /^\/api\/v1\/sandboxes\/[^/]+$/.test(call.path)
          ) {
            return {
              status: 200,
              headers: {},
              body: JSON.stringify({
                status: "ok",
                result: { instance_id: call.path.split("/").pop(), state: "ready" },
              }),
            };
          }
          const scripted = await reply(call);
          return {
            status: scripted.status,
            headers: scripted.headers ?? {},
            body:
              scripted.body === undefined ? "" : JSON.stringify(scripted.body),
          };
        },
        streamRequest: async (
          _hostname: string,
          addressIndex: number,
          _authority: string,
          path: string,
          init: { method: string; body?: unknown },
        ) => {
          const call: RunnerCall = {
            addressIndex,
            method: init.method,
            path,
            ...(init.body !== undefined ? { body: String(init.body) } : {}),
          };
          runnerCalls.push(call);
          const scripted = await reply(call);
          // >=400 answers the way sendToSandboxStream expects: the raw error
          // body as chunks. 2xx is SSE `data:` lines of exec events.
          return {
            status: scripted.status,
            headers: scripted.headers ?? {},
            chunks: singleChunk(
              scripted.status >= 400
                ? JSON.stringify(scripted.body ?? {})
                : execSse(scripted),
            ),
          };
        },
        close: async () => undefined,
      } as unknown as ScriptedTransport;
    }

    const runnerCreated = (): RunnerReply => ({
      status: 201,
      headers: { "soma-runner-url": RUNNER_URL },
      body: sandboxRecord(),
    });
    const runnerRefused = (status: number, code: string): RunnerReply => ({
      status,
      body: { error: code },
    });
    const runnerExecOk = (): RunnerReply => ({
      status: 200,
      body: { stdout: "from-runner\n", stderr: "", exit_code: 0 },
    });

    /** Serves the account API for every sandbox operation a test makes. */
    function useAccountApi(): void {
      fetchMock.mockImplementation(
        async (url: string, init?: { method?: string }) => {
          const method = init?.method ?? "GET";
          if (url.endsWith("/exec")) {
            return jsonResponse({
              data: { stdout: "from-account-api\n", stderr: "", exit_code: 0 },
            });
          }
          if (method === "DELETE") return jsonResponse({ data: {} });
          return jsonResponse(sandboxRecord(), method === "POST" ? 201 : 200);
        },
      );
    }

    function accountApiCalls(): Array<{ method: string; path: string }> {
      return fetchMock.mock.calls.map(([url, init]) => ({
        method: (init as { method?: string } | undefined)?.method ?? "GET",
        path: String(url).replace(DEFAULT_BASE_URL, ""),
      }));
    }

    function runnerCreates(): RunnerCall[] {
      return runnerCalls.filter(
        (call) => call.method === "POST" && call.path === "/api/v1/sandboxes",
      );
    }

    /**
     * Runs every per-sandbox operation the provider routes by origin and
     * asserts each one reached the account API and none reached a runner.
     */
    async function expectWholeLifeOnAccountApi(
      provider: ReturnType<typeof miosa>,
      sandbox: Awaited<ReturnType<ReturnType<typeof miosa>["sandbox"]["create"]>>,
    ): Promise<void> {
      const id = sandbox.sandboxId;
      const created = await sandbox.runCommand("node -v");
      const reattached = await provider.sandbox.getById(id);
      const viaReattached = await reattached!.runCommand("node -v");
      await provider.sandbox.destroy(id);

      expect(created.stdout).toBe("from-account-api\n");
      expect(viaReattached.stdout).toBe("from-account-api\n");
      expect(accountApiCalls()).toEqual(
        expect.arrayContaining([
          { method: "POST", path: `/sandboxes/${id}/exec` },
          { method: "GET", path: `/sandboxes/${id}` },
          { method: "DELETE", path: `/sandboxes/${id}` },
        ]),
      );
      expect(
        runnerCalls.filter((call) => call.path.startsWith(`/api/v1/sandboxes/${id}`)),
      ).toEqual([]);
    }

    it("should create a large sandbox on the account API and keep its whole life there", async () => {
      // The runner refuses this shape; whether the SDK short-circuits it
      // client-side or the runner answers 400, the account API must own it.
      useRunners((call) =>
        call.method === "POST" && call.path === "/api/v1/sandboxes"
          ? runnerRefused(400, "RUNNER_UNSUPPORTED_REQUEST")
          : runnerExecOk(),
      );
      useAccountApi();
      const provider = miosa({ apiKey: API_KEY });

      const sandbox = await provider.sandbox.create({ vcpus: 8, memory: 16384 });

      const [createCall] = fetchMock.mock.calls;
      expect(String(createCall?.[0])).toBe(`${DEFAULT_BASE_URL}/sandboxes`);
      expect(
        JSON.parse(String((createCall?.[1] as { body?: string }).body)),
      ).toMatchObject({ size: "large" });
      await expectWholeLifeOnAccountApi(provider, sandbox);
    });

    it("should fall back to the account API on a runner 400 RUNNER_UNSUPPORTED_REQUEST and keep the sandbox there", async () => {
      useRunners((call) =>
        call.method === "POST" && call.path === "/api/v1/sandboxes"
          ? runnerRefused(400, "RUNNER_UNSUPPORTED_REQUEST")
          : runnerExecOk(),
      );
      useAccountApi();
      const provider = miosa({ apiKey: API_KEY });

      const sandbox = await provider.sandbox.create();

      // The runner itself answered this one.
      expect(runnerCreates()).toHaveLength(1);
      expect(accountApiCalls()[0]).toEqual({ method: "POST", path: "/sandboxes" });
      await expectWholeLifeOnAccountApi(provider, sandbox);
    });

    it("should retry the other runner on a 429 and stay on the runner when it accepts", async () => {
      useRunners((call) => {
        if (call.method === "POST" && call.path === "/api/v1/sandboxes") {
          return call.addressIndex === 0
            ? runnerRefused(429, "rate_limited")
            : runnerCreated();
        }
        return runnerExecOk();
      });
      useAccountApi();
      const provider = miosa({ apiKey: API_KEY });

      const sandbox = await provider.sandbox.create();
      const result = await sandbox.runCommand("node -v");

      expect(runnerCreates().map((call) => call.addressIndex)).toEqual([0, 1]);
      expect(result.stdout).toBe("from-runner\n");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should fall back to the account API when every runner answers 429 and keep the sandbox there", async () => {
      useRunners((call) =>
        call.method === "POST" && call.path === "/api/v1/sandboxes"
          ? runnerRefused(429, "rate_limited")
          : runnerExecOk(),
      );
      useAccountApi();
      const provider = miosa({ apiKey: API_KEY });

      const sandbox = await provider.sandbox.create();

      // Both runners were asked before the account API took it.
      expect(runnerCreates().map((call) => call.addressIndex)).toEqual([0, 1]);
      expect(accountApiCalls()[0]).toEqual({ method: "POST", path: "/sandboxes" });
      await expectWholeLifeOnAccountApi(provider, sandbox);
    });

    it("should fall back to the account API when every runner is at capacity", async () => {
      useRunners((call) =>
        call.method === "POST" && call.path === "/api/v1/sandboxes"
          ? runnerRefused(429, "runtime_busy")
          : runnerExecOk(),
      );
      useAccountApi();
      const provider = miosa({ apiKey: API_KEY });

      const sandbox = await provider.sandbox.create();

      expect(runnerCreates()).toHaveLength(2);
      await expectWholeLifeOnAccountApi(provider, sandbox);
    });

    it("should fall back to the account API when no runner can be connected to", async () => {
      useRunners(() => {
        throw new RunnerConnectError(
          "run-us.miosa.ai",
          "10.0.0.1",
          Object.assign(new Error("connect ECONNREFUSED"), {
            code: "ECONNREFUSED",
          }),
        );
      });
      useAccountApi();
      const provider = miosa({ apiKey: API_KEY });

      const sandbox = await provider.sandbox.create();

      expect(runnerCreates()).toHaveLength(2);
      await expectWholeLifeOnAccountApi(provider, sandbox);
    });

    it("should fall back to the account API when the runners do not know the key yet", async () => {
      useRunners((call) =>
        call.method === "POST" && call.path === "/api/v1/sandboxes"
          ? runnerRefused(401, "unauthorized")
          : runnerExecOk(),
      );
      useAccountApi();
      const provider = miosa({ apiKey: API_KEY });

      const sandbox = await provider.sandbox.create();

      expect(accountApiCalls()[0]).toEqual({ method: "POST", path: "/sandboxes" });
      await expectWholeLifeOnAccountApi(provider, sandbox);
    });

    it("should not send the create to the account API after a connection reset that may have followed delivery", async () => {
      useRunners(() => {
        throw Object.assign(new Error("read ECONNRESET"), {
          code: "ECONNRESET",
        });
      });
      useAccountApi();
      const provider = miosa({ apiKey: API_KEY });

      await expect(provider.sandbox.create()).rejects.toThrow(/ECONNRESET/);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should not send the create to the account API after a timeout that may have followed delivery", async () => {
      useRunners(() => {
        throw new RunnerTimeoutError("run-us.miosa.ai", "/api/v1/sandboxes", 30_000);
      });
      useAccountApi();
      const provider = miosa({ apiKey: API_KEY });

      await expect(provider.sandbox.create()).rejects.toThrow(/timed out/);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should fall back to the account API when every runner is feed-stale", async () => {
      useRunners((call) =>
        call.method === "POST" && call.path === "/api/v1/sandboxes"
          ? runnerRefused(503, "feed_stale")
          : runnerExecOk(),
      );
      useAccountApi();
      const provider = miosa({ apiKey: API_KEY });

      const sandbox = await provider.sandbox.create();

      expect(runnerCreates()).toHaveLength(2);
      expect(accountApiCalls()[0]).toEqual({ method: "POST", path: "/sandboxes" });
      await expectWholeLifeOnAccountApi(provider, sandbox);
    });

    it("should fall back to the account API when the regional hostname does not resolve", async () => {
      useRunners(() => runnerExecOk(), {
        addressCount: async () => {
          throw Object.assign(
            new Error("getaddrinfo ENOTFOUND run-us.miosa.ai"),
            { code: "ENOTFOUND" },
          );
        },
      });
      useAccountApi();
      const provider = miosa({ apiKey: API_KEY });

      const sandbox = await provider.sandbox.create();

      expect(accountApiCalls()[0]).toEqual({ method: "POST", path: "/sandboxes" });
      await expectWholeLifeOnAccountApi(provider, sandbox);
    });

    it("should rethrow a runner failure that may follow a provisioned sandbox", async () => {
      useRunners(() => runnerRefused(500, "internal_error"));
      useAccountApi();
      const provider = miosa({ apiKey: API_KEY });

      await expect(provider.sandbox.create()).rejects.toThrow(/internal_error/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should keep a runner-created sandbox on the runner for exec and destroy", async () => {
      useRunners((call) => {
        if (call.method === "POST" && call.path === "/api/v1/sandboxes") {
          return runnerCreated();
        }
        if (call.method === "DELETE") return { status: 200, body: {} };
        return runnerExecOk();
      });
      useAccountApi();
      const provider = miosa({ apiKey: API_KEY });

      const sandbox = await provider.sandbox.create();
      const result = await sandbox.runCommand("node -v");
      await provider.sandbox.destroy(sandbox.sandboxId);

      expect(result.stdout).toBe("from-runner\n");
      expect(runnerCalls.map((call) => `${call.method} ${call.path}`)).toEqual([
        "POST /api/v1/sandboxes",
        `GET /api/v1/sandboxes/${sandbox.sandboxId}`,
        `POST /api/v1/sandboxes/${sandbox.sandboxId}/exec/stream`,
        `DELETE /api/v1/sandboxes/${sandbox.sandboxId}`,
      ]);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("destroying an id this process did not create, with the regional endpoint off", () => {
    const FOREIGN_ID = "f0f0f0f0-0000-0000-0000-000000000009";

    function accountApiAnswers(status: number): void {
      fetchMock.mockResolvedValue(
        jsonResponse({ error: { code: "NOT_FOUND" } }, status),
      );
    }

    it("should delete a regional sandbox the account API does not know", async () => {
      runnerSpies.destroySandbox.mockResolvedValue({});
      accountApiAnswers(404);
      const provider = miosa({ apiKey: API_KEY, runnerMode: false });

      await provider.sandbox.destroy(FOREIGN_ID);

      expect(runnerSpies.destroySandbox).toHaveBeenCalledWith(FOREIGN_ID);
    });

    it("should stop at the account API when it deletes the sandbox", async () => {
      accountApiAnswers(200);
      const provider = miosa({ apiKey: API_KEY, runnerMode: false });

      await provider.sandbox.destroy(FOREIGN_ID);

      expect(runnerSpies.destroySandbox).not.toHaveBeenCalled();
    });

    it("should treat an id both endpoints do not know as already destroyed", async () => {
      runnerSpies.destroySandbox.mockRejectedValue(
        Object.assign(new Error("not found"), { status: 404 }),
      );
      accountApiAnswers(404);
      const provider = miosa({ apiKey: API_KEY, runnerMode: false });

      await expect(provider.sandbox.destroy(FOREIGN_ID)).resolves.toBeUndefined();
    });

    it("should raise a regional failure instead of reporting the sandbox destroyed", async () => {
      runnerSpies.destroySandbox.mockRejectedValue(
        Object.assign(new Error("boom"), { status: 500 }),
      );
      accountApiAnswers(404);
      const provider = miosa({ apiKey: API_KEY, runnerMode: false });

      await expect(provider.sandbox.destroy(FOREIGN_ID)).rejects.toThrow(/boom/);
    });

    it("should not send a custom control plane's key to the regional endpoint", async () => {
      accountApiAnswers(404);
      const provider = miosa({
        apiKey: API_KEY,
        runnerMode: false,
        baseUrl: "https://api.example.test/api/v1",
      });

      await provider.sandbox.destroy(FOREIGN_ID);

      expect(runnerSpies.destroySandbox).not.toHaveBeenCalled();
    });
  });

  describe("connection warm-up", () => {
    it("should warm the runner client as soon as the provider is constructed", async () => {
      miosa({ apiKey: API_KEY });

      // No sandbox operation has run; only the warm-up can have built it.
      await vi.waitFor(() => expect(runnerSpies.constructed).toHaveLength(1));
      expect(runnerSpies.constructed[0]?.apiKey).toBe(API_KEY);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should warm the runner client when the module is imported with a usable key", async () => {
      vi.stubEnv("MIOSA_API_KEY", API_KEY);
      vi.resetModules();
      try {
        const fresh = await import("../index");

        // Importing is the only thing that has happened: no provider exists.
        await vi.waitFor(() => expect(runnerSpies.constructed).toHaveLength(1));
        expect(runnerSpies.constructed[0]?.apiKey).toBe(API_KEY);
        await fresh.closeMiosaRunnerConnections();
        fresh.closeMiosaConnections();
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("should not warm a runner client on import when opted out", async () => {
      vi.stubEnv("MIOSA_API_KEY", API_KEY);
      vi.stubEnv("MIOSA_RUNNER_MODE", "0");
      vi.resetModules();
      try {
        const fresh = await import("../index");
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(runnerSpies.constructed).toHaveLength(0);
        fresh.closeMiosaConnections();
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("should not warm a runner client when opted out", async () => {
      miosa({ apiKey: API_KEY, runnerMode: false });
      process.env.MIOSA_RUNNER_MODE = "0";
      miosa({ apiKey: API_KEY });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(runnerSpies.constructed).toHaveLength(0);
    });
  });

  describe("opting out", () => {
    it.each([
      ["runnerMode: false", { runnerMode: false }, undefined],
      ["MIOSA_RUNNER_MODE=0", {}, "0"],
    ])(
      "should send every sandbox operation to the account API with %s",
      async (_label, extra, env) => {
        if (env !== undefined) process.env.MIOSA_RUNNER_MODE = env;
        fetchMock.mockImplementation(
          async (url: string, init?: { method?: string }) => {
            const method = init?.method ?? "GET";
            if (url.endsWith("/exec")) {
              return jsonResponse({
                data: { stdout: "ok\n", stderr: "", exit_code: 0 },
              });
            }
            if (url.endsWith("/sandboxes") && method === "GET") {
              return jsonResponse({ data: [sandboxRecord()] });
            }
            if (method === "DELETE") return jsonResponse({ data: {} });
            return jsonResponse(sandboxRecord(), method === "POST" ? 201 : 200);
          },
        );
        const provider = miosa({ apiKey: API_KEY, ...extra });

        const sandbox = await provider.sandbox.create();
        await sandbox.runCommand("node -v");
        const reattached = await provider.sandbox.getById(sandbox.sandboxId);
        await reattached!.runCommand("node -v");
        const [listed] = await provider.sandbox.list();
        await listed!.runCommand("node -v");
        await provider.sandbox.destroy(sandbox.sandboxId);

        const id = sandbox.sandboxId;
        const urls = fetchMock.mock.calls.map(([url]) => String(url));
        expect(urls.every((url) => url.startsWith(`${DEFAULT_BASE_URL}/`))).toBe(
          true,
        );
        expect(
          fetchMock.mock.calls
            .map(
              ([url, init]) =>
                `${(init as { method?: string }).method ?? "GET"} ${String(url).replace(DEFAULT_BASE_URL, "")}`,
            )
            // getById also reads the sandbox's egress state file; that is
            // computesdk's own bookkeeping, not routing.
            .filter((call) => !call.includes("/fs/read")),
        ).toEqual([
          "POST /sandboxes",
          `POST /sandboxes/${id}/exec`,
          `GET /sandboxes/${id}`,
          `POST /sandboxes/${id}/exec`,
          "GET /sandboxes",
          `POST /sandboxes/${id}/exec`,
          `DELETE /sandboxes/${id}`,
        ]);
        expect(runnerSpies.constructed).toHaveLength(0);
        expect(runnerSpies.createSandbox).not.toHaveBeenCalled();
        expect(runnerSpies.execStream).not.toHaveBeenCalled();
        expect(runnerSpies.destroySandbox).not.toHaveBeenCalled();
      },
    );
  });

  // Each test here uses its own sandbox id: the provider records sandbox
  // origins per id for the life of the process, across providers.
  describe("origin tracking across handles and settings", () => {
    const notFound = () =>
      Object.assign(new Error("runner request failed with 404 NOT_FOUND"), {
        status: 404,
        code: "NOT_FOUND",
      });

    it("should run a command on the account API for a reattached sandbox the regional endpoint does not own", async () => {
      const id = "b1000000-0000-0000-0000-000000000001";
      fetchMock.mockImplementation(async (url: string) =>
        url.endsWith("/exec")
          ? jsonResponse({
              data: { stdout: "from-account-api\n", stderr: "", exit_code: 0 },
            })
          : jsonResponse(sandboxRecord({ id })),
      );
      runnerSpies.execStream.mockRejectedValue(notFound());
      const provider = miosa({ apiKey: API_KEY });

      // Created by another process: this one has no record of its origin.
      const sandbox = await provider.sandbox.getById(id);
      const first = await sandbox!.runCommand("echo ok");
      const second = await sandbox!.runCommand("echo ok");

      expect(first.stdout).toBe("from-account-api\n");
      expect(second.stdout).toBe("from-account-api\n");
      // Learned once, then addressed directly.
      expect(runnerSpies.execStream).toHaveBeenCalledTimes(1);
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/exec")),
      ).toHaveLength(2);
    });

    it("should not re-run a reattached command on the account API after an ambiguous regional failure", async () => {
      const id = "b1000000-0000-0000-0000-000000000002";
      fetchMock.mockImplementation(async () => jsonResponse(sandboxRecord({ id })));
      runnerSpies.execStream.mockRejectedValue(
        Object.assign(new Error("runner request failed with 500 internal_error"), {
          status: 500,
        }),
      );
      const provider = miosa({ apiKey: API_KEY });

      const sandbox = await provider.sandbox.getById(id);
      const result = await sandbox!.runCommand("echo ok");

      expect(result.exitCode).toBe(127);
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/exec")),
      ).toHaveLength(0);
    });

    it("should not create twice when the account API create made for the regional endpoint loses its response", async () => {
      runnerSpies.createSandbox.mockImplementationOnce(async () => {
        const fallback = runnerSpies.constructed[0]?.fallbackCreate;
        if (!fallback) throw new Error("fallbackCreate was not wired");
        return await fallback({ size: "large" });
      });
      fetchMock.mockRejectedValue(
        Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
      );
      const provider = miosa({ apiKey: API_KEY });

      await expect(
        provider.sandbox.create({ vcpus: 8, memory: 16384 }),
      ).rejects.toThrow(/ECONNRESET/);
      // The lost POST may have provisioned a sandbox; it must not be re-sent.
      expect(
        fetchMock.mock.calls.filter(
          ([url, init]) =>
            String(url) === `${DEFAULT_BASE_URL}/sandboxes` &&
            (init as { method?: string }).method === "POST",
        ),
      ).toHaveLength(1);
    });

    it("should keep a regional sandbox on the regional endpoint after opting out", async () => {
      const id = "b1000000-0000-0000-0000-000000000003";
      runnerSpies.createSandbox.mockResolvedValueOnce({
        id,
        runnerUrl: "https://b.run-us.miosa.ai",
        data: sandboxRecord({ id }),
      });
      runnerSpies.execStream.mockReturnValue(
        execStreamEvents({ stdout: "from-runner\n" }),
      );
      runnerSpies.destroySandbox.mockResolvedValue({});
      fetchMock.mockImplementation(async () => jsonResponse(sandboxRecord({ id })));
      await miosa({ apiKey: API_KEY }).sandbox.create();

      process.env.MIOSA_RUNNER_MODE = "0";
      const optedOut = miosa({ apiKey: API_KEY });
      const reattached = await optedOut.sandbox.getById(id);
      const result = await reattached!.runCommand("echo ok");
      await optedOut.sandbox.destroy(id);

      expect(result.stdout).toBe("from-runner\n");
      expect(runnerSpies.destroySandbox).toHaveBeenCalledWith(id);
      expect(
        fetchMock.mock.calls.filter(
          ([, init]) => (init as { method?: string }).method === "DELETE",
        ),
      ).toHaveLength(0);
    });

    it("should forget a sandbox's origin once it is destroyed", async () => {
      const id = "b1000000-0000-0000-0000-000000000004";
      runnerSpies.createSandbox.mockImplementationOnce(async () => {
        const fallback = runnerSpies.constructed[0]?.fallbackCreate;
        if (!fallback) throw new Error("fallbackCreate was not wired");
        return await fallback({ size: "large" });
      });
      fetchMock
        .mockResolvedValueOnce(jsonResponse(sandboxRecord({ id }), 201))
        .mockResolvedValueOnce(jsonResponse({ data: {} }))
        .mockResolvedValueOnce(
          jsonResponse({ error: { code: "NOT_FOUND" } }, 404),
        );
      runnerSpies.destroySandbox.mockRejectedValueOnce(notFound());
      const provider = miosa({ apiKey: API_KEY });

      await provider.sandbox.create({ vcpus: 8, memory: 16384 });
      await provider.sandbox.destroy(id);
      expect(runnerSpies.destroySandbox).not.toHaveBeenCalled();

      // The entry is gone, so the id is now as unknown as any other: a second
      // destroy has to consult both endpoints instead of trusting a stale
      // "account" record.
      await provider.sandbox.destroy(id);
      expect(runnerSpies.destroySandbox).toHaveBeenCalledWith(id);
    });
  });
});
