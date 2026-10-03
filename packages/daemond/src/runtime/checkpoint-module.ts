/**
 * checkpoint-module — the in-sandbox capture/restore engine for daemond.
 *
 * Runs as a detached module job (`module.exec`) inside the sandbox: pure Node
 * stdlib (fs/crypto/zlib/http/https), so it executes on any provider image
 * that has a node runtime — including the daemond-bootstrapped static node.
 *
 * Usage: `node checkpoint-module.cjs <op> <payload>`
 *   payload: `b64:<base64-json>` or raw JSON on argv[3].
 *   stdout: JSON lines — `{type:"progress",...}`* then `{type:"result",...}`
 *   or `{type:"error",message}` with a non-zero exit code.
 *
 * Ops:
 *   scan     walk + sha256 + build manifest (no upload)
 *   capture  scan → dedup blobs against the store → upload new blobs
 *            standalone + a delta zip (manifest.json + new blob entries)
 *   restore  range-GET the zip central directory → fetch needed entries /
 *            standalone blobs in parallel → verify sha256 → extract
 *   diff     compare two manifests → added/changed/deleted paths
 *
 * Storage layout (spec: portable-checkpoints):
 *   checkpoints/{checkpointId}.zip   manifest.json + blobs new to this checkpoint
 *   blobs/{sha256}                   shared objects, deduplicated org-wide
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import * as zlib from "node:zlib";
import * as http from "node:http";
import * as https from "node:https";

// ---------------------------------------------------------------------------
// Wire output
// ---------------------------------------------------------------------------

interface ProgressEvent {
  type: "progress";
  op: string;
  phase: string;
  done: number;
  total: number;
  bytes?: number;
}

function emitProgress(op: string, phase: string, done: number, total: number, bytes?: number): void {
  const event: ProgressEvent = { type: "progress", op, phase, done, total };
  if (bytes !== undefined) event.bytes = bytes;
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function emitResult(value: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ type: "result", ...value })}\n`);
}

function emitError(err: unknown): never {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stdout.write(`${JSON.stringify({ type: "error", message })}\n`);
  process.exit(1);
}

class ProgressReporter {
  private last = 0;
  constructor(
    private readonly op: string,
    private readonly phase: string,
    private readonly total: number,
    private readonly intervalMs = 250,
  ) {}
  tick(done: number, bytes?: number): void {
    const now = Date.now();
    if (done >= this.total || now - this.last >= this.intervalMs) {
      this.last = now;
      emitProgress(this.op, this.phase, done, this.total, bytes);
    }
  }
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function sha256Buffer(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// ---------------------------------------------------------------------------
// Glob matcher (gitignore-lite: **, *, ?, basename matching for bare names)
// ---------------------------------------------------------------------------

export interface CompiledGlob {
  regex: RegExp;
  dirOnly: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

export function compileGlob(raw: string): CompiledGlob {
  let glob = raw.trim();
  let dirOnly = false;
  if (glob.endsWith("/")) {
    dirOnly = true;
    glob = glob.slice(0, -1);
  }
  let re = "";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        const after = glob[i + 2];
        if (after === "/") {
          re += "(?:.*/)?";
          i += 3;
        } else {
          re += ".*";
          i += 2;
        }
      } else {
        re += "[^/]*";
        i += 1;
      }
    } else if (ch === "?") {
      re += "[^/]";
      i += 1;
    } else {
      re += escapeRegExp(ch);
      i += 1;
    }
  }
  return { regex: new RegExp(`(?:^|/)${re}$`), dirOnly };
}

export function compileGlobs(globs: string[] | undefined): CompiledGlob[] {
  return (globs ?? []).map(compileGlob);
}

