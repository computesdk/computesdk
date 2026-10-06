/**
 * ComputeSDK egress router — a self-contained forward proxy that runs inside
 * a sandbox (no dependencies, Node builtins only).
 *
 * For a configured set of credentialed hosts the shim terminates TLS using a
 * root CA it mints at startup, parses the decrypted HTTP request, and relays
 * it to an off-box credential injector which swaps placeholder values for
 * real secrets and performs the upstream fetch. Every other host is either
 * CONNECT-tunneled straight upstream (passthrough mode, the default) or
 * denied (allowlist mode). The shim only ever holds host rules, the injector
 * URL and a run/injector token — never a credential value.
 *
 * Usage: node egress-shim.js <config.json>
 *
 * Config file:
 * {
 *   "injectorUrl": "https://…/api/ci/cred-proxy",   // required
 *   "injectorToken": "…",                            // optional bearer for the injector
 *   "credentialedHosts": ["api.openai.com", "*.github.com"],
 *   "mode": "passthrough" | "allowlist",             // default passthrough
 *   "port": 0,                                       // 0 = ephemeral
 *   "dir": "/tmp/computesdk-egress",                 // CA + leaf cert workspace
 *   "requestTimeoutMs": 120000,
 *   "maxBodyBytes": 67108864
 * }
 *
 * Startup output is line-delimited JSON so the caller can wait on it:
 *   EGRESS_READY {"port":<n>,"caCertPath":"<abs path to the generated CA pem>"}
 *   EGRESS_ERROR {"message":"<why>"}                 — startup failed, exits non-zero
 *
 * Relay envelope (must match the platform injector):
 *   POST <injectorUrl>  Content-Type: application/json
 *   {"token":<injectorToken>,"request":{method,url,headers,bodyB64}}
 * Response envelope:
 *   {"status":<n>,"headers":{...},"bodyB64":"<base64>"}
 * which the shim writes back to the client verbatim.
 */

import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import * as tls from "node:tls";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFile, execFileSync } from "node:child_process";

export interface EgressShimConfig {
  injectorUrl: string;
  injectorToken?: string;
  credentialedHosts: string[];
  mode?: "passthrough" | "allowlist";
  port?: number;
  dir?: string;
  requestTimeoutMs?: number;
  maxBodyBytes?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BODY_BYTES = 64 * 1024 * 1024;
const MAX_HEAD_BYTES = 64 * 1024;
const MAX_HEADER_LINE_BYTES = 16 * 1024;
const CONNECT_UPSTREAM_TIMEOUT_MS = 30_000;
const SOCKET_IDLE_TIMEOUT_MS = 120_000;
const CA_SUBJECT = "/CN=ComputeSDK Egress Router CA";

const HEAD_END = Buffer.from("\r\n\r\n", "latin1");
const CRLF = Buffer.from("\r\n", "latin1");

/** Hop-by-hop + framing headers never forwarded to the injector. */
const SKIP_REQUEST_HEADERS = new Set([
  "connection",
  "proxy-connection",
  "keep-alive",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
  "content-length",
  "expect",
]);

/** Response headers rebuilt by the shim rather than copied verbatim. */
const SKIP_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
]);

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Host rules
// ---------------------------------------------------------------------------

/**
 * Exact hostname or "*.suffix" match. A wildcard rule matches the bare suffix
 * too, so "*.example.com" covers both "example.com" and "api.example.com".
 */
export function matchCredentialedHost(host: string, rules: string[]): boolean {
  // Tolerate a trailing :port (CONNECT authorities, Host headers). Bare IPv6
  // literals have multiple colons and are left alone.
  let h = host.toLowerCase().trim().replace(/\.$/, "");
  if (h.startsWith("[")) {
    h = h.replace(/^\[|\](:\d+)?$/g, "");
  } else if (h.indexOf(":") === h.lastIndexOf(":")) {
    h = h.replace(/:\d+$/, "");
  }
  if (!h) return false;
  for (const raw of rules) {
    const rule = raw.trim().toLowerCase();
    if (!rule) continue;
    if (rule.startsWith("*.")) {
      const suffix = rule.slice(2);
      if (h === suffix || h.endsWith("." + suffix)) return true;
    } else if (h === rule) {
      return true;
    }
  }
  return false;
}

export function splitAuthority(authority: string): { host: string; port: number | null } {
  const trimmed = authority.trim();
  const v6 = trimmed.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (v6) {
    return { host: v6[1], port: v6[2] ? Number(v6[2]) : null };
  }
  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon === -1) return { host: trimmed, port: null };
  const host = trimmed.slice(0, lastColon);
  const portRaw = trimmed.slice(lastColon + 1);
  if (!/^\d+$/.test(portRaw)) {
    // Unbracketed value with colons (e.g. bare IPv6) — treat the whole thing as host.
    return { host: trimmed, port: null };
  }
  return { host, port: Number(portRaw) };
}

function stripPort(authority: string): string {
  return splitAuthority(authority).host;
}

function validConnectHost(host: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(host) || /^[0-9a-fA-F:]+$/.test(host);
}

// ---------------------------------------------------------------------------
// Buffered socket reader
// ---------------------------------------------------------------------------

