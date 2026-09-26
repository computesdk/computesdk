import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import * as http from "node:http";
import { spawn } from "node:child_process";

interface SeedLauncherDaemonConfig {
  version: string;
  name: string;
  token: string;
  socket: string;
  stateFile: string;
  sseHost: string;
  ssePort: number;
  sseStrictPort?: boolean;
}

interface WireMessage {
  id?: string;
  type: string;
  token?: string;
  payload?: Record<string, unknown>;
  replyTo?: string;
}

interface Subscriber {
  conn: net.Socket;
  filter?: {
    channel?: string;
    type?: string;
  };
}

function writeLine(conn: net.Socket, value: unknown): void {
  try {
    if (!conn.destroyed) conn.write(`${JSON.stringify(value)}\n`);
  } catch {}
}

function now(): number {
  return Date.now();
}

function makeId(): string {
  return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
}

function loadConfig(): SeedLauncherDaemonConfig {
  const encoded = process.argv[2];
  if (!encoded) throw new Error("seed daemon config is missing");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as SeedLauncherDaemonConfig;
}

const config = loadConfig();
const startedAt = now();
const subscribers = new Set<Subscriber>();
const sseClients = new Set<http.ServerResponse>();

function publish(event: Record<string, unknown>): void {
  const payload = {
    id: makeId(),
    type: "event",
    ts: now(),
    payload: event,
  };

  for (const sub of subscribers) {
    const channelOk = !sub.filter || !sub.filter.channel || sub.filter.channel === event.channel;
    const typeOk = !sub.filter || !sub.filter.type || sub.filter.type === event.type;
    if (channelOk && typeOk) writeLine(sub.conn, payload);
  }

  const sseData = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(sseData);
    } catch {}
  }
}

function persistState(ssePort: number): void {
  const state = {
    version: config.version,
    name: config.name,
    pid: process.pid,
    token: config.token,
    socket: config.socket,
    ssePort,
    startedAt,
  };
  fs.writeFileSync(config.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function isAuthed(msg: WireMessage): boolean {
  return !!msg && msg.token === config.token;
}

function removeSocket(): void {
  try {
    fs.unlinkSync(config.socket);
  } catch {}
}

function sanitizeEnvInput(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string") {
      env[key] = value;
      continue;
    }
    if (value === undefined || value === null) continue;
    env[key] = String(value);
  }

  return env;
}

interface Job {
  id: string;
  requestId: string;
  pid: number | null;
  status: "running" | "exited";
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  combined: string;
  kill(signal: string): void;
  onExit: Set<() => void>;
}

/** How long an exited detached job stays retrievable via `wait`/`status`. */
const JOB_RETENTION_MS = 10 * 60 * 1000;

const jobs = new Map<string, Job>();

function jobSnapshot(job: Job): Record<string, unknown> {
  return {
    jobId: job.id,
    pid: job.pid,
    status: job.status,
    exitCode: job.exitCode,
    signal: job.signal,
    stdout: job.stdout,
    stderr: job.stderr,
    combined: job.combined,
  };
}

function reply(conn: net.Socket, type: string, replyTo: string, payload: Record<string, unknown>): void {
  writeLine(conn, { id: makeId(), type, replyTo, ts: now(), payload });
}

function replyError(conn: net.Socket, replyTo: string, message: string): void {
  reply(conn, "error", replyTo, { message });
}

