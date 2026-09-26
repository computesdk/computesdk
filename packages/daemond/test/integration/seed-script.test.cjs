const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { daemonSeedScript } = require("../../dist/index.js");
const { WebSocketServer } = require("ws");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectSocket(socketPath, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    try {
      const conn = await new Promise((resolve, reject) => {
        const socket = net.createConnection(socketPath);
        socket.once("connect", () => resolve(socket));
        socket.once("error", reject);
      });
      return conn;
    } catch {
      await sleep(50);
    }
  }
  throw new Error(`Timed out connecting to socket: ${socketPath}`);
}

async function waitForSocketRemoved(socketPath, timeoutMs, message) {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    if (!fs.existsSync(socketPath)) return;
    await sleep(50);
  }
  throw new Error(message);
}

const SCRIPT_VERSION = "3";

function defaultSocketPath(name, cwd) {
  const workspaceHash = crypto.createHash("sha256").update(cwd).digest("hex").slice(0, 16);
  const daemonHash = crypto
    .createHash("sha256")
    .update(`${name}:${workspaceHash}`)
    .digest("hex")
    .slice(0, 16);
  return path.join(os.tmpdir(), ".computesdk", "seed-sockets", `${daemonHash}.sock`);
}

function parseJsonLines(raw) {
  const lines = raw
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    throw new Error("seed launcher returned no stdout");
  }
  return lines.map((line) => JSON.parse(line));
}

async function runSeedLauncher(script, args, options = {}) {
  const { spawn } = require("node:child_process");
  const child = spawn(process.execPath, ["-e", script, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: options.cwd,
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });

  if (exitCode !== 0) {
    throw new Error(`seed launcher failed [exit=${String(exitCode)}]\n${stderr || "<empty stderr>"}`);
  }

  const parsed = parseJsonLines(stdout);
  return parsed[parsed.length - 1];
}

async function reserveTcpPort() {
  const server = http.createServer((_req, res) => {
    res.writeHead(200);
    res.end("ok");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    server.close();
    throw new Error("failed to reserve tcp port");
  }

  return { server, port: addr.port };
}

async function stopDaemon(name, token, cwd = process.cwd()) {
  const socketPath = defaultSocketPath(name, cwd);
  const conn = await connectSocket(socketPath, 3000);
  try {
    const messages = readMessages(conn);
    conn.write(`${JSON.stringify({ id: "stop-test", type: "stop", token })}\n`);
    const stopped = await messages.next(3000);
    assert.equal(stopped.type, "stopped");
  } finally {
    if (!conn.destroyed) conn.destroy();
  }
  await waitForSocketRemoved(socketPath, 5000, "seed daemon did not stop");
}

function readMessages(conn) {
  let buf = "";
  const queue = [];
  const waiters = [];

  conn.on("data", (data) => {
    buf += data.toString("utf8");
    let idx = -1;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      const waiter = waiters.shift();
      if (waiter) waiter(msg);
      else queue.push(msg);
    }
  });

  return {
    next(timeoutMs = 3000) {
      if (queue.length > 0) return Promise.resolve(queue.shift());

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const i = waiters.indexOf(onMessage);
          if (i !== -1) waiters.splice(i, 1);
          reject(new Error("Timed out waiting for message"));
        }, timeoutMs);

        const onMessage = (msg) => {
          clearTimeout(timer);
          resolve(msg);
        };

        waiters.push(onMessage);
      });
    },
    async nextMatching(predicate, timeoutMs = 3000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const remaining = Math.max(1, deadline - Date.now());
        const msg = await this.next(remaining);
        if (predicate(msg)) return msg;
      }
      throw new Error("Timed out waiting for matching message");
    },
  };
}

