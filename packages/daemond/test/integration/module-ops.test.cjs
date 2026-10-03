const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const {
  daemonSeedScript,
  checkpointInstallInput,
  checkpointOpInput,
  parseCheckpointResult,
} = require("../../dist/index.js");

const STORE_STUB = path.join(__dirname, "..", "fixtures", "store-stub.cjs");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectSocket(socketPath, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = net.createConnection(socketPath);
        socket.once("connect", () => resolve(socket));
        socket.once("error", reject);
      });
    } catch {
      await sleep(50);
    }
  }
  throw new Error(`Timed out connecting to socket: ${socketPath}`);
}

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
  if (lines.length === 0) throw new Error("seed launcher returned no stdout");
  return lines.map((line) => JSON.parse(line));
}

async function runSeedLauncher(script, args, options = {}) {
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
  server.close();
  return addr.port;
}

async function stopDaemon(name, token, cwd = process.cwd()) {
  const socketPath = defaultSocketPath(name, cwd);
  const conn = await connectSocket(socketPath, 3000);
  try {
    conn.write(`${JSON.stringify({ id: "stop-test", type: "stop", token })}\n`);
    await sleep(150);
  } finally {
    conn.destroy();
  }
}

function b64args(value) {
  return `b64:${Buffer.from(JSON.stringify(value), "utf8").toString("base64")}`;
}

function startStoreStub(port) {
  const child = spawn(process.execPath, [STORE_STUB], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return child;
}

async function waitForStore(port, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${port}/__objects`, (res) => {
            res.resume();
            res.statusCode === 200 ? resolve() : reject(new Error(String(res.statusCode)));
          })
          .on("error", reject);
      });
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error("store stub did not start");
}

/**
 * Exercises the module op family over the real daemon socket:
 * module.install pushes checkpoint-module.cjs, module.exec runs scan/capture/
 * restore ops as daemon jobs, module.list introspects — all through the same
 * launcher payloads a sandbox runCommand would carry.
 */
test("module.install + module.exec + module.list run checkpoint ops over the socket", async (t) => {
  const name = `daemond-modops-${process.pid}`;
  const ssePort = await reserveTcpPort();
  const script = daemonSeedScript({ name, ssePort });
  const storePort = await reserveTcpPort();
  const store = startStoreStub(storePort);
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "daemond-modops-"));
  const destDir = path.join(workdir, "restored");

  // seed a small tree with a symlink and a subdirectory
  fs.mkdirSync(path.join(workdir, "proj/src"), { recursive: true });
  fs.writeFileSync(path.join(workdir, "proj/src/app.js"), "console.log('app');\n");
  fs.writeFileSync(path.join(workdir, "proj/README.md"), "# proj\n");
  fs.symlinkSync("src/app.js", path.join(workdir, "proj/link"));

  let token;
  try {
    // --- module.install ----------------------------------------------------
    const install = await runSeedLauncher(script, [JSON.stringify(checkpointInstallInput())]);
    token = install.token;
    assert.equal(install.command.name, "checkpoint");
    assert.match(install.command.path, /modules\/checkpoint\.cjs$/);
    assert.match(install.command.sha256, /^[0-9a-f]{64}$/);

    // --- module.list --------------------------------------------------------
    const list = await runSeedLauncher(script, [JSON.stringify({ moduleList: true })]);
    assert.deepEqual(
      list.command.modules.map((m) => m.name),
      ["checkpoint"],
    );

    // --- module.exec scan (detached job → wait) ------------------------------
    const scanInput = checkpointOpInput("scan", {
      paths: [path.join(workdir, "proj")],
      meta: { cwd: path.join(workdir, "proj"), workflowHash: "wf-1", sourceProvider: "test" },
    });
    const started = await runSeedLauncher(script, [JSON.stringify(scanInput)]);
    assert.equal(started.command.status, "running");
    assert.ok(started.command.jobId);

    const done = await runSeedLauncher(script, [
      JSON.stringify({ wait: started.command.jobId, timeoutMs: 30000 }),
    ]);
    assert.equal(done.command.status, "exited");
    assert.equal(done.command.exitCode, 0);
    const scanResult = parseCheckpointResult(done.command.stdout);
    assert.equal(scanResult.op, "scan");
    const scanned = scanResult.manifest;
    assert.equal(scanned.files[path.join(workdir, "proj/src/app.js")].sha.length, 64);
    assert.equal(scanned.files[path.join(workdir, "proj/link")].type, "symlink");

    // --- module.exec capture → store stub -----------------------------------
    const captureInput = checkpointOpInput("capture", {
      paths: [path.join(workdir, "proj")],
      store: { kind: "http", baseUrl: `http://127.0.0.1:${storePort}` },
      meta: { cwd: path.join(workdir, "proj") },
    });
    const capStarted = await runSeedLauncher(script, [JSON.stringify(captureInput)]);
    const capDone = await runSeedLauncher(script, [
      JSON.stringify({ wait: capStarted.command.jobId, timeoutMs: 60000 }),
    ]);
    const capture = parseCheckpointResult(capDone.command.stdout);
    assert.equal(capture.op, "capture");
    assert.equal(capture.blobsNew, 2); // app.js + README.md
    assert.ok(capture.zipBytes > 0);

    // --- module.exec restore into destDir ------------------------------------
    const restoreInput = checkpointOpInput("restore", {
      store: { kind: "http", baseUrl: `http://127.0.0.1:${storePort}` },
      checkpointId: capture.checkpointId,
      destDir,
    });
    const restStarted = await runSeedLauncher(script, [JSON.stringify(restoreInput)]);
    const restDone = await runSeedLauncher(script, [
      JSON.stringify({ wait: restStarted.command.jobId, timeoutMs: 60000 }),
    ]);
    const restore = parseCheckpointResult(restDone.command.stdout);
    assert.equal(restore.op, "restore");
    assert.equal(restore.files, 2);
    assert.equal(restore.failures.length, 0);

    const restoredApp = path.join(destDir, workdir.slice(1), "proj/src/app.js");
    assert.equal(fs.readFileSync(restoredApp, "utf8"), "console.log('app');\n");
    assert.equal(fs.readFileSync(path.join(destDir, workdir.slice(1), "proj/README.md"), "utf8"), "# proj\n");
    assert.equal(fs.readlinkSync(path.join(destDir, workdir.slice(1), "proj/link")), "src/app.js");

    // --- unknown module is a clean error --------------------------------------
    await assert.rejects(
      runSeedLauncher(script, [
        JSON.stringify({ moduleExec: { name: "nope", argv: [], detach: true } }),
      ]),
      /module nope is not installed/,
    );
  } finally {
    store.kill("SIGKILL");
    if (token) await stopDaemon(name, token).catch(() => {});
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});