function startJob(msg: WireMessage): Job | string {
  const payload = msg.payload ?? {};
  const requestId = msg.id || makeId();
  const command = String(payload.command ?? "").trim();
  const args = Array.isArray(payload.args) ? payload.args.map((value) => String(value)) : [];
  const cwd = typeof payload.cwd === "string" && payload.cwd.length > 0 ? payload.cwd : process.cwd();
  const shell = payload.shell === true;
  const detach = payload.detach === true;
  // An attached exec has always defaulted to a 60s deadline; a detached job is
  // by definition something the caller expects to outlive the request.
  const timeoutMs = Number.isFinite(payload.timeoutMs)
    ? Math.max(1, Number(payload.timeoutMs))
    : detach
      ? null
      : 60_000;
  const extraEnv = sanitizeEnvInput(payload.env);

  if (!command) return "seed daemon: command is required";

  publish({
    channel: "daemon",
    type: "command.started",
    requestId,
    command,
    args,
    ts: now(),
  });

  const child = spawn(command, args, {
    cwd,
    shell,
    env: {
      ...process.env,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group, so a kill reaches the whole tree: a `sh -c` wrapper
    // dying alone would leave its children holding the output pipes open and
    // the job "running" until they exit on their own.
    detached: true,
  });

  const job: Job = {
    id: makeId(),
    requestId,
    pid: child.pid ?? null,
    status: "running",
    exitCode: null,
    signal: null,
    stdout: "",
    stderr: "",
    combined: "",
    kill(signal: string) {
      try {
        if (child.pid) process.kill(-child.pid, signal as NodeJS.Signals);
        else child.kill(signal as NodeJS.Signals);
      } catch {
        try {
          child.kill(signal as NodeJS.Signals);
        } catch {}
      }
    },
    onExit: new Set(),
  };
  jobs.set(job.id, job);

  let finished = false;
  let timedOut = false;
  let killTimer: NodeJS.Timeout | null = null;

  const timer =
    timeoutMs === null
      ? null
      : setTimeout(() => {
          timedOut = true;
          job.kill("SIGTERM");
          killTimer = setTimeout(() => job.kill("SIGKILL"), 1_500);
        }, timeoutMs);

  child.stdout.on("data", (chunk: Buffer | string) => {
    const text = String(chunk);
    job.stdout += text;
    job.combined += text;
    publish({ channel: "daemon", type: "command.stdout", requestId, jobId: job.id, chunk: text, ts: now() });
  });

  child.stderr.on("data", (chunk: Buffer | string) => {
    const text = String(chunk);
    job.stderr += text;
    job.combined += text;
    publish({ channel: "daemon", type: "command.stderr", requestId, jobId: job.id, chunk: text, ts: now() });
  });

  const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    if (killTimer) {
      clearTimeout(killTimer);
      killTimer = null;
    }

    if (timedOut) {
      const note = "seed daemon: command timed out\n";
      job.stderr += job.stderr.endsWith("\n") || job.stderr.length === 0 ? note : `\n${note}`;
      job.combined += job.combined.endsWith("\n") || job.combined.length === 0 ? note : `\n${note}`;
    }

    job.status = "exited";
    job.exitCode = exitCode;
    job.signal = signal;

    publish({
      channel: "daemon",
      type: "command.exit",
      requestId,
      jobId: job.id,
      exitCode,
      signal,
      ts: now(),
    });

    for (const listener of job.onExit) listener();
    job.onExit.clear();

    const retention = setTimeout(() => jobs.delete(job.id), JOB_RETENTION_MS);
    retention.unref();
  };

  child.once("error", (err: Error) => {
    job.stderr += String(err);
    job.combined += String(err);
    // spawn failure: the conventional "command not found / not executable" code.
    finish(127, null);
  });

  child.once("close", (exitCode, signal) => {
    finish(exitCode, signal);
  });

  return job;
}

function handleExec(msg: WireMessage, conn: net.Socket): void {
  const requestId = msg.id || makeId();
  const started = startJob({ ...msg, id: requestId });
  if (typeof started === "string") {
    reply(conn, "exec_result", requestId, {
      exitCode: 1,
      signal: null,
      stdout: "",
      stderr: started,
      combined: `${started}\n`,
    });
    return;
  }

  if (msg.payload?.detach === true) {
    reply(conn, "exec_result", requestId, jobSnapshot(started));
    return;
  }

  // An attached exec's result is delivered exactly once, right here; only
  // detached jobs need to stay addressable (wait/status/kill) after exit.
  const send = (): void => {
    reply(conn, "exec_result", requestId, jobSnapshot(started));
    jobs.delete(started.id);
  };
  if (started.status === "exited") send();
  else started.onExit.add(send);
}

function handleWait(msg: WireMessage, conn: net.Socket): void {
  const requestId = msg.id || makeId();
  const payload = msg.payload ?? {};
  const job = jobs.get(String(payload.jobId ?? ""));
  if (!job) {
    replyError(conn, requestId, `seed daemon: unknown job ${String(payload.jobId ?? "")}`);
    return;
  }

  const send = (): void => reply(conn, "exec_result", requestId, jobSnapshot(job));
  if (job.status === "exited") {
    send();
    return;
  }

  const timeoutMs = Number.isFinite(payload.timeoutMs) ? Math.max(1, Number(payload.timeoutMs)) : null;
  let timer: NodeJS.Timeout | null = null;
  const onExit = (): void => {
    if (timer) clearTimeout(timer);
    send();
  };
  job.onExit.add(onExit);
  if (timeoutMs !== null) {
    timer = setTimeout(() => {
      job.onExit.delete(onExit);
      send();
    }, timeoutMs);
  }
  conn.once("close", () => {
    job.onExit.delete(onExit);
    if (timer) clearTimeout(timer);
  });
}

