import { describe, it, expect, vi, beforeEach } from "vitest";

const files = new Map<string, string>();
const dirs = new Set<string>();
const runCalls: string[][] = [];
let probeFails = false;

class FakeSandbox {
  sandboxId = "sb-test";

  async run(cmd: string, options?: { args?: string[] }) {
    const args = options?.args ?? [];
    runCalls.push([cmd, ...args]);
    if (cmd === "sh") {
      // Emulates the writable-workdir probe: pwd is "/", not writable, so the
      // probe falls back to $HOME.
      return probeFails
        ? { stdout: "", stderr: "boom", exitCode: 127 }
        : { stdout: "/root", stderr: "", exitCode: 0 };
    }
    if (cmd === "mkdir") {
      dirs.add(args[1]);
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    if (cmd === "rm") {
      files.delete(args[1]);
      dirs.delete(args[1]);
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  async startProcess() {
    return {};
  }

  async readFile(path: string) {
    const v = files.get(path);
    if (v === undefined) throw new Error(`not found: ${path}`);
    return Buffer.from(v);
  }

  async writeFile(path: string, data: Buffer) {
    files.set(path, data.toString("utf-8"));
  }

  async listDirectory(path: string) {
    if (!dirs.has(path)) throw new Error(`not found: ${path}`);
    return { entries: [{ name: "a.txt", isDir: false, size: 3 }] };
  }

  async deleteFile(path: string) {
    if (!files.delete(path)) throw new Error(`not found: ${path}`);
  }

  async terminate() {}
}

vi.mock("tensorlake", () => ({
  Sandbox: class {
    static create = async () => new FakeSandbox();
    static connect = async () => new FakeSandbox();
    static list = async () => [];
    static listSnapshots = async () => [];
    static deleteSnapshot = async () => {};
  },
  SandboxStatus: { RUNNING: "RUNNING" },
  OutputMode: { DISCARD: "discard" },
  ProcessStatus: {},
}));

import { tensorlake } from "../index";

describe("tensorlake relative filesystem paths", () => {
  beforeEach(() => {
    files.clear();
    dirs.clear();
    runCalls.length = 0;
    probeFails = false;
  });

  it("resolves relative paths against a writable workdir", async () => {
    const provider = tensorlake({ apiKey: "test" });
    const sandbox = await provider.sandbox.create();

    await sandbox.filesystem.writeFile("bench/file.txt", "x");
    expect(files.get("/root/bench/file.txt")).toBe("x");

    // `.` and duplicate slashes normalize; `..` is preserved for the sandbox
    // filesystem to resolve physically (a preceding component may be a symlink).
    expect(await sandbox.filesystem.readFile("./bench/file.txt")).toBe("x");
    expect(await sandbox.filesystem.exists("bench//file.txt")).toBe(true);
    await sandbox.filesystem.writeFile("a/../b.txt", "y");
    expect(files.get("/root/a/../b.txt")).toBe("y");

    await sandbox.filesystem.mkdir("bench/dir");
    expect(dirs.has("/root/bench/dir")).toBe(true);
    expect(await sandbox.filesystem.exists("bench/dir")).toBe(true);
    await sandbox.filesystem.remove("bench/file.txt");
    expect(files.has("/root/bench/file.txt")).toBe(false);

    // The workdir is probed once and cached across operations.
    expect(runCalls.filter((c) => c[0] === "sh")).toHaveLength(1);
  });

  it("does not cache a failed workdir probe", async () => {
    probeFails = true;
    const provider = tensorlake({ apiKey: "test" });
    const sandbox = await provider.sandbox.create();

    // Failed probe falls back to '/' for this op only — it is not cached.
    await sandbox.filesystem.writeFile("x.txt", "x");
    expect(files.get("/x.txt")).toBe("x");

    probeFails = false;
    await sandbox.filesystem.writeFile("y.txt", "y");
    expect(files.get("/root/y.txt")).toBe("y");
    expect(runCalls.filter((c) => c[0] === "sh")).toHaveLength(2);
  });

  it("rejects ambiguous paths in remove", async () => {
    const provider = tensorlake({ apiKey: "test" });
    const sandbox = await provider.sandbox.create();

    for (const p of ["", ".", "./", "./."]) {
      await expect(sandbox.filesystem.remove(p)).rejects.toThrow();
    }
    expect(runCalls.filter((c) => c[0] === "rm")).toHaveLength(0);
  });

  it("passes absolute paths through without probing", async () => {
    const provider = tensorlake({ apiKey: "test" });
    const sandbox = await provider.sandbox.create();

    await sandbox.filesystem.writeFile("/abs/file.txt", "x");
    expect(files.get("/abs/file.txt")).toBe("x");
    expect(runCalls.filter((c) => c[0] === "sh")).toHaveLength(0);
  });
});
