import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSandbox: vi.fn() }));
vi.mock("@nodeops-createos/sandbox", () => ({
  CreateosSandboxClient: vi.fn(() => ({ getSandbox: mocks.getSandbox })),
  CreateosSandboxNotFoundError: class extends Error {},
  Sandbox: class {},
}));

import { createosSandbox } from "../index";

beforeEach(() => { vi.clearAllMocks(); });

type CaptureFile = "out" | "err" | "outlen" | "errlen" | "code";

type Capture = {
  out?: string[];
  err?: string[];
  outlen?: string | Error;
  errlen?: string | Error;
  code?: string | Error;
  nativeReads?: Partial<Record<CaptureFile, unknown[]>>;
};

// Only the native SDK is faked. defineProvider, sandbox handles, and the
// production adapter's guest-file capture/readback protocol all run unchanged.
async function fixture(capture: Capture = {}) {
  const reads = { out: 0, err: 0 };
  const catReads = { out: 0, err: 0, outlen: 0, errlen: 0, code: 0 };
  const out = capture.out ?? ["output"];
  const err = capture.err ?? [""];
  const files = {
    outlen: capture.outlen ?? String(Buffer.byteLength(out[out.length - 1]!)),
    errlen: capture.errlen ?? String(Buffer.byteLength(err[err.length - 1]!)),
    code: capture.code ?? "0",
  };
  const read = (path: string): string => {
    const suffix = path.split(".").pop()!;
    if (suffix === "out" || suffix === "err") {
      const values = suffix === "out" ? out : err;
      return values[Math.min(reads[suffix]++, values.length - 1)]!;
    }
    const value = files[suffix as keyof typeof files];
    if (value instanceof Error) throw value;
    if (typeof value !== "string") throw new Error(`Unexpected native read: ${path}`);
    return value;
  };
  const wrappers: string[] = [];
  const cleanups: string[][] = [];
  const native = {
    id: "native-createos",
    runCommand: vi.fn(async (command: string, args: string[]) => {
      if (command === "sh") {
        wrappers.push(args[1]!);
        expect(args[1]).toContain("wc -c");
        return { result: { stdout: "", stderr: "", exit_code: 0 }, exec_ms: 12 };
      }
      if (command === "rm") {
        cleanups.push(args);
        return { result: { stdout: "", stderr: "", exit_code: 0 }, exec_ms: 1 };
      }
      if (command !== "cat") throw new Error(`Unexpected native command: ${command}`);
      const file = args[0]!.split(".").pop()! as CaptureFile;
      const attempt = catReads[file]++;
      const overrides = capture.nativeReads?.[file];
      if (overrides) return overrides[Math.min(attempt, overrides.length - 1)];
      return { result: { stdout: read(args[0]!), stderr: "", exit_code: 0 }, exec_ms: 1 };
    }),
  };
  mocks.getSandbox.mockResolvedValue(native);
  const sandbox = await createosSandbox({ apiKey: "local-test-only" }).sandbox.getById(native.id);
  return { sandbox: sandbox!, native, reads, catReads, wrappers, cleanups };
}

