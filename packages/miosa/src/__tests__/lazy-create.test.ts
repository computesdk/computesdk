import { describe, expect, it } from "vitest";

import {
  LazyCreate,
  canRunInCreate,
  isPlaceholderId,
  placeholderId,
  readRun,
  withRun,
  withoutRun,
  RunRefused,
  isRunRefusal,
} from "../lazy-create";

describe("create-and-run contract", () => {
  describe("withRun", () => {
    it("should add the command and timeout under run without touching the rest", () => {
      const body = { wait: true, persistent: false };

      const actual = withRun(body, { command: "node -v", timeoutMs: 5000 });

      expect(actual).toEqual({
        wait: true,
        persistent: false,
        run: { command: "node -v", timeout_ms: 5000 },
      });
      expect(body).toEqual({ wait: true, persistent: false });
    });
  });

  describe("withRun without a timeout", () => {
    it("should leave timeout_ms out so the runner's default applies", () => {
      expect(withRun({}, { command: "node -v" })).toEqual({
        run: { command: "node -v" },
      });
    });
  });

  describe("withoutRun", () => {
    it("should remove the run field and keep everything else", () => {
      const actual = withoutRun({
        wait: true,
        run: { command: "x", timeout_ms: 1 },
      });

      expect(actual).toEqual({ wait: true });
    });

    it("should leave a body without run unchanged", () => {
      expect(withoutRun({ wait: true })).toEqual({ wait: true });
    });
  });

  describe("readRun", () => {
    it("should read the outcome from a flat create response", () => {
      const actual = readRun({
        id: "a",
        run: { exit_code: 0, stdout: "v22\n", stderr: "", duration_ms: 4 },
      });

      expect(actual).toEqual({
        exitCode: 0,
        error: undefined,
        stdout: "v22\n",
        stderr: "",
        durationMs: 4,
      });
    });

    it("should read the outcome from a response wrapped in data", () => {
      const actual = readRun({
        data: { id: "a", run: { exit_code: 3, stdout: "", stderr: "boom" } },
      });

      expect(actual).toEqual({
        exitCode: 3,
        error: undefined,
        stdout: "",
        stderr: "boom",
        durationMs: undefined,
      });
    });

    it("should read a null error as a command that ended", () => {
      const actual = readRun({
        run: { exit_code: 0, error: null, stdout: "x", stderr: "" },
      });

      expect(actual).toMatchObject({ exitCode: 0, error: undefined });
    });

    it("should read a command with no result from the exec error object", () => {
      const actual = readRun({
        run: {
          exit_code: null,
          error: { code: "EXEC_TIMEOUT", message: "deadline exceeded" },
          stdout: "partial",
          stderr: "",
          duration_ms: 30000,
        },
      });

      expect(actual).toEqual({
        exitCode: null,
        error: "deadline exceeded",
        stdout: "partial",
        stderr: "",
        durationMs: 30000,
      });
    });

    it("should name an error object that carries only a code", () => {
      const actual = readRun({
        run: { exit_code: null, error: { code: "EXEC_SPAWN_FAILED" } },
      });

      expect(actual?.error).toBe("EXEC_SPAWN_FAILED");
    });

    it.each([
      ["no run field", { id: "a" }],
      ["a run that is not an object", { id: "a", run: "done" }],
      ["a null run", { id: "a", run: null }],
      ["a run without an exit code", { id: "a", run: { stdout: "x" } }],
      [
        "an exit code that is not a number",
        { id: "a", run: { exit_code: "0" } },
      ],
    ])("should report no outcome for %s", (_name, response) => {
      expect(readRun(response)).toBeUndefined();
    });

    it("should report no outcome for an undefined response", () => {
      expect(readRun(undefined)).toBeUndefined();
    });
  });

  describe("canRunInCreate", () => {
    it("should allow a bare command and one with only a timeout", () => {
      expect(canRunInCreate()).toBe(true);
      expect(canRunInCreate({})).toBe(true);
    });

    it.each([
      ["a working directory", { cwd: "/work" }],
      ["environment variables", { env: { A: "1" } }],
      ["background mode", { background: true }],
    ])("should refuse %s, which the request cannot carry", (_name, options) => {
      expect(canRunInCreate(options)).toBe(false);
    });
  });

  describe("isRunRefusal", () => {
    const runnerError = (status: number, code: string) =>
      Object.assign(new Error(code), { name: "RunnerError", status, code });

    it.each([
      [400, "MISSING_PARAM"],
      [400, "INVALID_PARAM"],
      [400, "INVALID_TIMEOUT"],
      [400, "EXEC_TIMEOUT_UNSUPPORTED"],
      [413, "RUNNER_COMMAND_TOO_LARGE"],
    ])("should recognise %i %s", (status, code) => {
      expect(isRunRefusal(runnerError(status, code))).toBe(true);
    });

    it.each([
      [400, "RUNNER_UNSUPPORTED_REQUEST"],
      [429, "rate_limited"],
      [500, "internal_error"],
      [400, "NOT_FOUND"],
    ])("should not recognise %i %s", (status, code) => {
      expect(isRunRefusal(runnerError(status, code))).toBe(false);
    });

    it("should not recognise an error that is not from the runner", () => {
      expect(isRunRefusal(new Error("INVALID_PARAM"))).toBe(false);
      expect(isRunRefusal("INVALID_PARAM")).toBe(false);
    });
  });

  describe("placeholder ids", () => {
    it("should mint distinct ids that are recognised as placeholders", () => {
      const first = placeholderId();
      const second = placeholderId();

      expect(first).not.toBe(second);
      expect(isPlaceholderId(first)).toBe(true);
    });

    it("should not mistake a real sandbox id for a placeholder", () => {
      expect(isPlaceholderId("a1b2c3d4-0000-0000-0000-000000000001")).toBe(
        false
      );
    });
  });
});