test("seed launcher script executes command and reuses daemon token", async () => {
  const name = `seed-script-it-${process.pid}`;
  const script = daemonSeedScript({ name });

  const first = await runSeedLauncher(script, ["pwd"]);
  try {
    const second = await runSeedLauncher(script, [JSON.stringify({ command: "pwd" })]);

    assert.equal(typeof first.token, "string");
    assert.equal(first.token.length > 0, true);
    assert.equal(second.token, first.token);
    assert.equal(second.daemon.reused, true);
    assert.match(first.daemon.sseUrl, /^http:\/\/127\.0\.0\.1:\d+\/events\?token=/);
    assert.equal(first.command.exitCode, 0);
    assert.match(first.command.stdout, new RegExp(process.cwd().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const mixed = await runSeedLauncher(script, [
      JSON.stringify({
        command: process.execPath,
        args: ["-e", "process.stdout.write('alpha\\n');process.stderr.write('beta\\n')"],
      }),
    ]);

    assert.equal(mixed.command.exitCode, 0);
    assert.match(mixed.command.stdout, /alpha/);
    assert.match(mixed.command.stderr, /beta/);
    assert.match(mixed.command.combined, /alpha/);
    assert.match(mixed.command.combined, /beta/);
  } finally {
    await stopDaemon(name, first.token);
  }
});

test("seed launcher runs detached jobs concurrently and reports honest exit status", async () => {
  const name = `seed-script-detach-${process.pid}`;
  const script = daemonSeedScript({ name });

  const a = await runSeedLauncher(script, [
    JSON.stringify({ command: "sh", args: ["-c", "sleep 0.5; echo A; exit 3"], detach: true }),
  ]);
  try {
    const b = await runSeedLauncher(script, [
      JSON.stringify({ command: "sh", args: ["-c", "sleep 0.5; echo B"], detach: true }),
    ]);
    assert.equal(a.command.status, "running");
    assert.equal(a.command.exitCode, null);
    assert.equal(typeof a.command.jobId, "string");
    assert.notEqual(a.command.jobId, b.command.jobId);

    const snapshot = await runSeedLauncher(script, [JSON.stringify({ status: a.command.jobId })]);
    assert.equal(snapshot.command.jobId, a.command.jobId);
    assert.ok(["running", "exited"].includes(snapshot.command.status));

    const waitedA = await runSeedLauncher(script, [JSON.stringify({ wait: a.command.jobId })]);
    const waitedB = await runSeedLauncher(script, [JSON.stringify({ wait: b.command.jobId })]);
    assert.equal(waitedA.command.status, "exited");
    assert.equal(waitedA.command.exitCode, 3);
    assert.equal(waitedA.command.stdout, "A\n");
    assert.equal(waitedB.command.exitCode, 0);
    assert.equal(waitedB.command.stdout, "B\n");

    // A bounded wait on a live job returns a running snapshot with partial output.
    const c = await runSeedLauncher(script, [
      JSON.stringify({ command: "sh", args: ["-c", "echo partial; sleep 30"], detach: true }),
    ]);
    const partial = await runSeedLauncher(script, [JSON.stringify({ wait: c.command.jobId, timeoutMs: 1000 })]);
    assert.equal(partial.command.status, "running");
    assert.equal(partial.command.exitCode, null);
    assert.equal(partial.command.stdout, "partial\n");

    // Kill reaches the whole process group, so the `sleep` child dies with its shell.
    await runSeedLauncher(script, [JSON.stringify({ kill: c.command.jobId })]);
    const killed = await runSeedLauncher(script, [JSON.stringify({ wait: c.command.jobId, timeoutMs: 3000 })]);
    assert.equal(killed.command.status, "exited");
    assert.equal(killed.command.exitCode, null);
    assert.equal(killed.command.signal, "SIGTERM");

    await assert.rejects(
      runSeedLauncher(script, [JSON.stringify({ wait: "no-such-job" })]),
      /unknown job no-such-job/,
    );

    // base64-prefixed payloads decode launcher-side.
    const encoded = Buffer.from(JSON.stringify({ command: "printf", args: ["%s|", "a b", '"c"', "$X"] })).toString("base64");
    const decoded = await runSeedLauncher(script, [`b64:${encoded}`]);
    assert.equal(decoded.command.stdout, 'a b|"c"|$X|');

    // Attached execs are not retained: their result was already delivered.
    const attached = await runSeedLauncher(script, [JSON.stringify({ command: "sh", args: ["-c", "echo done"] })]);
    assert.equal(attached.command.stdout, "done\n");
    assert.ok(attached.command.jobId);
    await assert.rejects(
      runSeedLauncher(script, [JSON.stringify({ status: attached.command.jobId })]),
      /unknown job/,
    );

    // A background grandchild that outlives its shell is still reachable via kill.
    const d = await runSeedLauncher(script, [
      JSON.stringify({ command: "sh", args: ["-c", "sleep 30 >/dev/null 2>&1 & echo $!"], detach: true }),
    ]);
    const exited = await runSeedLauncher(script, [JSON.stringify({ wait: d.command.jobId, timeoutMs: 5000 })]);
    assert.equal(exited.command.status, "exited");
    const orphanPid = Number(exited.command.stdout.trim());
    assert.ok(Number.isInteger(orphanPid) && orphanPid > 0, `unexpected stdout ${exited.command.stdout}`);
    assert.doesNotThrow(() => process.kill(orphanPid, 0), "orphan should still be alive before kill");
    await runSeedLauncher(script, [JSON.stringify({ kill: d.command.jobId, signal: "SIGKILL" })]);
    const deadline = Date.now() + 3000;
    let orphanAlive = true;
    while (orphanAlive && Date.now() < deadline) {
      try { process.kill(orphanPid, 0); await new Promise((r) => setTimeout(r, 100)); } catch { orphanAlive = false; }
    }
    assert.equal(orphanAlive, false, "kill should reach the background grandchild");
  } finally {
    await stopDaemon(name, a.token);
  }
});

test("seed daemon socket auth, subscribe, and stop", async () => {
  const name = `seed-script-auth-${process.pid}`;
  const script = daemonSeedScript({ name });
  const launched = await runSeedLauncher(script, ["pwd"]);
  const socketPath = defaultSocketPath(name, process.cwd());
  const token = launched.token;

  let conn = null;
  try {
    conn = await connectSocket(socketPath, 3000);
    const messages = readMessages(conn);

    conn.write(`${JSON.stringify({ id: "sub-unauth", type: "subscribe", payload: {} })}\n`);
    const unauthorized = await messages.next(3000);
    assert.equal(unauthorized.type, "error");
    assert.equal(unauthorized.replyTo, "sub-unauth");
    assert.equal(unauthorized.payload.message, "unauthorized");

    conn.write(
      `${JSON.stringify({
        id: "sub-auth",
        type: "subscribe",
        token,
        payload: { channel: "daemon", type: "command.exit" },
      })}\n`,
    );
    const subscribed = await messages.next(3000);
    assert.equal(subscribed.type, "subscribed");
    assert.equal(subscribed.replyTo, "sub-auth");

    conn.write(`${JSON.stringify({ id: "health-1", type: "health", token })}\n`);
    const health = await messages.next(3000);
    assert.equal(health.type, "health");
    assert.equal(health.payload.state, "running");
    assert.equal(health.payload.version, SCRIPT_VERSION);

    conn.write(
      `${JSON.stringify({
        id: "exec-1",
        type: "exec",
        token,
        payload: { command: process.execPath, args: ["-e", "process.stdout.write('ok')"] },
      })}\n`,
    );

    const event = await messages.nextMatching(
      (msg) =>
        msg.type === "event" &&
        msg.payload &&
        msg.payload.type === "command.exit" &&
        msg.payload.requestId === "exec-1",
      5000,
    );
    assert.equal(event.payload.channel, "daemon");

    const execResult = await messages.nextMatching(
      (msg) => msg.type === "exec_result" && msg.replyTo === "exec-1",
      5000,
    );
    assert.equal(execResult.payload.exitCode, 0);
    assert.match(execResult.payload.stdout, /ok/);

    conn.write(`${JSON.stringify({ id: "stop-1", type: "stop", token })}\n`);
    const stopped = await messages.next(3000);
    assert.equal(stopped.type, "stopped");
    assert.equal(stopped.replyTo, "stop-1");
  } finally {
    if (conn && !conn.destroyed) conn.destroy();
  }

  await waitForSocketRemoved(socketPath, 5000, "seed daemon did not stop");
});

test("seed launcher uses configured SSE port", async () => {
  const reserved = await reserveTcpPort();
  const targetPort = reserved.port;
  await new Promise((resolve, reject) => {
    reserved.server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const name = `seed-script-sse-port-${process.pid}`;
  const script = daemonSeedScript({ name, ssePort: targetPort });
  const launched = await runSeedLauncher(script, ["pwd"]);
  try {
    const actualPort = Number(new URL(launched.daemon.sseUrl).port);
    assert.equal(actualPort, targetPort);
  } finally {
    await stopDaemon(name, launched.token);
  }
});

test("seed launcher replaces a daemon speaking an older protocol on the same socket and port", async () => {
  const reserved = await reserveTcpPort();
  const targetPort = reserved.port;
  await new Promise((resolve, reject) => {
    reserved.server.close((err) => (err ? reject(err) : resolve()));
  });

  const name = `seed-script-upgrade-${process.pid}`;
  const script = daemonSeedScript({ name, ssePort: targetPort, sseStrictPort: true });
  // Simulate the previous release: same socket, same strict port, older protocol.
  const oldScript = script.replace(`const VERSION='${SCRIPT_VERSION}'`, "const VERSION='0'");
  assert.notEqual(oldScript, script);

  const old = await runSeedLauncher(oldScript, ["pwd"]);
  try {
    assert.equal(old.daemon.reused, false);
    const upgraded = await runSeedLauncher(script, ["pwd"]);
    assert.equal(upgraded.daemon.reused, false);
    assert.notEqual(upgraded.daemon.pid, old.daemon.pid);
    assert.equal(Number(new URL(upgraded.daemon.sseUrl).port), targetPort);
    assert.equal(upgraded.token, old.token);

    const again = await runSeedLauncher(script, ["pwd"]);
    assert.equal(again.daemon.reused, true);
    assert.equal(again.daemon.pid, upgraded.daemon.pid);
  } finally {
    await stopDaemon(name, old.token);
  }
});

test("seed launcher falls back when configured SSE port is busy", async () => {
  const blocker = await reserveTcpPort();

  try {
    const name = `seed-script-sse-fallback-${process.pid}`;
    const script = daemonSeedScript({ name, ssePort: blocker.port });
    const launched = await runSeedLauncher(script, ["pwd"]);
    try {
      const actualPort = Number(new URL(launched.daemon.sseUrl).port);
      assert.notEqual(actualPort, blocker.port);
    } finally {
      await stopDaemon(name, launched.token);
    }
  } finally {
    await new Promise((resolve, reject) => {
      blocker.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
});

test("seed launcher fails when strict SSE port is busy", async () => {
  const blocker = await reserveTcpPort();

  try {
    const name = `seed-script-sse-strict-${process.pid}`;
    const script = daemonSeedScript({ name, ssePort: blocker.port, sseStrictPort: true });
    await assert.rejects(
      runSeedLauncher(script, ["pwd"]),
      /seed launcher could not reach daemon health \(ssePort=.*sseStrictPort=true\)/,
    );
  } finally {
    await new Promise((resolve, reject) => {
      blocker.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
});

// ---- tunnel client tests ----

function startTunnelControlPlane() {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0, path: "/tunnel" });
  const conns = [];
  wss.on("connection", (ws, req) => {
    const entry = {
      ws,
      url: req.url,
      frames: [],
      cursor: 0,
      closeCode: null,
      waiters: [],
    };
    ws.binaryType = "nodebuffer";
    ws.on("message", (data, isBinary) => {
      const frame = { data, isBinary };
      entry.frames.push(frame);
      for (const w of entry.waiters.splice(0)) w(frame);
    });
    ws.on("close", (code) => {
      entry.closeCode = code;
    });
    conns.push(entry);
    for (const w of entry.newConnWaiters?.splice(0) ?? []) w(entry);
  });
  const state = {
    wss,
    conns,
    newConnWaiters: [],
  };
  wss.on("connection", () => {
    for (const w of state.newConnWaiters.splice(0)) w(conns[conns.length - 1]);
  });
  return new Promise((resolve) => {
    wss.on("listening", () => {
      state.url = `ws://127.0.0.1:${wss.address().port}/tunnel`;
      resolve(state);
    });
  });
}

function waitForTunnelConn(server, index, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  return (async () => {
    while (Date.now() < deadline) {
      if (server.conns[index]) return server.conns[index];
      await sleep(25);
    }
    throw new Error(`no tunnel connection #${index}`);
  })();
}

function nextFrame(connEntry, predicate, timeoutMs = 5000) {
  // Consume-style scan: frames before the match are dropped so callers can
  // poll a stream of frames without re-reading the same one.
  for (let i = connEntry.cursor; i < connEntry.frames.length; i++) {
    connEntry.cursor = i + 1;
    if (predicate(connEntry.frames[i])) return Promise.resolve(connEntry.frames[i]);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for tunnel frame")), timeoutMs);
    const waiter = (frame) => {
      if (predicate(frame)) {
        clearTimeout(timer);
        resolve(frame);
      } else {
        connEntry.waiters.push(waiter);
      }
    };
    connEntry.waiters.push(waiter);
  });
}

function encodeTunnelData(id, buf) {
  const out = Buffer.alloc(4 + buf.length);
  out.writeUInt32BE(id >>> 0, 0);
  buf.copy(out, 4);
  return out;
}

function startTunnelApp() {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })),
  );
}

async function subscribeDaemonEvents(socketPath, token) {
  const conn = await connectSocket(socketPath, 3000);
  conn.write(`${JSON.stringify({ id: "sub-tunnel", type: "subscribe", token, payload: { channel: "daemon" } })}\n`);
  const events = [];
  let buf = "";
  conn.on("data", (data) => {
    buf += data.toString("utf8");
    let idx = -1;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === "event") events.push(msg.payload);
      } catch {}
    }
  });
  await sleep(150); // let the subscribe land
  return { conn, events };
}