describe("createos-sandbox command capture integrity (native SDK fake)", () => {
  it.each(["stdout", "stderr"] as const)("rejects two incomplete %s reads (40/60 of 100 bytes), without rerunning the command", async (stream) => {
    const partial = ["x".repeat(40), "x".repeat(60)];
    const f = await fixture(stream === "stdout" ? { out: partial, outlen: "100" } : { err: partial, errlen: "100" });
    await expect(f.sandbox.runCommand("do-not-repeat-side-effect")).rejects.toMatchObject({
      code: "COMMAND_OUTPUT_INTEGRITY", stream, expectedBytes: 100, actualBytes: 60, attempts: 2,
    });
    expect(f.reads[stream === "stdout" ? "out" : "err"]).toBe(2);
    expect(f.wrappers).toHaveLength(1);
    expect(f.cleanups).toHaveLength(1);
  });

  it.each(["stdout", "stderr"] as const)("recovers %s on an exact second read (40/100), without rerunning the command", async (stream) => {
    const complete = "x".repeat(100);
    const f = await fixture(stream === "stdout" ? { out: [complete.slice(0, 40), complete], outlen: "100" } : { err: [complete.slice(0, 40), complete], errlen: "100" });
    const result = await f.sandbox.runCommand("side-effect");
    expect(result[stream]).toBe(complete);
    expect(result.exitCode).toBe(0);
    expect(f.reads[stream === "stdout" ? "out" : "err"]).toBe(2);
    expect(f.wrappers).toHaveLength(1);
  });

  it.each(["stdout", "stderr"] as const)("rejects an oversized %s reread rather than choosing the longest", async (stream) => {
    const capture = ["x".repeat(40), "x".repeat(101)];
    const f = await fixture(stream === "stdout" ? { out: capture, outlen: "100" } : { err: capture, errlen: "100" });
    await expect(f.sandbox.runCommand("once")).rejects.toMatchObject({ code: "COMMAND_OUTPUT_INTEGRITY" });
    expect(f.wrappers).toHaveLength(1);
  });

  it.each(["stdout", "stderr"] as const)("rejects malformed/missing %s length metadata", async (stream) => {
    for (const length of ["", "   ", "6junk", "6.0", "-1", "9007199254740992", new Error("missing length file")]) {
      const f = await fixture(stream === "stdout" ? { outlen: length } : { errlen: length });
      await expect(f.sandbox.runCommand("once")).rejects.toMatchObject({ code: "COMMAND_OUTPUT_INTEGRITY" });
      expect(f.reads[stream === "stdout" ? "out" : "err"]).toBe(0);
      expect(f.wrappers).toHaveLength(1);
      expect(f.cleanups).toHaveLength(1);
    }
  });

  it("accepts valid zero-byte streams and a whitespace-padded byte count", async () => {
    const f = await fixture({ out: [""], err: [""], outlen: " 0\n", errlen: "0" });
    await expect(f.sandbox.runCommand("true")).resolves.toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(f.reads).toEqual({ out: 1, err: 1 });
  });

  it("counts UTF-8 bytes independently for stdout and stderr", async () => {
    const f = await fixture({ out: ["😀é"], err: ["界"], outlen: "6", errlen: "3" });
    await expect(f.sandbox.runCommand("unicode")).resolves.toMatchObject({ stdout: "😀é", stderr: "界", exitCode: 0 });
    expect(f.reads).toEqual({ out: 1, err: 1 });
  });

  it("does not accept Unicode character counts in place of byte counts", async () => {
    const f = await fixture({ out: ["😀é"], outlen: "3" });
    await expect(f.sandbox.runCommand("unicode")).rejects.toMatchObject({ code: "COMMAND_OUTPUT_INTEGRITY" });
  });

  it.each(["missing-length", "truncated-output"])("keeps %s diagnostics free of output, commands, and native exception text", async (failure) => {
    const secretOutput = "captured-output-secret";
    const f = await fixture(failure === "missing-length"
      ? { out: [secretOutput], outlen: new Error("native-credential-secret") }
      : { out: [secretOutput.padEnd(40, "x"), secretOutput.padEnd(60, "x")], outlen: "100" });
    const error: unknown = await f.sandbox.runCommand("command-secret").catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "COMMAND_OUTPUT_INTEGRITY", stream: "stdout" });
    expect(String(error) + JSON.stringify(error)).not.toMatch(/captured-output-secret|native-credential-secret|command-secret/);
    expect(f.wrappers).toHaveLength(1);
    expect(f.cleanups).toHaveLength(1);
  });

  it.each(["", "   ", "0junk", "0.5", "-1", "256", new Error("missing child status")])("rejects invalid child status %s even when the outer native wrapper exits zero", async (code) => {
    const f = await fixture({ code });
    await expect(f.sandbox.runCommand("child-status-unknown")).rejects.toMatchObject({ code: "COMMAND_OUTPUT_INTEGRITY" });
    expect(f.wrappers).toHaveLength(1);
    expect(f.cleanups).toHaveLength(1);
  });

  it("preserves a known nonzero child result with verified stdout and stderr", async () => {
    const f = await fixture({ out: ["partial result"], err: ["real child error\n"], code: " 17\n" });
    await expect(f.sandbox.runCommand("fails-once")).resolves.toMatchObject({ stdout: "partial result", stderr: "real child error\n", exitCode: 17 });
    expect(f.wrappers).toHaveLength(1);
    expect(f.cleanups).toHaveLength(1);
  });
});

// Runtime-invalid replies are intentional: native HTTP payloads can violate
// their declared types. Valid replies use only the installed SDK's real fields.
function nativeCatResult(stdout: unknown, status: unknown): unknown {
  return { result: { stdout, stderr: "native-stderr-secret", exit_code: status }, exec_ms: 1 };
}