/**
 * Pull-based reader over a socket. Attaching 'data' puts the socket in
 * flowing mode and buffers everything; callers await exactly the bytes they
 * need. `unbind()` removes the reader so the socket can be piped elsewhere.
 */
class SocketReader {
  private buffered = Buffer.alloc(0);
  private waiters: Array<() => void> = [];
  private ended = false;
  private failed: Error | null = null;
  private readonly onData = (chunk: Buffer): void => {
    this.buffered = Buffer.concat([this.buffered, chunk]);
    this.flush();
  };
  private readonly onEnd = (): void => {
    this.ended = true;
    this.flush();
  };
  private readonly onError = (err: Error): void => {
    this.failed = err;
    this.ended = true;
    this.flush();
  };

  constructor(private readonly socket: net.Socket | tls.TLSSocket) {
    socket.on("data", this.onData);
    socket.on("end", this.onEnd);
    socket.on("error", this.onError);
    socket.on("close", this.onEnd);
  }

  unbind(): void {
    this.socket.removeListener("data", this.onData);
    this.socket.removeListener("end", this.onEnd);
    this.socket.removeListener("error", this.onError);
    this.socket.removeListener("close", this.onEnd);
  }

  private flush(): void {
    const waiters = this.waiters.splice(0);
    for (const wake of waiters) wake();
  }

  private wait(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /** Bytes already buffered (used to forward leftovers into a tunnel). */
  takeBuffered(): Buffer {
    const out = this.buffered;
    this.buffered = Buffer.alloc(0);
    return out;
  }

  /** Read until `marker` is consumed; returns bytes up to and including it, or null on EOF. */
  async readUntil(marker: Buffer, limit: number): Promise<Buffer | null> {
    for (;;) {
      const idx = this.buffered.indexOf(marker);
      if (idx >= 0) {
        const out = this.buffered.subarray(0, idx + marker.length);
        this.buffered = this.buffered.subarray(idx + marker.length);
        return out;
      }
      if (this.buffered.length > limit) {
        throw new HttpError(431, "request headers too large");
      }
      if (this.ended) {
        if (this.failed) throw this.failed;
        return null;
      }
      await this.wait();
    }
  }

  async readLine(limit = MAX_HEADER_LINE_BYTES): Promise<Buffer | null> {
    return this.readUntil(Buffer.from("\n", "latin1"), limit);
  }

  async readBytes(n: number): Promise<Buffer | null> {
    for (;;) {
      if (this.buffered.length >= n) {
        const out = this.buffered.subarray(0, n);
        this.buffered = this.buffered.subarray(n);
        return out;
      }
      if (this.ended) {
        if (this.failed) throw this.failed;
        return null;
      }
      await this.wait();
    }
  }

  /** Drain whatever is buffered, or wait for more; null at EOF. */
  async readChunk(): Promise<Buffer | null> {
    for (;;) {
      if (this.buffered.length) return this.takeBuffered();
      if (this.ended) {
        if (this.failed) throw this.failed;
        return null;
      }
      await this.wait();
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP/1.x request parsing
// ---------------------------------------------------------------------------

interface HttpRequestHead {
  method: string;
  target: string;
  version: string;
  headers: Array<[string, string]>;
}

function parseHead(raw: Buffer): HttpRequestHead {
  const text = raw.toString("latin1");
  const lines = text.split("\r\n");
  const requestLine = lines[0];
  const firstSpace = requestLine.indexOf(" ");
  const lastSpace = requestLine.lastIndexOf(" ");
  if (firstSpace <= 0 || lastSpace <= firstSpace) {
    throw new HttpError(400, "malformed request line");
  }
  const headers: Array<[string, string]> = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) throw new HttpError(400, "malformed header line");
    headers.push([line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]);
  }
  return {
    method: requestLine.slice(0, firstSpace).toUpperCase(),
    target: requestLine.slice(firstSpace + 1, lastSpace),
    version: requestLine.slice(lastSpace + 1),
    headers,
  };
}

function headerValues(headers: Array<[string, string]>, name: string): string[] {
  const values: string[] = [];
  for (const [k, v] of headers) {
    if (k === name) values.push(v);
  }
  return values;
}

function headerValue(headers: Array<[string, string]>, name: string): string | undefined {
  const values = headerValues(headers, name);
  return values.length ? values.join(", ") : undefined;
}

/** Collect a request body, dechunking when Transfer-Encoding is chunked. */
async function readRequestBody(
  reader: SocketReader,
  headers: Array<[string, string]>,
  maxBodyBytes: number
): Promise<Buffer> {
  const te = headerValue(headers, "transfer-encoding");
  if (te && /chunked/i.test(te)) {
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const sizeLine = await reader.readLine();
      if (sizeLine === null) throw new HttpError(400, "unexpected EOF in chunked body");
      const sizeText = sizeLine.toString("latin1").split(";")[0].trim();
      const size = parseInt(sizeText, 16);
      if (!Number.isFinite(size) || size < 0) {
        throw new HttpError(400, "invalid chunk size");
      }
      if (size === 0) {
        // Consume trailer section: header lines until a bare CRLF.
        for (;;) {
          const line = await reader.readLine();
          if (line === null) break;
          const trimmed = line.toString("latin1").trim();
          if (trimmed === "") break;
        }
        break;
      }
      total += size;
      if (total > maxBodyBytes) throw new HttpError(413, "request body too large");
      const chunk = await reader.readBytes(size);
      if (chunk === null) throw new HttpError(400, "unexpected EOF in chunked body");
      const crlf = await reader.readBytes(2);
      if (!crlf || !crlf.equals(CRLF)) throw new HttpError(400, "malformed chunk boundary");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  const cl = headerValue(headers, "content-length");
  if (cl !== undefined) {
    const length = Number(cl);
    if (!Number.isInteger(length) || length < 0) throw new HttpError(400, "invalid content-length");
    if (length > maxBodyBytes) throw new HttpError(413, "request body too large");
    if (length === 0) return Buffer.alloc(0);
    const body = await reader.readBytes(length);
    if (body === null) throw new HttpError(400, "unexpected EOF in request body");
    return body;
  }

  return Buffer.alloc(0);
}

// ---------------------------------------------------------------------------
// Injector relay
// ---------------------------------------------------------------------------

interface RelayedResponse {
  status: number;
  headers: Array<[string, string]>;
  body: Buffer;
}

function headersToObject(headers: Array<[string, string]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of headers) {
    if (k in out) out[k] = `${out[k]}, ${v}`;
    else out[k] = v;
  }
  return out;
}

function objectToHeaders(obj: unknown): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (!obj || typeof obj !== "object") return out;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const name = key.toLowerCase();
    if (SKIP_RESPONSE_HEADERS.has(name)) continue;
    if (Array.isArray(value)) {
      for (const v of value) out.push([name, String(v)]);
    } else if (value !== undefined && value !== null) {
      out.push([name, String(value)]);
    }
  }
  return out;
}