async function waitForEvent(events, type, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ev = events.find((e) => e && e.type === type);
    if (ev) return ev;
    await sleep(50);
  }
  throw new Error(`no ${type} event within ${timeoutMs}ms`);
}

function closeServer(server) {
  return new Promise((resolve) => {
    for (const c of server.conns ?? []) c.ws.terminate();
    if (server.wss) server.wss.close(() => resolve());
    else server.close(() => resolve());
  });
}

test("tunnel connect: launcher reports connected, control plane sees token auth and tunnel.connected event", async () => {
  const name = `seed-tunnel-connect-${process.pid}`;
  const cp = await startTunnelControlPlane();
  const script = daemonSeedScript({ name });
  const tunnelToken = "tt-secret-token";

  // Boot the daemon with a trivial exec so we can subscribe for events before
  // the tunnel connects (the connected event fires only once).
  const boot = await runSeedLauncher(script, ["pwd"]);
  const sub = await subscribeDaemonEvents(defaultSocketPath(name, process.cwd()), boot.token);

  const result = await runSeedLauncher(script, [
    JSON.stringify({ tunnel: { connect: cp.url, tunnelToken, timeoutMs: 8000 } }),
  ]);
  try {
    assert.equal(result.tunnel.state, "connected");
    assert.equal(result.tunnel.url, cp.url);
    assert.equal(typeof result.tunnel.connectedAt, "number");
    assert.equal(result.command.exitCode, 0);
    assert.equal(result.command.stdout, "");

    const conn = await waitForTunnelConn(cp, 0);
    const url = new URL(conn.url, "http://x");
    assert.equal(url.searchParams.get("token"), tunnelToken);
    const auth = await nextFrame(conn, (f) => !f.isBinary && JSON.parse(f.data.toString()).t === "auth");
    assert.equal(JSON.parse(auth.data.toString()).token, tunnelToken);
    // The tunnel token must not leak into status or events.
    assert.ok(!JSON.stringify(result.tunnel).includes(tunnelToken));

    const ev = await waitForEvent(sub.events, "tunnel.connected", 3000);
    assert.equal(ev.url, cp.url);
    assert.ok(!JSON.stringify(ev).includes(tunnelToken));

    // Same URL + same token is a strict no-op: no replacement, no new attempt.
    const again = await runSeedLauncher(script, [
      JSON.stringify({ tunnel: { connect: cp.url, tunnelToken, timeoutMs: 8000 } }),
    ]);
    assert.equal(again.tunnel.state, "connected");
    assert.equal(again.tunnel.connectedAt, result.tunnel.connectedAt);
    assert.equal(again.tunnel.reconnects, result.tunnel.reconnects);
    sub.conn.destroy();
  } finally {
    sub.conn.destroy();
    await stopDaemon(name, result.token);
    await closeServer(cp);
  }
});

