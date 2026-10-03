import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as http from "node:http";
import * as crypto from "node:crypto";

import {
  buildManifest,
  compileGlob,
  compileGlobs,
  diffManifests,
  isExcluded,
  readCentralDirectory,
  fetchZipEntry,
  opRestore,
  ZipWriter,
  type CheckpointManifest,
} from "../../src/runtime/checkpoint-module.js";

function tmpdir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sha(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// ---------------------------------------------------------------------------
// glob matcher
// ---------------------------------------------------------------------------

describe("glob matcher", () => {
  it("matches basenames for bare names", () => {
    const globs = compileGlobs(["node_modules"]);
    expect(isExcluded("/work/app/node_modules", true, globs)).toBe(true);
    expect(isExcluded("/work/node_modules/pkg/index.js", true, globs)).toBe(false); // path, not dir name
    expect(isExcluded("/work/app/src", true, globs)).toBe(false);
  });

  it("supports ** crossing segments and * within a segment", () => {
    const globs = compileGlobs(["**/node_modules/.cache/**", "app/*/build"]);
    expect(isExcluded("/work/app/node_modules/.cache/babel/x", false, globs)).toBe(true);
    expect(isExcluded("/work/app/node_modules/pkg", false, globs)).toBe(false);
    expect(isExcluded("/x/app/web/build", true, globs)).toBe(true);
    expect(isExcluded("/x/app/web/build/extra", false, globs)).toBe(false);
  });

  it("honors dir-only trailing slash and ? wildcard", () => {
    const globs = compileGlobs(["dist/", "file?.log"]);
    expect(isExcluded("/w/dist", true, globs)).toBe(true);
    expect(isExcluded("/w/dist", false, globs)).toBe(false);
    expect(isExcluded("/w/file1.log", false, globs)).toBe(true);
    expect(isExcluded("/w/file10.log", false, globs)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// manifest build
// ---------------------------------------------------------------------------

describe("buildManifest", () => {
  let root: string;

  beforeAll(() => {
    root = tmpdir("ckpt-manifest-");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.mkdirSync(path.join(root, "node_modules/pkg"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(root, "src/b.ts"), "export const b = 2;\n");
    fs.writeFileSync(path.join(root, "node_modules/pkg/index.js"), "module.exports = {};\n");
    fs.symlinkSync("src/a.ts", path.join(root, "link"));
  });

  it("walks files, dirs and symlinks and hashes file contents", async () => {
    const { manifest, missing } = await buildManifest({ paths: [root] });
    expect(missing).toEqual([]);
    const aPath = path.join(root, "src/a.ts");
    const entry = manifest.files[aPath];
    expect(entry.type).toBe("file");
    expect(entry.sha).toBe(sha("export const a = 1;\n"));
    expect(entry.size).toBe(20);
    const link = manifest.files[path.join(root, "link")];
    expect(link.type).toBe("symlink");
    expect(link.link).toBe("src/a.ts");
    expect(manifest.files[path.join(root, "src")].type).toBe("dir");
    expect(manifest.stats.files).toBe(3);
  });

  it("applies exclusion globs to subtrees and files", async () => {
    const { manifest } = await buildManifest({ paths: [root], exclude: ["node_modules", "*.ts"] });
    expect(manifest.files[path.join(root, "src/a.ts")]).toBeUndefined();
    expect(manifest.files[path.join(root, "node_modules/pkg/index.js")]).toBeUndefined();
    expect(manifest.files[path.join(root, "node_modules")]).toBeUndefined();
    expect(manifest.files[path.join(root, "link")]).toBeDefined();
  });

  it("records meta fields and auto arch/platform", async () => {
    const { manifest } = await buildManifest({
      paths: [root],
      meta: { cwd: "/w", env: { A: "1" }, workflowHash: "wh", sourceProvider: "e2b" },
    });
    expect(manifest.arch).toBe(process.arch);
    expect(manifest.platform).toBe(process.platform);
    expect(manifest.cwd).toBe("/w");
    expect(manifest.env).toEqual({ A: "1" });
    expect(manifest.workflowHash).toBe("wh");
    expect(manifest.sourceProvider).toBe("e2b");
  });

  it("resolves relative capture paths to absolute (manifest keys are absolute)", async () => {
    const rel = path.relative(process.cwd(), root);
    const { manifest } = await buildManifest({ paths: [rel] });
    expect(manifest.capture.paths.every((p) => path.isAbsolute(p))).toBe(true);
    expect(manifest.capture.paths[0]).toBe(path.resolve(rel));
    // manifest keys still address files under the resolved root
    expect(manifest.files[path.join(root, "src/a.ts")]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// manifest diff
// ---------------------------------------------------------------------------

describe("diffManifests", () => {
  const base: CheckpointManifest = {
    version: 1,
    checkpointId: "a",
    createdAt: "t",
    arch: "x64",
    platform: "linux",
    capture: { paths: [], exclude: [] },
    blobsInZip: [],
    stats: { files: 0, dirs: 0, symlinks: 0, bytes: 0 },
    files: {
      "/keep": { type: "file", sha: "1", size: 1, mode: 0o100644, mtime: 1 },
      "/gone": { type: "file", sha: "2", size: 1, mode: 0o100644, mtime: 1 },
      "/edit": { type: "file", sha: "3", size: 1, mode: 0o100644, mtime: 1 },
    },
  };

  it("reports added, deleted, changed, unchanged", () => {
    const next: CheckpointManifest = {
      ...base,
      files: {
        "/keep": base.files["/keep"],
        "/edit": { ...base.files["/edit"], sha: "9" },
        "/new": { type: "file", sha: "4", size: 1, mode: 0o100644, mtime: 2 },
      },
    };
    const diff = diffManifests(base, next);
    expect(diff.added).toEqual(["/new"]);
    expect(diff.deleted).toEqual(["/gone"]);
    expect(diff.changed).toEqual([{ path: "/edit", aSha: "3", bSha: "9" }]);
    expect(diff.unchanged).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// zip write/read round-trip
// ---------------------------------------------------------------------------

describe("zip writer + reader", () => {
  let zipPath: string;
  let payloadA: Buffer;
  let payloadB: Buffer;

  beforeAll(async () => {
    zipPath = path.join(tmpdir("ckpt-zip-"), "test.zip");
    payloadA = Buffer.from("the quick brown fox jumps over the lazy dog\n".repeat(50));
    payloadB = crypto.randomBytes(4096); // incompressible → STORE
    const writer = new ZipWriter(zipPath);
    writer.addBuffer("manifest.json", Buffer.from('{"a":1}', "utf8"));
    writer.addBuffer(`blobs/${sha(payloadA)}`, payloadA);
    writer.addBuffer(`blobs/${sha(payloadB)}`, payloadB);
    const file = path.join(tmpdir("ckpt-file-"), "data.txt");
    fs.writeFileSync(file, payloadA);
    await writer.addFile("blobs/fromfile", file);
    writer.finish();
  });

  const fileRange = (file: string) => async (start: number, end: number) => {
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(end - start + 1);
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf;
    } finally {
      fs.closeSync(fd);
    }
  };

  it("parses the central directory and reads entries back", async () => {
    const fetchRange = fileRange(zipPath);
    const cd = await readCentralDirectory(fetchRange, fs.statSync(zipPath).size);
    expect(cd.entries.map((e) => e.name).sort()).toEqual(
      [`blobs/${sha(payloadA)}`, `blobs/${sha(payloadB)}`, "blobs/fromfile", "manifest.json"].sort(),
    );
    const byName = new Map(cd.entries.map((e) => [e.name, e]));
    const a = await fetchZipEntry(fetchRange, byName.get(`blobs/${sha(payloadA)}`)!);
    expect(a.equals(payloadA)).toBe(true);
    const b = await fetchZipEntry(fetchRange, byName.get(`blobs/${sha(payloadB)}`)!);
    expect(b.equals(payloadB)).toBe(true);
    expect(b.length).toBe(4096);
    const m = await fetchZipEntry(fetchRange, byName.get("manifest.json")!);
    expect(m.toString("utf8")).toBe('{"a":1}');
    const f = await fetchZipEntry(fetchRange, byName.get("blobs/fromfile")!);
    expect(f.equals(payloadA)).toBe(true);
  });

  it("produces a zip that stock unzip can read", async () => {
    // Cross-validate with zlib on every entry independently: each entry's
    // compressed bytes inflate to the expected content (done above), and the
    // CD crc matches a fresh crc of the content.
    const fetchRange = fileRange(zipPath);
    const cd = await readCentralDirectory(fetchRange, fs.statSync(zipPath).size);
    for (const entry of cd.entries) {
      const data = await fetchZipEntry(fetchRange, entry);
      expect(data.length).toBe(entry.uncompressedSize);
    }
  });
});

// ---------------------------------------------------------------------------
// range GET against a stub HTTP server
// ---------------------------------------------------------------------------

describe("range-GET restore path", () => {
  let server: http.Server;
  let port: number;
  let zipData: Buffer;
  const requests: Array<{ method?: string; range?: string }> = [];

  beforeAll(async () => {
    const zipPath = path.join(tmpdir("ckpt-http-"), "r.zip");
    const writer = new ZipWriter(zipPath);
    writer.addBuffer("manifest.json", Buffer.from(JSON.stringify({ hello: "world" }), "utf8"));
    const blob = crypto.randomBytes(10000);
    writer.addBuffer(`blobs/${sha(blob)}`, blob);
    writer.finish();
    zipData = fs.readFileSync(zipPath);

    server = http.createServer((req, res) => {
      requests.push({ method: req.method, range: req.headers.range as string | undefined });
      const key = req.url ?? "/";
      if (!key.startsWith("/checkpoints/")) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (req.method === "HEAD") {
        res.writeHead(200, { "content-length": zipData.length });
        res.end();
        return;
      }
      const range = req.headers.range;
      if (range) {
        const m = /^bytes=(\d+)-(\d+)$/.exec(range);
        if (m) {
          const start = Number(m[1]);
          const end = Math.min(Number(m[2]), zipData.length - 1);
          res.writeHead(206, {
            "content-length": end - start + 1,
            "content-range": `bytes ${start}-${end}/${zipData.length}`,
          });
          res.end(zipData.subarray(start, end + 1));
          return;
        }
      }
      res.writeHead(200, { "content-length": zipData.length });
      res.end(zipData);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(() => server.close());

  it("fetches the CD and entries with byte ranges only", async () => {
    const url = `http://127.0.0.1:${port}/checkpoints/ckpt-x.zip`;
    const fetchRange = async (start: number, end: number) => {
      const res = await new Promise<Buffer>((resolve, reject) => {
        http
          .get(url, { headers: { Range: `bytes=${start}-${end}` } }, (r) => {
            const chunks: Buffer[] = [];
            r.on("data", (c) => chunks.push(c));
            r.on("end", () => resolve(Buffer.concat(chunks)));
          })
          .on("error", reject);
      });
      return res;
    };
    const cd = await readCentralDirectory(fetchRange, zipData.length);
    expect(cd.entries.length).toBe(2);
    const manifest = cd.entries.find((e) => e.name === "manifest.json")!;
    const raw = await fetchZipEntry(fetchRange, manifest);
    expect(JSON.parse(raw.toString("utf8"))).toEqual({ hello: "world" });
    // every fetch was ranged, none pulled the whole object
    const wholeGets = requests.filter((r) => r.method === "GET" && !r.range);
    expect(wholeGets.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Regression: streamed zip CRC + empty entries
// ---------------------------------------------------------------------------

// Reference CRC-32 (independent of the implementation under test).
const REF_CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function refCrc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = REF_CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

describe("zip CRC integrity", () => {
  it("streamed addFile entries record a valid CRC-32", async () => {
    // >64KiB forces multiple read chunks — exercises incremental CRC chaining.
    const dir = tmpdir("ckpt-crc-");
    const payload = crypto.randomBytes(200 * 1024);
    const file = path.join(dir, "big.bin");
    fs.writeFileSync(file, payload);
    const zipPath = path.join(dir, "t.zip");
    const writer = new ZipWriter(zipPath);
    await writer.addFile("blobs/big", file);
    writer.finish();

    const range = async (start: number, end: number) => {
      const fd = fs.openSync(zipPath, "r");
      try {
        const buf = Buffer.alloc(end - start + 1);
        fs.readSync(fd, buf, 0, buf.length, start);
        return buf;
      } finally {
        fs.closeSync(fd);
      }
    };
    const cd = await readCentralDirectory(range, fs.statSync(zipPath).size);
    const entry = cd.entries.find((e) => e.name === "blobs/big")!;
    expect(entry.crc).toBe(refCrc32(payload));
    const data = await fetchZipEntry(range, entry);
    expect(data.equals(payload)).toBe(true);
  });

  it("zero-length entries return empty without a range fetch", async () => {
    const dir = tmpdir("ckpt-empty-");
    const zipPath = path.join(dir, "t.zip");
    const writer = new ZipWriter(zipPath);
    writer.addBuffer("manifest.json", Buffer.from("{}"));
    writer.addBuffer("empty.zip", Buffer.alloc(0)); // STORE ext + 0 bytes → compressedSize 0
    writer.finish();
    const cd = await readCentralDirectory(
      async (s, e) => {
        const fd = fs.openSync(zipPath, "r");
        try {
          const buf = Buffer.alloc(e - s + 1);
          fs.readSync(fd, buf, 0, buf.length, s);
          return buf;
        } finally {
          fs.closeSync(fd);
        }
      },
      fs.statSync(zipPath).size,
    );
    const entry = cd.entries.find((e) => e.name === "empty.zip")!;
    expect(entry.compressedSize).toBe(0);
    // The data fetch would be a reversed range (416 on real servers): throw on
    // s > e and count any data-range request beyond the 30-byte header read.
    let dataFetches = 0;
    const data = await fetchZipEntry(async (s, e) => {
      if (s > e) throw new Error("reversed range requested");
      if (e - s + 1 !== 30) dataFetches += 1;
      const fd = fs.openSync(zipPath, "r");
      try {
        const buf = Buffer.alloc(e - s + 1);
        fs.readSync(fd, buf, 0, buf.length, s);
        return buf;
      } finally {
        fs.closeSync(fd);
      }
    }, entry);
    expect(data.length).toBe(0);
    expect(dataFetches).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Regression: restore op — confinement, failures, dir modes, resultPath
// ---------------------------------------------------------------------------

describe("opRestore hardening", () => {
  let server: http.Server;
  let port: number;
  const objects = new Map<string, Buffer>();
  const out: string[] = [];

  const origWrite = process.stdout.write.bind(process.stdout);

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const buf = objects.get(req.url ?? "");
      if (!buf) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (req.method === "HEAD") {
        res.writeHead(200, { "content-length": buf.length });
        res.end();
        return;
      }
      const m = /^bytes=(\d+)-(\d+)$/.exec((req.headers.range as string) ?? "");
      if (m) {
        const start = Number(m[1]);
        const end = Math.min(Number(m[2]), buf.length - 1);
        res.writeHead(206, { "content-length": end - start + 1 });
        res.end(buf.subarray(start, end + 1));
        return;
      }
      res.writeHead(200, { "content-length": buf.length });
      res.end(buf);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
    // Keep op stdout lines inspectable and out of the test log.
    process.stdout.write = ((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
  });

  afterAll(() => {
    process.stdout.write = origWrite;
    process.exitCode = 0;
    server.close();
  });

  function makeManifest(files: CheckpointManifest["files"], blobsInZip: string[], capturePaths = ["/cap"]): CheckpointManifest {
    return {
      version: 1,
      checkpointId: `ckpt-${objects.size}`,
      createdAt: new Date().toISOString(),
      arch: process.arch,
      platform: process.platform,
      capture: { paths: capturePaths, exclude: [] },
      blobsInZip,
      stats: { files: 0, dirs: 0, symlinks: 0, bytes: 0 },
      files,
    };
  }

  async function serveCheckpoint(manifest: CheckpointManifest, blobs: Record<string, Buffer>): Promise<string> {
    const dir = tmpdir("ckpt-srv-");
    const zipPath = path.join(dir, "c.zip");
    const writer = new ZipWriter(zipPath);
    writer.addBuffer("manifest.json", Buffer.from(JSON.stringify(manifest)));
    for (const [sha, data] of Object.entries(blobs)) writer.addBuffer(`blobs/${sha}`, data);
    writer.finish();
    const url = `/checkpoints/${manifest.checkpointId}.zip`;
    objects.set(url, fs.readFileSync(zipPath));
    return `http://127.0.0.1:${port}${url}`;
  }

  it("refuses to write manifest paths without destDir or writeAbsolute", async () => {
    const url = await serveCheckpoint(makeManifest({}, []), {});
    await expect(opRestore({ checkpointUrl: url })).rejects.toThrow(/destDir is required/);
  });

  it("writes manifest paths verbatim when writeAbsolute: true", async () => {
    const abs = path.join(tmpdir("ckpt-abs-"), "verbatim.txt");
    const content = Buffer.from("verbatim\n");
    const url = await serveCheckpoint(
      makeManifest({ [abs]: { type: "file", sha: sha(content), size: content.length, mode: 0o100644, mtime: 1 } }, [sha(content)]),
      { [sha(content)]: content },
    );
    const prevExit = process.exitCode;
    try {
      await opRestore({ checkpointUrl: url, writeAbsolute: true });
      expect(fs.readFileSync(abs).equals(content)).toBe(true);
    } finally {
      process.exitCode = prevExit;
    }
  });

  it("rejects manifest paths that escape destDir via ..", async () => {
    const destDir = path.join(tmpdir("ckpt-esc-"), "dest");
    const outside = path.join(destDir, "..", "escape.txt");
    const content = Buffer.from("nope\n");
    const url = await serveCheckpoint(
      makeManifest({ "/cap/../escape.txt": { type: "file", sha: sha(content), size: content.length, mode: 0o100644, mtime: 1 } }, [sha(content)]),
      { [sha(content)]: content },
    );
    const prevExit = process.exitCode;
    try {
      await opRestore({ checkpointUrl: url, destDir });
      expect(process.exitCode).toBe(1); // partial restore fails the op
      expect(fs.existsSync(outside)).toBe(false);
    } finally {
      process.exitCode = prevExit;
    }
  });

  it("does not write through pre-existing symlinks out of destDir", async () => {
    const outsideDir = tmpdir("ckpt-outside-");
    const destDir = path.join(tmpdir("ckpt-sym-"), "dest");
    fs.mkdirSync(destDir, { recursive: true });
    fs.symlinkSync(outsideDir, path.join(destDir, "evil"));
    const content = Buffer.from("pwn\n");
    const url = await serveCheckpoint(
      makeManifest({ "/cap/evil/pwn.txt": { type: "file", sha: sha(content), size: content.length, mode: 0o100644, mtime: 1 } }, [sha(content)]),
      { [sha(content)]: content },
    );
    const prevExit = process.exitCode;
    try {
      await opRestore({ checkpointUrl: url, destDir });
      expect(process.exitCode).toBe(1);
      expect(fs.existsSync(path.join(outsideDir, "pwn.txt"))).toBe(false);
    } finally {
      process.exitCode = prevExit;
    }
  });

  it("creates empty children under read-only parent dirs (modes applied last)", async () => {
    const destDir = path.join(tmpdir("ckpt-ro-"), "dest");
    const manifest = makeManifest(
      {
        "/cap/ro": { type: "dir", mode: 0o40500, mtime: 1 },
        "/cap/ro/empty-child": { type: "dir", mode: 0o40700, mtime: 1 },
      },
      [],
    );
    const url = await serveCheckpoint(manifest, {});
    const prevExit = process.exitCode;
    try {
      await opRestore({ checkpointUrl: url, destDir });
      const child = path.join(destDir, "ro", "empty-child");
      expect(fs.existsSync(child)).toBe(true);
      // restore writability for tmpdir cleanup
      fs.chmodSync(path.join(destDir, "ro"), 0o700);
      fs.chmodSync(child, 0o700);
    } finally {
      process.exitCode = prevExit;
    }
  });

  it("restores zero-length files and reports a clean result", async () => {
    const destDir = path.join(tmpdir("ckpt-zero-"), "dest");
    const emptySha = sha(Buffer.alloc(0));
    const url = await serveCheckpoint(
      makeManifest({ "/cap/empty.bin": { type: "file", sha: emptySha, size: 0, mode: 0o100644, mtime: 1 } }, [emptySha]),
      { [emptySha]: Buffer.alloc(0) },
    );
    const prevExit = process.exitCode;
    try {
      await opRestore({ checkpointUrl: url, destDir });
      expect(fs.statSync(path.join(destDir, "empty.bin")).size).toBe(0);
    } finally {
      process.exitCode = prevExit;
    }
  });

  it("fails (exitCode 1) and records failures for unfetchable blobs", async () => {
    const destDir = path.join(tmpdir("ckpt-miss-"), "dest");
    const missingSha = "f".repeat(64); // not in zip, no store to fall back on
    const url = await serveCheckpoint(
      makeManifest({ "/cap/gone.txt": { type: "file", sha: missingSha, size: 4, mode: 0o100644, mtime: 1 } }, []),
      {},
    );
    const prevExit = process.exitCode;
    out.length = 0;
    try {
      await opRestore({ checkpointUrl: url, destDir });
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = prevExit;
    }
  });

  it("writes full result JSON to resultPath and emits a slim line", async () => {
    const dir = tmpdir("ckpt-rp-");
    const destDir = path.join(dir, "dest");
    const resultPath = path.join(dir, "result.json");
    const content = Buffer.from("hi\n");
    const url = await serveCheckpoint(
      makeManifest({ "/cap/a.txt": { type: "file", sha: sha(content), size: content.length, mode: 0o100644, mtime: 1 } }, [sha(content)]),
      { [sha(content)]: content },
    );
    const prevExit = process.exitCode;
    out.length = 0;
    try {
      await opRestore({ checkpointUrl: url, destDir, resultPath });
      const full = JSON.parse(fs.readFileSync(resultPath, "utf8")) as { op: string; files: number };
      expect(full.op).toBe("restore");
      expect(full.files).toBe(1);
      const slim = out
        .filter((l) => l.includes('"type":"result"'))
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .pop();
      expect(slim?.resultPath).toBe(resultPath);
      expect(slim?.files).toBeUndefined();
    } finally {
      process.exitCode = prevExit;
    }
  });
});