export function isExcluded(absPath: string, isDir: boolean, globs: CompiledGlob[]): boolean {
  for (const glob of globs) {
    if (glob.dirOnly && !isDir) continue;
    if (glob.regex.test(absPath)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export interface ManifestEntry {
  type: "file" | "dir" | "symlink";
  sha?: string;
  size?: number;
  mode: number;
  mtime: number;
  link?: string;
}

export interface CheckpointManifest {
  version: 1;
  checkpointId: string;
  createdAt: string;
  arch: string;
  platform: string;
  cwd?: string;
  env?: Record<string, string>;
  workflowHash?: string;
  sourceProvider?: string;
  capture: { paths: string[]; exclude: string[] };
  /** Blob shas embedded as entries inside this checkpoint's zip. */
  blobsInZip: string[];
  stats: { files: number; dirs: number; symlinks: number; bytes: number };
  files: Record<string, ManifestEntry>;
}

interface WalkedTree {
  files: Array<{ abs: string; size: number; mode: number; mtime: number }>;
  dirs: Array<{ abs: string; mode: number; mtime: number }>;
  symlinks: Array<{ abs: string; link: string; mode: number; mtime: number }>;
  missing: string[];
}

function walkTree(paths: string[], globs: CompiledGlob[]): WalkedTree {
  const tree: WalkedTree = { files: [], dirs: [], symlinks: [], missing: [] };
  const visit = (abs: string): void => {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(abs);
    } catch {
      tree.missing.push(abs);
      return;
    }
    if (stat.isSymbolicLink()) {
      if (isExcluded(abs, false, globs)) return;
      let link = "";
      try {
        link = fs.readlinkSync(abs);
      } catch {
        tree.missing.push(abs);
        return;
      }
      tree.symlinks.push({ abs, link, mode: stat.mode, mtime: stat.mtimeMs });
      return;
    }
    if (stat.isDirectory()) {
      if (isExcluded(abs, true, globs)) return;
      tree.dirs.push({ abs, mode: stat.mode, mtime: stat.mtimeMs });
      let names: string[];
      try {
        names = fs.readdirSync(abs).sort();
      } catch {
        tree.missing.push(abs);
        return;
      }
      for (const name of names) visit(path.join(abs, name));
      return;
    }
    if (stat.isFile()) {
      if (isExcluded(abs, false, globs)) return;
      tree.files.push({ abs, size: stat.size, mode: stat.mode, mtime: stat.mtimeMs });
      return;
    }
    // sockets/fifos/devices: host-bound, never captured.
  };
  for (const root of paths) visit(path.resolve(root));
  return tree;
}

async function hashFiles(
  files: WalkedTree["files"],
  concurrency: number,
  reporter: ProgressReporter,
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  let done = 0;
  let bytes = 0;
  await mapLimit(files, concurrency, async (file) => {
    const sha = await sha256File(file.abs);
    hashes.set(file.abs, sha);
    done += 1;
    bytes += file.size;
    reporter.tick(done, bytes);
  });
  return hashes;
}

export async function buildManifest(args: {
  checkpointId?: string;
  paths: string[];
  exclude?: string[];
  meta?: {
    cwd?: string;
    env?: Record<string, string>;
    workflowHash?: string;
    sourceProvider?: string;
    arch?: string;
    platform?: string;
  };
  hashConcurrency?: number;
}): Promise<{ manifest: CheckpointManifest; missing: string[]; fileBytes: Map<string, string> }> {
  const globs = compileGlobs(args.exclude);
  const tree = walkTree(args.paths, globs);
  const totalBytes = tree.files.reduce((sum, f) => sum + f.size, 0);
  const reporter = new ProgressReporter("scan", "hash", tree.files.length);
  const hashes = await hashFiles(tree.files, args.hashConcurrency ?? 8, reporter);

  const files: Record<string, ManifestEntry> = {};
  for (const dir of tree.dirs) {
    files[dir.abs] = { type: "dir", mode: dir.mode, mtime: Math.round(dir.mtime) };
  }
  for (const link of tree.symlinks) {
    files[link.abs] = { type: "symlink", mode: link.mode, mtime: Math.round(link.mtime), link: link.link };
  }
  for (const file of tree.files) {
    files[file.abs] = {
      type: "file",
      sha: hashes.get(file.abs),
      size: file.size,
      mode: file.mode,
      mtime: Math.round(file.mtime),
    };
  }

  const manifest: CheckpointManifest = {
    version: 1,
    checkpointId: args.checkpointId ?? `ckpt-${crypto.randomBytes(8).toString("hex")}`,
    createdAt: new Date().toISOString(),
    arch: args.meta?.arch ?? process.arch,
    platform: args.meta?.platform ?? process.platform,
    capture: { paths: args.paths, exclude: args.exclude ?? [] },
    blobsInZip: [],
    stats: {
      files: tree.files.length,
      dirs: tree.dirs.length,
      symlinks: tree.symlinks.length,
      bytes: totalBytes,
    },
    files,
  };
  if (args.meta?.cwd !== undefined) manifest.cwd = args.meta.cwd;
  if (args.meta?.env !== undefined) manifest.env = args.meta.env;
  if (args.meta?.workflowHash !== undefined) manifest.workflowHash = args.meta.workflowHash;
  if (args.meta?.sourceProvider !== undefined) manifest.sourceProvider = args.meta.sourceProvider;

  return { manifest, missing: tree.missing, fileBytes: hashes };
}

export function diffManifests(
  a: CheckpointManifest,
  b: CheckpointManifest,
): { added: string[]; deleted: string[]; changed: Array<{ path: string; aSha?: string; bSha?: string }>; unchanged: number } {
  const added: string[] = [];
  const deleted: string[] = [];
  const changed: Array<{ path: string; aSha?: string; bSha?: string }> = [];
  let unchanged = 0;
  for (const [p, entry] of Object.entries(b.files)) {
    const prev = a.files[p];
    if (!prev) {
      added.push(p);
    } else if (prev.type !== entry.type || prev.sha !== entry.sha || prev.mode !== entry.mode || prev.link !== entry.link) {
      changed.push({ path: p, aSha: prev.sha, bSha: entry.sha });
    } else {
      unchanged += 1;
    }
  }
  for (const p of Object.keys(a.files)) {
    if (!(p in b.files)) deleted.push(p);
  }
  added.sort();
  deleted.sort();
  changed.sort((x, y) => x.path.localeCompare(y.path));
  return { added, deleted, changed, unchanged };
}

// ---------------------------------------------------------------------------
// CRC32 (for zip entries)
// ---------------------------------------------------------------------------

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer, seed = 0xffffffff): number {
  let crc = seed;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Zip writer — streaming, data descriptors, DEFLATE/STORE, zip64 fallback.
// Local headers carry zeroed crc/sizes (flag bit 3); a data descriptor trails
// each entry's data, so files stream through with O(1) memory.
// ---------------------------------------------------------------------------

const STORE_EXTENSIONS = new Set([
  ".gz", ".zst", ".br", ".zip", ".jar", ".png", ".jpg", ".jpeg", ".webp",
  ".mp4", ".mp3", ".xz", ".bz2", ".7z", ".rar", ".whl", ".woff2",
]);

export interface ZipEntryRecord {
  name: string;
  method: 0 | 8;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  mtime: number;
  externalAttrs: number;
}

function dosDateTime(epochMs: number): { time: number; date: number } {
  const d = new Date(epochMs);
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const year = Math.max(1980, d.getFullYear());
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export class ZipWriter {
  private fd: number;
  private offset = 0;
  private entries: ZipEntryRecord[] = [];

  constructor(private readonly filePath: string) {
    this.fd = fs.openSync(filePath, "w");
  }

  private write(buf: Buffer): void {
    fs.writeSync(this.fd, buf, 0, buf.length, this.offset);
    this.offset += buf.length;
  }

  /** Add an entry from an in-memory buffer. */
  addBuffer(name: string, data: Buffer, opts?: { mtime?: number; method?: 0 | 8 }): ZipEntryRecord {
    const compressed = opts?.method === 0 ? null : zlib.deflateRawSync(data, { level: 6 });
    const method: 0 | 8 = compressed !== null && compressed.length < data.length ? 8 : 0;
    const body = method === 8 ? compressed! : data;
    const record = this.beginEntry(name, opts?.mtime ?? Date.now(), method);
    this.write(body);
    return this.endEntry(record, crc32(data), body.length, data.length);
  }

  /**
   * Add an entry by streaming a file through crc32 + optional deflate.
   * Returns the record after the data descriptor lands.
   */
  async addFile(
    name: string,
    filePath: string,
    opts?: { mtime?: number; method?: 0 | 8 | "auto" },
  ): Promise<ZipEntryRecord> {
    let method: 0 | 8 = 8;
    const chosen = opts?.method ?? "auto";
    if (chosen === 0 || (chosen === "auto" && STORE_EXTENSIONS.has(path.extname(name).toLowerCase()))) {
      method = 0;
    }
    const record = this.beginEntry(name, opts?.mtime ?? Date.now(), method);
    let crc = 0xffffffff;
    let rawSize = 0;
    let outSize = 0;
    const stream = fs.createReadStream(filePath);
    const deflate = method === 8 ? zlib.createDeflateRaw({ level: 6 }) : null;
    if (deflate) {
      stream.pipe(deflate);
      deflate.on("data", (chunk: string | Buffer) => {
        const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        outSize += buf.length;
        this.write(buf);
      });
    } else {
      stream.on("data", (chunk: string | Buffer) => {
        const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        outSize += buf.length;
        this.write(buf);
      });
    }
    stream.on("data", (chunk: string | Buffer) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      rawSize += buf.length;
      crc = crc32(buf, crc);
    });
    await new Promise<void>((resolve, reject) => {
      stream.on("error", reject);
      (deflate ?? stream).on("error", reject);
      (deflate ?? stream).on("end", resolve);
    });
    return this.endEntry(record, crc ^ 0xffffffff, outSize, rawSize);
  }

  private beginEntry(name: string, mtime: number, method: 0 | 8 = 8): ZipEntryRecord {
    const nameBuf = Buffer.from(name, "utf8");
    const { time, date } = dosDateTime(mtime);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(45, 4); // version needed
    header.writeUInt16LE(0x0808, 6); // UTF-8 names + data descriptor
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(0, 14); // crc
    header.writeUInt32LE(0, 18); // compressed size
    header.writeUInt32LE(0, 22); // uncompressed size
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28); // extra len
    this.write(header);
    this.write(nameBuf);
    return {
      name,
      method,
      crc: 0,
      compressedSize: 0,
      uncompressedSize: 0,
      localOffset: this.offset - 30 - nameBuf.length,
      mtime,
      externalAttrs: 0o100644 << 16,
    };
  }

  private endEntry(record: ZipEntryRecord, crc: number, compressedSize: number, uncompressedSize: number): ZipEntryRecord {
    record.crc = crc >>> 0;
    record.compressedSize = compressedSize;
    record.uncompressedSize = uncompressedSize;
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(record.crc, 4);
    descriptor.writeUInt32LE(compressedSize, 8);
    descriptor.writeUInt32LE(uncompressedSize, 12);
    this.write(descriptor);
    this.entries.push(record);
    return record;
  }

  /** Write the central directory + EOCD (+zip64 when needed) and close. */
  finish(): { filePath: string; entries: ZipEntryRecord[]; size: number } {
    const cdStart = this.offset;
    for (const entry of this.entries) {
      const nameBuf = Buffer.from(entry.name, "utf8");
      const needsZip64 =
        entry.compressedSize >= 0xffffffff ||
        entry.uncompressedSize >= 0xffffffff ||
        entry.localOffset >= 0xffffffff;
      const { time, date } = dosDateTime(entry.mtime);
      const extra = needsZip64 ? Buffer.alloc(4 + 24) : Buffer.alloc(0);
      if (needsZip64) {
        extra.writeUInt16LE(0x0001, 0);
        extra.writeUInt16LE(24, 2);
        extra.writeBigUInt64LE(BigInt(entry.uncompressedSize), 4);
        extra.writeBigUInt64LE(BigInt(entry.compressedSize), 12);
        extra.writeBigUInt64LE(BigInt(entry.localOffset), 20);
      }
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(45, 4); // version made by
      cd.writeUInt16LE(45, 6); // version needed
      cd.writeUInt16LE(0x0808, 8);
      cd.writeUInt16LE(entry.method, 10);
      cd.writeUInt16LE(time, 12);
      cd.writeUInt16LE(date, 14);
      cd.writeUInt32LE(entry.crc, 16);
      cd.writeUInt32LE(entry.compressedSize >= 0xffffffff ? 0xffffffff : entry.compressedSize, 20);
      cd.writeUInt32LE(entry.uncompressedSize >= 0xffffffff ? 0xffffffff : entry.uncompressedSize, 24);
      cd.writeUInt16LE(nameBuf.length, 28);
      cd.writeUInt16LE(extra.length, 30);
      cd.writeUInt16LE(0, 32); // comment len
      cd.writeUInt16LE(0, 34); // disk start
      cd.writeUInt16LE(0, 36); // internal attrs
      cd.writeUInt32LE(entry.externalAttrs >>> 0, 38);
      cd.writeUInt32LE(entry.localOffset >= 0xffffffff ? 0xffffffff : entry.localOffset, 42);
      this.write(cd);
      this.write(nameBuf);
      if (extra.length) this.write(extra);
    }
    const cdSize = this.offset - cdStart;
    const count = this.entries.length;
    const needsZip64Eocd = count >= 0xffff || cdStart >= 0xffffffff || cdSize >= 0xffffffff;

    if (needsZip64Eocd) {
      const zip64EocdOffset = this.offset;
      const z64 = Buffer.alloc(56);
      z64.writeUInt32LE(0x06064b50, 0);
      z64.writeBigUInt64LE(BigInt(44), 4); // record size
      z64.writeUInt16LE(45, 12);
      z64.writeUInt16LE(45, 14);
      z64.writeUInt32LE(0, 16); // disk
      z64.writeUInt32LE(0, 20); // cd disk
      z64.writeBigUInt64LE(BigInt(count), 24);
      z64.writeBigUInt64LE(BigInt(count), 32);
      z64.writeBigUInt64LE(BigInt(cdSize), 40);
      z64.writeBigUInt64LE(BigInt(cdStart), 48);
      this.write(z64);
      const locator = Buffer.alloc(20);
      locator.writeUInt32LE(0x07064b50, 0);
      locator.writeUInt32LE(0, 4);
      locator.writeBigUInt64LE(BigInt(zip64EocdOffset), 8);
      locator.writeUInt32LE(1, 16);
      this.write(locator);
    }

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(count >= 0xffff ? 0xffff : count, 8);
    eocd.writeUInt16LE(count >= 0xffff ? 0xffff : count, 10);
    eocd.writeUInt32LE(cdSize >= 0xffffffff ? 0xffffffff : cdSize, 12);
    eocd.writeUInt32LE(cdStart >= 0xffffffff ? 0xffffffff : cdStart, 16);
    eocd.writeUInt16LE(0, 20);
    this.write(eocd);
    fs.closeSync(this.fd);
    return { filePath: this.filePath, entries: this.entries, size: this.offset };
  }
}

// ---------------------------------------------------------------------------
// Zip reader over a range fetcher
// ---------------------------------------------------------------------------

export interface ZipCdEntry {
  name: string;
  method: 0 | 8;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

export interface CentralDirectory {
  entries: ZipCdEntry[];
  size: number;
}

export async function readCentralDirectory(
  fetchRange: (start: number, end: number) => Promise<Buffer>,
  totalSize: number,
): Promise<CentralDirectory> {
  const tailLen = Math.min(totalSize, 22 + 65536);
  const tail = await fetchRange(totalSize - tailLen, totalSize - 1);
  // EOCD signature scan, from the end of the tail buffer.
  let eocdPos = -1;
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tail.readUInt32LE(i) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos < 0) throw new Error("zip: end of central directory not found");
  let count = tail.readUInt16LE(eocdPos + 10);
  let cdSize = tail.readUInt32LE(eocdPos + 12);
  let cdOffset = tail.readUInt32LE(eocdPos + 16);

  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    // zip64: the locator sits immediately before the EOCD.
    const locatorStart = eocdPos - 20;
    if (locatorStart < 0 || tail.readUInt32LE(locatorStart) !== 0x07064b50) {
      throw new Error("zip: zip64 locator missing");
    }
    const z64Offset = Number(tail.readBigUInt64LE(locatorStart + 8));
    const z64 = await fetchRange(z64Offset, z64Offset + 56 - 1);
    if (z64.readUInt32LE(0) !== 0x06064b50) throw new Error("zip: bad zip64 EOCD");
    count = Number(z64.readBigUInt64LE(32));
    cdSize = Number(z64.readBigUInt64LE(40));
    cdOffset = Number(z64.readBigUInt64LE(48));
  }

  // The directory often lands inside the tail we already fetched.
  const tailStart = totalSize - tailLen;
  let cd: Buffer;
  if (cdOffset >= tailStart && cdOffset + cdSize <= totalSize) {
    cd = tail.subarray(cdOffset - tailStart, cdOffset - tailStart + cdSize);
  } else {
    cd = await fetchRange(cdOffset, cdOffset + cdSize - 1);
  }

  const entries: ZipCdEntry[] = [];
  let pos = 0;
  while (pos + 46 <= cd.length && entries.length < count) {
    if (cd.readUInt32LE(pos) !== 0x02014b50) break;
    const method = cd.readUInt16LE(pos + 10) as 0 | 8;
    const crc = cd.readUInt32LE(pos + 16);
    let compressedSize = cd.readUInt32LE(pos + 20);
    let uncompressedSize = cd.readUInt32LE(pos + 24);
    const nameLen = cd.readUInt16LE(pos + 28);
    const extraLen = cd.readUInt16LE(pos + 30);
    const commentLen = cd.readUInt16LE(pos + 32);
    let localOffset = cd.readUInt32LE(pos + 42);
    const name = cd.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      // zip64 extra field (0x0001): fields appear in order, only for the
      // slots that carried the 0xFFFFFFFF sentinel.
      let epos = pos + 46 + nameLen;
      const eend = epos + extraLen;
      while (epos + 4 <= eend) {
        const tag = cd.readUInt16LE(epos);
        const tlen = cd.readUInt16LE(epos + 2);
        if (tag === 0x0001) {
          let vpos = epos + 4;
          if (uncompressedSize === 0xffffffff) {
            uncompressedSize = Number(cd.readBigUInt64LE(vpos));
            vpos += 8;
          }
          if (compressedSize === 0xffffffff) {
            compressedSize = Number(cd.readBigUInt64LE(vpos));
            vpos += 8;
          }
          if (localOffset === 0xffffffff) {
            localOffset = Number(cd.readBigUInt64LE(vpos));
            vpos += 8;
          }
          break;
        }
        epos += 4 + tlen;
      }
    }
    entries.push({ name, method, crc, compressedSize, uncompressedSize, localOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  if (entries.length === 0 && count > 0) throw new Error("zip: central directory parse failed");
  return { entries, size: totalSize };
}

/**
 * Fetch one entry's data. Local headers carry name/extra lengths, so a small
 * first range read locates the data start, then one more range GET pulls the
 * (possibly deflated) bytes. Returns the raw entry bytes — caller inflates.
 */
export async function fetchZipEntry(
  fetchRange: (start: number, end: number) => Promise<Buffer>,
  entry: ZipCdEntry,
): Promise<Buffer> {
  const head = await fetchRange(entry.localOffset, entry.localOffset + 30 - 1);
  if (head.readUInt32LE(0) !== 0x04034b50) {
    throw new Error(`zip: bad local header for ${entry.name}`);
  }
  const nameLen = head.readUInt16LE(26);
  const extraLen = head.readUInt16LE(28);
  const dataStart = entry.localOffset + 30 + nameLen + extraLen;
  const raw = await fetchRange(dataStart, dataStart + entry.compressedSize - 1);
  if (entry.method === 8) return zlib.inflateRawSync(raw);
  return raw;
}

// ---------------------------------------------------------------------------
// HTTP helpers (no fetch — node:http/https, works on every node since v0.x)
// ---------------------------------------------------------------------------

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function httpRequest(opts: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: Buffer;
  redirects?: number;
  timeoutMs?: number;
}): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(opts.url);
    const lib = url.protocol === "http:" ? http : https;
    const req = lib.request(
      url,
      {
        method: opts.method,
        headers: opts.headers,
        timeout: opts.timeoutMs ?? 60000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          const body = Buffer.concat(chunks);
          const redirects = opts.redirects ?? 3;
          if (status >= 300 && status < 400 && typeof res.headers.location === "string" && redirects > 0) {
            httpRequest({
              ...opts,
              url: new URL(res.headers.location, url).toString(),
              redirects: redirects - 1,
            }).then(resolve, reject);
            return;
          }
          resolve({ status, headers: res.headers, body });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("http request timeout")));
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** Like httpRequest but streams the request body from a file (zip upload). */
function httpPutFile(opts: {
  url: string;
  headers?: Record<string, string>;
  filePath: string;
  redirects?: number;
  timeoutMs?: number;
}): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(opts.url);
    const lib = url.protocol === "http:" ? http : https;
    const size = fs.statSync(opts.filePath).size;
    const req = lib.request(
      url,
      {
        method: "PUT",
        headers: { "content-length": String(size), ...(opts.headers ?? {}) },
        timeout: opts.timeoutMs ?? 120000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          const redirects = opts.redirects ?? 3;
          if (status >= 300 && status < 400 && typeof res.headers.location === "string" && redirects > 0) {
            httpPutFile({ ...opts, url: new URL(res.headers.location, url).toString(), redirects: redirects - 1 }).then(
              resolve,
              reject,
            );
            return;
          }
          resolve({ status, headers: res.headers, body: Buffer.concat(chunks) });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("http put timeout")));
    req.on("error", reject);
    fs.createReadStream(opts.filePath).on("error", reject).pipe(req);
  });
}

