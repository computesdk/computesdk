/**
 * E2E: checkpoint capture in one e2b sandbox, restore into a second sandbox.
 *
 * Not wired into `pnpm test` — needs E2B_API_KEY and real network. Run:
 *   node test/e2e/checkpoint-e2e.cjs
 *
 * Topology: sandbox A runs the store stub (range-capable HTTP object store)
 * on :8080, exposed publicly via sandbox.getHost(8080). Capture uploads
 * blobs + delta zip there; sandbox B restores straight from A's public URL,
 * proving PUT + range GETs work box-to-box without platform involvement.
 */
const { Sandbox } = require("e2b");
const { daemonSeedScript } = require("../../dist/index.js");
const fs = require("node:fs");
const path = require("node:path");

const STORE_STUB = path.join(__dirname, "../fixtures/store-stub.cjs");
const CHECKPOINT_MODULE = path.join(__dirname, "../../dist/runtime/checkpoint-module.js");
const WORKDIR = "/home/user/app";
const STORE_PORT = 8080;
const NODE_TARBALL = "v22.14.0";
const NODE = "/tmp/node-v22.14.0-linux-x64/bin/node";

const ensureNode = async (sbx) => {
  const probe = await sbx.commands.run("node --version", { timeoutMs: 10_000 });
  if (probe.exitCode === 0) return "node";
  // The whole point of the module is "any box with node" — fetch one.
  const res = await sbx.commands.run(
    `cd /tmp && curl -fsSLo node.tar.xz https://nodejs.org/dist/${NODE_TARBALL}/node-${NODE_TARBALL}-linux-x64.tar.xz && tar -xJf node.tar.xz && ${NODE} --version`,
    { timeoutMs: 120_000 },
  );
  if (res.exitCode !== 0) throw new Error(`node bootstrap failed: ${res.stdout}\n${res.stderr}`);
  return NODE;
};

const launchScript = daemonSeedScript({ name: `e2e-${process.pid}` });
const moduleSource = fs.readFileSync(CHECKPOINT_MODULE, "utf8");

