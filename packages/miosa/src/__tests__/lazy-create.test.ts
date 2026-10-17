import { describe, expect, it } from "vitest";

import {
  LazyCreate,
  canRunInCreate,
  isPlaceholderId,
  placeholderId,
  readRun,
  withRun,
  withoutRun,
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
        stdout: "",
        stderr: "boom",
        durationMs: undefined,
      });
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