function handleStatus(msg: WireMessage, conn: net.Socket): void {
  const requestId = msg.id || makeId();
  const jobId = String(msg.payload?.jobId ?? "");
  const job = jobs.get(jobId);
  if (!job) {
    replyError(conn, requestId, `seed daemon: unknown job ${jobId}`);
    return;
  }
  reply(conn, "exec_result", requestId, jobSnapshot(job));
}

function handleKill(msg: WireMessage, conn: net.Socket): void {
  const requestId = msg.id || makeId();
  const payload = msg.payload ?? {};
  const jobId = String(payload.jobId ?? "");
  const job = jobs.get(jobId);
  if (!job) {
    replyError(conn, requestId, `seed daemon: unknown job ${jobId}`);
    return;
  }
  // Signal the whole process group even when the leader has exited: a shell
  // that backgrounded a child with redirected output exits first, leaving the
  // child alive in the group.
  job.kill(typeof payload.signal === "string" && payload.signal ? payload.signal : "SIGTERM");
  reply(conn, "exec_result", requestId, jobSnapshot(job));
}

// ---- tunnel client ----
// Dial-out multiplexed tunnel to the control plane (RFC:
// docs/rfcs/0001-daemond-dial-out-tunnel.md). A single WebSocket carries JSON
// text control frames (open/opened/close/error/ping/pong/auth) and binary data
// frames (uint32be stream id + payload). The daemon keeps zero dependencies,
// so this uses the global WebSocket shipped since Node 22 — typed minimally
// here because the runtime tsconfig's lib predates it.

interface TunnelSocketEvent {
  data?: unknown;
  code?: number;
  reason?: string;
  message?: string;
}

interface TunnelSocket {
  readyState: number;
  bufferedAmount: number;
  binaryType: string;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, fn: (ev: TunnelSocketEvent) => void): void;
}

const TUNNEL_MAX_FRAME_PAYLOAD = 64 * 1024;
const TUNNEL_BACKPRESSURE_LIMIT = 1024 * 1024;
const TUNNEL_BACKOFF_MIN_MS = 500;
const TUNNEL_BACKOFF_MAX_MS = 10_000;
const TUNNEL_MAX_STREAMS = 256;
const TUNNEL_WS_OPEN = 1;

interface TunnelStatus {
  state: "connecting" | "connected" | "disconnected";
  url: string | null;
  connectedAt: number | null;
  reconnects: number;
  streamsOpen: number;
  lastError: string | null;
}

const tunnelStatus: TunnelStatus = {
  state: "disconnected",
  url: null,
  connectedAt: null,
  reconnects: 0,
  streamsOpen: 0,
  lastError: null,
};

let tunnelWs: TunnelSocket | null = null;
let tunnelToken: string | null = null;
let tunnelAllowPort: (port: number) => boolean = () => true;
let tunnelClosed = true; // user intent: while true, close events never trigger a reconnect
let tunnelBackoffMs = TUNNEL_BACKOFF_MIN_MS;
let tunnelReconnectTimer: NodeJS.Timeout | null = null;
const tunnelStreams = new Map<number, net.Socket>();
const tunnelStateWaiters = new Set<() => void>();

function tunnelNotify(): void {
  for (const waiter of [...tunnelStateWaiters]) waiter();
}

function tunnelSnapshot(): Record<string, unknown> {
  return { ...tunnelStatus };
}

function tunnelIsLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function parseTunnelAllowPorts(input: unknown): ((port: number) => boolean) | string {
  if (input === undefined) return (port) => port >= 1 && port <= 65535;
  if (!Array.isArray(input)) return "allowPorts must be an array of ports or \"a-b\" ranges";
  const rules: Array<(port: number) => boolean> = [];
  for (const entry of input) {
    if (typeof entry === "number" && Number.isInteger(entry)) {
      const p = entry;
      rules.push((port) => port === p);
      continue;
    }
    if (typeof entry === "string" && /^\d+-\d+$/.test(entry)) {
      const [lo, hi] = entry.split("-").map(Number);
      rules.push((port) => port >= lo && port <= hi);
      continue;
    }
    return `allowPorts: invalid entry ${JSON.stringify(entry)}`;
  }
  return (port) => rules.some((rule) => rule(port));
}

function tunnelSendFrame(ws: TunnelSocket, id: number, payload: Buffer): void {
  for (let off = 0; off < payload.length; off += TUNNEL_MAX_FRAME_PAYLOAD) {
    const frame = Buffer.allocUnsafe(4 + Math.min(TUNNEL_MAX_FRAME_PAYLOAD, payload.length - off));
    frame.writeUInt32BE(id >>> 0, 0);
    payload.copy(frame, 4, off, off + TUNNEL_MAX_FRAME_PAYLOAD);
    ws.send(frame);
  }
}

function tunnelSendControl(ws: TunnelSocket, obj: Record<string, unknown>): void {
  if (ws.readyState === TUNNEL_WS_OPEN) ws.send(JSON.stringify(obj));
}

function tunnelSendError(ws: TunnelSocket, id: number, code: string, message: string): void {
  tunnelSendControl(ws, { t: "error", id, code, message });
}

function tunnelOpenStream(ws: TunnelSocket, id: number, port: number, host: string): void {
  if (tunnelStreams.size >= TUNNEL_MAX_STREAMS) {
    tunnelSendError(ws, id, "TOO_MANY_STREAMS", `max ${String(TUNNEL_MAX_STREAMS)} streams`);
    return;
  }
  if (!tunnelIsLoopbackHost(host)) {
    tunnelSendError(ws, id, "HOST_NOT_ALLOWED", `not allowed: ${host}:${String(port)}`);
    return;
  }
  if (!tunnelAllowPort(port)) {
    tunnelSendError(ws, id, "PORT_NOT_ALLOWED", `not allowed: ${host}:${String(port)}`);
    return;
  }
  const sock = net.connect(port, host);
  tunnelStreams.set(id, sock);
  tunnelStatus.streamsOpen = tunnelStreams.size;
  sock.on("connect", () => {
    tunnelSendControl(ws, { t: "opened", id });
  });
  sock.on("data", (chunk: Buffer) => {
    if (ws.readyState !== TUNNEL_WS_OPEN) return;
    tunnelSendFrame(ws, id, chunk);
    if (ws.bufferedAmount > TUNNEL_BACKPRESSURE_LIMIT && !sock.destroyed) {
      sock.pause();
      const poll = setInterval(() => {
        if (ws.bufferedAmount <= TUNNEL_BACKPRESSURE_LIMIT / 2 || ws.readyState !== TUNNEL_WS_OPEN) {
          clearInterval(poll);
          if (!sock.destroyed) sock.resume();
        }
      }, 20);
      poll.unref();
    }
  });
  sock.on("end", () => {
    tunnelSendControl(ws, { t: "close", id });
  });
  sock.on("error", (err: NodeJS.ErrnoException) => {
    tunnelSendError(ws, id, err.code || "ECONNREFUSED", err.message);
    tunnelStreams.delete(id);
    tunnelStatus.streamsOpen = tunnelStreams.size;
  });
  sock.on("close", () => {
    tunnelStreams.delete(id);
    tunnelStatus.streamsOpen = tunnelStreams.size;
  });
}

function tunnelHandleFrame(ws: TunnelSocket, data: unknown, isBinary: boolean): void {
  if (isBinary) {
    const buf = Buffer.isBuffer(data)
      ? data
      : Buffer.from(data as ArrayBuffer);
    if (buf.length < 4) return;
    const id = buf.readUInt32BE(0);
    const sock = tunnelStreams.get(id);
    if (sock && !sock.destroyed) sock.write(buf.subarray(4));
    return;
  }
  let msg: { t?: string; id?: number; port?: number; host?: string; ts?: number };
  try {
    msg = JSON.parse(typeof data === "string" ? data : Buffer.from(data as ArrayBuffer).toString());
  } catch {
    return;
  }
  switch (msg.t) {
    case "open":
      if (typeof msg.id === "number" && typeof msg.port === "number") {
        tunnelOpenStream(ws, msg.id, msg.port, typeof msg.host === "string" ? msg.host : "127.0.0.1");
      }
      break;
    case "close": {
      const sock = typeof msg.id === "number" ? tunnelStreams.get(msg.id) : undefined;
      if (sock) sock.end();
      break;
    }
    case "ping":
      tunnelSendControl(ws, { t: "pong", ts: msg.ts });
      break;
  }
}

