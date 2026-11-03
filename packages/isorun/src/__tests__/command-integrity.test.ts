import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("isorun", () => ({
  Isorun: vi.fn(() => ({ get: mocks.get })),
  Sandbox: class {},
}));

import { isorun } from "../index";

beforeEach(() => { vi.clearAllMocks(); });

type Capture = {
  out?: string[];
  err?: string[];
  outlen?: string | Error;
  errlen?: string | Error;
  code?: string | Error;
};

// Only the native SDK is faked. defineProvider, sandbox handles, and the
// production adapter's guest-file capture/readback protocol all run unchanged.
async function fixture(capture: Capture = {}) {
  const reads = { out: 0, err: 0 };
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
  const cleanups: string[] = [];
  const native = {
    id: "native-isorun",
    exec: vi.fn(async (command: string) => {
      if (command.startsWith("( ")) {
        wrappers.push(command);
        expect(command).toContain("wc -c");
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command.startsWith("rm -f ")) {
        cleanups.push(command);
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      const match = /^cat (\S+)(?: 2>\/dev\/null)?$/.exec(command);
      if (!match) throw new Error(`Unexpected native command: ${command}`);
      return { stdout: read(match[1]!), stderr: "", exitCode: 0 };
    }),
  };
  mocks.get.mockResolvedValue(native);
  const sandbox = await isorun({ apiKey: "local-test-only" }).sandbox.getById(native.id);
  return { sandbox: sandbox!, native, reads, wrappers, cleanups };
}

describe("isorun command capture integrity (native SDK fake)", () => {
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
