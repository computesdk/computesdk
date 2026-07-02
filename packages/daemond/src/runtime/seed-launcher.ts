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

/** In-memory record for a background job. */
interface JobEntry {
  pid: number | null;
  running: boolean;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
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

/** Maximum bytes retained per stream in the background job ring buffer. */
const MAX_JOB_OUTPUT_BYTES = 256 * 1024;

/** Registry of all background jobs started by this daemon instance. */
const jobRegistry = new Map<string, JobEntry>();

/** Trim a string to at most `maxBytes` characters, keeping the tail. */
function trimToMaxBytes(str: string, maxBytes: number): string {
  if (str.length <= maxBytes) return str;
  return str.slice(str.length - maxBytes);
}

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

function handleExec(msg: WireMessage, conn: net.Socket): void {
  const payload = msg.payload ?? {};
  const requestId = msg.id || makeId();
  const command = String(payload.command ?? "").trim();
  const args = Array.isArray(payload.args) ? payload.args.map((value) => String(value)) : [];
  const cwd = typeof payload.cwd === "string" && payload.cwd.length > 0 ? payload.cwd : process.cwd();
  const shell = payload.shell === true;
  const isBackground = payload.background === true;
  const timeoutMs = Number.isFinite(payload.timeoutMs) ? Math.max(1, Number(payload.timeoutMs)) : 60_000;
  const extraEnv = sanitizeEnvInput(payload.env);

  if (!command) {
    writeLine(conn, {
      id: makeId(),
      type: "exec_result",
      replyTo: requestId,
      ts: now(),
      payload: {
        exitCode: 1,
        signal: null,
        stdout: "",
        stderr: "seed daemon: command is required",
        combined: "seed daemon: command is required\n",
      },
    });
    return;
  }

  publish({
    channel: "daemon",
    type: "command.started",
    requestId,
    command,
    args,
    background: isBackground,
    ts: now(),
  });

  // ─── Background mode ─────────────────────────────────────────────────────
  // Spawn the child detached so it can outlive the connection (and the daemon
  // itself if needed). Output is captured into a ring buffer that callers can
  // read with the `job_read` message type.
  if (isBackground) {
    const child = spawn(command, args, {
      cwd,
      shell,
      env: {
        ...process.env,
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    child.unref();

    const entry: JobEntry = {
      pid: child.pid ?? null,
      running: true,
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
    };
    jobRegistry.set(requestId, entry);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const text = String(chunk);
      entry.stdout = trimToMaxBytes(entry.stdout + text, MAX_JOB_OUTPUT_BYTES);
      publish({ channel: "daemon", type: "command.stdout", requestId, chunk: text, ts: now() });
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      const text = String(chunk);
      entry.stderr = trimToMaxBytes(entry.stderr + text, MAX_JOB_OUTPUT_BYTES);
      publish({ channel: "daemon", type: "command.stderr", requestId, chunk: text, ts: now() });
    });

    child.once("error", (err: Error) => {
      const text = String(err);
      entry.stderr = trimToMaxBytes(entry.stderr + text, MAX_JOB_OUTPUT_BYTES);
      entry.running = false;
      entry.exitCode = 1;
      entry.signal = null;
      publish({ channel: "daemon", type: "command.exit", requestId, exitCode: 1, signal: null, ts: now() });
    });

    child.once("close", (exitCode: number | null, signal: NodeJS.Signals | null) => {
      entry.running = false;
      entry.exitCode = exitCode;
      entry.signal = signal;
      publish({ channel: "daemon", type: "command.exit", requestId, exitCode, signal, ts: now() });
    });

    // Respond immediately — the job runs independently in the background.
    writeLine(conn, {
      id: makeId(),
      type: "exec_result",
      replyTo: requestId,
      ts: now(),
      payload: {
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: "",
        combined: "",
        jobId: requestId,
      },
    });
    return;
  }

  // ─── Foreground mode ─────────────────────────────────────────────────────
  const child = spawn(command, args, {
    cwd,
    shell,
    env: {
      ...process.env,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let combined = "";
  let finished = false;
  let timedOut = false;
  let killTimer: NodeJS.Timeout | null = null;

  const timer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGTERM");
    } catch {}

    killTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
    }, 1_500);
  }, timeoutMs);

  child.stdout.on("data", (chunk: Buffer | string) => {
    const text = String(chunk);
    stdout += text;
    combined += text;
    publish({ channel: "daemon", type: "command.stdout", requestId, chunk: text, ts: now() });
  });

  child.stderr.on("data", (chunk: Buffer | string) => {
    const text = String(chunk);
    stderr += text;
    combined += text;
    publish({ channel: "daemon", type: "command.stderr", requestId, chunk: text, ts: now() });
  });

  const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (killTimer) {
      clearTimeout(killTimer);
      killTimer = null;
    }

    if (timedOut) {
      stderr += stderr.endsWith("\n") || stderr.length === 0 ? "seed daemon: command timed out\n" : "\nseed daemon: command timed out\n";
      combined += combined.endsWith("\n") || combined.length === 0 ? "seed daemon: command timed out\n" : "\nseed daemon: command timed out\n";
    }

    publish({
      channel: "daemon",
      type: "command.exit",
      requestId,
      exitCode,
      signal,
      ts: now(),
    });

    writeLine(conn, {
      id: makeId(),
      type: "exec_result",
      replyTo: requestId,
      ts: now(),
      payload: {
        exitCode,
        signal,
        stdout,
        stderr,
        combined,
      },
    });
  };

  child.once("error", (err: Error) => {
    stderr += String(err);
    combined += String(err);
    finish(1, null);
  });

  child.once("close", (exitCode, signal) => {
    finish(exitCode, signal);
  });
}

/**
 * Handle a `job_read` message — return the current ring-buffer contents and
 * status for the given background job.
 */
function handleJobRead(msg: WireMessage, conn: net.Socket): void {
  const replyId = msg.id || makeId();
  const jobId = String(msg.payload?.jobId ?? "");

  if (!jobId) {
    writeLine(conn, {
      id: makeId(),
      type: "error",
      replyTo: replyId,
      ts: now(),
      payload: { message: "job_read: jobId is required" },
    });
    return;
  }

  const entry = jobRegistry.get(jobId);
  if (!entry) {
    writeLine(conn, {
      id: makeId(),
      type: "error",
      replyTo: replyId,
      ts: now(),
      payload: { message: `job_read: job not found: ${jobId}` },
    });
    return;
  }

  writeLine(conn, {
    id: makeId(),
    type: "job_status",
    replyTo: replyId,
    ts: now(),
    payload: {
      jobId,
      pid: entry.pid,
      running: entry.running,
      exitCode: entry.exitCode,
      signal: entry.signal,
      stdout: entry.stdout,
      stderr: entry.stderr,
    },
  });
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

        if (msg.type === "job_read") {
          handleJobRead({ ...msg, id }, conn);
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
            try {
              server.close();
              sse.server.close();
            } catch {}
            removeSocket();
            process.exit(0);
          }, 10);
          continue;
        }
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
