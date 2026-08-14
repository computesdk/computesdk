import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const command = {
    exec: vi.fn(),
    execAsync: vi.fn(),
  };
  const file = {
    read: vi.fn(),
    write: vi.fn(),
  };
  const nativeDevbox = { command, cmd: command, file };
  const executions = {
    kill: vi.fn(),
    streamStdoutUpdates: vi.fn(),
    streamStderrUpdates: vi.fn(),
  };
  const devboxes = {
    createAndAwaitRunning: vi.fn(),
    retrieve: vi.fn(),
    list: vi.fn(),
    shutdown: vi.fn(),
    enableTunnel: vi.fn(),
    snapshotDisk: vi.fn(),
    listDiskSnapshots: vi.fn(),
    deleteDiskSnapshot: vi.fn(),
    executions,
  };
  const blueprints = {
    create: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
  };
  const client = {
    api: { devboxes, blueprints },
    devbox: { fromId: vi.fn(() => nativeDevbox) },
  };
  return { command, file, nativeDevbox, executions, devboxes, blueprints, client };
});

vi.mock("@runloop/api-client", () => ({
  RunloopSDK: vi.fn(() => mocks.client),
}));

import { runloop } from "../index";

type DevboxStatus =
  | "scheduled"
  | "queued"
  | "provisioning"
  | "initializing"
  | "running"
  | "suspending"
  | "suspended"
  | "resuming"
  | "failure"
  | "shutdown";

function devbox(status: DevboxStatus = "running", id = "devbox-1") {
  return {
    id,
    capabilities: [],
    create_time_ms: 1_700_000_000_000,
    end_time_ms: null,
    launch_parameters: { keep_alive_time_seconds: 90 },
    metadata: { team: "compute" },
    state_transitions: [],
    status,
    blueprint_id: "bpt_1",
  };
}

function result(stdout = "", stderr = "", exitCode: number | null = 0) {
  return {
    stdout: vi.fn().mockResolvedValue(stdout),
    stderr: vi.fn().mockResolvedValue(stderr),
    exitCode,
  };
}

function paginated<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