// ---------------------------------------------------------------------------
// Object stores
// ---------------------------------------------------------------------------

interface ObjectStore {
  /** `end` is inclusive (Range header semantics). */
  get(key: string, range?: { start: number; end: number }): Promise<Buffer>;
  head(key: string): Promise<boolean>;
  /** Object size in bytes (HEAD content-length). */
  stat(key: string): Promise<number>;
  put(key: string, data: Buffer): Promise<void>;
  putFile(key: string, filePath: string): Promise<void>;
  /** Public/base URL for a key when the store can serve plain GETs. */
  urlFor?(key: string): string;
}

function joinKey(prefix: string | undefined, key: string): string {
  return `${prefix ?? ""}${key}`;
}

/** Plain unauthenticated HTTP object store — local stubs, public buckets. */
function httpStore(cfg: { baseUrl: string; headers?: Record<string, string>; prefix?: string }): ObjectStore {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const url = (key: string) => `${base}/${joinKey(cfg.prefix, key)}`;
  return {
    async get(key, range) {
      const headers = { ...(cfg.headers ?? {}) };
      if (range) headers.Range = `bytes=${range.start}-${range.end}`;
      const res = await httpRequest({ method: "GET", url: url(key), headers });
      if (res.status === 404) throw new Error(`store: object not found: ${key}`);
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`store: GET ${key} failed: ${res.status} ${res.body.toString("utf8").slice(0, 200)}`);
      }
      return res.body;
    },
    async head(key) {
      const res = await httpRequest({ method: "HEAD", url: url(key), headers: cfg.headers });
      if (res.status === 404) return false;
      if (res.status < 200 || res.status >= 300) throw new Error(`store: HEAD ${key} failed: ${res.status}`);
      return true;
    },
    async stat(key) {
      const res = await httpRequest({ method: "HEAD", url: url(key), headers: cfg.headers });
      if (res.status < 200 || res.status >= 300) throw new Error(`store: HEAD ${key} failed: ${res.status}`);
      const size = Number(res.headers["content-length"]);
      if (!Number.isFinite(size)) throw new Error(`store: HEAD ${key} returned no content-length`);
      return size;
    },
    async put(key, data) {
      const res = await httpRequest({
        method: "PUT",
        url: url(key),
        headers: { "content-length": String(data.length), ...(cfg.headers ?? {}) },
        body: data,
      });
      if (res.status < 200 || res.status >= 300) throw new Error(`store: PUT ${key} failed: ${res.status}`);
    },
    async putFile(key, filePath) {
      const res = await httpPutFile({ url: url(key), headers: cfg.headers, filePath });
      if (res.status < 200 || res.status >= 300) throw new Error(`store: PUT ${key} failed: ${res.status}`);
    },
    urlFor: url,
  };
}

