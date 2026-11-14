/**
 * checkpoint-oci-module — the in-sandbox capture/restore engine for daemond,
 * OCI artifact edition.
 *
 * Runs as a detached module job (`module.exec`) inside the sandbox: pure Node
 * stdlib (fs/crypto/zlib/http/https), so it executes on any provider image
 * that has a node runtime — including the daemond-bootstrapped static node.
 * The platform installs it via `module.install` with the source passed
 * explicitly (`checkpointInstallInput(source)`); this file is that source.
 *
 * Usage: `node checkpoint-oci-module.cjs <op> <payload>`
 *   payload: `b64:<base64-json>` or raw JSON on argv[3].
 *   stdout: JSON lines — `{type:"progress",...}`* then `{type:"result",...}`
 *   or `{type:"error",message}` with a non-zero exit code.
 *
 * Ops:
 *   scan     walk + sha256 + build the file index (no upload)
 *   capture  walk → deterministic tar+gzip layers → CAS blobs → OCI manifest
 *   restore  fetch manifest → config (file index) → only the layers that
 *            cover selected files → verify sha256 → extract
 *   diff     compare two checkpoints' file indexes → added/changed/deleted
 *
 * Artifact layout (OCI image-layout-inspired, `{prefix}` = "{orgId}/"):
 *   blobs/{sha256-hex}        content-addressed objects: one per layer
 *                           (tar+gzip) plus the image-config JSON blob
 *   manifests/{id}.json       OCI image manifest — the checkpoint's commit
 *                           point; small, fetchable without pulling layers
 *
 * Because a layer is a tar+gzip blob addressed by digest and the manifest is
 * an OCI manifest, a checkpoint is pullable by ordinary OCI tooling and can
 * lazy-pull: read the manifest (KB), then fetch only the layers needed.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const http = require("node:http");
const https = require("node:https");

// ---------------------------------------------------------------------------
// Wire output
// ---------------------------------------------------------------------------

function emitProgress(op, phase, done, total, bytes) {
  const event = { type: "progress", op, phase, done, total };
  if (bytes !== undefined) event.bytes = bytes;
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function emitResult(value) {
  process.stdout.write(`${JSON.stringify({ type: "result", ...value })}\n`);
}

/**
 * Emit an op result. When args.resultPath is set the full result is written
 * to that file and stdout gets a slim pointer instead — detached job output
 * is tail-bounded (4MiB), and a big manifest/result line would be clipped
 * mid-JSON before callers could parse it.
 */
function emitOpResult(args, result) {
  const resultPath =
    typeof args.resultPath === "string" && args.resultPath.length > 0
      ? args.resultPath
      : undefined;
  if (!resultPath) {
    emitResult(result);
    return;
  }
  fs.writeFileSync(resultPath, JSON.stringify(result));
  emitResult({ op: result.op, resultPath });
}

function emitError(err) {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stdout.write(`${JSON.stringify({ type: "error", message })}\n`);
  process.exit(1);
}