function quote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function getSandbox() {
  const provider = runloop({ apiKey: "test-key" });
  const sandbox = await provider.sandbox.getById("devbox-1");
  expect(sandbox).not.toBeNull();
  return { provider, sandbox: sandbox! };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.client.devbox.fromId.mockReturnValue(mocks.nativeDevbox);
  mocks.devboxes.retrieve.mockResolvedValue(devbox());
  mocks.devboxes.createAndAwaitRunning.mockResolvedValue(devbox());
  mocks.devboxes.list.mockReturnValue(paginated([]));
  mocks.devboxes.shutdown.mockResolvedValue(devbox("shutdown"));
  mocks.devboxes.snapshotDisk.mockResolvedValue(snapshot("snapshot-created"));
  mocks.devboxes.listDiskSnapshots.mockReturnValue(paginated([]));
  mocks.executions.kill.mockResolvedValue(undefined);
  mocks.executions.streamStdoutUpdates.mockResolvedValue(paginated([]));
  mocks.executions.streamStderrUpdates.mockResolvedValue(paginated([]));
  mocks.command.exec.mockResolvedValue(result());
  mocks.file.read.mockResolvedValue("");
  mocks.file.write.mockResolvedValue(undefined);
  mocks.blueprints.list.mockReturnValue(paginated([]));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Runloop command execution", () => {
  it("retrieves complete stdout and stderr through ExecutionResult", async () => {
    const executionResult = result("line\n".repeat(150), "warning\n".repeat(120), 7);
    mocks.command.exec.mockResolvedValue(executionResult);
    const { sandbox } = await getSandbox();

    const commandResult = await sandbox.runCommand("generate-output");

    expect(commandResult).toMatchObject({
      stdout: "line\n".repeat(150),
      stderr: "warning\n".repeat(120),
      exitCode: 7,
    });
    expect(executionResult.stdout).toHaveBeenCalledOnce();
    expect(executionResult.stderr).toHaveBeenCalledOnce();
    expect(mocks.client.devbox.fromId).toHaveBeenCalledWith("devbox-1");
  });

  it("streams native stdout and stderr callbacks and preserves missing exit status", async () => {
    mocks.command.exec.mockImplementation(async (_command, params) => {
      params.stdout?.("out-1\n");
      params.stderr?.("err-1\n");
      return result("out-1\n", "err-1\n", null);
    });
    const onStdout = vi.fn();
    const onStderr = vi.fn();
    const { sandbox } = await getSandbox();

    const commandResult = await sandbox.runCommand("stream", { onStdout, onStderr });

    expect(onStdout).toHaveBeenCalledWith("out-1\n");
    expect(onStderr).toHaveBeenCalledWith("err-1\n");
    expect(commandResult.exitCode).toBe(-1);
  });

  it("safely quotes cwd and environment values and validates environment keys", async () => {
    const { sandbox } = await getSandbox();
    const cwd = "/tmp/it's $HOME";
    const envValue = "a' $(touch /tmp/pwned)\nnext";
    await sandbox.runCommand("printf done", {
      cwd,
      env: { SAFE_VALUE: envValue },
      background: true,
    });

    const foreground = `cd -- ${quote(cwd)} && SAFE_VALUE=${quote(envValue)} printf done`;
    expect(mocks.command.exec).toHaveBeenCalledWith(
      `nohup sh -lc ${quote(foreground)} >/dev/null 2>&1 &`,
      {},
    );

    await expect(sandbox.runCommand("true", { env: { "BAD-NAME": "x" } }))
      .rejects.toThrow("Invalid environment variable name");
  });

  it("cancels a timed-out async execution, returns 124, and stops callbacks", async () => {
    vi.useFakeTimers();
    mocks.executions.kill.mockRejectedValueOnce(new Error("kill request failed"));
    mocks.executions.streamStdoutUpdates.mockImplementation(async (
      _devboxId,
      _executionId,
      _params,
      requestOptions,
    ) => ({
      async *[Symbol.asyncIterator]() {
        yield { output: "before-timeout\n" };
        await new Promise<void>((resolve) => {
          requestOptions.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        yield { output: "after-timeout\n" };
      },
    }));
    mocks.command.execAsync.mockResolvedValue({
      executionId: "exec-1",
      result: ({ signal }: { signal: AbortSignal }) => new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("monitor aborted")), { once: true });
      }),
    });
    const onStdout = vi.fn();
    const { sandbox } = await getSandbox();

    const running = sandbox.runCommand("sleep 60", { timeout: 50, onStdout });
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(40);
    const commandResult = await running;

    expect(commandResult.exitCode).toBe(124);
    expect(mocks.executions.kill).toHaveBeenCalledWith(
      "devbox-1",
      "exec-1",
      { kill_process_group: true },
    );
    expect(onStdout).toHaveBeenCalledTimes(1);
    expect(onStdout).toHaveBeenCalledWith("before-timeout\n");
  });
});