/** Minimal AWS SigV4 signer for S3-compatible stores (Tigris, S3, R2, minio). */
function s3Store(cfg: {
  endpoint: string;
  bucket: string;
  prefix?: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  style?: "path" | "vhost";
}): ObjectStore {
  const region = cfg.region ?? "auto";
  const endpoint = cfg.endpoint.replace(/\/+$/, "");
  const style = cfg.style ?? "vhost";

  const buildUrl = (key: string): { url: string; host: string; path: string } => {
    const full = joinKey(cfg.prefix, key)
      .split("/")
      .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
      .join("/");
    if (style === "path") {
      const u = new URL(`${endpoint}/${cfg.bucket}/${full}`);
      return { url: u.toString(), host: u.host, path: `/${cfg.bucket}/${full}` };
    }
    const u = new URL(endpoint);
    u.host = `${cfg.bucket}.${u.host}`;
    u.pathname = `/${full}`;
    return { url: u.toString(), host: u.host, path: `/${full}` };
  };

  const sign = (method: string, key: string, headers: Record<string, string>, payloadHash: string): Record<string, string> => {
    const { host, path: uriPath } = buildUrl(key);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const dateStamp = amzDate.slice(0, 8);
    const signed: Record<string, string> = {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...headers,
    };
    if (cfg.sessionToken) signed["x-amz-security-token"] = cfg.sessionToken;
    const headerKeys = Object.keys(signed).sort();
    const canonicalHeaders = headerKeys.map((k) => `${k.toLowerCase()}:${String(signed[k]).trim()}\n`).join("");
    const signedHeaders = headerKeys.map((k) => k.toLowerCase()).join(";");
    const canonicalRequest = [method, uriPath, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Buffer(canonicalRequest)}`;
    const hmac = (key: string | Buffer, data: string) => crypto.createHmac("sha256", key).update(data).digest();
    const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, "s3");
    const kSigning = hmac(kService, "aws4_request");
    const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");
    return {
      ...signed,
      Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  };

  const request = async (method: string, key: string, extraHeaders?: Record<string, string>, body?: Buffer): Promise<HttpResponse> => {
    const payloadHash = body ? sha256Buffer(body) : sha256Buffer(Buffer.alloc(0));
    const headers = sign(method, key, { ...(extraHeaders ?? {}) }, payloadHash);
    const { url } = buildUrl(key);
    return httpRequest({ method, url, headers, body });
  };

  return {
    async get(key, range) {
      const headers: Record<string, string> = {};
      if (range) headers.Range = `bytes=${range.start}-${range.end}`;
      const res = await request("GET", key, headers);
      if (res.status === 404) throw new Error(`s3: object not found: ${key}`);
      if (res.status !== 200 && res.status !== 206) {
        throw new Error(`s3: GET ${key} failed: ${res.status} ${res.body.toString("utf8").slice(0, 200)}`);
      }
      return res.body;
    },
    async head(key) {
      const res = await request("HEAD", key);
      if (res.status === 404) return false;
      if (res.status < 200 || res.status >= 300) throw new Error(`s3: HEAD ${key} failed: ${res.status}`);
      return true;
    },
    async stat(key) {
      const res = await request("HEAD", key);
      if (res.status < 200 || res.status >= 300) throw new Error(`s3: HEAD ${key} failed: ${res.status}`);
      const size = Number(res.headers["content-length"]);
      if (!Number.isFinite(size)) throw new Error(`s3: HEAD ${key} returned no content-length`);
      return size;
    },
    async put(key, data) {
      const res = await request("PUT", key, { "content-length": String(data.length) }, data);
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`s3: PUT ${key} failed: ${res.status} ${res.body.toString("utf8").slice(0, 200)}`);
      }
    },
    async putFile(key, filePath) {
      // File puts stream the body but still need the payload hash up front.
      const data = fs.readFileSync(filePath);
      const res = await request("PUT", key, { "content-length": String(data.length) }, data);
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`s3: PUT ${key} failed: ${res.status} ${res.body.toString("utf8").slice(0, 200)}`);
      }
    },
  };
}

/**
 * Platform-minted credentials without secrets on the box:
 *  - `post`: an S3 POST policy (url + form fields) — uploads land via
 *    multipart POST with `key` = minted prefix + object name.
 *  - `getBaseUrl`: a read base (public bucket URL or CDN) for GET/HEAD.
 *  - `putUrls`: per-object presigned PUTs (e.g. the checkpoint zip — its key
 *    is known ahead of capture, so the platform can presign it exactly).
 */
function presignedStore(cfg: {
  post?: { url: string; fields: Record<string, string> };
  getBaseUrl?: string;
  putUrls?: Record<string, string>;
  prefix?: string;
}): ObjectStore {
  const readBase = cfg.getBaseUrl ? httpStore({ baseUrl: cfg.getBaseUrl, prefix: cfg.prefix }) : null;
  const post = cfg.post;
  return {
    async get(key, range) {
      if (!readBase) throw new Error("presigned store: no getBaseUrl for reads");
      return readBase.get(key, range);
    },
    async head(key) {
      if (!readBase) return false;
      return readBase.head(key);
    },
    async stat(key) {
      if (!readBase) throw new Error("presigned store: no getBaseUrl for reads");
      return readBase.stat(key);
    },
    async put(key, data) {
      const presigned = cfg.putUrls?.[joinKey(cfg.prefix, key)] ?? cfg.putUrls?.[key];
      if (presigned) {
        const res = await httpRequest({
          method: "PUT",
          url: presigned,
          headers: { "content-length": String(data.length) },
          body: data,
        });
        if (res.status < 200 || res.status >= 300) {
          throw new Error(`presigned PUT ${key} failed: ${res.status} ${res.body.toString("utf8").slice(0, 200)}`);
        }
        return;
      }
      if (!post) throw new Error(`presigned store: no upload path for ${key}`);
      const objectKey = joinKey(cfg.prefix, key);
      const formFields = { ...post.fields };
      formFields.key = formFields.key?.includes("${filename}")
        ? formFields.key.replaceAll("${filename}", objectKey)
        : objectKey;
      const boundary = `----daemond${crypto.randomBytes(12).toString("hex")}`;
      const parts: Buffer[] = [];
      for (const [k, v] of Object.entries(formFields)) {
        parts.push(
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`, "utf8"),
        );
      }
      parts.push(
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${objectKey}"\r\nContent-Type: application/octet-stream\r\n\r\n`, "utf8"),
      );
      parts.push(data);
      parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"));
      const body = Buffer.concat(parts);
      const res = await httpRequest({
        method: "POST",
        url: post.url,
        headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(body.length) },
        body,
      });
      if (res.status < 200 || res.status >= 400) {
        throw new Error(`presigned POST ${key} failed: ${res.status} ${res.body.toString("utf8").slice(0, 200)}`);
      }
    },
    async putFile(key, filePath) {
      await this.put(key, fs.readFileSync(filePath));
    },
    urlFor: readBase?.urlFor,
  };
}

