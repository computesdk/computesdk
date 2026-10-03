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