test("tunnel carries a stream: open -> opened -> HTTP request/response over data frames -> close", async () => {
  const name = `seed-tunnel-stream-${process.pid}`;
  const cp = await startTunnelControlPlane();
  const app = await startTunnelApp();
  const script = daemonSeedScript({ name });

  const result = await runSeedLauncher(script, [
    JSON.stringify({ tunnel: { connect: cp.url, tunnelToken: "tt", timeoutMs: 8000 } }),
  ]);
  try {
    assert.equal(result.tunnel.state, "connected");
    const conn = await waitForTunnelConn(cp, 0);

    conn.ws.send(JSON.stringify({ t: "open", id: 1, port: app.port, host: "127.0.0.1" }));
    await nextFrame(conn, (f) => !f.isBinary && JSON.parse(f.data.toString()).t === "opened");

    conn.ws.send(encodeTunnelData(1, Buffer.from("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")));

    const chunks = [];
    const deadline = Date.now() + 5000;
    let closed = false;
    while (Date.now() < deadline && !closed) {
      const f = await nextFrame(conn, (fr) => fr.isBinary || JSON.parse(fr.data.toString()).t === "close", 5000);
      if (f.isBinary) {
        const id = f.data.readUInt32BE(0);
        if (id === 1) chunks.push(f.data.subarray(4));
      } else {
        const msg = JSON.parse(f.data.toString());
        if (msg.t === "close" && msg.id === 1) closed = true;
      }
    }
    const body = Buffer.concat(chunks).toString();
    assert.match(body, /HTTP\/1\.1 200/);
    assert.match(body, /ok/);
    assert.equal(closed, true, "daemon should send close{id:1} after the app socket ends");
  } finally {
    await stopDaemon(name, result.token);
    await closeServer(cp);
    await new Promise((r) => app.server.close(r));
  }
});

