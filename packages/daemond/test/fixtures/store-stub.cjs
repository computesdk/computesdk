#!/usr/bin/env node
/**
 * store-stub — an S3-shaped, range-capable object store over plain HTTP.
 * Pure Node stdlib; used by checkpoint unit/integration tests and by the e2e
 * harness (it runs inside the sandbox too, so the checkpoint module can talk
 * to it at 127.0.0.1).
 *
 *   PUT   /<key>            store body
 *   GET   /<key>            fetch (Range: bytes=a-b honored, 206 + Content-Range)
 *   HEAD  /<key>            200/404 + Content-Length
 *   GET   /__objects        JSON map of key -> size (debug/introspection)
 *   GET   /__requests       JSON array of {method, key, range} since start
 *
 * Env: PORT (default 8080), STORE_DIR (persist objects to disk when set).
 */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const port = Number(process.env.PORT || 8080);
const storeDir = process.env.STORE_DIR || null;
const objects = new Map(); // key -> Buffer (in-memory when no STORE_DIR)
const requests = [];

function readObject(key) {
  if (storeDir) {
    const file = path.join(storeDir, key);
    if (!file.startsWith(path.resolve(storeDir)) || !fs.existsSync(file)) return null;
    return fs.readFileSync(file);
  }
  return objects.get(key) ?? null;
}

function writeObject(key, data) {
  if (storeDir) {
    const file = path.join(storeDir, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
    return;
  }
  objects.set(key, data);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const key = decodeURIComponent(url.pathname).replace(/^\/+/, "");

  if (key === "__objects") {
    const listing = {};
    for (const [k, v] of objects) listing[k] = v.length;
    if (storeDir && fs.existsSync(storeDir)) {
      const walk = (dir, prefix) => {
        for (const name of fs.readdirSync(dir)) {
          const p = path.join(dir, name);
          if (fs.statSync(p).isDirectory()) walk(p, `${prefix}${name}/`);
          else listing[`${prefix}${name}`] = fs.statSync(p).size;
        }
      };
      walk(storeDir, "");
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(listing));
    return;
  }
  if (key === "__requests") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(requests));
    return;
  }
  if (!key) {
    res.writeHead(404);
    res.end();
    return;
  }

  const rangeHeader = req.headers.range || null;
  requests.push({ method: req.method, key, range: rangeHeader });

  if (req.method === "PUT") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      writeObject(key, Buffer.concat(chunks));
      res.writeHead(200, { "content-length": 0 });
      res.end();
    });
    req.on("error", () => {
      res.writeHead(500);
      res.end();
    });
    return;
  }

  if (req.method === "HEAD" || req.method === "GET") {
    const data = readObject(key);
    if (!data) {
      res.writeHead(404, { "content-length": 0 });
      res.end();
      return;
    }
    if (req.method === "HEAD") {
      res.writeHead(200, { "content-length": data.length, "accept-ranges": "bytes" });
      res.end();
      return;
    }
    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
      if (match) {
        let start = match[1] === "" ? Math.max(0, data.length - Number(match[2])) : Number(match[1]);
        let end = match[2] === "" ? data.length - 1 : Math.min(Number(match[2]), data.length - 1);
        if (match[1] !== "" && match[2] === "") end = data.length - 1;
        if (start > end || start >= data.length) {
          res.writeHead(416, { "content-range": `bytes */${data.length}` });
          res.end();
          return;
        }
        const slice = data.subarray(start, end + 1);
        res.writeHead(206, {
          "content-length": slice.length,
          "content-range": `bytes ${start}-${end}/${data.length}`,
          "accept-ranges": "bytes",
        });
        res.end(slice);
        return;
      }
    }
    res.writeHead(200, { "content-length": data.length, "accept-ranges": "bytes" });
    res.end(data);
    return;
  }

  res.writeHead(405);
  res.end();
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`${JSON.stringify({ type: "ready", port })}\n`);
});