function tunnelConnect(): void {
  if (tunnelClosed || !tunnelStatus.url) return;
  const WS = (globalThis as { WebSocket?: new (url: string) => TunnelSocket }).WebSocket;
  if (!WS) {
    tunnelStatus.state = "disconnected";
    tunnelStatus.lastError = "tunnel requires Node >= 22";
    tunnelNotify();
    return;
  }
  let wsUrl: string;
  try {
    const u = new URL(tunnelStatus.url);
    if (tunnelToken) u.searchParams.set("token", tunnelToken);
    wsUrl = u.toString();
  } catch {
    tunnelStatus.state = "disconnected";
    tunnelStatus.lastError = `invalid tunnel url: ${tunnelStatus.url}`;
    tunnelNotify();
    return;
  }
  tunnelStatus.state = "connecting";
  tunnelNotify();

  const ws = new WS(wsUrl);
  tunnelWs = ws;
  ws.binaryType = "arraybuffer";

  ws.addEventListener("open", () => {
    if (tunnelToken) ws.send(JSON.stringify({ t: "auth", token: tunnelToken }));
    tunnelBackoffMs = TUNNEL_BACKOFF_MIN_MS;
    tunnelStatus.state = "connected";
    tunnelStatus.connectedAt = now();
    tunnelStatus.lastError = null;
    publish({ channel: "daemon", type: "tunnel.connected", url: tunnelStatus.url, ts: now() });
    tunnelNotify();
  });

  ws.addEventListener("message", (ev) => {
    tunnelHandleFrame(ws, ev.data, typeof ev.data !== "string");
  });

  ws.addEventListener("close", (ev) => {
    if (tunnelWs === ws) tunnelWs = null;
    for (const sock of tunnelStreams.values()) sock.destroy();
    tunnelStreams.clear();
    tunnelStatus.streamsOpen = 0;
    if (tunnelStatus.state !== "disconnected") {
      tunnelStatus.state = "disconnected";
      tunnelStatus.connectedAt = null;
    }
    const code = typeof ev.code === "number" ? ev.code : 1006;
    const reason = typeof ev.reason === "string" ? ev.reason : "";
    if (code === 4401) tunnelStatus.lastError = "unauthorized";
    const willRetry = !tunnelClosed && code !== 4401 && tunnelStatus.lastError !== "tunnel requires Node >= 22";
    publish({
      channel: "daemon",
      type: "tunnel.disconnected",
      url: tunnelStatus.url,
      code,
      reason,
      willRetry,
      ts: now(),
    });
    if (willRetry) {
      tunnelStatus.reconnects++;
      const jitter = tunnelBackoffMs * 0.25 * (Math.random() * 2 - 1);
      const delay = Math.min(tunnelBackoffMs + jitter, TUNNEL_BACKOFF_MAX_MS);
      tunnelBackoffMs = Math.min(tunnelBackoffMs * 2, TUNNEL_BACKOFF_MAX_MS);
      tunnelReconnectTimer = setTimeout(() => {
        tunnelReconnectTimer = null;
        tunnelConnect();
      }, delay);
      tunnelReconnectTimer.unref();
    }
    tunnelNotify();
  });

  ws.addEventListener("error", () => {
    // 'close' follows; reconnect is handled there.
  });
}

function tunnelStart(url: string, token: string, allowPort: (port: number) => boolean): void {
  const sameTarget =
    tunnelStatus.url === url && !tunnelClosed && tunnelStatus.state !== "disconnected";
  if (sameTarget) return; // same URL already connecting/connected: no-op
  tunnelTeardown();
  tunnelClosed = false;
  tunnelToken = token;
  tunnelAllowPort = allowPort;
  tunnelStatus.url = url;
  tunnelStatus.connectedAt = null;
  tunnelStatus.lastError = null;
  tunnelBackoffMs = TUNNEL_BACKOFF_MIN_MS;
  tunnelConnect();
}