class ProgressReporter {
  constructor(op, phase, total, intervalMs = 250) {
    this.op = op;
    this.phase = phase;
    this.total = total;
    this.intervalMs = intervalMs;
    this.last = 0;
  }
  tick(done, bytes) {
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

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length))
    .fill(0)
    .map(async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index], index);
      }
    });
  await Promise.all(workers);
  return results;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function sha256Buffer(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** True when `resolved` equals `root` or sits under it (`root` itself may be "/"). */
function isUnderRoot(root, resolved) {
  if (resolved === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return resolved.startsWith(prefix);
}

// ---------------------------------------------------------------------------
// Glob matcher (gitignore-lite: **, *, ?, basename matching for bare names)
// ---------------------------------------------------------------------------

function escapeRegExp(value) {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function compileGlob(raw) {
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

function compileGlobs(globs) {
  return (globs ?? []).map(compileGlob);
}

function isExcluded(absPath, isDir, globs) {
  for (const glob of globs) {
    if (glob.dirOnly && !isDir) continue;
    if (glob.regex.test(absPath)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// File index (the checkpoint's config payload)
// ---------------------------------------------------------------------------

/**
 * The file index travels inside the OCI image-config blob — it is what makes
 * lazy pull meaningful (which layers cover which paths), powers `diff`, and
 * gives restore per-file sha256 verification without opening a layer.
 * Index entries are the old manifest's vocabulary plus `layer` — the index
 * of the manifest's `layers[]` the entry was packed into.
 */

function walkTree(paths, globs) {
  const tree = { files: [], dirs: [], symlinks: [], missing: [] };
  const visit = (abs) => {
    let stat;
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
      let names;
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

async function hashFiles(files, concurrency, reporter) {
  const hashes = new Map();
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

/**
 * Layer assignment: every capture root owns one layer; each tree entry is
 * packed into the layer of the *deepest* root that contains it, so a
 * checkpoint of unchanged subtrees reproduces identical layer blobs and
 * dedups whole-layer against the store.
 */
function layerFor(abs, roots) {
  let best = -1;
  for (let i = 0; i < roots.length; i += 1) {
    const root = roots[i];
    if (abs === root || abs.startsWith(root === "/" ? "/" : `${root}/`)) {
      if (best === -1 || roots[best].length < root.length) best = i;
    }
  }
  return best;
}

async function buildIndex(args) {
  const globs = compileGlobs(args.exclude);
  const paths = (args.paths ?? []).map((p) => path.resolve(p));
  // Capture-root belt: the platform validates `paths` lexically, but a
  // root with a symlinked intermediate component (e.g. /root/link/sub
  // where link -> /etc) resolves out of scope — realpath catches what a
  // string check cannot. Roots that don't resolve land in `missing`.
  const allowedRoots = (args.allowedRoots ?? [])
    .map((r) => {
      try {
        return fs.realpathSync(path.resolve(r));
      } catch {
        return null;
      }
    })
    .filter((r) => r !== null);
  if (allowedRoots.length > 0) {
    for (const p of paths) {
      let real;
      try {
        real = fs.realpathSync(p);
      } catch {
        continue;
      }
      if (!allowedRoots.some((r) => real === r || real.startsWith(`${r}/`))) {
        throw new Error(
          `capture path escapes allowed roots: ${p} -> ${real}`,
        );
      }
    }
  }
  const tree = walkTree(paths, globs);
  const totalBytes = tree.files.reduce((sum, f) => sum + f.size, 0);
  const reporter = new ProgressReporter("scan", "hash", tree.files.length);
  const hashes = await hashFiles(tree.files, args.hashConcurrency ?? 8, reporter);

  const files = {};
  for (const dir of tree.dirs) {
    files[dir.abs] = {
      type: "dir",
      mode: dir.mode,
      mtime: Math.round(dir.mtime),
      layer: layerFor(dir.abs, paths),
    };
  }
  for (const link of tree.symlinks) {
    files[link.abs] = {
      type: "symlink",
      mode: link.mode,
      mtime: Math.round(link.mtime),
      link: link.link,
      layer: layerFor(link.abs, paths),
    };
  }
  for (const file of tree.files) {
    files[file.abs] = {
      type: "file",
      sha: hashes.get(file.abs),
      size: file.size,
      mode: file.mode,
      mtime: Math.round(file.mtime),
      layer: layerFor(file.abs, paths),
    };
  }

  const config = {
    kind: "sandbox-checkpoint",
    version: 1,
    checkpointId:
      args.checkpointId ?? `ckpt-${crypto.randomBytes(8).toString("hex")}`,
    createdAt: new Date().toISOString(),
    arch: args.meta?.arch ?? process.arch,
    platform: args.meta?.platform ?? process.platform,
    capture: { paths, exclude: args.exclude ?? [], missing: tree.missing },
    stats: {
      files: tree.files.length,
      dirs: tree.dirs.length,
      symlinks: tree.symlinks.length,
      bytes: totalBytes,
    },
    files,
  };
  if (args.meta?.cwd !== undefined) config.cwd = args.meta.cwd;
  if (args.meta?.env !== undefined) config.env = args.meta.env;
  if (args.meta?.organizationId !== undefined) {
    config.organizationId = args.meta.organizationId;
  }
  if (args.meta?.sourceSandboxId !== undefined) {
    config.sourceSandboxId = args.meta.sourceSandboxId;
  }
  if (args.meta?.sourceProvider !== undefined) {
    config.sourceProvider = args.meta.sourceProvider;
  }

  return { config, missing: tree.missing, fileBytes: hashes };
}

function diffIndexes(a, b) {
  const added = [];
  const deleted = [];
  const changed = [];
  let unchanged = 0;
  const aFiles = a.files ?? {};
  const bFiles = b.files ?? {};
  for (const [p, entry] of Object.entries(bFiles)) {
    const prev = aFiles[p];
    if (!prev) {
      added.push(p);
    } else if (
      prev.type !== entry.type ||
      prev.sha !== entry.sha ||
      prev.mode !== entry.mode ||
      prev.link !== entry.link
    ) {
      changed.push({ path: p, aSha: prev.sha, bSha: entry.sha });
    } else {
      unchanged += 1;
    }
  }
  for (const p of Object.keys(aFiles)) {
    if (!(p in bFiles)) deleted.push(p);
  }
  added.sort();
  deleted.sort();
  changed.sort((x, y) => x.path.localeCompare(y.path));
  return { added, deleted, changed, unchanged };
}

// ---------------------------------------------------------------------------
// Tar writer — ustar + pax, streaming, deterministic.
//
// Entries are emitted sorted by tar path; header fields carry the file's real
// mode/uid/gid/mtime. gzip (zlib) writes a fixed mtime=0 header, so an
// unchanged subtree reproduces an identical layer blob — that identity is
// what content-addressed dedup across checkpoints rests on.
// ---------------------------------------------------------------------------

const TAR_BLOCK = 512;

function octal(value, length) {
  // POSIX octal field: zero-padded digits, null-terminated.
  const s = Math.floor(value).toString(8).padStart(length - 1, "0");
  if (s.length > length - 1) throw new Error(`tar: field overflow ${value}`);
  return `${s}\0`;
}

/**
 * Split a long name across ustar prefix+name when a "/" boundary allows it
 * (name ≤100, prefix ≤155); null when even that cannot hold it — the caller
 * emits a pax `path` record instead.
 */
function ustarNameSplit(name) {
  if (name.length <= 100) return { name, prefix: "" };
  const slash = name.lastIndexOf("/", Math.min(name.length, 100));
  if (slash < 0) return null;
  const prefix = name.slice(0, slash);
  const tail = name.slice(slash + 1);
  if (tail.length > 100 || prefix.length > 155 || tail.length === 0) return null;
  return { name: tail, prefix };
}

function tarChecksum(header) {
  let sum = 0;
  for (let i = 0; i < TAR_BLOCK; i += 1) {
    // chksum field (offset 148, len 8) counts as spaces while summing.
    sum += i >= 148 && i < 156 ? 0x20 : header[i];
  }
  return sum;
}

function tarHeader(fields) {
  const header = Buffer.alloc(TAR_BLOCK);
  header.write(fields.name.slice(0, 100), 0, "utf8");
  header.write(octal(fields.mode & 0o7777, 8), 100, "utf8");
  header.write(octal(fields.uid ?? 0, 8), 108, "utf8");
  header.write(octal(fields.gid ?? 0, 8), 116, "utf8");
  header.write(octal(fields.size ?? 0, 12), 124, "utf8");
  header.write(octal(fields.mtime ?? 0, 12), 136, "utf8");
  // chksum filled after summing.
  header.write(fields.typeflag, 156, "utf8");
  if (fields.linkname) header.write(fields.linkname.slice(0, 100), 157, "utf8");
  header.write("ustar\0", 257, "utf8");
  header.write("00", 263, "utf8");
  if (fields.uname) header.write(fields.uname.slice(0, 32), 265, "utf8");
  if (fields.gname) header.write(fields.gname.slice(0, 32), 297, "utf8");
  if (fields.prefix) header.write(fields.prefix.slice(0, 155), 345, "utf8");
  const sum = tarChecksum(header);
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "utf8");
  return header;
}

/** A pax extended-header entry carrying the given records (path, linkpath). */
function paxEntry(records) {
  let body = "";
  for (const [key, value] of Object.entries(records)) {
    // record = "<len> <key>=<value>\n" where len covers the whole record.
    let len = key.length + String(value).length + 3; // space, '=', '\n'
    len += String(len).length;
    // The length digits can grow the record when len crosses a power of ten.
    while (`${len} ${key}=${value}\n`.length !== len) len += 1;
    body += `${len} ${key}=${value}\n`;
  }
  const data = Buffer.from(body, "utf8");
  return {
    header: tarHeader({
      name: "pax_global_header",
      mode: 0o644,
      size: data.length,
      typeflag: "x",
    }),
    data,
  };
}

/**
 * Writes one layer's tar stream: entries already grouped/sorted by the
 * caller. Each entry = {name, type, mode, mtime, size, link, filePath}.
 * Returns {sha256, bytes} of the produced tar — the layer's diff_id —
 * through the `onChunk` taps the caller pipes through gzip.
 */
async function writeTar(out, entries, reporter) {
  let done = 0;
  const emit = (buf) => out.write(buf);
  for (const entry of entries) {
    const pax = {};
    const split = ustarNameSplit(entry.name);
    if (split === null) pax.path = entry.name;
    if (entry.link && entry.link.length > 100) pax.linkpath = entry.link;
    let header;
    if (Object.keys(pax).length > 0) {
      const p = paxEntry(pax);
      emit(p.header);
      emit(p.data);
      emit(Buffer.alloc((TAR_BLOCK - (p.data.length % TAR_BLOCK)) % TAR_BLOCK));
      header = tarHeader({
        ...entry,
        // Fallback name: basename truncated to fit — the pax `path` record
        // is authoritative for readers.
        name: entry.name.split("/").pop().slice(0, 100) || "entry",
        prefix: "",
      });
    } else {
      header = tarHeader({ ...entry, name: split.name, prefix: split.prefix });
    }
    emit(header);
    if (entry.typeflag === "0" && entry.size > 0) {
      // Stream the file body — never buffered whole.
      await new Promise((resolve, reject) => {
        const stream = fs.createReadStream(entry.filePath);
        stream.on("error", reject);
        stream.on("data", (chunk) => emit(chunk));
        stream.on("end", resolve);
      });
      emit(Buffer.alloc((TAR_BLOCK - (entry.size % TAR_BLOCK)) % TAR_BLOCK));
    }
    done += 1;
    reporter?.tick(done);
  }
  emit(Buffer.alloc(TAR_BLOCK * 2)); // end-of-archive marker
}

/**
 * Reads a tar stream from a file path and hands each entry to `onEntry`.
 * Entry = {name, typeflag, mode, uid, gid, size, mtime, linkname, pax}.
 * `onEntry` receives a `data()` reader: call it to consume the entry body
 * (must be called, or skipped via `skip()`, before the next entry parses —
 * the body is read lazily to keep memory O(1)).
 * Supports ustar, pax `x` records, and GNU `L`/`K` long-name records.
 */
async function readTar(filePath, onEntry) {
  const fd = fs.openSync(filePath, "r");
  try {
    let offset = 0;
    const buf = Buffer.alloc(TAR_BLOCK);
    const readBlock = async (at) => {
      const bytesRead = fs.readSync(fd, buf, 0, TAR_BLOCK, at);
      if (bytesRead < TAR_BLOCK) return null;
      return Buffer.from(buf);
    };
    const readBytes = async (at, length) => {
      const data = Buffer.alloc(length);
      let got = 0;
      while (got < length) {
        const bytesRead = fs.readSync(fd, data, got, length - got, at + got);
        if (bytesRead <= 0) break;
        got += bytesRead;
      }
      return data.subarray(0, got);
    };
    const skipTo = (at) => {
      offset = at;
    };
    let pendingName;
    let pendingLink;
    let pendingMtime;
    while (true) {
      const header = await readBlock(offset);
      if (header === null || header.every((b) => b === 0)) break;
      const oct = (start, len) => {
        const raw = header
          .subarray(start, start + len)
          .toString("utf8")
          .replace(/\0.*$/s, "")
          .trim();
        const value = parseInt(raw, 8);
        return Number.isFinite(value) ? value : 0;
      };
      const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
      const size = oct(124, 12);
      const typeflag = header.subarray(156, 157).toString("utf8") || "0";
      const linkname = header.subarray(157, 257).toString("utf8").replace(/\0.*$/s, "");
      const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/s, "");
      offset += TAR_BLOCK;
      const bodyAt = offset;
      offset += Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;

      if (typeflag === "x" || typeflag === "g") {
        const data = await readBytes(bodyAt, size);
        for (const rec of parsePaxRecords(data)) {
          if (rec.key === "path") pendingName = rec.value;
          else if (rec.key === "linkpath") pendingLink = rec.value;
          else if (rec.key === "mtime") pendingMtime = Math.floor(Number(rec.value));
        }
        continue;
      }
      if (typeflag === "L" || typeflag === "K") {
        const data = await readBytes(bodyAt, size);
        const text = data.toString("utf8").replace(/\0+$/, "");
        if (typeflag === "L") pendingName = text;
        else pendingLink = text;
        continue;
      }

      const fullName = pendingName ?? (prefix ? `${prefix}/${name}` : name);
      const entry = {
        name: fullName,
        typeflag,
        mode: oct(100, 8),
        uid: oct(108, 8),
        gid: oct(116, 8),
        size,
        mtime: pendingMtime ?? oct(136, 12),
        linkname: pendingLink ?? linkname,
      };
      pendingName = undefined;
      pendingLink = undefined;
      pendingMtime = undefined;
      await onEntry(entry, {
        /** Copy the entry body to `dest`; returns its sha256. */
        extract: async (dest) => {
          const hash = crypto.createHash("sha256");
          const outFd = fs.openSync(dest, "w");
          try {
            let left = size;
            let at = bodyAt;
            while (left > 0) {
              const chunk = Buffer.alloc(Math.min(left, 1 << 20));
              const bytesRead = fs.readSync(
                fd,
                chunk,
                0,
                chunk.length,
                at,
              );
              if (bytesRead <= 0) break;
              const slice = chunk.subarray(0, bytesRead);
              hash.update(slice);
              fs.writeSync(outFd, slice);
              at += bytesRead;
              left -= bytesRead;
            }
          } finally {
            fs.closeSync(outFd);
          }
          return hash.digest("hex");
        },
        skip: async () => skipTo(offset),
      });
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** Pax record stream: "<len> <key>=<value>\n" repeated. */
function parsePaxRecords(data) {
  const records = [];
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    if (space < 0) break;
    const len = Number(data.subarray(at, space).toString("utf8"));
    if (!Number.isFinite(len) || len <= 0) break;
    const rec = data.subarray(space + 1, at + len - 1).toString("utf8");
    const eq = rec.indexOf("=");
    if (eq > 0) records.push({ key: rec.slice(0, eq), value: rec.slice(eq + 1) });
    at += len;
  }
  return records;
}

// ---------------------------------------------------------------------------
// HTTP helpers (no fetch — node:http/https, works on every node since v0.x)
// ---------------------------------------------------------------------------

function httpRequest(opts) {
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
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          const body = Buffer.concat(chunks);
          const redirects = opts.redirects ?? 3;
          if (
            status >= 300 &&
            status < 400 &&
            typeof res.headers.location === "string" &&
            redirects > 0
          ) {
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

/** Like httpRequest but streams the request body from a file. */
function httpPutFile(opts) {
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
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          const redirects = opts.redirects ?? 3;
          if (
            status >= 300 &&
            status < 400 &&
            typeof res.headers.location === "string" &&
            redirects > 0
          ) {
            httpPutFile({
              ...opts,
              url: new URL(res.headers.location, url).toString(),
              redirects: redirects - 1,
            }).then(resolve, reject);
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

/** Streams a response body to `filePath`; returns the final HttpResponse. */
function httpGetFile(opts) {
  return new Promise((resolve, reject) => {
    const url = new URL(opts.url);
    const lib = url.protocol === "http:" ? http : https;
    const req = lib.request(
      url,
      { method: "GET", headers: opts.headers, timeout: opts.timeoutMs ?? 120000 },
      (res) => {
        const status = res.statusCode ?? 0;
        const redirects = opts.redirects ?? 3;
        if (
          status >= 300 &&
          status < 400 &&
          typeof res.headers.location === "string" &&
          redirects > 0
        ) {
          res.resume();
          httpGetFile({
            ...opts,
            url: new URL(res.headers.location, url).toString(),
            redirects: redirects - 1,
          }).then(resolve, reject);
          return;
        }
        if (status < 200 || status >= 300) {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () =>
            resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }),
          );
          return;
        }
        const fd = fs.openSync(opts.filePath, "w");
        res.on("data", (chunk) => fs.writeSync(fd, chunk));
        res.on("end", () => {
          fs.closeSync(fd);
          resolve({ status, headers: res.headers, body: Buffer.alloc(0) });
        });
        res.on("error", (err) => {
          fs.closeSync(fd);
          reject(err);
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("http get timeout")));
    req.on("error", reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Object stores
//
// A directory contract, not an S3 contract: the platform hands the whole
// `store` object in the op argv and the module dispatches on `store.kind`.
// There is deliberately no SigV4/raw-credential driver here — the creds
// contract is that the box never holds an object-store secret.
// ---------------------------------------------------------------------------

function joinKey(prefix, key) {
  return `${prefix ?? ""}${key}`;
}

/** Plain unauthenticated HTTP object store — local stubs, public buckets. */
function httpStore(cfg) {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const url = (key) => `${base}/${joinKey(cfg.prefix, key)}`;
  return {
    async get(key, range) {
      const headers = { ...(cfg.headers ?? {}) };
      if (range) headers.Range = `bytes=${range.start}-${range.end}`;
      const res = await httpRequest({ method: "GET", url: url(key), headers });
      if (res.status === 404) throw new Error(`store: object not found: ${key}`);
      if (res.status < 200 || res.status >= 300) {
        throw new Error(
          `store: GET ${key} failed: ${res.status} ${res.body.toString("utf8").slice(0, 200)}`,
        );
      }
      return res.body;
    },
    async getFile(key, filePath) {
      const res = await httpGetFile({ url: url(key), filePath, headers: cfg.headers });
      if (res.status === 404) throw new Error(`store: object not found: ${key}`);
      if (res.status < 200 || res.status >= 300) {
        throw new Error(
          `store: GET ${key} failed: ${res.status} ${res.body.toString("utf8").slice(0, 200)}`,
        );
      }
    },
    async head(key) {
      const res = await httpRequest({ method: "HEAD", url: url(key), headers: cfg.headers });
      if (res.status === 404) return false;
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`store: HEAD ${key} failed: ${res.status}`);
      }
      return true;
    },
    async stat(key) {
      const res = await httpRequest({ method: "HEAD", url: url(key), headers: cfg.headers });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`store: HEAD ${key} failed: ${res.status}`);
      }
      const size = Number(res.headers["content-length"]);
      if (!Number.isFinite(size)) {
        throw new Error(`store: HEAD ${key} returned no content-length`);
      }
      return size;
    },
    async put(key, data) {
      const res = await httpRequest({
        method: "PUT",
        url: url(key),
        headers: { "content-length": String(data.length), ...(cfg.headers ?? {}) },
        body: data,
      });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`store: PUT ${key} failed: ${res.status}`);
      }
    },
    async putFile(key, filePath) {
      const res = await httpPutFile({ url: url(key), headers: cfg.headers, filePath });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`store: PUT ${key} failed: ${res.status}`);
      }
    },
    urlFor: url,
  };
}

/**
 * Platform-minted credentials without secrets on the box:
 *  - `post`: an S3 POST policy (url + form fields) — uploads land via
 *    multipart POST with `key` = minted prefix + object name.
 *  - `getBaseUrl`: a read base (public bucket URL or CDN) for GET/HEAD.
 *  - `putUrls`: per-object presigned PUTs (the OCI manifest — its key is
 *    known ahead of capture, so the platform can presign it exactly).
 *  - `getUrls`: per-object presigned GETs — the read counterpart to
 *    `putUrls`, for buckets without a public read base. SigV4 presigns are
 *    method-bound, so `head`/`stat` probe a `bytes=0-0` GET instead of HEAD.
 */
function presignedStore(cfg) {
  const readBase = cfg.getBaseUrl
    ? httpStore({ baseUrl: cfg.getBaseUrl, prefix: cfg.prefix })
    : null;
  const post = cfg.post;
  // `getUrlsUrl` carries the full URL set when it outgrew the op's argv:
  // one presigned GET on a platform-written doc `{getUrls: {key: url}}`.
  // Fetched lazily once, so capture-only ops never touch it.
  let docUrls;
  const loadGetUrls = async () => {
    if (docUrls === undefined) {
      docUrls = {};
      if (cfg.getUrlsUrl) {
        const res = await httpRequest({ method: "GET", url: cfg.getUrlsUrl });
        if (res.status !== 200) {
          throw new Error(
            `grant doc fetch failed: ${res.status} ${res.body.toString("utf8").slice(0, 200)}`,
          );
        }
        const doc = JSON.parse(res.body.toString("utf8"));
        docUrls = doc.getUrls ?? {};
      }
    }
  };
  const getUrl = (key) =>
    cfg.getUrls?.[joinKey(cfg.prefix, key)] ??
    cfg.getUrls?.[key] ??
    docUrls?.[joinKey(cfg.prefix, key)] ??
    docUrls?.[key];
  /** `bytes=0-0` probe: exists + total size, without needing a signed HEAD. */
  const probe = async (key) => {
    const res = await httpRequest({
      method: "GET",
      url: getUrl(key),
      headers: { Range: "bytes=0-0" },
    });
    if (res.status === 404) return { exists: false, size: 0 };
    if (res.status !== 200 && res.status !== 206) {
      throw new Error(
        `presigned GET ${key} failed: ${res.status} ${res.body.toString("utf8").slice(0, 200)}`,
      );
    }
    const range = res.headers["content-range"];
    const total =
      (typeof range === "string" && range.match(/\/(\d+)\s*$/)?.[1]) ??
      res.headers["content-length"];
    const size = Number(total);
    if (!Number.isFinite(size)) {
      throw new Error(`presigned GET ${key} returned no object size`);
    }
    return { exists: true, size };
  };
  return {
    async get(key, range) {
      await loadGetUrls();
      const url = getUrl(key);
      if (url) {
        const headers = {};
        if (range) headers.Range = `bytes=${range.start}-${range.end}`;
        const res = await httpRequest({ method: "GET", url, headers });
        if (res.status === 404) throw new Error(`store: object not found: ${key}`);
        if (res.status !== 200 && res.status !== 206) {
          throw new Error(
            `presigned GET ${key} failed: ${res.status} ${res.body.toString("utf8").slice(0, 200)}`,
          );
        }
        return res.body;
      }
      if (!readBase) {
        throw new Error("presigned store: no getBaseUrl or getUrls for reads");
      }
      return readBase.get(key, range);
    },
    async getFile(key, filePath) {
      await loadGetUrls();
      const url = getUrl(key);
      if (url) {
        const res = await httpGetFile({ url, filePath });
        if (res.status === 404) throw new Error(`store: object not found: ${key}`);
        if (res.status < 200 || res.status >= 300) {
          throw new Error(
            `presigned GET ${key} failed: ${res.status} ${res.body.toString("utf8").slice(0, 200)}`,
          );
        }
        return;
      }
      if (!readBase) {
        throw new Error("presigned store: no getBaseUrl or getUrls for reads");
      }
      return readBase.getFile(key, filePath);
    },
    async head(key) {
      await loadGetUrls();
      if (getUrl(key)) return (await probe(key)).exists;
      if (!readBase) return false;
      return readBase.head(key);
    },
    async stat(key) {
      await loadGetUrls();
      if (getUrl(key)) return (await probe(key)).size;
      if (!readBase) {
        throw new Error("presigned store: no getBaseUrl or getUrls for reads");
      }
      return readBase.stat(key);
    },
    async put(key, data) {
      const presigned =
        cfg.putUrls?.[joinKey(cfg.prefix, key)] ?? cfg.putUrls?.[key];
      if (presigned) {
        const res = await httpRequest({
          method: "PUT",
          url: presigned,
          headers: { "content-length": String(data.length) },
          body: data,
        });
        if (res.status < 200 || res.status >= 300) {
          throw new Error(
            `presigned PUT ${key} failed: ${res.status} ${res.body.toString("utf8").slice(0, 200)}`,
          );
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
      const parts = [];
      for (const [k, v] of Object.entries(formFields)) {
        parts.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
            "utf8",
          ),
        );
      }
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${objectKey}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
          "utf8",
        ),
      );
      parts.push(data);
      parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"));
      const body = Buffer.concat(parts);
      const res = await httpRequest({
        method: "POST",
        url: post.url,
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": String(body.length),
        },
        body,
      });
      if (res.status < 200 || res.status >= 400) {
        throw new Error(
          `presigned POST ${key} failed: ${res.status} ${res.body.toString("utf8").slice(0, 200)}`,
        );
      }
    },
    async putFile(key, filePath) {
      // Stream when the platform minted an exact PUT URL for this key.
      const presigned =
        cfg.putUrls?.[joinKey(cfg.prefix, key)] ?? cfg.putUrls?.[key];
      if (presigned) {
        const res = await httpPutFile({ url: presigned, filePath });
        if (res.status < 200 || res.status >= 300) {
          throw new Error(
            `presigned PUT ${key} failed: ${res.status} ${res.body.toString("utf8").slice(0, 200)}`,
          );
        }
        return;
      }
      // Layers go through the blob POST policy — the multipart body streams
      // (fields, then the file, then the closing boundary) so a multi-GB
      // layer never buffers whole.
      if (!post) throw new Error(`presigned store: no upload path for ${key}`);
      await postMultipartFile(post, joinKey(cfg.prefix, key), filePath);
    },
    urlFor: readBase?.urlFor,
  };
}

/**
 * One S3 POST-policy upload of a file: multipart body streamed to the
 * request (form fields, file body, closing boundary), so blob uploads stay
 * O(1) memory. `objectKey` is the full prefixed key the policy's
 * starts-with condition covers.
 */
function postMultipartFile(post, objectKey, filePath) {
  const formFields = { ...post.fields };
  formFields.key = formFields.key?.includes("${filename}")
    ? formFields.key.replaceAll("${filename}", objectKey)
    : objectKey;
  const boundary = `----daemond${crypto.randomBytes(12).toString("hex")}`;
  const headParts = [];
  for (const [k, v] of Object.entries(formFields)) {
    headParts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
        "utf8",
      ),
    );
  }
  headParts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${objectKey}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      "utf8",
    ),
  );
  const head = Buffer.concat(headParts);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const size = fs.statSync(filePath).size;
  return new Promise((resolve, reject) => {
    const url = new URL(post.url);
    const lib = url.protocol === "http:" ? http : https;
    const req = lib.request(
      url,
      {
        method: "POST",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": String(head.length + size + tail.length),
        },
        timeout: 300000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          const body = Buffer.concat(chunks);
          if (status < 200 || status >= 400) {
            reject(
              new Error(
                `presigned POST ${objectKey} failed: ${status} ${body.toString("utf8").slice(0, 200)}`,
              ),
            );
            return;
          }
          resolve({ status, headers: res.headers, body });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("http post timeout")));
    req.on("error", reject);
    req.write(head);
    const fileStream = fs.createReadStream(filePath);
    fileStream.on("error", reject);
    fileStream.on("end", () => {
      req.write(tail);
      req.end();
    });
    fileStream.pipe(req, { end: false });
  });
}

/**
 * A real directory as the object store: `{root}` is a mounted path (an
 * attached volume, a shared filesystem, or local dev scratch) and keys are
 * plain files under it. Range GETs read only the requested span.
 */
function fsStore(cfg) {
  const keyPath = (key) => path.join(cfg.root, joinKey(cfg.prefix, key));
  return {
    async get(key, range) {
      const filePath = keyPath(key);
      if (!range) {
        try {
          return fs.readFileSync(filePath);
        } catch {
          throw new Error(`store: object not found: ${key}`);
        }
      }
      let fd;
      try {
        fd = fs.openSync(filePath, "r");
      } catch {
        throw new Error(`store: object not found: ${key}`);
      }
      try {
        const buf = Buffer.alloc(range.end - range.start + 1);
        const read = fs.readSync(fd, buf, 0, buf.length, range.start);
        return buf.subarray(0, read);
      } finally {
        fs.closeSync(fd);
      }
    },
    async getFile(key, filePath) {
      try {
        fs.copyFileSync(keyPath(key), filePath);
      } catch {
        throw new Error(`store: object not found: ${key}`);
      }
    },
    async head(key) {
      return fs.existsSync(keyPath(key));
    },
    async stat(key) {
      return fs.statSync(keyPath(key)).size;
    },
    async put(key, data) {
      const filePath = keyPath(key);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, data);
    },
    async putFile(key, filePath) {
      const target = keyPath(key);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(filePath, target);
    },
    urlFor: (key) => `file://${keyPath(key)}`,
  };
}