test("tunnel surfaces ECONNREFUSED for a closed port", async () => {
  const name = `seed-tunnel-refused-${process.pid}`;
  const cp = await startTunnelControlPlane();
  const script = daemonSeedScript({ name });

  const result = await runSeedLauncher(script, [
    JSON.stringify({ tunnel: { connect: cp.url, tunnelToken: "tt", timeoutMs: 8000 } }),
  ]);
  try {
    const conn = await waitForTunnelConn(cp, 0);
    conn.ws.send(JSON.stringify({ t: "open", id: 3, port: 9, host: "127.0.0.1" }));
    const frame = await nextFrame(
      conn,
      (f) => !f.isBinary && JSON.parse(f.data.toString()).t === "error",
    );
    const err = JSON.parse(frame.data.toString());
    assert.equal(err.id, 3);
    assert.equal(err.code, "ECONNREFUSED");
  } finally {
    await stopDaemon(name, result.token);
    await closeServer(cp);
  }
});

test("tunnel enforces allowPorts and loopback-only hosts", async () => {
  const name = `seed-tunnel-allow-${process.pid}`;
  const cp = await startTunnelControlPlane();
  const app = await startTunnelApp();
  const script = daemonSeedScript({ name });

  const result = await runSeedLauncher(script, [
    JSON.stringify({ tunnel: { connect: cp.url, tunnelToken: "tt", allowPorts: [app.port], timeoutMs: 8000 } }),
  ]);
  try {
    const conn = await waitForTunnelConn(cp, 0);
    conn.ws.send(JSON.stringify({ t: "open", id: 5, port: app.port + 1, host: "127.0.0.1" }));
    let frame = await nextFrame(conn, (f) => !f.isBinary && JSON.parse(f.data.toString()).t === "error");
    let err = JSON.parse(frame.data.toString());
    assert.equal(err.id, 5);
    assert.equal(err.code, "PORT_NOT_ALLOWED");

    conn.ws.send(JSON.stringify({ t: "open", id: 7, port: app.port, host: "10.0.0.1" }));
    frame = await nextFrame(
      conn,
      (f) => !f.isBinary && JSON.parse(f.data.toString()).t === "error" && JSON.parse(f.data.toString()).id === 7,
    );
    err = JSON.parse(frame.data.toString());
    assert.equal(err.code, "HOST_NOT_ALLOWED");
  } finally {
    await stopDaemon(name, result.token);
    await closeServer(cp);
    await new Promise((r) => app.server.close(r));
  }
});