function tunnelDisconnect(): void {
  tunnelTeardown();
  tunnelStatus.state = "disconnected";
  tunnelStatus.connectedAt = null;
  tunnelNotify();
}

function tunnelTeardown(): void {
  tunnelClosed = true;
  if (tunnelReconnectTimer) {
    clearTimeout(tunnelReconnectTimer);
    tunnelReconnectTimer = null;
  }
  for (const sock of tunnelStreams.values()) sock.destroy();
  tunnelStreams.clear();
  tunnelStatus.streamsOpen = 0;
  const ws = tunnelWs;
  tunnelWs = null;
  if (ws && (ws.readyState === TUNNEL_WS_OPEN || ws.readyState === 0 /* CONNECTING */)) {
    try {
      ws.close(1000);
    } catch {}
  }
}

function handleTunnel(msg: WireMessage, conn: net.Socket): void {
  const requestId = msg.id || makeId();
  const payload = msg.payload ?? {};

  if (payload.status === true) {
    reply(conn, "tunnel_result", requestId, tunnelSnapshot());
    return;
  }

  if (payload.disconnect === true) {
    tunnelDisconnect();
    reply(conn, "tunnel_result", requestId, tunnelSnapshot());
    return;
  }

  if ("connect" in payload) {
    const connectUrl = payload.connect;
    const token = payload.tunnelToken;
    if (typeof connectUrl !== "string" || !connectUrl) {
      replyError(conn, requestId, "seed daemon: tunnel connect requires a url string");
      return;
    }
    if (typeof token !== "string" || !token) {
      replyError(conn, requestId, "seed daemon: tunnel connect requires a tunnelToken string");
      return;
    }
    const allowPort = parseTunnelAllowPorts(payload.allowPorts);
    if (typeof allowPort === "string") {
      replyError(conn, requestId, `seed daemon: ${allowPort}`);
      return;
    }
    const timeoutMs = Number.isFinite(payload.timeoutMs)
      ? Math.max(1, Number(payload.timeoutMs))
      : 10_000;

    tunnelStart(connectUrl, token, allowPort);

    const send = (): void => {
      reply(conn, "tunnel_result", requestId, tunnelSnapshot());
    };
    if (tunnelStatus.state === "connected") {
      send();
      return;
    }
    const timer = setTimeout(() => {
      tunnelStateWaiters.delete(onChange);
      send();
    }, timeoutMs);
    const onChange = (): void => {
      // Reply as soon as connected, or once the attempt has terminally failed
      // (unauthorized / unsupported runtime / invalid url — no retry pending).
      const terminal =
        tunnelStatus.state === "connected" ||
        (tunnelStatus.state === "disconnected" && tunnelClosed) ||
        tunnelStatus.lastError === "unauthorized" ||
        tunnelStatus.lastError === "tunnel requires Node >= 22" ||
        (tunnelStatus.lastError ?? "").startsWith("invalid tunnel url");
      if (!terminal) return;
      clearTimeout(timer);
      tunnelStateWaiters.delete(onChange);
      send();
    };
    tunnelStateWaiters.add(onChange);
    conn.once("close", () => {
      clearTimeout(timer);
      tunnelStateWaiters.delete(onChange);
    });
    return;
  }

  replyError(conn, requestId, "seed daemon: tunnel message requires connect, status or disconnect");
}

function createSseServer(): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url ?? "/", `http://${config.sseHost}`);
    if (requestUrl.pathname !== "/events") {
      res.writeHead(404);
      res.end("not found");
      return;
    }

    const token = requestUrl.searchParams.get("token") ?? "";
    if (token !== config.token) {
      res.writeHead(401);
      res.end("unauthorized");
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    sseClients.add(res);
    req.on("close", () => {
      sseClients.delete(res);
    });
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    let fallbackAttempted = false;

    const finishResolve = (value: { server: http.Server; port: number }): void => {
      if (settled) return;
      settled = true;
      server.off("error", onError);
      resolve(value);
    };

    const finishReject = (err: Error): void => {
      if (settled) return;
      settled = true;
      server.off("error", onError);
      reject(err);
    };

    const listenAndResolve = (port: number): void => {
      server.listen(port, config.sseHost, () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          finishReject(new Error("seed daemon: failed to determine SSE port"));
          return;
        }
        finishResolve({ server, port: addr.port });
      });
    };

    const onError = (err: NodeJS.ErrnoException): void => {
      const shouldFallback =
        !fallbackAttempted &&
        err.code === "EADDRINUSE" &&
        config.ssePort > 0 &&
        config.sseStrictPort !== true;
      if (shouldFallback) {
        fallbackAttempted = true;
        try {
          server.close(() => {
            listenAndResolve(0);
          });
        } catch {
          listenAndResolve(0);
        }
        return;
      }
      finishReject(err);
    };

    server.on("error", onError);

    listenAndResolve(config.ssePort);
  });
}

