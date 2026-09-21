import * as fs from "node:fs";
import * as path from "node:path";
import type { SeedCommandInput, SeedInvocationResult, SeedScriptConfig } from "./types.js";

const SCRIPT_VERSION = "1";

function loadSeedLauncherRuntimeSource(): string {
  const runtimePath = path.join(__dirname, "runtime", "seed-launcher.js");
  return fs.readFileSync(runtimePath, "utf8").trim();
}

function createLauncherScript(config: {
  name: string;
  socket?: string;
  ssePort: number;
  sseStrictPort: boolean;
}): string {
  const daemonSourceBase64 = Buffer.from(loadSeedLauncherRuntimeSource(), "utf8").toString("base64");
  const serialized = JSON.stringify(config);

  return [
    "const fs=require('node:fs')",
    "const path=require('node:path')",
    "const os=require('node:os')",
    "const net=require('node:net')",
    "const crypto=require('node:crypto')",
    "const {spawn}=require('node:child_process')",
    `const CONFIG=${serialized}`,
    `const VERSION='${SCRIPT_VERSION}'`,
    `const DAEMON_SOURCE=Buffer.from('${daemonSourceBase64}','base64').toString('utf8')`,
    "const workspaceHash=crypto.createHash('sha256').update(process.cwd()).digest('hex').slice(0,16)",
    "const daemonHash=crypto.createHash('sha256').update(CONFIG.name+':'+workspaceHash).digest('hex').slice(0,16)",
    "const baseDir=path.join(os.tmpdir(),'.computesdk','seed-daemon',daemonHash)",
    "const socketPath=CONFIG.socket||path.join(os.tmpdir(),'.computesdk','seed-sockets',daemonHash+'.sock')",
    "const daemonFile=path.join(baseDir,'daemon.cjs')",
    "const stateFile=path.join(baseDir,'state.json')",
    "function mkdirp(p){fs.mkdirSync(p,{recursive:true})}",
    "function sleep(ms){return new Promise(r=>setTimeout(r,ms))}",
    "function randomToken(){return crypto.randomBytes(24).toString('hex')}",
    "function readState(){if(!fs.existsSync(stateFile))return null;try{return JSON.parse(fs.readFileSync(stateFile,'utf8'))}catch{return null}}",
    "function writeState(value){mkdirp(path.dirname(stateFile));fs.writeFileSync(stateFile,JSON.stringify(value,null,2)+'\\n','utf8')}",
    "function request(message,timeoutMs=5000){return new Promise((resolve,reject)=>{const conn=net.createConnection(socketPath);let buf='';const timer=setTimeout(()=>{try{conn.destroy()}catch{}reject(new Error('seed launcher timeout'))},timeoutMs);conn.once('error',(err)=>{clearTimeout(timer);reject(err)});conn.on('data',(chunk)=>{buf+=String(chunk);let idx=-1;while((idx=buf.indexOf('\\n'))!==-1){const line=buf.slice(0,idx);buf=buf.slice(idx+1);if(!line.trim())continue;let msg;try{msg=JSON.parse(line)}catch{continue}if(msg.replyTo===message.id||msg.type==='error'){clearTimeout(timer);conn.end();resolve(msg);return}}});conn.once('connect',()=>{try{conn.write(JSON.stringify(message)+'\\n')}catch(err){clearTimeout(timer);reject(err)}})})}",
    "async function waitForHealthy(token,timeoutMs,errorContext){const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){try{const health=await request({id:'health-'+Date.now(),type:'health',token},1000);if(health&&health.type==='health'&&health.payload&&health.payload.state==='running')return health.payload}catch{}await sleep(100)}throw new Error('seed launcher could not reach daemon health'+(errorContext?' ('+errorContext+')':''))}",
    "function parseInput(argv){if(argv.length===0)throw new Error('seed launcher requires a command or JSON payload');if(argv.length===1){const raw=argv[0];try{const parsed=JSON.parse(raw);if(parsed&&typeof parsed==='object'&&typeof parsed.command==='string')return parsed}catch{}return {command:raw,args:[]}}return {command:argv[0],args:argv.slice(1)}}",
    "async function ensureDaemon(){mkdirp(path.dirname(socketPath));mkdirp(baseDir);fs.writeFileSync(daemonFile,DAEMON_SOURCE,'utf8');const state=readState();const token=state&&typeof state.token==='string'&&state.token?state.token:randomToken();let reused=false;let health=null;try{health=await waitForHealthy(token,500);reused=true}catch{}if(!health){const encoded=Buffer.from(JSON.stringify({version:VERSION,name:CONFIG.name,token,socket:socketPath,stateFile,sseHost:'127.0.0.1',ssePort:Number.isFinite(CONFIG.ssePort)?Number(CONFIG.ssePort):38989,sseStrictPort:CONFIG.sseStrictPort===true}),'utf8').toString('base64');const child=spawn(process.execPath,[daemonFile,encoded],{detached:true,stdio:'ignore',env:process.env});child.unref();health=await waitForHealthy(token,8000,'ssePort='+String(CONFIG.ssePort)+', sseStrictPort='+(CONFIG.sseStrictPort===true?'true':'false'));writeState({version:VERSION,name:CONFIG.name,pid:child.pid||null,token,socket:socketPath,ssePort:health.sseUrl?Number(new URL(health.sseUrl).port):null,startedAt:Date.now()});}return {token,reused,health}}",
    "async function main(){const input=parseInput(process.argv.slice(1));const ensure=await ensureDaemon();const requestId=(input.requestId&&String(input.requestId))||('req-'+Date.now()+'-'+Math.random().toString(16).slice(2));const execResponse=await request({id:requestId,type:'exec',token:ensure.token,payload:{command:input.command,args:Array.isArray(input.args)?input.args:[],cwd:typeof input.cwd==='string'?input.cwd:undefined,env:input.env&&typeof input.env==='object'?input.env:undefined,shell:input.shell===true,timeoutMs:Number.isFinite(input.timeoutMs)?Number(input.timeoutMs):undefined}},Math.max(1000,Number(input.timeoutMs)||60000)+2000);if(execResponse.type==='error'){throw new Error(String(execResponse.payload&&execResponse.payload.message||'seed launcher request failed'))}const result={token:ensure.token,requestId,daemon:{reused:ensure.reused,pid:ensure.health&&Number.isFinite(Number(ensure.health.pid))?Number(ensure.health.pid):null,sseUrl:ensure.health&&typeof ensure.health.sseUrl==='string'?ensure.health.sseUrl:''},command:execResponse.payload};process.stdout.write(JSON.stringify(result)+'\\n')}",
    "main().catch((err)=>{process.stderr.write(String(err&&err.stack?err.stack:err)+'\\n');process.exit(1)})",
  ].join(";");
}