async function expectSafeReadFailure(f: Awaited<ReturnType<typeof fixture>>) {
  const error: unknown = await f.sandbox.runCommand("command-secret").catch((e: unknown) => e);
  expect(error).toMatchObject({ code: "COMMAND_OUTPUT_INTEGRITY" });
  expect(String(error) + JSON.stringify(error)).not.toMatch(/native-stderr-secret|native-agent-secret|captured-output-secret|command-secret/);
  expect(f.wrappers).toHaveLength(1);
  expect(f.cleanups).toHaveLength(1);
  return error;
}

describe("native capture read completion", () => {
  it.each(["out", "err"] as const)("rejects a failed native %s cat returning empty text for a zero-byte capture", async (file) => {
    const f = await fixture({ out: [""], err: [""], nativeReads: { [file]: [nativeCatResult("", 1)] } });
    const error = await expectSafeReadFailure(f);
    expect(error).toMatchObject({ reason: "output-read-failed", stream: file === "out" ? "stdout" : "stderr", attempts: 1 });
    expect(f.catReads[file]).toBe(1);
  });

  it.each(["out", "err"] as const)("rejects failed native %s cat even if text has exactly the recorded byte count", async (file) => {
    const secret = "captured-output-secret";
    const f = await fixture({ [file]: [secret], nativeReads: { [file]: [nativeCatResult(secret, 1)] } });
    await expectSafeReadFailure(f);
    expect(f.catReads[file]).toBe(1);
  });

  it.each(["out", "err"] as const)("rejects a failed exact-size second native %s cat without replaying the command", async (file) => {
    const complete = "x".repeat(100);
    const f = await fixture({
      [file]: [complete],
      nativeReads: { [file]: [nativeCatResult(complete.slice(0, 40), 0), nativeCatResult(complete, 1)] },
    });
    const error = await expectSafeReadFailure(f);
    expect(error).toMatchObject({ reason: "output-read-failed", attempts: 2 });
    expect(f.catReads[file]).toBe(2);
  });

  it.each(["outlen", "errlen", "code"] as const)("rejects failed native %s cat despite valid-looking metadata", async (file) => {
    const f = await fixture({ out: [""], err: [""], nativeReads: { [file]: [nativeCatResult("0", 1)] } });
    const error = await expectSafeReadFailure(f);
    expect(error).toMatchObject({ reason: file === "code" ? "invalid-exit-code" : "length-read-failed" });
    expect(f.catReads[file]).toBe(1);
  });

  for (const file of ["out", "err", "outlen", "errlen", "code"] as const) {
    describe(`${file} malformed native reply`, () => {
      it.each([
        { name: "undefined reply", make: () => undefined },
        { name: "null reply", make: () => null },
        { name: "missing payload", make: () => ({}) },
        { name: "missing status", make: (text: string) => nativeCatResult(text, undefined) },
        { name: "null status", make: (text: string) => nativeCatResult(text, null) },
        { name: "string status", make: (text: string) => nativeCatResult(text, "0") },
        { name: "missing stdout", make: () => nativeCatResult(undefined, 0) },
        { name: "null stdout", make: () => nativeCatResult(null, 0) },
        { name: "numeric stdout", make: () => nativeCatResult(0, 0) },
        { name: "buffer stdout", make: () => nativeCatResult(Buffer.from(""), 0) },
      ])("rejects $name with safe diagnostics", async ({ make }) => {
        const f = await fixture({
          out: [""], err: [""],
          nativeReads: { [file]: [make(file === "out" || file === "err" ? "" : "0")] },
        });
        await expectSafeReadFailure(f);
        expect(f.catReads[file]).toBe(1);
      });
    });
  }
});

// CreateOS exposes an additional agent-start failure independently of exit_code.
it.each(["out", "err", "outlen", "errlen", "code"] as const)("rejects CreateOS agent error while reading %s even when native status is zero", async (file) => {
  const f = await fixture({ out: [""], err: [""], nativeReads: { [file]: [{
    result: { stdout: file === "out" || file === "err" ? "" : "0", stderr: "native-stderr-secret", exit_code: 0, error: "native-agent-secret" },
    exec_ms: 1,
  }] } });
  await expectSafeReadFailure(f);
  expect(f.catReads[file]).toBe(1);
});