describe("Runloop lifecycle and listing", () => {
  it("deep-merges launch parameters while retaining the calculated keep-alive", async () => {
    const provider = runloop({ apiKey: "test-key" });
    await provider.sandbox.create({
      timeout: 2_500,
      launch_parameters: {
        keep_alive_time_seconds: 999,
        resource_size_request: "CUSTOM_SIZE",
        custom_cpu_cores: 4,
        lifecycle: { resume_triggers: { http: true } },
      },
    });

    expect(mocks.devboxes.createAndAwaitRunning).toHaveBeenCalledWith(
      expect.objectContaining({
        launch_parameters: {
          keep_alive_time_seconds: 3,
          resource_size_request: "CUSTOM_SIZE",
          custom_cpu_cores: 4,
          lifecycle: { resume_triggers: { http: true } },
        },
      }),
      { longPoll: { timeoutMs: 2_500 } },
    );

    await provider.sandbox.create({
      launch_parameters: {
        keep_alive_time_seconds: 999,
        resource_size_request: "LARGE",
      },
    });
    expect(mocks.devboxes.createAndAwaitRunning).toHaveBeenLastCalledWith(
      expect.objectContaining({
        launch_parameters: {
          keep_alive_time_seconds: 999,
          resource_size_request: "LARGE",
        },
      }),
      undefined,
    );
  });

  it.each([
    ["scheduled", "running"],
    ["queued", "running"],
    ["provisioning", "running"],
    ["initializing", "running"],
    ["resuming", "running"],
    ["running", "running"],
    ["suspending", "stopped"],
    ["suspended", "stopped"],
    ["shutdown", "stopped"],
    ["failure", "error"],
  ] as const)("refreshes and maps %s to %s", async (nativeStatus, expectedStatus) => {
    const { sandbox } = await getSandbox();
    mocks.devboxes.retrieve.mockResolvedValue(devbox(nativeStatus));

    const info = await sandbox.getInfo();

    expect(info.status).toBe(expectedStatus);
    expect(info.timeout).toBe(90_000);
    expect(mocks.devboxes.retrieve).toHaveBeenLastCalledWith("devbox-1");
  });

  it("suppresses only HTTP 404 for getById and destroy", async () => {
    const provider = runloop({ apiKey: "test-key" });
    mocks.devboxes.retrieve.mockRejectedValueOnce({ status: 404 });
    await expect(provider.sandbox.getById("missing")).resolves.toBeNull();

    mocks.devboxes.retrieve.mockRejectedValueOnce({ status: 401 });
    await expect(provider.sandbox.getById("private")).rejects.toMatchObject({ status: 401 });

    mocks.devboxes.shutdown.mockRejectedValueOnce({ status: 404 });
    await expect(provider.sandbox.destroy("missing")).resolves.toBeUndefined();

    mocks.devboxes.shutdown.mockRejectedValueOnce({ status: 503 });
    await expect(provider.sandbox.destroy("unavailable")).rejects.toMatchObject({ status: 503 });
  });

  it("exhausts sandbox pagination and surfaces list failures", async () => {
    const provider = runloop({ apiKey: "test-key" });
    mocks.devboxes.list.mockReturnValue(paginated([devbox("running", "one"), devbox("suspended", "two")]));

    const sandboxes = await provider.sandbox.list();
    expect(sandboxes.map((item) => item.sandboxId)).toEqual(["one", "two"]);

    mocks.devboxes.list.mockReturnValueOnce({
      async *[Symbol.asyncIterator]() { throw new Error("network down"); },
    });
    await expect(provider.sandbox.list()).rejects.toThrow("network down");
  });

  it("exhausts template pagination while respecting an explicit limit", async () => {
    const provider = runloop({ apiKey: "test-key" });
    mocks.blueprints.list.mockReturnValue(paginated([
      { id: "bpt_1" }, { id: "bpt_2" }, { id: "bpt_3" },
    ]));

    const templates = await provider.template!.list({ limit: 2 });

    expect(templates.map((item) => item.id)).toEqual(["bpt_1", "bpt_2"]);
    expect(mocks.blueprints.list).toHaveBeenCalledWith({ limit: 2 });
  });
});

function snapshot(id: string) {
  return {
    id,
    create_time_ms: 1_710_000_000_000,
    metadata: { purpose: "test" },
    source_devbox_id: "devbox-1",
    source_blueprint_id: "bpt_1",
    name: "checkpoint",
    size_bytes: 12_345,
    commit_message: "before migration",
  };
}

describe("Runloop snapshots", () => {
  it("normalizes created snapshots", async () => {
    const provider = runloop({ apiKey: "test-key" });

    const created = await provider.snapshot!.create("devbox-1", {
      name: "checkpoint",
      metadata: { purpose: "test" },
    });

    expect(mocks.devboxes.snapshotDisk).toHaveBeenCalledWith("devbox-1", {
      name: "checkpoint",
      metadata: { purpose: "test" },
    });
    expect(created).toEqual({
      id: "snapshot-created",
      provider: "runloop",
      createdAt: new Date(1_710_000_000_000),
      metadata: {
        purpose: "test",
        name: "checkpoint",
        sourceDevboxId: "devbox-1",
        sourceBlueprintId: "bpt_1",
        sizeBytes: 12_345,
        commitMessage: "before migration",
      },
    });
  });

  it("paginates, filters by devbox, normalizes, and honors list limits", async () => {
    const provider = runloop({ apiKey: "test-key" });
    mocks.devboxes.listDiskSnapshots.mockReturnValue(paginated([
      snapshot("snp_1"), snapshot("snp_2"), snapshot("snp_3"),
    ]));

    const snapshots = await provider.snapshot!.list({ sandboxId: "devbox-1", limit: 2 });

    expect(snapshots.map((item) => item.id)).toEqual(["snp_1", "snp_2"]);
    expect(snapshots.every((item) => item.provider === "runloop")).toBe(true);
    expect(mocks.devboxes.listDiskSnapshots).toHaveBeenCalledWith({
      devbox_id: "devbox-1",
      limit: 2,
    });
  });
});