function makeStore(cfg: unknown): ObjectStore {
  const store = (cfg ?? {}) as Record<string, unknown>;
  if (store.kind === "http" || typeof store.baseUrl === "string") {
    return httpStore(store as { baseUrl: string; headers?: Record<string, string>; prefix?: string });
  }
  if (store.kind === "s3" || typeof store.accessKeyId === "string") {
    return s3Store(store as Parameters<typeof s3Store>[0]);
  }
  if (store.kind === "presigned" || store.post || store.putUrls || store.getBaseUrl) {
    return presignedStore(store as Parameters<typeof presignedStore>[0]);
  }
  throw new Error("checkpoint: store config required (http baseUrl | s3 creds | presigned post/getBaseUrl)");
}

// ---------------------------------------------------------------------------
// Ops
// ---------------------------------------------------------------------------

const BLOBS_PREFIX = "blobs/";
const CHECKPOINTS_PREFIX = "checkpoints/";
const MANIFESTS_PREFIX = "manifests/";

/** Manifest from an inline object, a URL, or a local file path. */
async function loadManifestRef(
  ref: { manifest?: CheckpointManifest; manifestUrl?: string; manifestPath?: string } | undefined,
): Promise<CheckpointManifest | null> {
  if (ref?.manifest) return ref.manifest;
  if (ref?.manifestUrl) {
    const res = await httpRequest({ method: "GET", url: ref.manifestUrl });
    if (res.status >= 200 && res.status < 300) {
      return JSON.parse(res.body.toString("utf8")) as CheckpointManifest;
    }
    return null;
  }
  if (ref?.manifestPath) {
    return JSON.parse(fs.readFileSync(ref.manifestPath, "utf8")) as CheckpointManifest;
  }
  return null;
}