async function main(): Promise<void> {
  fs.mkdirSync(path.dirname(config.socket), { recursive: true });
  fs.mkdirSync(path.dirname(config.stateFile), { recursive: true });
  removeSocket();

  const sse = await createSseServer();
  persistState(sse.port);

  const server = net.createServer((conn) => {
    let buffer = "";
    conn.on("data", (chunk: Buffer | string) => {
      buffer += String(chunk);
      let idx = -1;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line.trim()) continue;

        let msg: WireMessage;
        try {
          msg = JSON.parse(line) as WireMessage;
        } catch {
          continue;
        }

        const id = msg.id || makeId();

        if (msg.type === "health") {
          if (msg.token && !isAuthed(msg)) {
            writeLine(conn, {
              id: makeId(),
              type: "error",
              replyTo: id,
              ts: now(),
              payload: { message: "unauthorized" },
            });
            continue;
          }

          writeLine(conn, {
            id: makeId(),
            type: "health",
            replyTo: id,
            ts: now(),
            payload: {
              state: "running",
              version: config.version,
              pid: process.pid,
              uptime: now() - startedAt,
              sseUrl: `http://${config.sseHost}:${String(sse.port)}/events?token=${config.token}`,
            },
          });
          continue;
        }

        if (!isAuthed(msg)) {
          writeLine(conn, {
            id: makeId(),
            type: "error",
            replyTo: id,
            ts: now(),
            payload: { message: "unauthorized" },
          });
          continue;
        }

        if (msg.type === "subscribe") {
          subscribers.add({ conn, filter: msg.payload as Subscriber["filter"] });
          writeLine(conn, {
            id: makeId(),
            type: "subscribed",
            replyTo: id,
            ts: now(),
            payload: { ok: true },
          });
          continue;
        }

        if (msg.type === "unsubscribe") {
          for (const subscriber of subscribers) {
            if (subscriber.conn === conn) subscribers.delete(subscriber);
          }
          writeLine(conn, {
            id: makeId(),
            type: "unsubscribed",
            replyTo: id,
            ts: now(),
            payload: { ok: true },
          });
          continue;
        }

        if (msg.type === "exec") {
          handleExec({ ...msg, id }, conn);
          continue;
        }

        if (msg.type === "wait") {
          handleWait({ ...msg, id }, conn);
          continue;
        }

        if (msg.type === "status") {
          handleStatus({ ...msg, id }, conn);
          continue;
        }

        if (msg.type === "kill") {
          handleKill({ ...msg, id }, conn);
          continue;
        }

        if (msg.type === "tunnel") {
          handleTunnel({ ...msg, id }, conn);
          continue;
        }

        if (msg.type === "stop") {
          writeLine(conn, {
            id: makeId(),
            type: "stopped",
            replyTo: id,
            ts: now(),
            payload: { ok: true },
          });
          setTimeout(() => {
            tunnelTeardown();
            try {
              server.close();
              sse.server.close();
            } catch {}
            removeSocket();
            process.exit(0);
          }, 10);
          continue;
        }

        replyError(conn, id, `seed daemon: unknown message type ${String(msg.type)}`);
      }
    });

    conn.on("close", () => {
      for (const subscriber of subscribers) {
        if (subscriber.conn === conn) subscribers.delete(subscriber);
      }
    });
  });

  server.listen(config.socket);

  process.on("SIGTERM", () => {
    tunnelTeardown();
    try {
      server.close();
      sse.server.close();
    } catch {}
    removeSocket();
    process.exit(0);
  });
}

void main().catch((err: unknown) => {
  process.stderr.write(`${String((err as Error)?.stack ?? err)}\n`);
  process.exit(1);
});