function rawResponseHeaders(rawHeaders: string[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    const name = rawHeaders[i].toLowerCase();
    if (!SKIP_RESPONSE_HEADERS.has(name)) out.push([name, rawHeaders[i + 1]]);
  }
  return out;
}

/**
 * POSTs the decrypted request to the injector per the relay envelope contract
 * and resolves the envelope response. Non-JSON injector responses (its own
 * errors, proxies in between) are surfaced verbatim as status/headers/body.
 */
function relayToInjector(
  config: EgressShimConfig,
  request: { method: string; url: string; headers: Array<[string, string]>; body: Buffer }
): Promise<RelayedResponse> {
  const url = new URL(config.injectorUrl);
  const transport = url.protocol === "https:" ? https : http;
  const envelope = JSON.stringify({
    token: config.injectorToken ?? null,
    request: {
      method: request.method,
      url: request.url,
      headers: headersToObject(request.headers),
      bodyB64: request.body.toString("base64"),
    },
  });

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(envelope),
        },
        timeout: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks);
          const statusCode = res.statusCode ?? 502;
          let parsed: { status?: number; headers?: unknown; bodyB64?: string };
          try {
            parsed = JSON.parse(raw.toString("utf8"));
          } catch {
            // The injector forwards upstream failures in envelope form, so a
            // non-JSON reply means the injector itself (or an intermediary)
            // failed — surface it verbatim rather than inventing a 502.
            resolve({
              status: statusCode,
              headers: rawResponseHeaders(res.rawHeaders ?? []),
              body: raw,
            });
            return;
          }
          resolve({
            status: typeof parsed.status === "number" ? parsed.status : statusCode,
            headers: objectToHeaders(parsed.headers),
            body: parsed.bodyB64 ? Buffer.from(parsed.bodyB64, "base64") : Buffer.alloc(0),
          });
        });
        res.on("error", reject);
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new HttpError(504, "injector request timed out"));
    });
    req.on("error", (err) => {
      reject(new HttpError(502, `injector unreachable: ${err.message}`));
    });
    req.end(envelope);
  });
}

// ---------------------------------------------------------------------------
// Response writing
// ---------------------------------------------------------------------------

function wantsClose(head: HttpRequestHead): boolean {
  const connection = headerValue(head.headers, "connection")?.toLowerCase() ?? "";
  if (head.version === "HTTP/1.0") return connection !== "keep-alive";
  return connection === "close";
}

function writeStatusLine(socket: net.Socket | tls.TLSSocket, head: string, body?: Buffer): void {
  socket.write(head + "\r\n\r\n");
  if (body && body.length) socket.write(body);
}

function writeErrorResponse(socket: net.Socket | tls.TLSSocket, status: number, message: string, close = true): void {
  const body = Buffer.from(message, "utf8");
  writeStatusLine(
    socket,
    [
      `HTTP/1.1 ${status} ${http.STATUS_CODES[status] ?? "Error"}`,
      "Content-Type: text/plain",
      `Content-Length: ${body.length}`,
      `Connection: ${close ? "close" : "keep-alive"}`,
    ].join("\r\n"),
    body
  );
}

function writeRelayedResponse(
  socket: net.Socket | tls.TLSSocket,
  response: RelayedResponse,
  closeAfter: boolean
): void {
  const reason = http.STATUS_CODES[response.status] ?? "";
  const lines = [`HTTP/1.1 ${response.status} ${reason}`];
  for (const [k, v] of response.headers) lines.push(`${k}: ${v}`);
  lines.push(`Content-Length: ${response.body.length}`);
  lines.push(`Connection: ${closeAfter ? "close" : "keep-alive"}`);
  writeStatusLine(socket, lines.join("\r\n"), response.body);
}