function makeStore(cfg) {
  const store = cfg ?? {};
  if (store.kind === "fs" || typeof store.root === "string") {
    return fsStore(store);
  }
  if (store.kind === "http" || typeof store.baseUrl === "string") {
    return httpStore(store);
  }
  if (
    store.kind === "presigned" ||
    store.post ||
    store.putUrls ||
    store.getUrls ||
    store.getBaseUrl
  ) {
    return presignedStore(store);
  }
  throw new Error(
    "checkpoint: store config required (fs root | http baseUrl | presigned post/getBaseUrl/getUrls)",
  );
}

// ---------------------------------------------------------------------------
// OCI assembly
// ---------------------------------------------------------------------------

const BLOBS_PREFIX = "blobs/";
const MANIFESTS_PREFIX = "manifests/";
const MANIFEST_MEDIA_TYPE = "application/vnd.oci.image.manifest.v1+json";
const LAYER_MEDIA_TYPE = "application/vnd.oci.image.layer.v1.tar+gzip";
const CONFIG_MEDIA_TYPE = "application/vnd.computesdk.checkpoint.config.v1+json";

/**
 * Writes one capture root's subtree as a deterministic tar.gz layer.
 * Streams through tmp files only — the plain-tar stream and the gzipped
 * blob are both hashed inline, so one pass yields the blob descriptor and
 * the uncompressed `diff_id` the OCI config carries.
 */
