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
  return `'${value.replace(/'/g, `"'"'"`)}'`;
}

export function daemonSeedScriptCommand(
  config: SeedScriptConfig | undefined,
  payload: string | SeedCommandInput,
): string {
  const script = daemonSeedScript(config);
  const payloadArg = typeof payload === "string" ? payload : JSON.stringify(payload);
  return `node -e ${shellQuote(script)} ${shellQuote(payloadArg)}`;
}

export function parseSeedInvocationOutput(raw: string): SeedInvocationResult {
  const lines = raw
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new Error("daemond: expected JSON output from seed launcher");
  }

  const last = lines[lines.length - 1];
  return JSON.parse(last) as SeedInvocationResult;
}