describe("Runloop filesystem", () => {
  it("uses native UTF-8 reads and writes for large hostile content", async () => {
    const content = `large-$\{HOME\}-$(touch nope)-'\n${"x".repeat(1_000_000)}`;
    const hostilePath = "/tmp/a path/'quote'/$(touch nope)\nfile.txt";
    mocks.file.read.mockResolvedValue(content);
    const { sandbox } = await getSandbox();

    await sandbox.filesystem.writeFile(hostilePath, content);
    const read = await sandbox.filesystem.readFile(hostilePath);

    expect(mocks.file.write).toHaveBeenCalledWith({ file_path: hostilePath, contents: content });
    expect(mocks.file.read).toHaveBeenCalledWith({ file_path: hostilePath });
    expect(read).toBe(content);
    expect(mocks.command.exec).not.toHaveBeenCalled();
  });

  it("decodes structured directory metadata including newline-containing names", async () => {
    const names = ["space name.txt", "quote'$(touch nope)\nname"];
    const stdout = [
      `${Buffer.from(names[0]).toString("base64")}\tfile\t42\t1710000000`,
      `${Buffer.from(names[1]).toString("base64")}\tdirectory\t4096\t1710000001`,
      "",
    ].join("\n");
    mocks.command.exec.mockResolvedValue(result(stdout));
    const { sandbox } = await getSandbox();

    const entries = await sandbox.filesystem.readdir("/tmp/a path/'quoted'\nroot");

    expect(entries).toEqual([
      { name: names[0], type: "file", size: 42, modified: new Date(1_710_000_000_000) },
      { name: names[1], type: "directory", size: 4096, modified: new Date(1_710_000_001_000) },
    ]);
    expect(mocks.command.exec.mock.calls[0][0]).toContain("find -- '/tmp/a path/'\"'\"'quoted'\"'\"'\nroot'");
    expect(mocks.command.exec.mock.calls[0][0]).not.toContain("ls -la");
  });

  it("quotes shell fallback paths, terminates options, and guards deletion roots", async () => {
    const hostilePath = "-dir/'quote'/$(touch nope)\nname";
    const { sandbox } = await getSandbox();

    await sandbox.filesystem.mkdir(hostilePath);
    expect(mocks.command.exec.mock.calls.at(-1)?.[0]).toBe(
      `mkdir -p -- '-dir/'"'"'quote'"'"'/$(touch nope)\nname'`,
    );

    await expect(sandbox.filesystem.exists(hostilePath)).resolves.toBe(true);
    expect(mocks.command.exec.mock.calls.at(-1)?.[0]).toBe(
      `test -e '-dir/'"'"'quote'"'"'/$(touch nope)\nname'`,
    );

    await sandbox.filesystem.remove(hostilePath);
    expect(mocks.command.exec.mock.calls.at(-1)?.[0]).toBe(
      `rm -rf -- '-dir/'"'"'quote'"'"'/$(touch nope)\nname'`,
    );

    await expect(sandbox.filesystem.remove("/")).rejects.toThrow("unsafe path");
    await expect(sandbox.filesystem.remove("/tmp/..")).rejects.toThrow("unsafe path");
    await expect(sandbox.filesystem.remove(".")).rejects.toThrow("unsafe path");
    await expect(sandbox.filesystem.remove("")).rejects.toThrow("unsafe path");
  });
});