test("tunnel reconnects after link loss and reports reconnects", async () => {
  const name = `seed-tunnel-reconnect-${process.pid}`;
  const cp = await startTunnelControlPlane();
  const script = daemonSeedScript({ name });

  const result = await runSeedLauncher(script, [
    JSON.stringify({ tunnel: { connect: cp.url, tunnelToken: "tt", timeoutMs: 8000 } }),
  ]);
  const socketPath = defaultSocketPath(name, process.cwd());
  let sub;
  try {
    const conn = await waitForTunnelConn(cp, 0);
    sub = await subscribeDaemonEvents(socketPath, result.token);

    conn.ws.terminate();
    const reconnected = await waitForTunnelConn(cp, 1, 4000);
    assert.ok(reconnected, "daemon should reconnect within 4s");

    const status = await runSeedLauncher(script, [JSON.stringify({ tunnel: { status: true } })]);
    assert.equal(status.tunnel.state, "connected");
    assert.ok(status.tunnel.reconnects >= 1, `expected reconnects >= 1, got ${status.tunnel.reconnects}`);

    const disc = await waitForEvent(sub.events, "tunnel.disconnected", 2000);
    assert.equal(disc.willRetry, true);
    await waitForEvent(sub.events, "tunnel.connected", 2000);
  } finally {
    if (sub) sub.conn.destroy();
    await stopDaemon(name, result.token);
    await closeServer(cp);
  }
});