// ---------------------------------------------------------------------------
// Certificate machinery (openssl-backed)
// ---------------------------------------------------------------------------

function openssl(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("openssl", args, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(`openssl ${args[0]} failed: ${(stderr || error.message).trim()}`));
      } else {
        resolve();
      }
    });
  });
}

function requireOpenssl(): void {
  try {
    execFileSync("openssl", ["version"], { stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    throw new Error("openssl binary not found — the egress router needs it to mint its CA and leaf certificates");
  }
}

function mintRootCa(dir: string): { caKeyPath: string; caCertPath: string } {
  const caKeyPath = path.join(dir, "ca.key");
  const caCertPath = path.join(dir, "ca.pem");
  if (!fs.existsSync(caKeyPath) || !fs.existsSync(caCertPath)) {
    execFileSync(
      "openssl",
      [
        "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes",
        "-days", "3650",
        "-subj", CA_SUBJECT,
        "-keyout", caKeyPath,
        "-out", caCertPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    fs.chmodSync(caKeyPath, 0o600);
  }
  return { caKeyPath, caCertPath };
}

const SYSTEM_CA_BUNDLE_CANDIDATES = [
  "/etc/ssl/certs/ca-certificates.crt",
  "/etc/pki/tls/certs/ca-bundle.crt",
  "/etc/ssl/cert.pem",
  "/usr/local/share/certs/ca-root-nss.crt",
];

/**
 * Our CA prepended to the box's public bundle. CA env vars that REPLACE the
 * default trust store (SSL_CERT_FILE, REQUESTS_CA_BUNDLE, GIT_SSL_CAINFO)
 * must point at this file, or passthrough hosts' public certs stop
 * verifying.
 */
function writeCaBundle(dir: string, caCertPath: string): string {
  const parts = [fs.readFileSync(caCertPath)];
  for (const candidate of SYSTEM_CA_BUNDLE_CANDIDATES) {
    try {
      parts.push(fs.readFileSync(candidate));
      break;
    } catch {
      /* try the next candidate */
    }
  }
  const bundlePath = path.join(dir, "ca-bundle.pem");
  fs.writeFileSync(
    bundlePath,
    parts.map((p) => p.toString("utf8").trimEnd() + "\n").join("")
  );
  return bundlePath;
}

/** Per-host leaf mint, deduplicated so concurrent CONNECTs share one openssl run. */
function createLeafMinter(dir: string, caKeyPath: string, caCertPath: string) {
  const pending = new Map<string, Promise<tls.SecureContext>>();
  return (host: string): Promise<tls.SecureContext> => {
    const cached = pending.get(host);
    if (cached) return cached;
    const promise = (async () => {
      const leafDir = path.join(dir, "leaf-" + crypto.createHash("sha256").update(host).digest("hex").slice(0, 16));
      fs.mkdirSync(leafDir, { recursive: true });
      const keyPath = path.join(leafDir, "key.pem");
      const csrPath = path.join(leafDir, "req.csr");
      const certPath = path.join(leafDir, "cert.pem");
      const extPath = path.join(leafDir, "ext.cnf");
      const sanType = net.isIP(host) ? "IP" : "DNS";
      fs.writeFileSync(
        extPath,
        [
          `subjectAltName=${sanType}:${host}`,
          "basicConstraints=CA:FALSE",
          "keyUsage=digitalSignature,keyEncipherment",
          "extendedKeyUsage=serverAuth",
          "",
        ].join("\n")
      );
      await openssl([
        "req", "-new", "-newkey", "rsa:2048", "-nodes", "-sha256",
        "-subj", `/CN=${host}`,
        "-keyout", keyPath,
        "-out", csrPath,
      ]);
      // Random serial instead of -CAcreateserial: the shared ca.srl file races
      // under concurrent mints for different hosts.
      const serial = "0x" + crypto.randomBytes(16).toString("hex");
      await openssl([
        "x509", "-req",
        "-in", csrPath,
        "-CA", caCertPath,
        "-CAkey", caKeyPath,
        "-set_serial", serial,
        "-out", certPath,
        "-days", "825",
        "-sha256",
        "-extfile", extPath,
      ]);
      fs.chmodSync(keyPath, 0o600);
      return tls.createSecureContext({
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      });
    })();
    pending.set(host, promise);
    // A failed mint must not poison the cache — drop it so a retry re-mints.
    promise.catch(() => pending.delete(host));
    return promise;
  };
}

// ---------------------------------------------------------------------------
// Request serving
// ---------------------------------------------------------------------------

type SocketLike = net.Socket | tls.TLSSocket;

/**
 * Serializes a parsed request back to wire form for a fresh upstream
 * connection: origin-form target, hop-by-hop headers stripped, body framing
 * recomputed (readRequestBody already removed chunk framing, so a stale
 * `Transfer-Encoding` must not survive), and `connection: close` so the
 * upstream response FIN propagates to the client — the next request then
 * gets fresh host routing instead of being pinned to this upstream.
 */
const DROP_FORWARD_HEADERS = new Set(["connection", "transfer-encoding", "content-length", "keep-alive", "upgrade"]);

function serializeRequest(head: HttpRequestHead, body: Buffer): Buffer {
  let target = head.target;
  if (/^https?:\/\//i.test(target)) {
    try {
      const u = new URL(target);
      target = u.pathname + u.search || "/";
    } catch {
      /* leave target as-is */
    }
  }
  const hadFraming = head.headers.some(([k]) => {
    const lk = k.toLowerCase();
    return lk === "content-length" || lk === "transfer-encoding";
  });
  const outHeaders = sanitizeRequestHeaders(head.headers).filter(([k]) => !DROP_FORWARD_HEADERS.has(k.toLowerCase()));
  if (hadFraming || body.length) outHeaders.push(["content-length", String(body.length)]);
  outHeaders.push(["connection", "close"]);
  const headText =
    `${head.method} ${target} HTTP/1.1\r\n` +
    outHeaders.map(([k, v]) => `${k}: ${v}`).join("\r\n") +
    "\r\n\r\n";
  return Buffer.concat([Buffer.from(headText, "latin1"), body]);
}

/** Hop-by-hop headers stripped from a forwarded upstream response head. */
const RESPONSE_DROP_HEADERS = new Set(["connection", "proxy-connection", "keep-alive"]);

function parseResponseHead(raw: Buffer): {
  statusLine: string;
  status: number;
  headers: Array<[string, string]>;
} {
  const lines = raw.toString("latin1").split("\r\n");
  const statusLine = lines[0];
  const match = /^HTTP\/\S+\s+(\d{3})\b/i.exec(statusLine);
  if (!match) throw new HttpError(502, "malformed upstream status line");
  const headers: Array<[string, string]> = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) throw new HttpError(502, "malformed upstream header line");
    headers.push([line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]);
  }
  return { statusLine, status: parseInt(match[1], 10), headers };
}

/** Connect to an upstream, TLS-wrapping when `useTls` (public-CA verified). */
function connectUpstream(host: string, port: number, useTls: boolean): Promise<SocketLike> {
  return new Promise((resolve, reject) => {
    const raw = net.connect({ host, port });
    raw.setTimeout(CONNECT_UPSTREAM_TIMEOUT_MS);
    const sock: SocketLike = useTls ? tls.connect({ socket: raw, servername: host }) : raw;
    const fail = (error: HttpError): void => {
      sock.destroy();
      reject(error);
    };
    const onError = (err: Error): void =>
      fail(new HttpError(502, `upstream ${host}:${port} failed: ${err.message}`));
    raw.once("timeout", () => fail(new HttpError(504, `upstream ${host}:${port} timed out`)));
    sock.once("error", onError);
    if (useTls) raw.once("error", () => { /* reported on the TLS socket */ });
    const begin = (): void => {
      raw.setTimeout(0);
      sock.removeListener("error", onError);
      resolve(sock);
    };
    if (useTls) sock.once("secureConnect", begin);
    else raw.once("connect", begin);
  });
}

/** Copy exactly `count` bytes from `reader` to `socket` in bounded chunks. */
async function pumpBytes(reader: SocketReader, socket: SocketLike, count: number): Promise<void> {
  let remaining = count;
  while (remaining > 0) {
    const piece = await reader.readBytes(Math.min(remaining, 64 * 1024));
    if (piece === null) throw new HttpError(502, "unexpected EOF in upstream body");
    socket.write(piece);
    remaining -= piece.length;
  }
}

/** Forward a chunked upstream body verbatim through the terminal chunk + trailers. */
async function pumpChunked(reader: SocketReader, socket: SocketLike): Promise<void> {
  for (;;) {
    const sizeLine = await reader.readLine();
    if (sizeLine === null) throw new HttpError(502, "unexpected EOF in upstream chunked body");
    socket.write(sizeLine);
    const size = parseInt(sizeLine.toString("latin1").split(";")[0].trim(), 16);
    if (!Number.isFinite(size) || size < 0) throw new HttpError(502, "invalid upstream chunk size");
    if (size === 0) {
      for (;;) {
        const line = await reader.readLine();
        if (line === null) break;
        socket.write(line);
        if (line.toString("latin1").trim() === "") break;
      }
      return;
    }
    await pumpBytes(reader, socket, size + 2);
  }
}

/**
 * Forwards one parsed request over a fresh upstream connection and streams
 * the response back. The client connection stays in parsed-request mode,
 * so the next request — whether keep-alive or pipelined — is routed by its
 * own Host instead of being pinned to the first upstream. `connection:
 * close` goes upstream only to delimit the response; the client-visible
 * Connection header follows the client's own request (unless the body is
 * close-delimited, where our own FIN must delimit it).
 *
 * Returns "spliced" when the exchange switched protocols (101 or CONNECT)
 * and both sockets are now raw-piped — the caller stops serving and must
 * not close the client; "close" when the client connection must end after
 * this response; "done" to keep serving.
 */
async function forwardPassthroughRequest(
  socket: SocketLike,
  reader: SocketReader,
  head: HttpRequestHead,
  body: Buffer,
  host: string,
  port: number,
  useTls: boolean,
  clientClose: boolean
): Promise<"done" | "close" | "spliced"> {
  const upstream = await connectUpstream(host, port, useTls);
  const ureader = new SocketReader(upstream);
  try {
    upstream.write(serializeRequest(head, body));
    // Skip interim 1xx heads (103 Early Hints etc.); 101 switches protocols.
    let res: ReturnType<typeof parseResponseHead>;
    for (;;) {
      const raw = await ureader.readUntil(HEAD_END, MAX_HEAD_BYTES);
      if (raw === null) throw new HttpError(502, `upstream ${host}:${port} closed without a response`);
      res = parseResponseHead(raw);
      if (res.status !== 101 && res.status >= 100 && res.status < 200) continue;
      break;
    }
    const resHeaders = res.headers.filter(([k]) => !RESPONSE_DROP_HEADERS.has(k));
    const chunked = /chunked/i.test(headerValue(resHeaders, "transfer-encoding") ?? "");
    const cl = headerValue(resHeaders, "content-length");
    const noBody = head.method === "HEAD" || res.status === 204 || res.status === 304;
    const switchProtocols = res.status === 101 || head.method === "CONNECT";
    const closeDelimited = !noBody && !switchProtocols && cl === undefined && !chunked;
    const replyClose = clientClose || closeDelimited;
    resHeaders.push(["connection", replyClose ? "close" : "keep-alive"]);
    socket.write(
      res.statusLine + "\r\n" + resHeaders.map(([k, v]) => `${k}: ${v}`).join("\r\n") + "\r\n\r\n"
    );

    if (switchProtocols) {
      const rest = ureader.takeBuffered();
      ureader.unbind();
      reader.unbind();
      if (rest.length) socket.write(rest);
      socket.pipe(upstream);
      upstream.pipe(socket);
      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
      return "spliced";
    }

    if (!noBody) {
      if (chunked) {
        await pumpChunked(ureader, socket);
      } else if (cl !== undefined) {
        const length = Number(cl);
        if (!Number.isInteger(length) || length < 0) {
          throw new HttpError(502, "invalid upstream content-length");
        }
        await pumpBytes(ureader, socket, length);
      } else {
        for (;;) {
          const piece = await ureader.readChunk();
          if (piece === null) break;
          socket.write(piece);
        }
      }
    }
    ureader.unbind();
    upstream.destroy();
    return replyClose ? "close" : "done";
  } catch (error) {
    upstream.destroy();
    throw error;
  }
}

export function buildRequestUrl(scheme: "http" | "https", hostHeader: string | undefined, defaultHost: string, target: string): string {
  if (/^https?:\/\//i.test(target)) return target;
  if (target === "*") return `${scheme}://${hostHeader || defaultHost}/`;
  const host = hostHeader || defaultHost;
  const pathPart = target.startsWith("/") ? target : `/${target}`;
  return `${scheme}://${host}${pathPart}`;
}

export function sanitizeRequestHeaders(headers: Array<[string, string]>): Array<[string, string]> {
  const connectionTokens = new Set(
    headerValues(headers, "connection")
      .flatMap((v) => v.split(","))
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
  );
  return headers.filter(([k]) => !SKIP_REQUEST_HEADERS.has(k) && !connectionTokens.has(k));
}

/**
 * Reads the request the client actually sent over an already-established
 * (TLS or plain) socket, answers `Expect: 100-continue`, and returns the
 * head + buffered reader + body.
 */
async function readRequest(
  socket: SocketLike,
  reader: SocketReader,
  maxBodyBytes: number
): Promise<{ head: HttpRequestHead; body: Buffer } | null> {
  const headRaw = await reader.readUntil(HEAD_END, MAX_HEAD_BYTES);
  if (headRaw === null) return null;
  const head = parseHead(headRaw);
  if (/^100-continue$/i.test(headerValue(head.headers, "expect") ?? "")) {
    socket.write("HTTP/1.1 100 Continue\r\n\r\n");
  }
  const body = await readRequestBody(reader, head.headers, maxBodyBytes);
  return { head, body };
}

/**
 * The credentialed-host path: read requests off `socket` (a MITM'd TLS socket
 * or a plain socket already known to target a credentialed host), relay each
 * to the injector, and write the relayed response back. Loops for keep-alive
 * and consumes any pipelined bytes in order.
 */
async function serveRelayed(
  socket: SocketLike,
  options: {
    scheme: "http" | "https";
    defaultHost: string;
    reader?: SocketReader;
    /** Head already consumed by the caller (plain-HTTP path). */
    firstHead?: HttpRequestHead;
  },
  config: EgressShimConfig
): Promise<void> {
  const reader = options.reader ?? new SocketReader(socket);
  const maxBody = config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  let pendingHead = options.firstHead;
  let spliced = false;
  try {
    for (;;) {
      let head: HttpRequestHead;
      let body: Buffer;
      if (pendingHead) {
        // Caller already consumed the head (plain-HTTP path); only the body remains.
        head = pendingHead;
        pendingHead = undefined;
        if (/^100-continue$/i.test(headerValue(head.headers, "expect") ?? "")) {
          socket.write("HTTP/1.1 100 Continue\r\n\r\n");
        }
        body = await readRequestBody(reader, head.headers, maxBody);
      } else {
        const request = await readRequest(socket, reader, maxBody);
        if (request === null) break;
        head = request.head;
        body = request.body;
      }

      const hostHeader = headerValue(head.headers, "host");
      const closeAfter = wantsClose(head);
      const allowlist = (config.mode ?? "passthrough") === "allowlist";

      // An absolute-form target carries its own authority and is what would
      // be relayed — it must pass the credentialed check too, or a listed
      // Host header could smuggle an unlisted URL to the injector.
      let effectiveHost: string;
      let tunnelPort: number | null;
      let tunnelTls: boolean;
      if (/^https?:\/\//i.test(head.target)) {
        let url: URL;
        try {
          url = new URL(head.target);
        } catch {
          writeErrorResponse(socket, 400, "egress router: malformed absolute URI");
          break;
        }
        const authority = splitAuthority(url.host);
        effectiveHost = authority.host;
        tunnelPort = authority.port;
        tunnelTls = url.protocol === "https:";
      } else {
        const authority = splitAuthority(hostHeader || options.defaultHost);
        effectiveHost = authority.host;
        tunnelPort = authority.port;
        tunnelTls = options.scheme === "https";
      }

      if (!matchCredentialedHost(effectiveHost, config.credentialedHosts ?? [])) {
        if (allowlist) {
          writeErrorResponse(socket, 403, `egress router: ${effectiveHost} is not a credentialed host`);
          break;
        }
        if (!effectiveHost || !validConnectHost(effectiveHost)) {
          writeErrorResponse(socket, 400, `egress router: invalid upstream host "${effectiveHost}"`);
          break;
        }
        // Passthrough: forward this request over a fresh upstream
        // connection, then keep parsing — a reused client connection
        // routes each request by its own Host instead of pinning the
        // whole connection to the first upstream.
        const outcome = await forwardPassthroughRequest(
          socket,
          reader,
          head,
          body,
          effectiveHost,
          tunnelPort ?? (tunnelTls ? 443 : 80),
          tunnelTls,
          closeAfter
        );
        if (outcome === "spliced") {
          spliced = true;
          break;
        }
        if (outcome === "close") break;
        continue;
      }

      const relayed = await relayToInjector(config, {
        method: head.method,
        url: buildRequestUrl(options.scheme, hostHeader, options.defaultHost, head.target),
        headers: sanitizeRequestHeaders(head.headers),
        body,
      });
      writeRelayedResponse(socket, relayed, closeAfter);
      if (closeAfter) break;
    }
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 502;
    try {
      writeErrorResponse(socket, status, `egress router: ${error instanceof Error ? error.message : String(error)}`);
    } catch {
      /* socket already dead */
    }
  } finally {
    if (!spliced) socket.end();
  }
}

function httpErrorCode(socket: SocketLike, status: number, message: string): void {
  try {
    writeErrorResponse(socket, status, message);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Connection handling
// ---------------------------------------------------------------------------

async function handleConnect(
  client: net.Socket,
  reader: SocketReader,
  head: HttpRequestHead,
  config: EgressShimConfig,
  mintLeaf: (host: string) => Promise<tls.SecureContext>
): Promise<void> {
  const authority = splitAuthority(head.target);
  const host = authority.host;
  const port = authority.port ?? 443;

  if (!host || !validConnectHost(host) || port <= 0 || port > 65535) {
    httpErrorCode(client, 400, `egress router: invalid CONNECT authority "${head.target}"`);
    client.end();
    return;
  }

  if (matchCredentialedHost(host, config.credentialedHosts ?? [])) {
    let secureContext: tls.SecureContext;
    try {
      secureContext = await mintLeaf(host);
    } catch (error) {
      httpErrorCode(client, 502, `egress router: could not mint certificate for ${host}: ${error instanceof Error ? error.message : error}`);
      client.end();
      return;
    }
    // A client that pipelined bytes after the CONNECT head can't have sent
    // anything valid (TLS only starts after our 200), but hand leftovers to
    // the TLS socket anyway rather than dropping them mid-handshake.
    const leftover = reader.takeBuffered();
    reader.unbind();
    if (leftover.length) {
      try {
        client.unshift(leftover);
      } catch {
        client.destroy();
        return;
      }
    }
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    const tlsSocket = new tls.TLSSocket(client, {
      isServer: true,
      secureContext,
      requestCert: false,
      rejectUnauthorized: false,
      ALPNProtocols: ["http/1.1"],
    });
    tlsSocket.on("error", () => client.destroy());
    await serveRelayed(tlsSocket, { scheme: "https", defaultHost: host }, config);
    return;
  }

  if ((config.mode ?? "passthrough") === "allowlist") {
    httpErrorCode(client, 403, `egress router: CONNECT to ${host} denied by allowlist policy`);
    client.end();
    return;
  }

  // Passthrough: raw TCP tunnel straight upstream.
  const upstream = net.connect({ host, port });
  let established = false;
  upstream.setTimeout(CONNECT_UPSTREAM_TIMEOUT_MS);
  upstream.once("timeout", () => {
    if (!established) httpErrorCode(client, 504, `egress router: CONNECT to ${host}:${port} timed out`);
    upstream.destroy();
    client.end();
  });
  upstream.once("error", (err) => {
    if (!established) httpErrorCode(client, 502, `egress router: CONNECT to ${host}:${port} failed: ${err.message}`);
    client.end();
  });
  upstream.once("connect", () => {
    established = true;
    upstream.setTimeout(0);
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    const rest = reader.takeBuffered();
    reader.unbind();
    if (rest.length) upstream.write(rest);
    client.pipe(upstream);
    upstream.pipe(client);
  });
}

/**
 * Non-CONNECT requests hitting the proxy port (plain-HTTP forward-proxy
 * form) just validate the authority and hand off: serveRelayed resolves
 * each request's effective host itself, so mixed-use connections route
 * per request (credentialed hosts relay, others forward or deny).
 */
async function handlePlainHttp(
  client: net.Socket,
  reader: SocketReader,
  head: HttpRequestHead,
  config: EgressShimConfig
): Promise<void> {
  let scheme: "http" | "https" = "http";
  let defaultHost = headerValue(head.headers, "host");

  if (/^https?:\/\//i.test(head.target)) {
    let parsed: URL;
    try {
      parsed = new URL(head.target);
    } catch {
      httpErrorCode(client, 400, "egress router: malformed absolute URI");
      client.end();
      return;
    }
    defaultHost = parsed.host;
    scheme = parsed.protocol === "https:" ? "https" : "http";
  }

  if (!defaultHost) {
    httpErrorCode(client, 400, "egress router: request has no Host");
    client.end();
    return;
  }

  await serveRelayed(client, { scheme, defaultHost, reader, firstHead: head }, config);
}

async function handleConnection(
  client: net.Socket,
  config: EgressShimConfig,
  mintLeaf: (host: string) => Promise<tls.SecureContext>
): Promise<void> {
  client.setNoDelay(true);
  client.setTimeout(SOCKET_IDLE_TIMEOUT_MS, () => client.destroy());
  client.on("error", () => client.destroy());

  const reader = new SocketReader(client);
  let rawHead: Buffer | null;
  try {
    rawHead = await reader.readUntil(HEAD_END, MAX_HEAD_BYTES);
  } catch (error) {
    httpErrorCode(client, error instanceof HttpError ? error.status : 400, `egress router: ${error instanceof Error ? error.message : error}`);
    client.end();
    return;
  }
  if (rawHead === null) {
    client.end();
    return;
  }

  let head: HttpRequestHead;
  try {
    head = parseHead(rawHead);
  } catch (error) {
    httpErrorCode(client, error instanceof HttpError ? error.status : 400, `egress router: ${error instanceof Error ? error.message : error}`);
    client.end();
    return;
  }

  if (head.method === "CONNECT") {
    await handleConnect(client, reader, head, config, mintLeaf);
    return;
  }
  await handlePlainHttp(client, reader, head, config);
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

function reportError(message: string): void {
  process.stdout.write(`EGRESS_ERROR ${JSON.stringify({ message })}\n`);
}

function loadConfig(configPath: string): EgressShimConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`could not read config at ${configPath}: ${error instanceof Error ? error.message : error}`);
  }
  const config = parsed as EgressShimConfig;
  if (!config || typeof config !== "object") {
    throw new Error("config must be a JSON object");
  }
  if (typeof config.injectorUrl !== "string" || !/^https?:\/\//.test(config.injectorUrl)) {
    throw new Error("config.injectorUrl must be an http(s) URL");
  }
  {
    const injectorUrl = new URL(config.injectorUrl);
    const host = injectorUrl.hostname.toLowerCase().replace(/^[\[\]]/g, "");
    const loopback = host === "localhost" || host === "::1" || host.startsWith("127.");
    if (injectorUrl.protocol === "http:" && !loopback) {
      throw new Error(
        "config.injectorUrl must be https — plain http is only allowed for loopback injectors (the token and decrypted requests travel in cleartext)"
      );
    }
  }
  if (!Array.isArray(config.credentialedHosts)) {
    throw new Error("config.credentialedHosts must be an array of hostnames");
  }
  const mode = config.mode ?? "passthrough";
  if (mode !== "passthrough" && mode !== "allowlist") {
    throw new Error(`config.mode must be "passthrough" or "allowlist" (got "${config.mode}")`);
  }
  if (config.port !== undefined && (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535)) {
    throw new Error("config.port must be an integer between 0 and 65535");
  }
  return { ...config, mode };
}

async function main(): Promise<void> {
  const configPath = process.argv[2];
  if (!configPath) {
    throw new Error("usage: egress-shim.js <config.json>");
  }
  const config = loadConfig(configPath);

  requireOpenssl();

  // Each router works out of the directory holding its config, so two
  // routers on one box never share a CA or host rules.
  const workdir = config.dir ?? path.dirname(path.resolve(configPath));
  fs.mkdirSync(workdir, { recursive: true });
  const { caKeyPath, caCertPath } = mintRootCa(workdir);
  const mintLeaf = createLeafMinter(workdir, caKeyPath, caCertPath);
  const caBundlePath = writeCaBundle(workdir, caCertPath);

  const server = net.createServer((client) => {
    handleConnection(client, config, mintLeaf).catch(() => client.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: config.port ?? 0 }, resolve);
  });

  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : config.port;
  process.stdout.write(`EGRESS_READY ${JSON.stringify({ port: boundPort, caCertPath, caBundlePath, pid: process.pid })}\n`);

  const shutdown = (): void => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (require.main === module) {
  main().catch((error) => {
    reportError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