function parsePayload(argv: string[]): { op: string; args: Record<string, unknown> } {
  const op = argv[2];
  if (!op) throw new Error("checkpoint: op required (scan|capture|restore|diff)");
  let raw = argv[3] ?? "{}";
  if (raw.startsWith("b64:")) raw = Buffer.from(raw.slice(4), "base64").toString("utf8");
  const args = JSON.parse(raw) as Record<string, unknown>;
  return { op, args };
}

async function opScan(args: Record<string, unknown>): Promise<void> {
  const { manifest, missing } = await buildManifest({
    checkpointId: args.checkpointId as string | undefined,
    paths: (args.paths as string[]) ?? [],
    exclude: args.exclude as string[] | undefined,
    meta: args.meta as Parameters<typeof buildManifest>[0]["meta"],
    hashConcurrency: args.concurrency as number | undefined,
  });
  emitResult({ op: "scan", manifest, missing });
}

async function opCapture(args: Record<string, unknown>): Promise<void> {
  const started = Date.now();
  const store = makeStore(args.store);
  const { manifest, missing } = await buildManifest({
    checkpointId: args.checkpointId as string | undefined,
    paths: (args.paths as string[]) ?? [],
    exclude: args.exclude as string[] | undefined,
    meta: args.meta as Parameters<typeof buildManifest>[0]["meta"],
    hashConcurrency: args.concurrency as number | undefined,
  });

  // Collect the unique blob shas this checkpoint needs.
  const blobBySha = new Map<string, string>();
  for (const [abs, entry] of Object.entries(manifest.files)) {
    if (entry.type === "file" && entry.sha) blobBySha.set(entry.sha, abs);
  }

  // Dedup against prior checkpoints: caller-supplied sha set, a parent
  // manifest (inline or URL), then HEAD checks on the store itself.
  const dedup = (args.dedup ?? {}) as { knownBlobs?: string[]; parentManifest?: unknown; checkHead?: boolean };
  const known = new Set<string>(dedup.knownBlobs ?? []);
  const parent = dedup.parentManifest as
    | { manifest?: CheckpointManifest; manifestUrl?: string; manifestPath?: string }
    | undefined;
  const parentManifest = await loadManifestRef(parent);
  if (parentManifest) {
    for (const entry of Object.values(parentManifest.files)) if (entry.sha) known.add(entry.sha);
  }

  let candidates = [...blobBySha.keys()].filter((sha) => !known.has(sha));
  if (dedup.checkHead !== false && candidates.length > 0) {
    const headReporter = new ProgressReporter("capture", "dedup-head", candidates.length);
    let headDone = 0;
    const stillNeeded = await mapLimit(candidates, 16, async (sha) => {
      const exists = await store.head(`${BLOBS_PREFIX}${sha}`);
      headDone += 1;
      headReporter.tick(headDone);
      return exists ? null : sha;
    });
    candidates = stillNeeded.filter((sha): sha is string => sha !== null);
  }
  const newBlobs = new Set(candidates);
  manifest.blobsInZip = args.includeBlobsInZip === false ? [] : [...newBlobs].sort();

  // Upload new standalone blobs first; the zip PUT is the commit point, so a
  // mid-capture disconnect can only orphan deduplicatable CAS objects.
  const uploadReporter = new ProgressReporter("capture", "upload-blobs", candidates.length);
  let uploaded = 0;
  let uploadedBytes = 0;
  await mapLimit(candidates, (args.uploadConcurrency as number | undefined) ?? 8, async (sha) => {
    const abs = blobBySha.get(sha)!;
    await store.put(`${BLOBS_PREFIX}${sha}`, fs.readFileSync(abs));
    uploaded += 1;
    uploadedBytes += manifest.files[abs]?.size ?? 0;
    uploadReporter.tick(uploaded, uploadedBytes);
  });

  // Delta zip: manifest.json + entries for blobs new to this checkpoint.
  const tmpZip = path.join(os.tmpdir(), `checkpoint-${manifest.checkpointId}-${process.pid}.zip`);
  const writer = new ZipWriter(tmpZip);
  const zipReporter = new ProgressReporter("capture", "zip", manifest.blobsInZip.length + 1);
  let zipped = 0;
  for (const sha of manifest.blobsInZip) {
    const abs = blobBySha.get(sha)!;
    await writer.addFile(`${BLOBS_PREFIX}${sha}`, abs, { mtime: manifest.files[abs]?.mtime });
    zipped += 1;
    zipReporter.tick(zipped);
  }
  writer.addBuffer("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"), {
    mtime: Date.now(),
  });
  zipReporter.tick(zipped + 1);
  const zipInfo = writer.finish();

  // Standalone manifest: lets dedup/parent lookups reference a small object
  // instead of carrying the whole manifest through argv (which tops out at
  // ~128KB/arg) or parsing it out of the zip.
  const manifestKey = `${MANIFESTS_PREFIX}${manifest.checkpointId}.json`;
  await store.put(manifestKey, Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));

  const zipKey = `${CHECKPOINTS_PREFIX}${manifest.checkpointId}.zip`;
  const presignedZip = (args.zipPutUrl ??
    ((args.store as { putUrls?: Record<string, string> } | undefined)?.putUrls?.[zipKey])) as string | undefined;
  if (presignedZip) {
    const res = await httpPutFile({ url: presignedZip, filePath: tmpZip });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`presigned PUT ${zipKey} failed: ${res.status} ${res.body.toString("utf8").slice(0, 200)}`);
    }
  } else {
    await store.putFile(zipKey, tmpZip);
  }
  fs.rmSync(tmpZip, { force: true });

  emitResult({
    op: "capture",
    checkpointId: manifest.checkpointId,
    manifest,
    missing,
    zipKey,
    manifestKey,
    zipBytes: zipInfo.size,
    blobsTotal: blobBySha.size,
    blobsNew: candidates.length,
    blobsDeduped: blobBySha.size - candidates.length,
    bytesNew: uploadedBytes,
    ms: Date.now() - started,
  });
}