export function daemonSeedScript(config?: SeedScriptConfig): string {
  if (process.platform === "win32") {
    throw new Error("daemond: Windows is not supported (Unix socket runtime required)");
  }

  const name = config?.name?.trim() || "daemond-seed";
  const socket = config?.socket;
  const ssePort = parseSsePort(config?.ssePort);
  const sseStrictPort = config?.sseStrictPort === true;
  return createLauncherScript({ name, socket, ssePort, sseStrictPort });
}

function parseSsePort(value: number | undefined): number {
  if (value === undefined) return 38989;
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error("daemond: ssePort must be an integer between 1 and 65535");
  }
  return value;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * Node version fetched when a sandbox ships no JS runtime. Pinned to an LTS
 * release so the bootstrap is reproducible; the archive layout
 * (node-v<ver>-linux-<arch>/bin/node) is stable across releases.
 */
const BOOTSTRAP_NODE_VERSION = "22.14.0";

/**
 * SHA-256 of the pinned node dist tarballs, from
 * https://nodejs.org/dist/v22.14.0/SHASUMS256.txt — the download is verified
 * against it whenever a checksum tool exists in the sandbox.
 */
const BOOTSTRAP_NODE_SHA256: Record<"x64" | "arm64", string> = {
  x64: "9d942932535988091034dc94cc5f42b6dc8784d6366df3a36c4c9ccb3996f0c2",
  arm64: "8cf30ff7250f9463b53c18f89c6c606dfda70378215b2c905d0a9a8b08bd45e0",
};

/**
 * One fetch verb for the node download. A minimal image may ship none of the
 * usual tools (Namespace's base image has no curl), so the chain walks what is
 * actually installed: curl, then wget, then busybox's wget applet, then
 * python3's stdlib — and keeps falling through when a tool exists but the
 * transfer fails. HTTPS certificate verification stays on throughout.
 */
const NODE_FETCH_FN = [
  "__daemond_fetch() {",
  "  if command -v curl >/dev/null 2>&1; then",
  '    curl -fsSL "$1" -o "$2" && return 0',
  '    rm -f "$2" 2>/dev/null',
  "  fi",
  "  if command -v wget >/dev/null 2>&1; then",
  '    wget -q -O "$2" "$1" && return 0',
  '    rm -f "$2" 2>/dev/null',
  "  fi",
  // A busybox binary does not imply the wget applet was built in — `--list` is
  // how to ask, and a busybox-only image may not ship a standalone grep.
  "  if command -v busybox >/dev/null 2>&1; then",
  "    for __daemond_applet in $(busybox --list 2>/dev/null); do",
  '      if [ "$__daemond_applet" = "wget" ]; then',
  '        if busybox wget -q -O "$2" "$1"; then return 0; fi',
  '        rm -f "$2" 2>/dev/null',
  "        break",
  "      fi",
  "    done",
  "  fi",
  "  if command -v python3 >/dev/null 2>&1; then",
  "    python3 -c 'import shutil, sys, urllib.request",
  'with urllib.request.urlopen(sys.argv[1]) as r, open(sys.argv[2], "wb") as f:',
  '    shutil.copyfileobj(r, f)\' "$1" "$2" && return 0',
  '    rm -f "$2" 2>/dev/null',
  "  fi",
  "  return 1",
  "}",
] as const;