describe("LazyCreate", () => {
  const run = { command: "node -v", timeoutMs: 1000 };

  it("should not call create until the first call", () => {
    let calls = 0;
    const lazy = new LazyCreate(async () => ++calls);

    expect(lazy.started).toBe(false);
    expect(calls).toBe(0);
  });

  it("should start one create for any number of concurrent first calls", async () => {
    let calls = 0;
    const lazy = new LazyCreate(async () => ++calls);

    const first = lazy.begin(run);
    const second = lazy.begin();
    const third = lazy.begin(run);

    expect(await first.result).toBe(1);
    expect(await second.result).toBe(1);
    expect(await third.result).toBe(1);
    expect(calls).toBe(1);
  });

  it("should mark only the call that started the create as the starter", () => {
    const lazy = new LazyCreate(async () => "created");

    const first = lazy.begin(run);
    const second = lazy.begin(run);

    expect(first.starter).toBe(true);
    expect(second.starter).toBe(false);
  });

  it("should hand the starter's run to create and no run when none was given", async () => {
    const seen: unknown[] = [];
    const withCommand = new LazyCreate(async (r) => seen.push(r));
    const withoutCommand = new LazyCreate(async (r) => seen.push(r));

    await withCommand.begin(run).result;
    await withoutCommand.begin().result;

    expect(seen).toEqual([run, undefined]);
  });

  it("should never send a failed create again and repeat the same error", async () => {
    let calls = 0;
    const failure = new Error("create failed");
    const lazy = new LazyCreate<number>(async () => {
      calls += 1;
      throw failure;
    });

    await expect(lazy.begin(run).result).rejects.toBe(failure);
    await expect(lazy.begin().result).rejects.toBe(failure);
    await expect(lazy.begin(run).result).rejects.toBe(failure);

    expect(calls).toBe(1);
  });

  describe("settled", () => {
    it("should resolve undefined when no create started", async () => {
      const lazy = new LazyCreate(async () => "created");

      expect(await lazy.settled()).toBeUndefined();
      expect(lazy.started).toBe(false);
    });

    it("should wait for a create that is in flight", async () => {
      const lazy = new LazyCreate(async () => "created");
      lazy.begin();

      expect(await lazy.settled()).toBe("created");
    });

    it("should resolve undefined instead of throwing when the create failed", async () => {
      const lazy = new LazyCreate<string>(async () => {
        throw new Error("create failed");
      });
      await lazy.begin().result.catch(() => undefined);

      expect(await lazy.settled()).toBeUndefined();
    });
  });

  describe("a refused run", () => {
    it("should reset so the next call starts its own create", async () => {
      let calls = 0;
      const lazy = new LazyCreate(async (r) => {
        calls += 1;
        if (r) throw new RunRefused(new Error("refused"));
        return "created";
      });

      const first = lazy.begin(run);
      await expect(first.result).rejects.toBeInstanceOf(RunRefused);
      expect(lazy.started).toBe(false);

      const second = lazy.begin();
      expect(second.starter).toBe(true);
      expect(await second.result).toBe("created");
      expect(calls).toBe(2);
    });

    it("should make a call that was waiting start one plain create, shared by all waiters", async () => {
      let calls = 0;
      const lazy = new LazyCreate(async (r) => {
        calls += 1;
        if (r) throw new RunRefused(new Error("refused"));
        return "created";
      });

      const first = lazy.begin(run);
      const waiterA = lazy.begin();
      const waiterB = lazy.begin();

      await expect(first.result).rejects.toBeInstanceOf(RunRefused);
      expect(await waiterA.result).toBe("created");
      expect(await waiterB.result).toBe("created");
      expect(calls).toBe(2);
    });

    it("should still remember any other failure", async () => {
      const failure = new Error("boom");
      let calls = 0;
      const lazy = new LazyCreate<string>(async () => {
        calls += 1;
        throw failure;
      });

      await expect(lazy.begin(run).result).rejects.toBe(failure);
      await expect(lazy.begin().result).rejects.toBe(failure);
      expect(calls).toBe(1);
    });

    it("should carry the refusal's message", () => {
      expect(new RunRefused(new Error("refused INVALID_PARAM")).message).toBe(
        "refused INVALID_PARAM",
      );
    });
  });

  describe("cancel", () => {
    it("should make a later call fail instead of creating", async () => {
      let calls = 0;
      const lazy = new LazyCreate(async () => ++calls);
      lazy.cancel();

      await expect(lazy.begin(run).result).rejects.toThrow(/destroyed/);
      expect(calls).toBe(0);
    });

    it("should leave a create that already started alone", async () => {
      const lazy = new LazyCreate(async () => "created");
      const started = lazy.begin();
      lazy.cancel();

      expect(await started.result).toBe("created");
      expect(await lazy.begin().result).toBe("created");
    });
  });
});
