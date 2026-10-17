import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The SDK's real RunnerClient runs against an in-memory transport, so the
// create, the address walk and the fallback to the account API are the real
// code; only the wire is scripted.
type ScriptedTransport = import("@miosa/sdk").RunnerTransport;

const wire = vi.hoisted(() => ({
  transport: undefined as ScriptedTransport | undefined,
}));

vi.mock("@miosa/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@miosa/sdk")>();
  return {
    ...actual,
    RunnerClient: vi
      .fn()
      .mockImplementation(
        (options: ConstructorParameters<typeof actual.RunnerClient>[0]) =>
          new actual.RunnerClient({ ...options, transport: wire.transport })
      ),
  };
});

import { DEFAULT_BASE_URL, closeMiosaRunnerConnections, miosa } from "../index";
import type { MiosaSandboxRecord } from "../index";

const API_KEY = "msk_test_0123456789abcdef";
const REAL_ID = "a1b2c3d4-0000-0000-0000-000000000001";
const RUNNER_URL = "https://a.run-us.miosa.ai";

function sandboxRecord(): MiosaSandboxRecord {
  return {
    id: REAL_ID,
    slug: "a1b2c3d4",
    name: "test-sandbox",
    state: "running",
    template_id: "miosa-sandbox",
    cpu_count: 1,
    memory_mb: 2048,
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

interface RunnerCall {
  addressIndex: number;
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}

type RunnerReply = {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
};

const RUN_OUTCOME = {
  exit_code: 0,
  stdout: "v22.1.0\n",
  stderr: "",
  duration_ms: 3,
};

const createdWithRun = (): RunnerReply => ({
  status: 201,
  headers: { "soma-runner-url": RUNNER_URL },
  body: { ...sandboxRecord(), run: RUN_OUTCOME },
});
const createdPlain = (): RunnerReply => ({
  status: 201,
  headers: { "soma-runner-url": RUNNER_URL },
  body: sandboxRecord(),
});
const execOk = (): RunnerReply => ({
  status: 200,
  body: { stdout: "from-exec\n", stderr: "", exit_code: 0 },
});

describe("lazy create", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let runnerCalls: RunnerCall[];

  /** Two runner addresses; `reply` scripts every request except /healthz. */
  function useRunners(reply: (call: RunnerCall) => RunnerReply): void {
    runnerCalls = [];
    wire.transport = {
      protocol: "h2",
      prewarm: () => undefined,
      addressCount: async () => 2,
      ready: async () => undefined,
      request: async (
        _hostname: string,
        addressIndex: number,
        _authority: string,
        path: string,
        init: { method: string; body?: unknown }
      ) => {
        if (path === "/healthz") {
          return { status: 200, headers: {}, body: "{}" };
        }
        const call: RunnerCall = {
          addressIndex,
          method: init.method,
          path,
          body:
            init.body === undefined
              ? undefined
              : (JSON.parse(String(init.body)) as Record<string, unknown>),
        };
        runnerCalls.push(call);
        const scripted = reply(call);
        return {
          status: scripted.status,
          headers: scripted.headers ?? {},
          body:
            scripted.body === undefined ? "" : JSON.stringify(scripted.body),
        };
      },
      streamRequest: async () => {
        throw new Error("streamRequest is not scripted");
      },
      close: async () => undefined,
    } as unknown as ScriptedTransport;
  }

  const isCreate = (call: RunnerCall): boolean =>
    call.method === "POST" && call.path === "/api/v1/sandboxes";
  const creates = (): RunnerCall[] => runnerCalls.filter(isCreate);
  const runnerPaths = (): string[] =>
    runnerCalls.map((call) => `${call.method} ${call.path}`);

  /** The account API, serving whatever a test sends to it. */
  function useAccountApi(): void {
    fetchMock.mockImplementation(
      async (url: string, init?: { method?: string }) => {
        const method = init?.method ?? "GET";
        if (url.endsWith("/exec")) {
          return jsonResponse({
            data: { stdout: "from-account-api\n", stderr: "", exit_code: 0 },
          });
        }
        if (url.endsWith("/snapshots")) {
          return jsonResponse({ id: "snap-1", sandbox_id: REAL_ID }, 201);
        }
        if (method === "DELETE" || url.endsWith("/fs/write")) {
          return jsonResponse({ data: {} });
        }
        return jsonResponse(sandboxRecord(), method === "POST" ? 201 : 200);
      }
    );
  }

  const accountApiCalls = (): string[] =>
    fetchMock.mock.calls.map(([url, init]) => {
      const method = (init as { method?: string } | undefined)?.method ?? "GET";
      return `${method} ${String(url).replace(DEFAULT_BASE_URL, "")}`;
    });

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.MIOSA_RUNNER_MODE;
    delete process.env.MIOSA_LAZY_CREATE;
    useAccountApi();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    delete process.env.MIOSA_RUNNER_MODE;
    delete process.env.MIOSA_LAZY_CREATE;
    await closeMiosaRunnerConnections();
  });

  describe("switching it on", () => {
    it("should be off by default and create eagerly", async () => {
      useRunners((call) => (isCreate(call) ? createdPlain() : execOk()));
      const provider = miosa({ apiKey: API_KEY });

      const sandbox = await provider.sandbox.create();

      expect(creates()).toHaveLength(1);
      expect(sandbox.sandboxId).toBe(REAL_ID);
    });

    it("should be enabled by the lazyCreate option", async () => {
      useRunners(() => execOk());
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });

      const sandbox = await provider.sandbox.create();

      expect(runnerCalls).toEqual([]);
      expect(sandbox.sandboxId).not.toBe(REAL_ID);
    });

    it.each(["1", "true", "TRUE"])(
      "should be enabled by MIOSA_LAZY_CREATE=%s",
      async (value) => {
        process.env.MIOSA_LAZY_CREATE = value;
        useRunners(() => execOk());
        const provider = miosa({ apiKey: API_KEY });

        await provider.sandbox.create();

        expect(runnerCalls).toEqual([]);
      }
    );

    it.each(["0", "false", "", "yes"])(
      "should stay off for MIOSA_LAZY_CREATE=%j",
      async (value) => {
        process.env.MIOSA_LAZY_CREATE = value;
        useRunners((call) => (isCreate(call) ? createdPlain() : execOk()));
        const provider = miosa({ apiKey: API_KEY });

        await provider.sandbox.create();

        expect(creates()).toHaveLength(1);
      }
    );

    it("should let lazyCreate: false override the environment", async () => {
      process.env.MIOSA_LAZY_CREATE = "1";
      useRunners((call) => (isCreate(call) ? createdPlain() : execOk()));
      const provider = miosa({ apiKey: API_KEY, lazyCreate: false });

      await provider.sandbox.create();

      expect(creates()).toHaveLength(1);
    });

    it("should create eagerly on the account API when the regional endpoint is off", async () => {
      useRunners(() => execOk());
      const provider = miosa({
        apiKey: API_KEY,
        lazyCreate: true,
        runnerMode: false,
      });

      const sandbox = await provider.sandbox.create();

      expect(accountApiCalls()).toEqual(["POST /sandboxes"]);
      expect(sandbox.sandboxId).toBe(REAL_ID);
    });
  });

  describe("create", () => {
    it("should return a handle without any network call", async () => {
      useRunners(() => execOk());
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });

      const sandbox = await provider.sandbox.create();

      expect(runnerCalls).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(sandbox.provider).toBe("miosa");
    });

    it("should give each handle its own placeholder id", async () => {
      useRunners(() => execOk());
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });

      const first = await provider.sandbox.create();
      const second = await provider.sandbox.create();

      expect(first.sandboxId).not.toBe(second.sandboxId);
    });

    it("should still reject a missing API key at create time", async () => {
      delete process.env.MIOSA_API_KEY;
      const provider = miosa({ lazyCreate: true });

      await expect(provider.sandbox.create()).rejects.toThrow(
        /Missing MIOSA API key/
      );
    });
  });

  describe("first runCommand", () => {
    it("should create and run in one request and return the command's result", async () => {
      useRunners((call) => (isCreate(call) ? createdWithRun() : execOk()));
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await provider.sandbox.create();

      const result = await sandbox.runCommand("node -v");

      expect(runnerPaths()).toEqual(["POST /api/v1/sandboxes"]);
      expect(creates()[0]?.body).toMatchObject({
        run: { command: "node -v", timeout_ms: 30_000 },
      });
      expect(result).toMatchObject({
        stdout: "v22.1.0\n",
        stderr: "",
        exitCode: 0,
        durationMs: 3,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should keep the create body the eager create would have sent", async () => {
      useRunners((call) => (isCreate(call) ? createdWithRun() : execOk()));
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await provider.sandbox.create({ timeout: 60_000 });

      await sandbox.runCommand("node -v");

      expect(creates()[0]?.body).toMatchObject({
        wait: true,
        response_format: "compact",
        persistent: false,
        timeout_sec: 60,
      });
    });

    it("should send the caller's timeout as timeout_ms", async () => {
      useRunners((call) => (isCreate(call) ? createdWithRun() : execOk()));
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await provider.sandbox.create();

      await sandbox.runCommand("node -v", { timeout: 4000 });

      expect(creates()[0]?.body).toMatchObject({
        run: { command: "node -v", timeout_ms: 4000 },
      });
    });

    it("should report a failing command as a result, not an error", async () => {
      useRunners((call) =>
        isCreate(call)
          ? {
              ...createdWithRun(),
              body: {
                ...sandboxRecord(),
                run: {
                  exit_code: 2,
                  stdout: "",
                  stderr: "nope",
                  duration_ms: 1,
                },
              },
            }
          : execOk()
      );
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await provider.sandbox.create();

      const result = await sandbox.runCommand("false");

      expect(result).toMatchObject({ exitCode: 2, stderr: "nope" });
    });

    it("should run the second command as an ordinary exec on the created sandbox", async () => {
      useRunners((call) => (isCreate(call) ? createdWithRun() : execOk()));
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await provider.sandbox.create();

      await sandbox.runCommand("node -v");
      const second = await sandbox.runCommand("echo hi");

      expect(runnerPaths()).toEqual([
        "POST /api/v1/sandboxes",
        `POST /api/v1/sandboxes/${REAL_ID}/exec`,
      ]);
      expect(second.stdout).toBe("from-exec\n");
      expect(creates()).toHaveLength(1);
    });

    it("should create without a run and then exec when the runner ignores the field", async () => {
      useRunners((call) => (isCreate(call) ? createdPlain() : execOk()));
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await provider.sandbox.create();

      const result = await sandbox.runCommand("node -v");

      expect(runnerPaths()).toEqual([
        "POST /api/v1/sandboxes",
        `POST /api/v1/sandboxes/${REAL_ID}/exec`,
      ]);
      expect(creates()).toHaveLength(1);
      expect(result.stdout).toBe("from-exec\n");
    });

    it.each([
      ["a working directory", { cwd: "/work" }],
      ["environment variables", { env: { A: "1" } }],
    ])(
      "should create first and exec normally when the command needs %s",
      async (_name, options) => {
        useRunners((call) => (isCreate(call) ? createdPlain() : execOk()));
        const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
        const sandbox = await provider.sandbox.create();

        const result = await sandbox.runCommand("node -v", options);

        expect(creates()).toHaveLength(1);
        expect(creates()[0]?.body).not.toHaveProperty("run");
        expect(runnerPaths()).toContain(
          `POST /api/v1/sandboxes/${REAL_ID}/exec`
        );
        expect(result.stdout).toBe("from-exec\n");
      }
    );

    it("should hand a shape the runner does not serve to the account API without the run field", async () => {
      useRunners(() => execOk());
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await provider.sandbox.create({
        vcpus: 8,
        memory: 16384,
      });

      const result = await sandbox.runCommand("node -v");

      expect(runnerCalls).toEqual([]);
      const [createCall] = fetchMock.mock.calls;
      expect(String(createCall?.[0])).toBe(`${DEFAULT_BASE_URL}/sandboxes`);
      const sent = JSON.parse(
        String((createCall?.[1] as { body: string }).body)
      ) as Record<string, unknown>;
      expect(sent).toMatchObject({ size: "large" });
      expect(sent).not.toHaveProperty("run");
      expect(accountApiCalls()).toContain(`POST /sandboxes/${REAL_ID}/exec`);
      expect(result.stdout).toBe("from-account-api\n");
    });

    it("should strip the run field when the runner refuses the request and the account API takes it", async () => {
      useRunners((call) =>
        isCreate(call)
          ? {
              status: 400,
              body: { error: { code: "RUNNER_UNSUPPORTED_REQUEST" } },
            }
          : execOk()
      );
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await provider.sandbox.create();

      const result = await sandbox.runCommand("node -v");

      const sent = JSON.parse(
        String((fetchMock.mock.calls[0]?.[1] as { body: string }).body)
      ) as Record<string, unknown>;
      expect(sent).not.toHaveProperty("run");
      expect(result.stdout).toBe("from-account-api\n");
    });
  });

  describe("any other first call", () => {
    it("should create the sandbox before writing a file", async () => {
      useRunners((call) => (isCreate(call) ? createdPlain() : execOk()));
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await provider.sandbox.create();

      await sandbox.filesystem.writeFile("/work/a.txt", "hi");

      expect(creates()).toHaveLength(1);
      expect(creates()[0]?.body).not.toHaveProperty("run");
      expect(accountApiCalls()).toEqual([
        `POST /sandboxes/${REAL_ID}/fs/write`,
      ]);
    });

    it("should create the sandbox before reporting its info", async () => {
      useRunners((call) => (isCreate(call) ? createdPlain() : execOk()));
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await provider.sandbox.create();

      const info = await sandbox.getInfo();

      expect(creates()).toHaveLength(1);
      expect(info.id).toBe(REAL_ID);
    });

    it("should create the sandbox when it is looked up by its placeholder id", async () => {
      useRunners((call) => (isCreate(call) ? createdPlain() : execOk()));
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await provider.sandbox.create();

      const found = await provider.sandbox.getById(sandbox.sandboxId);

      expect(creates()).toHaveLength(1);
      expect(found?.sandboxId).toBe(REAL_ID);
    });

    it("should create the sandbox before snapshotting it by its placeholder id", async () => {
      useRunners((call) => (isCreate(call) ? createdPlain() : execOk()));
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await provider.sandbox.create();

      await provider.snapshot?.create(sandbox.sandboxId, { name: "s" });

      expect(creates()).toHaveLength(1);
      expect(accountApiCalls()).toContain(
        `POST /sandboxes/${REAL_ID}/snapshots`
      );
    });

    it("should exec normally after a non-command call created the sandbox", async () => {
      useRunners((call) => (isCreate(call) ? createdPlain() : execOk()));
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await provider.sandbox.create();

      await sandbox.filesystem.writeFile("/work/a.txt", "hi");
      const result = await sandbox.runCommand("node -v");

      expect(creates()).toHaveLength(1);
      expect(result.stdout).toBe("from-exec\n");
    });

    it("should send one create for a command and a file write started together", async () => {
      useRunners((call) => (isCreate(call) ? createdWithRun() : execOk()));
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await provider.sandbox.create();

      const [command] = await Promise.all([
        sandbox.runCommand("node -v"),
        sandbox.filesystem.writeFile("/work/a.txt", "hi"),
      ]);

      expect(creates()).toHaveLength(1);
      expect(command.stdout).toBe("v22.1.0\n");
      expect(accountApiCalls()).toEqual([
        `POST /sandboxes/${REAL_ID}/fs/write`,
      ]);
    });

    it("should give two commands started together one create and one ordinary exec", async () => {
      useRunners((call) => (isCreate(call) ? createdWithRun() : execOk()));
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await provider.sandbox.create();

      const [first, second] = await Promise.all([
        sandbox.runCommand("node -v"),
        sandbox.runCommand("echo hi"),
      ]);

      expect(creates()).toHaveLength(1);
      expect(first.stdout).toBe("v22.1.0\n");
      expect(second.stdout).toBe("from-exec\n");
    });
  });

  describe("errors", () => {
    it("should surface a runner create error on the first command as the error an eager create raises", async () => {
      useRunners((call) =>
        isCreate(call)
          ? { status: 500, body: { error: "internal_error" } }
          : execOk()
      );
      const eager = miosa({ apiKey: API_KEY });
      const eagerError = await eager.sandbox.create().then(
        () => undefined,
        (error: unknown) => error
      );
      const lazyProvider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await lazyProvider.sandbox.create();

      const lazyError = await sandbox.runCommand("node -v").then(
        () => undefined,
        (error: unknown) => error
      );

      expect(eagerError).toBeInstanceOf(Error);
      expect(lazyError).toBeInstanceOf(Error);
      expect((lazyError as Error).name).toBe((eagerError as Error).name);
      expect((lazyError as Error).message).toBe((eagerError as Error).message);
    });

    it("should surface an account API create error with the same type an eager create raises", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ error: { code: "TENANT_RESOLUTION_FAILED" } }, 422)
      );
      useRunners(() => execOk());
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await provider.sandbox.create({ vcpus: 8 });

      const error = await sandbox.runCommand("node -v").then(
        () => undefined,
        (caught: unknown) => caught
      );

      expect((error as Error).name).toBe("MiosaApiError");
      expect((error as Error).message).toMatch(/TENANT_RESOLUTION_FAILED/);
    });

    it("should raise the same error on every later call and send no second create", async () => {
      useRunners((call) =>
        isCreate(call)
          ? { status: 500, body: { error: "internal_error" } }
          : execOk()
      );
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await provider.sandbox.create();

      const first = await sandbox
        .runCommand("node -v")
        .catch((e: unknown) => e);
      const second = await sandbox.getInfo().catch((e: unknown) => e);
      const third = await sandbox.filesystem
        .writeFile("/a", "b")
        .catch((e: unknown) => e);

      expect(creates()).toHaveLength(1);
      expect(second).toBe(first);
      expect(third).toBe(first);
    });

    it("should not fall back to the account API after a timeout that may have reached the runner", async () => {
      useRunners((call) => {
        if (isCreate(call)) {
          throw new RunnerTimeoutErrorForTest();
        }
        return execOk();
      });
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await provider.sandbox.create();

      await expect(sandbox.runCommand("node -v")).rejects.toThrow(/timed out/);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("destroy", () => {
    it("should be a no-op for a sandbox that was never created", async () => {
      useRunners(() => execOk());
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await provider.sandbox.create();

      await sandbox.destroy();

      expect(runnerCalls).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should be a no-op when destroyed by placeholder id through the provider", async () => {
      useRunners(() => execOk());
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await provider.sandbox.create();

      await provider.sandbox.destroy(sandbox.sandboxId);

      expect(runnerCalls).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should not create a sandbox for a handle that was destroyed unused", async () => {
      useRunners((call) => (isCreate(call) ? createdWithRun() : execOk()));
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await provider.sandbox.create();
      await sandbox.destroy();

      await expect(sandbox.runCommand("node -v")).rejects.toThrow(/destroyed/);

      expect(creates()).toEqual([]);
    });

    it("should destroy the real sandbox on the runner once it was created", async () => {
      useRunners((call) => {
        if (isCreate(call)) return createdWithRun();
        if (call.method === "DELETE") return { status: 200, body: {} };
        return execOk();
      });
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await provider.sandbox.create();
      await sandbox.runCommand("node -v");

      await sandbox.destroy();

      expect(runnerPaths()).toEqual([
        "POST /api/v1/sandboxes",
        `DELETE /api/v1/sandboxes/${REAL_ID}`,
      ]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should destroy a sandbox on the account API when that is where its create landed", async () => {
      useRunners(() => execOk());
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await provider.sandbox.create({ vcpus: 8 });
      await sandbox.runCommand("node -v");

      await sandbox.destroy();

      expect(accountApiCalls()).toContain(`DELETE /sandboxes/${REAL_ID}`);
      expect(runnerCalls).toEqual([]);
    });

    it("should destroy nothing when the create failed", async () => {
      useRunners((call) =>
        isCreate(call)
          ? { status: 500, body: { error: "internal_error" } }
          : execOk()
      );
      const provider = miosa({ apiKey: API_KEY, lazyCreate: true });
      const sandbox = await provider.sandbox.create();
      await sandbox.runCommand("node -v").catch(() => undefined);

      await sandbox.destroy();

      expect(runnerPaths()).toEqual(["POST /api/v1/sandboxes"]);
    });
  });
});

/** The SDK's own timeout error, raised after the request was sent. */
class RunnerTimeoutErrorForTest extends Error {
  constructor() {
    super("runner request to run-us.miosa.ai/api/v1/sandboxes timed out");
    this.name = "RunnerTimeoutError";
  }
}
