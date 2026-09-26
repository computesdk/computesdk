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
  maxJobOutputBytes?: number;
  jobRetentionMs?: number;
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

const DEFAULT_MAX_JOB_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_JOB_RETENTION_MS = 10 * 60 * 1000;

const maxJobOutputBytes =
  Number.isFinite(config.maxJobOutputBytes) && Number(config.maxJobOutputBytes) > 0
    ? Number(config.maxJobOutputBytes)
    : DEFAULT_MAX_JOB_OUTPUT_BYTES;
const jobRetentionMs =
  Number.isFinite(config.jobRetentionMs) && Number(config.jobRetentionMs) > 0
    ? Number(config.jobRetentionMs)
    : DEFAULT_JOB_RETENTION_MS;

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
  stdin: import("node:stream").Writable | null;
  stdinOpen: boolean;
  bounded: boolean;
  truncated: boolean;
  kill(signal: string): void;
  onExit: Set<() => void>;
}

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
    truncated: job.truncated,
  };
}

function reply(conn: net.Socket, type: string, replyTo: string, payload: Record<string, unknown>): void {
  writeLine(conn, { id: makeId(), type, replyTo, ts: now(), payload });
}

function replyError(conn: net.Socket, replyTo: string, message: string): void {
  reply(conn, "error", replyTo, { message });
}

function appendOutput(job: Job, field: "stdout" | "stderr" | "combined", text: string): void {
  let next = job[field] + text;
  // Detached jobs buffer output for later status/wait reads, so the buffers
  // are bounded — keep the tail once a stream outgrows the cap. Attached
  // execs are replied to on exit and never stored, so they stay unbounded.
  if (job.bounded && Buffer.byteLength(next, "utf8") > maxJobOutputBytes) {
    const buf = Buffer.from(next, "utf8");
    next = buf.subarray(buf.length - maxJobOutputBytes).toString("utf8");
    job.truncated = true;
  }
  job[field] = next;
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
  const useStdin = payload.stdin === true;

  if (!command) return "seed daemon: command is required";

  const jobId = makeId();

  publish({
    channel: "daemon",
    type: "command.started",
    requestId,
    jobId,
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
    stdio: useStdin ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    // Own process group, so a kill reaches the whole tree: a `sh -c` wrapper
    // dying alone would leave its children holding the output pipes open and
    // the job "running" until they exit on their own.
    detached: true,
  });

  const job: Job = {
    id: jobId,
    requestId,
    pid: child.pid ?? null,
    status: "running",
    exitCode: null,
    signal: null,
    stdout: "",
    stderr: "",
    combined: "",
    stdin: useStdin ? child.stdin : null,
    stdinOpen: useStdin,
    bounded: detach,
    truncated: false,
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

  if (job.stdin) {
    let stdinClosePublished = false;
    const onStdinClosed = (): void => {
      if (stdinClosePublished) return;
      stdinClosePublished = true;
      job.stdinOpen = false;
      publish({
        channel: "daemon",
        type: "command.stdin.closed",
        requestId,
        jobId: job.id,
        ts: now(),
      });
    };
    job.stdin.once("close", onStdinClosed);
    job.stdin.once("finish", onStdinClosed);
  }

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

  child.stdout!.on("data", (chunk: Buffer | string) => {
    const text = String(chunk);
    appendOutput(job, "stdout", text);
    appendOutput(job, "combined", text);
    publish({ channel: "daemon", type: "command.stdout", requestId, jobId: job.id, chunk: text, ts: now() });
  });

  child.stderr!.on("data", (chunk: Buffer | string) => {
    const text = String(chunk);
    appendOutput(job, "stderr", text);
    appendOutput(job, "combined", text);
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
      appendOutput(job, "stderr", job.stderr.endsWith("\n") || job.stderr.length === 0 ? note : `\n${note}`);
      appendOutput(job, "combined", job.combined.endsWith("\n") || job.combined.length === 0 ? note : `\n${note}`);
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

    const retention = setTimeout(() => jobs.delete(job.id), jobRetentionMs);
    retention.unref();
  };

  child.once("error", (err: Error) => {
    appendOutput(job, "stderr", String(err));
    appendOutput(job, "combined", String(err));
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
  if (msg.payload?.stdin === true && msg.payload?.detach !== true) {
    replyError(conn, requestId, "seed daemon: stdin requires detach: true");
    return;
  }
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

function resolveStdinJob(
  msg: WireMessage,
  conn: net.Socket,
): { job: Job; requestId: string } | null {
  const requestId = msg.id || makeId();
  const jobId = String(msg.payload?.jobId ?? "");
  const job = jobs.get(jobId);
  if (!job) {
    replyError(conn, requestId, `seed daemon: unknown job ${jobId}`);
    return null;
  }
  if (job.status === "exited") {
    replyError(conn, requestId, `seed daemon: job ${jobId} has exited`);
    return null;
  }
  if (!job.stdin) {
    replyError(conn, requestId, `seed daemon: job ${jobId} was not started with stdin`);
    return null;
  }
  return { job, requestId };
}

function handleStdin(msg: WireMessage, conn: net.Socket): void {
  const resolved = resolveStdinJob(msg, conn);
  if (!resolved) return;
  const { job, requestId } = resolved;
  if (!job.stdinOpen || !job.stdin) {
    replyError(conn, requestId, `seed daemon: stdin of job ${job.id} is closed`);
    return;
  }

  const encoding = msg.payload?.encoding === "base64" ? "base64" : "utf8";
  const data = Buffer.from(String(msg.payload?.data ?? ""), encoding);
  // Reply only from the write callback so a flooded pipe applies backpressure
  // to the requester instead of buffering unboundedly in the daemon.
  job.stdin.write(data, (err) => {
    if (err) {
      replyError(conn, requestId, `seed daemon: stdin write failed: ${err.message}`);
      return;
    }
    reply(conn, "exec_result", requestId, jobSnapshot(job));
  });
}

function handleCloseStdin(msg: WireMessage, conn: net.Socket): void {
  const resolved = resolveStdinJob(msg, conn);
  if (!resolved) return;
  const { job, requestId } = resolved;
  if (job.stdinOpen && job.stdin) {
    job.stdin.end();
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

        if (msg.type === "stdin") {
          handleStdin({ ...msg, id }, conn);
          continue;
        }

        if (msg.type === "closeStdin") {
          handleCloseStdin({ ...msg, id }, conn);
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