async function writeLayer(input) {
  const tarPath = path.join(
    os.tmpdir(),
    `checkpoint-layer-${input.index}-${process.pid}.tar`,
  );
  const gzPath = `${tarPath}.gz`;
  const tarHash = crypto.createHash("sha256");
  const tarFd = fs.openSync(tarPath, "w");
  try {
    const sink = {
      write(buf) {
        tarHash.update(buf);
        fs.writeSync(tarFd, buf);
      },
    };
    const reporter = new ProgressReporter("capture", `tar:${input.root}`, input.entries.length);
    await writeTar(sink, input.entries, reporter);
  } finally {
    fs.closeSync(tarFd);
  }
  const gzHash = crypto.createHash("sha256");
  let gzBytes = 0;
  const gzFd = fs.openSync(gzPath, "w");
  try {
    const gunzip = zlib.createGzip({ level: 6 });
    gunzip.on("data", (chunk) => {
      gzHash.update(chunk);
      gzBytes += chunk.length;
      fs.writeSync(gzFd, chunk);
    });
    const done = new Promise((resolve, reject) => {
      gunzip.on("end", resolve);
      gunzip.on("error", reject);
      fs.createReadStream(tarPath).on("error", reject).pipe(gunzip);
    });
    await done;
  } finally {
    fs.closeSync(gzFd);
  }
  fs.rmSync(tarPath, { force: true });
  return {
    filePath: gzPath,
    sha256: gzHash.digest("hex"),
    size: gzBytes,
    diffId: `sha256:${tarHash.digest("hex")}`,
  };
}