/**
 * Prints the lowercase hex sha256 of $1 via whichever tool the sandbox ships,
 * or nothing when none exists (the caller then skips verification rather than
 * blocking bootstrap on a checksum utility alone).
 */
const NODE_SHA256_FN = [
  "__daemond_sha256() {",
  '  __daemond_digest=""',
  "  if command -v sha256sum >/dev/null 2>&1; then",
  '    __daemond_digest="$(sha256sum "$1" 2>/dev/null)"',
  "  elif command -v shasum >/dev/null 2>&1; then",
  '    __daemond_digest="$(shasum -a 256 "$1" 2>/dev/null)"',
  "  elif command -v openssl >/dev/null 2>&1; then",
  '    __daemond_digest="$(openssl dgst -sha256 "$1" 2>/dev/null)"',
  "  elif command -v busybox >/dev/null 2>&1; then",
  "    for __daemond_applet in $(busybox --list 2>/dev/null); do",
  '      if [ "$__daemond_applet" = "sha256sum" ]; then',
  '        __daemond_digest="$(busybox sha256sum "$1" 2>/dev/null)"',
  "        break",
  "      fi",
  "    done",
  "  fi",
  // sha256sum/shasum print "hash  file"; openssl prints "SHA2-256(file)= hash".
  '  __daemond_digest="${__daemond_digest##*= }"',
  '  printf \'%s\' "${__daemond_digest%% *}"',
  "}",
] as const;

/**
 * Shell prelude resolving a node binary for the seed launcher: PATH first,
 * then a cached bootstrap under ~/.computesdk/daemond, then a download of the
 * pinned, digest-verified static build for the sandbox's arch. Bootstrap only
 * supports Linux/glibc — other platforms get the capability error before any
 * download is attempted. On total failure it prints that error to stderr and
 * exits 127 rather than letting the launcher fail silently on a missing
 * interpreter.
 *
 * DAEMOND_NODE_DIST_URL overrides the dist base URL (default
 * https://nodejs.org/dist) — useful for mirrors and tests.
 * DAEMOND_NODE_SKIP_SHA256=1 disables digest verification (tests, or mirrors
 * serving repackaged archives).
 */