const run = async (sbx, cmd, timeoutMs = 60_000) => {
  try {
    return await sbx.commands.run(cmd, { timeoutMs });
  } catch (e) {
    // e2b 2.x throws CommandExitError on non-zero exits — normalize to a result.
    if (e && typeof e === "object" && "exitCode" in e) {
      return { exitCode: e.exitCode, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
    throw e;
  }
};

const must = async (sbx, cmd, timeoutMs) => {
  const res = await run(sbx, cmd, timeoutMs);
  if (res.exitCode !== 0) {
    throw new Error(`cmd failed [${res.exitCode}] ${cmd}\nstdout:${res.stdout}\nstderr:${res.stderr}`);
  }
  return res;
};

// The launcher reads process.argv[1] (built for `node -e <script> <payload>`),
// so require() the file instead of executing it as an entry point — that keeps
// argv identical to the production invocation.
const seed = async (sbx, payload) => {
  const res = await run(sbx, `${sbx._nodeBin} -e 'require("/tmp/seed.cjs")' '${JSON.stringify(payload)}'`);
  const last = res.stdout.trim().split("\n").pop();
  try {
    return JSON.parse(last);
  } catch {
    throw new Error(`bad seed output: ${res.stdout}\n${res.stderr}`);
  }
};

const installModule = (sbx) =>
  seed(sbx, { installModule: { name: "checkpoint", sourceB64: Buffer.from(moduleSource, "utf8").toString("base64") } });

const moduleExec = (sbx, op, args, timeoutMs = 120_000) =>
  seed(sbx, { moduleExec: { name: "checkpoint", argv: [op, `b64:${Buffer.from(JSON.stringify(args)).toString("base64")}`], detach: true, timeoutMs } });

const waitJob = (sbx, jobId, timeoutMs = 180_000) => seed(sbx, { wait: jobId, timeoutMs });

const resultOf = (stdout) => {
  const line = stdout.trim().split("\n").filter((l) => l.includes('"type":"result"')).pop();
  if (!line) throw new Error(`no result line (tail: ${stdout.slice(-400)})`);
  return JSON.parse(line);
};

const seedTreeScript = `
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root='${WORKDIR}';
fs.mkdirSync(path.join(root,'node_modules'),{recursive:true});
fs.mkdirSync(path.join(root,'src/lib'),{recursive:true});
fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'ckpt-e2e',version:'1.0.0'},null,2));
for(let i=0;i<40;i++)fs.writeFileSync(path.join(root,'src/lib','m'+i+'.js'),'export const v'+i+' = '+i+';\\n');
// ~35MB of node_modules-ish trees: many small files + a few big bundles
const pkgs=['left-pad','lodash','chalk','semver','axios','express','react','tslib'];
for(const p of pkgs){
  const d=path.join(root,'node_modules',p,'dist');
  fs.mkdirSync(d,{recursive:true});
  fs.writeFileSync(path.join(root,'node_modules',p,'package.json'),JSON.stringify({name:p,version:'1.0.0'}));
  for(let i=0;i<60;i++)fs.writeFileSync(path.join(d,'f'+i+'.js'),crypto.randomBytes(512).toString('hex'));
  fs.writeFileSync(path.join(d,'bundle.js'),crypto.randomBytes(2*1024*1024).toString('hex'));
}
fs.symlinkSync('src/lib/m0.js',path.join(root,'link.js'));
`;

async function main() {
  console.log("[e2e] creating sandbox A…");
  const a = await Sandbox.create();
  try {
    a._nodeBin = await ensureNode(a);
    console.log("[e2e] sandbox A:", a.sandboxId, "node:", a._nodeBin);

    await a.files.write("/tmp/seed.cjs", launchScript);
    await a.files.write("/tmp/store-stub.cjs", fs.readFileSync(STORE_STUB, "utf8"));
    await a.files.write("/tmp/gen-tree.cjs", seedTreeScript);
    await must(a, `${a._nodeBin} /tmp/gen-tree.cjs`, 60_000);

    // object store in-box, bound publicly via getHost
    await run(a, `STORE_DIR=/tmp/store PORT=${STORE_PORT} nohup ${a._nodeBin} /tmp/store-stub.cjs >/tmp/store.log 2>&1 &`, 5_000);
    await must(a, `for i in $(seq 1 50); do curl -sf -o /dev/null http://localhost:${STORE_PORT}/__objects && exit 0; sleep 0.2; done; exit 1`, 20_000);
    const storeHost = `https://${a.getHost(STORE_PORT)}`;
    console.log("[e2e] store public URL:", storeHost);

    // install the checkpoint module over the socket, then capture
    const inst = await installModule(a);
    if (!inst.command?.sha256) console.log("[e2e] install raw:", JSON.stringify(inst).slice(0, 500));
    console.log("[e2e] module.install:", inst.command.sha256.slice(0, 12), inst.command.bytes, "B");

    const list = await seed(a, { moduleList: true });
    console.log("[e2e] module.list:", JSON.stringify(list.command.modules));

    const cap = await moduleExec(a, "capture", {
      paths: [WORKDIR],
      store: { type: "http", baseUrl: `http://localhost:${STORE_PORT}` },
      manifest: { arch: process.arch, cwd: WORKDIR, env: { NODE_ENV: "test" }, workflowHash: "wf-e2e", sourceProvider: "e2b" },
    });
    const capDone = await waitJob(a, cap.command.jobId);
    const capResult = resultOf(capDone.command.stdout);
    const ckptId = capResult.checkpointId;
    console.log(
      `[e2e] capture: ckpt=${ckptId} ms=${capResult.ms} files=${capResult.manifest.stats.files} ` +
        `bytes=${capResult.manifest.stats.bytes} zipBytes=${capResult.zipBytes} blobsNew=${capResult.blobsNew} ` +
        `blobsDeduped=${capResult.blobsDeduped}`,
    );

    // second checkpoint after edits → delta sizes
    await must(a, `${a._nodeBin} -e "const fs=require('fs');fs.writeFileSync('${WORKDIR}/src/lib/m0.js','edited\\n');fs.writeFileSync('${WORKDIR}/new.js','new\\n');fs.rmSync('${WORKDIR}/src/lib/m1.js')"`);
    // parent manifest is referenced by URL, not carried through argv — a
    // manifest can be far larger than the ~128KB/arg limit.
    const cap2 = await moduleExec(a, "capture", {
      paths: [WORKDIR],
      store: { type: "http", baseUrl: `http://localhost:${STORE_PORT}` },
      dedup: { parentManifest: { manifestUrl: `http://localhost:${STORE_PORT}/manifests/${ckptId}.json` } },
    });
    const cap2Done = await waitJob(a, cap2.command.jobId);
    const cap2Result = resultOf(cap2Done.command.stdout);
    console.log(
      `[e2e] capture#2 (delta): ckpt=${cap2Result.checkpointId} ms=${cap2Result.ms} ` +
        `zipBytes=${cap2Result.zipBytes} blobsNew=${cap2Result.blobsNew} blobsDeduped=${cap2Result.blobsDeduped} ` +
        `bytesNew=${cap2Result.bytesNew}`,
    );

    // object listing sanity
    const objs = await must(a, `curl -s http://localhost:${STORE_PORT}/__objects`);
    const objMap = JSON.parse(objs.stdout);
    const objBytes = Object.values(objMap).reduce((t, n) => t + n, 0);
    console.log(`[e2e] store objects: ${Object.keys(objMap).length} objects, ${objBytes} bytes`);

    // --- sandbox B: restore over the public URL (real TLS range GETs) ---
    console.log("[e2e] creating sandbox B…");
    const b = await Sandbox.create();
    try {
      b._nodeBin = await ensureNode(b);
      await b.files.write("/tmp/seed.cjs", launchScript);
      const instB = await installModule(b);
      console.log("[e2e] B module.install:", instB.command.sha256.slice(0, 12));

      const zipUrl = `${storeHost}/checkpoints/${ckptId}.zip`;
      const rest = await moduleExec(b, "restore", {
        checkpointUrl: zipUrl,
        store: { type: "http", baseUrl: storeHost },
        destDir: WORKDIR,
      });
      const restDone = await waitJob(b, rest.command.jobId, 300_000);
      const restResult = resultOf(restDone.command.stdout);
      console.log("[e2e] restore:", JSON.stringify(restResult));

      // verify: scan B's tree and diff against A's checkpoint manifest
      const scanB = await moduleExec(b, "scan", { paths: [WORKDIR] });
      const scanBDone = await waitJob(b, scanB.command.jobId);
      const scanBResult = resultOf(scanBDone.command.stdout);
      const diffs = [];
      for (const [p, e] of Object.entries(capResult.manifest.files)) {
        const got = scanBResult.manifest.files[p];
        if (!got) diffs.push(`missing ${p}`);
        else if (e.type === "file" && got.sha !== e.sha) diffs.push(`hash ${p}`);
        else if (e.type === "symlink" && got.link !== e.link) diffs.push(`link ${p}`);
      }
      for (const p of Object.keys(scanBResult.manifest.files)) {
        if (!capResult.manifest.files[p]) diffs.push(`extra ${p}`);
      }
      if (diffs.length) throw new Error(`tree diff after restore: ${diffs.slice(0, 10).join("; ")} (${diffs.length})`);
      console.log("[e2e] tree diff: clean —", scanBResult.manifest.stats.files, "entries verified");
      await b.kill();
    } catch (e) {
      await b.kill().catch(() => {});
      throw e;
    }
    await a.kill();
    console.log("[e2e] PASS");
  } catch (e) {
    await a.kill().catch(() => {});
    console.error("[e2e] FAIL:", e.message);
    process.exitCode = 1;
  }
}

main();