/** Tar path for an absolute fs path: root-relative, no leading slash. */
function tarName(abs) {
  return abs.replace(/^\/+/, "");
}

/** Index entry → tar entry. `filePath` set only for regular files. */
function tarEntryFor(abs, entry) {
  const base = {
    name: tarName(abs),
    mode: entry.mode ?? 0o644,
    mtime: Math.floor((entry.mtime ?? 0) / 1000),
  };
  if (entry.type === "dir") {
    return { ...base, typeflag: "5", size: 0 };
  }
  if (entry.type === "symlink") {
    return { ...base, typeflag: "2", size: 0, link: entry.link ?? "", linkname: entry.link ?? "" };
  }
  return {
    ...base,
    typeflag: "0",
    size: entry.size ?? 0,
    filePath: abs,
  };
}

/**
 * Builds the OCI image-config JSON — standard fields (architecture, os,
 * rootfs.diff_ids) plus a `computesdk` extension carrying the file index,
 * capture scope, and stats. The index is what lets restore select layers
 * and verify files without reading them.
 */
function buildConfigBlob(config, diffIds) {
  const body = {
    architecture: config.arch,
    os: config.platform,
    created: config.createdAt,
    rootfs: { type: "layers", diff_ids: diffIds },
    computesdk: config,
  };
  return Buffer.from(JSON.stringify(body, null, 2), "utf8");
}