test("tunnel connect to an unreachable control plane reports a lastError", async () => {
  const name = `seed-tunnel-dialfail-${process.pid}`;
  const script = daemonSeedScript({ name });

  const result = await runSeedLauncher(script, [
    JSON.stringify({ tunnel: { connect: "ws://127.0.0.1:1/tunnel", tunnelToken: "tt", timeoutMs: 1500 } }),
  ]);
  try {
    assert.ok(["connecting", "disconnected"].includes(result.tunnel.state));
    assert.equal(typeof result.tunnel.lastError, "string");
    assert.ok(result.tunnel.lastError.length > 0);

    const status = await runSeedLauncher(script, [JSON.stringify({ tunnel: { disconnect: true } })]);
    assert.equal(status.tunnel.state, "disconnected");
  } finally {
    await stopDaemon(name, result.token);
  }
});

test("tunnel does not retry after a 4401 close", async () => {
  const name = `seed-tunnel-unauth-${process.pid}`;
  const cp = await startTunnelControlPlane();
  const script = daemonSeedScript({ name });

  const result = await runSeedLauncher(script, [
    JSON.stringify({ tunnel: { connect: cp.url, tunnelToken: "tt", timeoutMs: 8000 } }),
  ]);
  try {
    const conn = await waitForTunnelConn(cp, 0);
    conn.ws.close(4401, "unauthorized");

    const status = await runSeedLauncher(script, [JSON.stringify({ tunnel: { status: true } })]);
    assert.equal(status.tunnel.state, "disconnected");
    assert.equal(status.tunnel.lastError, "unauthorized");

    await sleep(2000);
    assert.equal(cp.conns.length, 1, "no reconnect should be attempted after 4401");
  } finally {
    await stopDaemon(name, result.token);
    await closeServer(cp);
  }
});

test("tunnel disconnect closes the socket with 1000 and suppresses reconnect", async () => {
  const name = `seed-tunnel-disconnect-${process.pid}`;
  const cp = await startTunnelControlPlane();
  const script = daemonSeedScript({ name });

  const result = await runSeedLauncher(script, [
    JSON.stringify({ tunnel: { connect: cp.url, tunnelToken: "tt", timeoutMs: 8000 } }),
  ]);
  try {
    const conn = await waitForTunnelConn(cp, 0);

    const status = await runSeedLauncher(script, [JSON.stringify({ tunnel: { disconnect: true } })]);
    assert.equal(status.tunnel.state, "disconnected");

    const deadline = Date.now() + 3000;
    while (conn.closeCode === null && Date.now() < deadline) await sleep(50);
    assert.equal(conn.closeCode, 1000);

    await sleep(1500);
    assert.equal(cp.conns.length, 1, "no reconnect after disconnect");
  } finally {
    await stopDaemon(name, result.token);
    await closeServer(cp);
  }
});