interface RestoreSource {
  kind: "zip-entry" | "blob";
  entry?: ZipCdEntry;
}

async function opRestore(args: Record<string, unknown>): Promise<void> {
  const started = Date.now();
  const store = args.store ? makeStore(args.store) : null;
  const zipUrl = args.checkpointUrl as string | undefined;
  const zipKey = `${CHECKPOINTS_PREFIX}${String(args.checkpointId ?? "")}.zip`;

  // fetchRange abstracts whether the zip is reached through the store or a
  // presigned/plain URL.
  let fetchRange: (start: number, end: number) => Promise<Buffer>;
  let totalSize: number;
  if (zipUrl) {
    const sizeRes = await httpRequest({ method: "HEAD", url: zipUrl });
    if (sizeRes.status !== 200 || !sizeRes.headers["content-length"]) {
      throw new Error(`restore: HEAD ${zipUrl} failed or lacks content-length (${sizeRes.status})`);
    }
    totalSize = Number(sizeRes.headers["content-length"]);
    fetchRange = async (start, end) => {
      const res = await httpRequest({
        method: "GET",
        url: zipUrl,
        headers: { Range: `bytes=${start}-${end}` },
      });
      if (res.status !== 200 && res.status !== 206) {
        throw new Error(`restore: range GET failed: ${res.status} ${res.body.toString("utf8").slice(0, 200)}`);
      }
      return res.body;
    };
  } else if (store) {
    totalSize = await store.stat(zipKey);
    fetchRange = async (start, end) => store.get(zipKey, { start, end });
  } else {
    throw new Error("restore: checkpointUrl or store required");
  }

  const cd = await readCentralDirectory(fetchRange, totalSize);
  const byName = new Map(cd.entries.map((entry) => [entry.name, entry]));
  const manifestEntry = byName.get("manifest.json");
  if (!manifestEntry) throw new Error("restore: manifest.json not in checkpoint zip");
  const manifestRaw = await fetchZipEntry(fetchRange, manifestEntry);
  const manifest = JSON.parse(manifestRaw.toString("utf8")) as CheckpointManifest;

  const strictArch = args.strictArch === true;
  const archMismatch = manifest.arch !== process.arch || manifest.platform !== process.platform;
  if (archMismatch && strictArch) {
    throw new Error(
      `restore: arch mismatch — checkpoint is ${manifest.platform}/${manifest.arch}, box is ${process.platform}/${process.arch}`,
    );
  }

  const includeGlobs = compileGlobs(args.include as string[] | undefined);
  const excludeGlobs = compileGlobs(args.exclude as string[] | undefined);
  const destDir = args.destDir as string | undefined;
  // destDir replaces the capture root: with one capture path it is stripped
  // outright; with several, their common directory prefix is stripped so the
  // roots' distinguishing tails survive under destDir. Absolute paths still
  // identify files in the manifest — destDir only changes where they land.
  const capturePaths = (manifest.capture?.paths ?? []).filter((p): p is string => typeof p === "string");
  const rootPrefix =
    capturePaths.length === 0
      ? "/"
      : capturePaths.length === 1
        ? capturePaths[0]
        : (() => {
            let prefix = capturePaths[0];
            for (const p of capturePaths.slice(1)) {
              while (!p.startsWith(prefix + "/") && prefix !== "/") prefix = path.dirname(prefix);
              if (!p.startsWith(prefix)) prefix = "/";
            }
            return prefix;
          })();
  const mapPath = (abs: string): string => {
    if (!destDir) return abs;
    const rel =
      abs === rootPrefix ? "" : abs.startsWith(rootPrefix + "/") ? abs.slice(rootPrefix.length + 1) : abs.replace(/^\/+/, "");
    return rel === "" ? destDir : path.join(destDir, rel);
  };

  const fileEntries = Object.entries(manifest.files).filter(([p, entry]) => {
    if (entry.type !== "file") return false;
    if (includeGlobs.length > 0 && !includeGlobs.some((g) => g.regex.test(p))) return false;
    if (excludeGlobs.length > 0 && excludeGlobs.some((g) => g.regex.test(p))) return false;
    return true;
  });

  const reporter = new ProgressReporter("restore", "files", fileEntries.length);
  let done = 0;
  let fetchedBytes = 0;
  let fromZip = 0;
  let fromStore = 0;
  const failures: Array<{ path: string; error: string }> = [];

  await mapLimit(fileEntries, (args.concurrency as number) ?? 8, async ([abs, entry]) => {
    try {
      const sha = entry.sha!;
      const zipSource = manifest.blobsInZip.includes(sha) ? byName.get(`${BLOBS_PREFIX}${sha}`) : undefined;
      let data: Buffer;
      let source: RestoreSource["kind"];
      if (zipSource) {
        data = await fetchZipEntry(fetchRange, zipSource);
        source = "zip-entry";
      } else {
        if (!store) throw new Error("blob not in zip and no store for blobs/");
        data = await store.get(`${BLOBS_PREFIX}${sha}`);
        source = "blob";
      }
      const actual = sha256Buffer(data);
      if (actual !== sha) {
        throw new Error(`sha256 mismatch: expected ${sha}, got ${actual}`);
      }
      const dest = mapPath(abs);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, data);
      try {
        fs.chmodSync(dest, entry.mode & 0o7777);
      } catch {}
      try {
        const mtime = new Date(entry.mtime);
        fs.utimesSync(dest, new Date(), mtime);
      } catch {}
      fetchedBytes += data.length;
      if (source === "zip-entry") fromZip += 1;
      else fromStore += 1;
      done += 1;
      reporter.tick(done, fetchedBytes);
    } catch (err) {
      failures.push({ path: abs, error: err instanceof Error ? err.message : String(err) });
      done += 1;
      reporter.tick(done, fetchedBytes);
    }
  });

  // Directories and symlinks land after files (parents must exist first —
  // longest path first orders parents before children).
  const dirs = Object.entries(manifest.files)
    .filter(([, entry]) => entry.type === "dir")
    .sort((a, b) => a[0].length - b[0].length);
  for (const [p, entry] of dirs) {
    try {
      const dest = mapPath(p);
      fs.mkdirSync(dest, { recursive: true });
      try {
        fs.chmodSync(dest, entry.mode & 0o7777);
      } catch {}
    } catch (err) {
      failures.push({ path: p, error: err instanceof Error ? err.message : String(err) });
    }
  }
  for (const [p, entry] of Object.entries(manifest.files).filter(([, e]) => e.type === "symlink")) {
    try {
      const dest = mapPath(p);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try {
        fs.rmSync(dest, { force: true });
      } catch {}
      fs.symlinkSync(entry.link ?? "", dest);
    } catch (err) {
      failures.push({ path: p, error: err instanceof Error ? err.message : String(err) });
    }
  }

  emitResult({
    op: "restore",
    checkpointId: manifest.checkpointId,
    files: fileEntries.length,
    bytes: fetchedBytes,
    fromZip,
    fromStore,
    failures,
    archMismatch,
    cwd: manifest.cwd,
    env: manifest.env,
    ms: Date.now() - started,
  });
}

async function opDiff(args: Record<string, unknown>): Promise<void> {
  const a = await loadManifestRef(args.a as Parameters<typeof loadManifestRef>[0]);
  const b = await loadManifestRef(args.b as Parameters<typeof loadManifestRef>[0]);
  if (!a || !b) throw new Error("diff: each side needs manifest, manifestUrl, or manifestPath");
  emitResult({ op: "diff", diff: diffManifests(a, b) });
}

async function main(): Promise<void> {
  const { op, args } = parsePayload(process.argv);
  switch (op) {
    case "scan":
      return opScan(args);
    case "capture":
      return opCapture(args);
    case "restore":
      return opRestore(args);
    case "diff":
      return opDiff(args);
    default:
      throw new Error(`checkpoint: unknown op ${op}`);
  }
}

// The daemon installs this file under an arbitrary name (e.g. checkpoint.cjs),
// so match by require.main identity, not by filename — `require`/`module` only
// exist when this file executes as CJS, so the check is a no-op under ESM
// loaders (vitest imports the exports without running an op).
const invokedDirectly =
  typeof require === "function" &&
  typeof module === "object" &&
  require.main === module;
if (invokedDirectly) {
  main().catch(emitError);
}