function buildManifestBlob(input) {
  const body = {
    schemaVersion: 2,
    mediaType: MANIFEST_MEDIA_TYPE,
    config: {
      mediaType: CONFIG_MEDIA_TYPE,
      digest: `sha256:${input.config.sha256}`,
      size: input.config.size,
    },
    layers: input.layers.map((layer) => ({
      mediaType: LAYER_MEDIA_TYPE,
      digest: `sha256:${layer.sha256}`,
      size: layer.size,
      annotations: {
        "org.opencontainers.image.title": layer.root,
        "com.computesdk.checkpoint.root": layer.root,
      },
    })),
    annotations: {
      "org.opencontainers.image.title": `computesdk checkpoint ${input.checkpointId}`,
      "org.opencontainers.image.created": input.config.createdAt,
      "com.computesdk.checkpoint.id": input.checkpointId,
      ...(input.config.sourceSandboxId
        ? { "com.computesdk.checkpoint.sourceSandboxId": input.config.sourceSandboxId }
        : {}),
      ...(input.config.sourceProvider
        ? { "com.computesdk.checkpoint.sourceProvider": input.config.sourceProvider }
        : {}),
    },
  };
  return Buffer.from(JSON.stringify(body, null, 2), "utf8");
}

/** Any digest format ("sha256:hex" or bare "hex") → the blob key tail. */
function digestHex(digest) {
  return String(digest).startsWith("sha256:") ? String(digest).slice(7) : String(digest);
}

/** Manifest from an inline object, a URL, or a local file path. */
async function loadManifestRef(ref) {
  if (ref?.manifest) return ref.manifest;
  if (ref?.manifestUrl) {
    const res = await httpRequest({ method: "GET", url: ref.manifestUrl });
    if (res.status >= 200 && res.status < 300) {
      return JSON.parse(res.body.toString("utf8"));
    }
    return null;
  }
  if (ref?.manifestPath) {
    return JSON.parse(fs.readFileSync(ref.manifestPath, "utf8"));
  }
  return null;
}

/** Config (file index) from inline, a blob via the store, a URL, or a file. */
async function loadConfigRef(ref, store) {
  if (ref?.config) return ref.config;
  if (ref?.configPath) {
    return JSON.parse(fs.readFileSync(ref.configPath, "utf8"));
  }
  if (ref?.configUrl) {
    const res = await httpRequest({ method: "GET", url: ref.configUrl });
    if (res.status >= 200 && res.status < 300) {
      return JSON.parse(res.body.toString("utf8"));
    }
    return null;
  }
  if (ref?.configDigest && store) {
    const hex = digestHex(ref.configDigest);
    return JSON.parse((await store.get(`${BLOBS_PREFIX}${hex}`)).toString("utf8"));
  }
  return null;
}

/**
 * The checkpoint's config for a manifest: fetch the manifest's config
 * descriptor's blob through the store. Returns {manifest, config}.
 */
async function resolveConfig(store, manifest) {
  const digest = manifest?.config?.digest;
  if (!digest) throw new Error("checkpoint: manifest has no config descriptor");
  const config = JSON.parse(
    (await store.get(`${BLOBS_PREFIX}${digestHex(digest)}`)).toString("utf8"),
  );
  // Older callers may find the index nested under `computesdk`; flat accepts.
  return config.computesdk?.kind === "sandbox-checkpoint" ? config.computesdk : config;
}

function parsePayload(argv) {
  const op = argv[2];
  if (!op) throw new Error("checkpoint: op required (scan|capture|restore|diff)");
  let raw = argv[3] ?? "{}";
  if (raw.startsWith("b64:")) {
    raw = Buffer.from(raw.slice(4), "base64").toString("utf8");
  }
  const args = JSON.parse(raw);
  return { op, args };
}

// ---------------------------------------------------------------------------
// Ops
// ---------------------------------------------------------------------------

async function opScan(args) {
  const { config, missing } = await buildIndex({
    checkpointId: args.checkpointId,
    paths: args.paths ?? [],
    exclude: args.exclude,
    meta: args.meta,
    allowedRoots: args.allowedRoots,
    hashConcurrency: args.concurrency,
  });
  emitOpResult(args, { op: "scan", config, missing });
}