function nodeBootstrapPrelude(): string {
  const v = BOOTSTRAP_NODE_VERSION;
  return [
    ...NODE_FETCH_FN,
    ...NODE_SHA256_FN,
    '__daemond_node=""',
    'if command -v node >/dev/null 2>&1; then __daemond_node=node',
    'elif command -v nodejs >/dev/null 2>&1; then __daemond_node=nodejs',
    "fi",
    '__daemond_home="${HOME:-/tmp}/.computesdk/daemond"',
    'if [ -z "$__daemond_node" ]; then',
    '  __daemond_os="$(uname -s 2>/dev/null || true)"',
    '  __daemond_mach="$(uname -m 2>/dev/null || true)"',
    '  case "$__daemond_mach" in',
    '    x86_64|amd64) __daemond_arch=x64 ;;',
    '    aarch64|arm64) __daemond_arch=arm64 ;;',
    '    *) __daemond_arch="" ;;',
    "  esac",
    `  case "$__daemond_arch" in x64) __daemond_sha=${BOOTSTRAP_NODE_SHA256.x64} ;; arm64) __daemond_sha=${BOOTSTRAP_NODE_SHA256.arm64} ;; *) __daemond_sha="" ;; esac`,
    '  __daemond_err=""',
    '  if [ "$__daemond_os" != "Linux" ]; then',
    '    __daemond_err="no static node build for ${__daemond_os:-unknown} (bootstrap supports Linux/glibc only)"',
    '  elif [ -z "$__daemond_arch" ]; then',
    '    __daemond_err="unsupported machine architecture ${__daemond_mach:-unknown}"',
    "  else",
    '    case "$(ldd --version 2>&1 || true)" in',
    '      *musl*|*Musl*) __daemond_err="musl libc cannot run the official static node build" ;;',
    "    esac",
    "  fi",
    '  if [ -z "$__daemond_err" ]; then',
    `    __daemond_dir="$__daemond_home/node-v${v}-linux-$__daemond_arch"`,
    '    if [ -x "$__daemond_dir/bin/node" ]; then',
    '      __daemond_node="$__daemond_dir/bin/node"',
    '    elif [ -d "$__daemond_dir" ]; then',
    '      __daemond_err="cached node at $__daemond_dir is unusable; remove it and retry"',
    "    else",
    `      __daemond_url="\${DAEMOND_NODE_DIST_URL:-https://nodejs.org/dist}/v${v}/node-v${v}-linux-$__daemond_arch.tar.gz"`,
    // umask keeps the predictable $$-named staging dirs private to this user.
    "      umask 077",
    '      __daemond_tmp="$__daemond_home/.bootstrap-$$"',
    '      mkdir -p "$__daemond_tmp" 2>/dev/null',
    '      if __daemond_fetch "$__daemond_url" "$__daemond_tmp/node.tar.gz"; then',
    '        __daemond_sum="$(__daemond_sha256 "$__daemond_tmp/node.tar.gz")"',
    '        if [ -n "$__daemond_sum" ] && [ "$__daemond_sum" != "$__daemond_sha" ] && [ "${DAEMOND_NODE_SKIP_SHA256:-}" != "1" ]; then',
    '          __daemond_err="downloaded node tarball failed sha256 verification (got $__daemond_sum)"',
    `        elif tar -xzf "$__daemond_tmp/node.tar.gz" -C "$__daemond_tmp" 2>/dev/null && [ -f "$__daemond_tmp/node-v${v}-linux-$__daemond_arch/bin/node" ] && "$__daemond_tmp/node-v${v}-linux-$__daemond_arch/bin/node" --version >/dev/null 2>&1; then`,
    // Never delete the shared cache dir — a concurrent bootstrap or running
    // daemon may be using it. Promote only into an absent path; if another
    // installer raced us there, adopt its runtime.
    '          if [ -x "$__daemond_dir/bin/node" ]; then',
    '            __daemond_node="$__daemond_dir/bin/node"',
    `          elif mv "$__daemond_tmp/node-v${v}-linux-$__daemond_arch" "$__daemond_dir" 2>/dev/null && [ -x "$__daemond_dir/bin/node" ]; then`,
    '            __daemond_node="$__daemond_dir/bin/node"',
    '          elif [ -x "$__daemond_dir/bin/node" ]; then',
    '            __daemond_node="$__daemond_dir/bin/node"',
    "          else",
    '            __daemond_err="could not install node into $__daemond_dir"',
    "          fi",
    "        else",
    '          __daemond_err="downloaded node tarball could not be unpacked or does not run on this system"',
    "        fi",
    "      else",
    '        __daemond_err="download of $__daemond_url failed: the image has none of curl, wget, busybox wget or python3, or the network is unreachable"',
    "      fi",
    '      rm -rf "$__daemond_tmp"',
    "    fi",
    "  fi",
    "fi",
    'if [ -z "$__daemond_node" ]; then',
    '  echo "daemond: sandbox lacks a JavaScript runtime and daemon bootstrap failed: ${__daemond_err:-node not found}" >&2',
    "  exit 127",
    "fi",
    // $0 is the launcher script, $1 the payload — both arrive as arguments to
    // the outer `sh -c` so the program itself stays safely quoted.
    'exec "$__daemond_node" -e "$0" "$1"',
  ].join("\n");
}

export function daemonSeedScriptCommand(
  config: SeedScriptConfig | undefined,
  payload: string | SeedCommandInput,
): string {
  const script = daemonSeedScript(config);
  const payloadArg = typeof payload === "string" ? payload : JSON.stringify(payload);
  // Wrapped as `sh -c '<program>' '<script>' '<payload>'`: a single command
  // invocation, so providers that prepend `VAR=value` env assignments or a
  // `cd <dir> &&` prefix to the command (archil, namespace) apply them to a
  // real command rather than producing a syntax error on the function
  // definition the prelude opens with.
  return `sh -c ${shellQuote(nodeBootstrapPrelude())} ${shellQuote(script)} ${shellQuote(payloadArg)}`;
}

function outputTail(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= 200) return trimmed;
  return `…${trimmed.slice(-200)}`;
}

export function parseSeedInvocationOutput(raw: string): SeedInvocationResult {
  const lines = raw
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new Error("daemond: expected JSON output from seed launcher (stdout was empty)");
  }

  const last = lines[lines.length - 1];
  try {
    return JSON.parse(last) as SeedInvocationResult;
  } catch {
    throw new Error(
      `daemond: expected JSON output from seed launcher (output tail: ${outputTail(raw)})`,
    );
  }
}