async function opCapture(args) {
  const started = Date.now();
  const store = makeStore(args.store);
  const checkpointId = args.checkpointId;
  const { config, missing } = await buildIndex({
    checkpointId,
    paths: args.paths ?? [],
    exclude: args.exclude,
    meta: args.meta,
    allowedRoots: args.allowedRoots,
    hashConcurrency: args.concurrency,
  });

  // One layer per capture root: group the index entries by their assigned
  // root and tar them in deterministic path order.
  const roots = config.capture.paths;
  const layerEntries = roots.map(() => []);
  for (const [abs, entry] of Object.entries(config.files)) {
    if (entry.layer >= 0) layerEntries[entry.layer].push(tarEntryFor(abs, entry));
  }
  for (const entries of layerEntries) {
    entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Dedup set: blobs the caller already knows (a parent checkpoint's
  // manifest, inline or via URL) plus optional store-side HEAD probes.
  const dedup = args.dedup ?? {};
  const known = new Set(dedup.knownBlobs ?? []);
  const parentManifest = await loadManifestRef(dedup.parentManifest);
  if (parentManifest) {
    for (const layer of parentManifest.layers ?? []) {
      if (layer.digest) known.add(digestHex(layer.digest));
    }
    if (parentManifest.config?.digest) {
      known.add(digestHex(parentManifest.config.digest));
    }
  }

  // Write every non-empty layer, then upload only the blobs dedup missed.
  // Content identity is what dedup keys on: an unchanged subtree tars
  // byte-identically, so its sha256 reuses the parent's blob.
  const layers = [];
  const layerFiles = [];
  let candidates = [];
  let uploadedLayerBytes = 0;
  try {
    for (let i = 0; i < roots.length; i += 1) {
      const entries = layerEntries[i];
      if (entries.length === 0) continue;
      const layer = await writeLayer({ index: i, root: roots[i], entries });
      layers.push({ root: roots[i], ...layer, index: i });
      layerFiles.push(layer.filePath);
      if (!known.has(layer.sha256)) candidates.push(layer);
    }

    if (dedup.checkHead !== false && candidates.length > 0) {
      const headReporter = new ProgressReporter("capture", "dedup-head", candidates.length);
      let headDone = 0;
      const stillNeeded = await mapLimit(candidates, 16, async (layer) => {
        const exists = await store.head(`${BLOBS_PREFIX}${layer.sha256}`);
        headDone += 1;
        headReporter.tick(headDone);
        return exists ? null : layer;
      });
      candidates = stillNeeded.filter((l) => l !== null);
    }

    const uploadReporter = new ProgressReporter("capture", "upload-layers", candidates.length);
    let uploaded = 0;
    let uploadedBytes = 0;
    await mapLimit(candidates, args.uploadConcurrency ?? 4, async (layer) => {
      await store.putFile(`${BLOBS_PREFIX}${layer.sha256}`, layer.filePath);
      uploaded += 1;
      uploadedBytes += layer.size;
      uploadReporter.tick(uploaded, uploadedBytes);
    });
    uploadedLayerBytes = uploadedBytes;
  } finally {
    for (const filePath of layerFiles) fs.rmSync(filePath, { force: true });
  }

  // The config blob (file index + capture metadata) is itself a CAS object,
  // uploaded under the same POST policy before the manifest commits.
  const diffIds = layers.map((layer) => layer.diffId);
  const configBlob = buildConfigBlob(config, diffIds);
  const configSha = sha256Buffer(configBlob);
  const configNeeded =
    !known.has(configSha) &&
    (dedup.checkHead === false ||
      !(await store.head(`${BLOBS_PREFIX}${configSha}`)));
  if (configNeeded) {
    await store.put(`${BLOBS_PREFIX}${configSha}`, configBlob);
  }

  const manifestBlob = buildManifestBlob({
    checkpointId: config.checkpointId,
    config: { sha256: configSha, size: configBlob.length },
    layers,
  });
  const manifestKey = `${MANIFESTS_PREFIX}${config.checkpointId}.json`;
  // The manifest PUT is the commit point: blobs landed already, so a reader
  // that finds the manifest can resolve everything it names.
  const manifestPutUrl = args.manifestPutUrl;
  if (manifestPutUrl) {
    const res = await httpRequest({
      method: "PUT",
      url: manifestPutUrl,
      headers: {
        "content-length": String(manifestBlob.length),
        "content-type": MANIFEST_MEDIA_TYPE,
      },
      body: manifestBlob,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(
        `presigned PUT ${manifestKey} failed: ${res.status} ${res.body.toString("utf8").slice(0, 200)}`,
      );
    }
  } else {
    await store.put(manifestKey, manifestBlob);
  }

  emitOpResult(args, {
    op: "capture",
    checkpointId: config.checkpointId,
    manifestKey,
    manifestDigest: `sha256:${sha256Buffer(manifestBlob)}`,
    configDigest: `sha256:${configSha}`,
    layers: layers.map((layer) => ({
      root: layer.root,
      digest: `sha256:${layer.sha256}`,
      diffId: layer.diffId,
      size: layer.size,
    })),
    stats: config.stats,
    arch: config.arch,
    platform: config.platform,
    blobsTotal: layers.length + 1,
    blobsNew: candidates.length + (configNeeded ? 1 : 0),
    blobsDeduped: layers.length + 1 - candidates.length - (configNeeded ? 1 : 0),
    bytesNew: uploadedLayerBytes + (configNeeded ? configBlob.length : 0),
    missing,
    ms: Date.now() - started,
  });
}

async function opRestore(args) {
  const started = Date.now();
  const store = args.store ? makeStore(args.store) : null;
  const checkpointId = String(args.checkpointId ?? "");

  // The manifest object is small — a whole GET, presigned or through the
  // store. Layers follow by descriptor digest.
  const manifestUrl = args.manifestUrl ?? args.checkpointUrl;
  let manifest;
  if (manifestUrl) {
    const res = await httpRequest({ method: "GET", url: manifestUrl });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(
        `restore: GET manifest failed: ${res.status} ${res.body.toString("utf8").slice(0, 200)}`,
      );
    }
    manifest = JSON.parse(res.body.toString("utf8"));
  } else if (store) {
    manifest = JSON.parse(
      (await store.get(`${MANIFESTS_PREFIX}${checkpointId}.json`)).toString("utf8"),
    );
  } else {
    throw new Error("restore: manifestUrl or store required");
  }
  if (!store) throw new Error("restore: store required for layer blobs");

  const config = await resolveConfig(store, manifest);

  const strictArch = args.strictArch === true;
  const archMismatch =
    config.arch !== process.arch || config.platform !== process.platform;
  if (archMismatch && strictArch) {
    throw new Error(
      `restore: arch mismatch — checkpoint is ${config.platform}/${config.arch}, box is ${process.platform}/${process.arch}`,
    );
  }

  const includeGlobs = compileGlobs(args.include);
  const excludeGlobs = compileGlobs(args.exclude);
  const destDir = args.destDir;
  // Writing manifest paths verbatim is an explicit opt-in: a crafted index
  // carries attacker-chosen absolute paths, so identity restore must be
  // asked for — otherwise every write is confined under destDir.
  if (!destDir && args.writeAbsolute !== true) {
    throw new Error(
      "restore: destDir is required, or pass writeAbsolute: true to write manifest paths verbatim",
    );
  }
  // destDir replaces the capture root: with one capture path it is stripped
  // outright; with several, their common directory prefix is stripped so the
  // roots' distinguishing tails survive under destDir. Absolute paths still
  // identify files in the index — destDir only changes where they land.
  const capturePaths = (config.capture?.paths ?? []).filter(
    (p) => typeof p === "string",
  );
  const rootPrefix =
    capturePaths.length === 0
      ? "/"
      : capturePaths.length === 1
        ? capturePaths[0]
        : (() => {
            let prefix = capturePaths[0];
            for (const p of capturePaths.slice(1)) {
              while (!p.startsWith(prefix + "/") && prefix !== "/") {
                prefix = path.dirname(prefix);
              }
              if (!p.startsWith(prefix)) prefix = "/";
            }
            return prefix;
          })();
  const mapPath = (abs) => {
    if (!destDir) {
      const norm = path.normalize(abs);
      if (!path.isAbsolute(norm)) {
        throw new Error(`restore: non-absolute manifest path ${abs}`);
      }
      return norm;
    }
    const rel =
      abs === rootPrefix
        ? ""
        : abs.startsWith(rootPrefix + "/")
          ? abs.slice(rootPrefix.length + 1)
          : abs.replace(/^\/+/, "");
    if (rel === "") return destDir;
    const norm = path.normalize(rel);
    if (norm === ".." || norm.startsWith(`..${path.sep}`) || path.isAbsolute(norm)) {
      throw new Error(`restore: manifest path escapes destDir: ${abs}`);
    }
    return path.join(destDir, norm);
  };

  // Symlink confinement: resolve destDir once, then before every write verify
  // the real path still lands under it — covers pre-existing symlinks in the
  // tree and links a crafted index had us create earlier in this restore.
  let resolvedRoot = null;
  if (destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    resolvedRoot = fs.realpathSync(destDir);
  }
  const assertInsideRoot = (resolved, what) => {
    if (resolvedRoot && !isUnderRoot(resolvedRoot, resolved)) {
      throw new Error(`restore: ${what} escapes destDir via symlink (${resolved})`);
    }
  };
  const prepareParent = (dest) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (resolvedRoot) assertInsideRoot(fs.realpathSync(path.dirname(dest)), dest);
  };

  const allEntries = Object.entries(config.files ?? {});
  const selected = new Map();
  const dirModes = [];
  const wantedLayers = new Set();
  for (const [abs, entry] of allEntries) {
    const isDir = entry.type === "dir";
    if (includeGlobs.length > 0 && !includeGlobs.some((g) => g.regex.test(abs))) {
      continue;
    }
    if (excludeGlobs.length > 0 && excludeGlobs.some((g) => g.regex.test(abs))) {
      continue;
    }
    // Directories always extract when any of their subtree is selected —
    // they carry no blob cost, only perms.
    if (!isDir && entry.layer >= 0) wantedLayers.add(entry.layer);
    if (isDir) {
      dirModes.push([abs, entry]);
      continue;
    }
    selected.set(abs, entry);
  }
  // A dir whose subtree was excluded entirely still lands — dirs are cheap
  // and removing them selectively is a later refinement. Track wanted
  // layers for files/symlinks only.

  const layerDescriptors = manifest.layers ?? [];
  const layerByIndex = new Map();
  // Layer indices in the index are positions in capture.paths order; the
  // manifest's layers[] skips empty roots, so rebuild the assignment by
  // matching the annotation's root back to its capture path.
  const rootToLayer = new Map();
  layerDescriptors.forEach((desc, i) => {
    const root = desc.annotations?.["com.computesdk.checkpoint.root"];
    if (root !== undefined) rootToLayer.set(root, i);
  });
  for (const pathIdx of wantedLayers) {
    const root = capturePaths[pathIdx];
    const descIdx = rootToLayer.get(root);
    if (descIdx !== undefined) layerByIndex.set(descIdx, layerDescriptors[descIdx]);
  }

  const failures = [];
  const reporter = new ProgressReporter("restore", "layers", layerByIndex.size);
  let layersPulled = 0;
  let layersSkipped = layerDescriptors.length - layerByIndex.size;
  let filesWritten = 0;
  let fetchedBytes = 0;
  const deferredDirs = [];

  for (const [descIdx, desc] of [...layerByIndex.entries()].sort((a, b) => a[0] - b[0])) {
    const hex = digestHex(desc.digest);
    const tmp = path.join(
      os.tmpdir(),
      `checkpoint-layer-${process.pid}-${descIdx}.tar.gz`,
    );
    try {
      if (store.getFile) {
        await store.getFile(`${BLOBS_PREFIX}${hex}`, tmp);
      } else {
        fs.writeFileSync(tmp, await store.get(`${BLOBS_PREFIX}${hex}`));
      }
      const actual = await sha256File(tmp);
      if (actual !== hex) {
        throw new Error(`sha256 mismatch on layer ${hex}: got ${actual}`);
      }
      const tarTmp = `${tmp}.tar`;
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(tarTmp);
        fs.createReadStream(tmp)
          .on("error", reject)
          .pipe(zlib.createGunzip())
          .on("error", reject)
          .pipe(out)
          .on("error", reject)
          .on("finish", resolve);
      });
      const captureRoot = desc.annotations?.["com.computesdk.checkpoint.root"];
      const rootIdx = capturePaths.indexOf(captureRoot);
      await readTar(tarTmp, async (entry, body) => {
        const abs = `/${entry.name}`;
        const indexEntry = config.files?.[abs];
        const wanted =
          indexEntry && indexEntry.layer === rootIdx && selected.has(abs);
        const dirWanted =
          entry.typeflag === "5" && indexEntry && indexEntry.layer === rootIdx;
        if (!wanted && !dirWanted) {
          await body.skip();
          return;
        }
        try {
          const dest = mapPath(abs);
          if (entry.typeflag === "5") {
            fs.mkdirSync(dest, { recursive: true });
            if (resolvedRoot) assertInsideRoot(fs.realpathSync(dest), dest);
            deferredDirs.push([dest, indexEntry]);
            await body.skip();
            return;
          }
          if (entry.typeflag === "2") {
            prepareParent(dest);
            try {
              if (fs.lstatSync(dest).isSymbolicLink()) fs.rmSync(dest, { force: true });
            } catch {}
            fs.symlinkSync(entry.linkname ?? indexEntry.link ?? "", dest);
            await body.skip();
            filesWritten += 1;
            return;
          }
          // Regular file: stream to dest while hashing — verification is
          // against the index sha, not the layer digest (already checked).
          prepareParent(dest);
          try {
            if (fs.lstatSync(dest).isSymbolicLink()) fs.rmSync(dest, { force: true });
          } catch {}
          const sha = await body.extract(dest);
          if (indexEntry.sha && sha !== indexEntry.sha) {
            fs.rmSync(dest, { force: true });
            throw new Error(`sha256 mismatch: ${abs}`);
          }
          try {
            fs.chmodSync(dest, (indexEntry.mode ?? entry.mode) & 0o7777);
          } catch {}
          try {
            const mtime = new Date(indexEntry.mtime ?? entry.mtime * 1000);
            fs.utimesSync(dest, new Date(), mtime);
          } catch {}
          fetchedBytes += entry.size;
          filesWritten += 1;
        } catch (err) {
          failures.push({
            path: abs,
            error: err instanceof Error ? err.message : String(err),
          });
          await body.skip().catch(() => {});
        }
      });
      fs.rmSync(tarTmp, { force: true });
      layersPulled += 1;
      reporter.tick(layersPulled);
    } catch (err) {
      failures.push({
        key: `${BLOBS_PREFIX}${hex}`,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  // chmod dirs deepest-first: a read-only parent mode would otherwise block
  // its own empty children from being created.
  for (const [dest, entry] of deferredDirs.sort((a, b) => b[0].length - a[0].length)) {
    try {
      fs.chmodSync(dest, (entry.mode ?? 0o755) & 0o7777);
    } catch {}
  }

  emitOpResult(args, {
    op: "restore",
    checkpointId: config.checkpointId,
    files: filesWritten,
    bytes: fetchedBytes,
    layersPulled,
    layersSkipped,
    failures,
    archMismatch,
    cwd: config.cwd,
    env: config.env,
    ms: Date.now() - started,
  });
  // A partial restore is a failed restore — exit non-zero so job control and
  // callers gating on exit status see it (failures[] carries the detail).
  if (failures.length > 0) process.exitCode = 1;
}

async function opDiff(args) {
  const store = args.store ? makeStore(args.store) : null;
  const load = async (ref) => {
    const config = await loadConfigRef(ref, store);
    if (config) return config;
    const manifest = await loadManifestRef(ref);
    if (manifest) return resolveConfig(store, manifest);
    return null;
  };
  const a = await load(args.a);
  const b = await load(args.b);
  if (!a || !b) {
    throw new Error(
      "diff: each side needs config/configUrl/configPath or manifest/manifestUrl/manifestPath",
    );
  }
  emitOpResult(args, { op: "diff", diff: diffIndexes(a, b) });
}

async function main() {
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
// so match by require.main identity, not by filename.
const invokedDirectly =
  typeof require === "function" &&
  typeof module === "object" &&
  require.main === module;
if (invokedDirectly) {
  main().catch(emitError);
}
