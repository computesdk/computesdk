import { fail } from '@briq-cloud/sdk';
import { daemonSeedScriptCommand } from 'daemond';
export const IMAGE =
  'ghcr.io/briq-cloud/sandbox@sha256:b3de0c6a50bdceea0c95d346c6b3cbc996c74741748bd9d28ec5bd13e8eecdd9';
/** SHA-256 of the `daemon.cjs` that `daemond` persists in the guest. */
export const DAEMON_SHA256 = 'e53117b91ed8db2252aa2207f506489ab46b8bcc9b8385e01e04cec7455ed367';
export const NODE_SHA256 = 'e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb';
const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
const SENTINEL = '__BRIQ_DAEMON_PAYLOAD__';
const normal = daemonSeedScriptCommand({ ssePort: 38989 }, SENTINEL);
const encoded = daemonSeedScriptCommand({ ssePort: 38989 }, SENTINEL, { argvEncoding: 'base64' });
const normalPrefix = normal.slice(0, -quote(SENTINEL).length);
const encodedPrefix = encoded.slice(0, -Buffer.from(SENTINEL).toString('base64').length);
/** Recognize only the exact shell envelope emitted by the pinned official factory. */
export function daemonPayload(command: string): string | undefined {
  if (command.startsWith(normalPrefix)) {
    const tail = command.slice(normalPrefix.length);
    const decoded = tail.slice(1, -1).replace(/'"'"'/g, "'");
    if (quote(decoded) !== tail) throw fail('invalid_argument', 'Invalid daemon command envelope');
    JSON.parse(decoded);
    return decoded;
  }
  if (command.startsWith(encodedPrefix)) {
    const tail = command.slice(encodedPrefix.length);
    const decoded = Buffer.from(tail, 'base64');
    if (decoded.toString('base64') !== tail)
      throw fail('invalid_argument', 'Invalid daemon command envelope');
    const json = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
    JSON.parse(json);
    return json;
  }
  return undefined;
}
// One-shot standard-library validation only: the process protocol remains the official daemon.
const GUARD = String.raw`
import os,stat,sys,hashlib
root,node_hash,daemon_hash=sys.argv[1:]
def private(p):
 try: os.mkdir(p,0o700)
 except FileExistsError: pass
 s=os.lstat(p)
 if not stat.S_ISDIR(s.st_mode) or s.st_uid!=os.geteuid() or s.st_mode&0o077: raise ValueError()
try:
 n='/usr/local/bin/node';s=os.lstat(n)
 if not stat.S_ISREG(s.st_mode) or hashlib.sha256(open(n,'rb').read()).hexdigest()!=node_hash: raise ValueError()
 for p in [root,root+'/home',root+'/tmp']: private(p)
 control=root+'/tmp/.computesdk'
 if os.path.lexists(control):
  count=0
  for parent,dirs,files in os.walk(control,followlinks=False):
   for p in [parent]+[os.path.join(parent,n) for n in dirs+files]:
    count+=1;s=os.lstat(p)
    if count>512 or stat.S_ISLNK(s.st_mode) or s.st_uid!=os.geteuid() or s.st_mode&0o077: raise ValueError()
    if os.path.basename(p)=='daemon.cjs' and hashlib.sha256(open(p,'rb').read()).hexdigest()!=daemon_hash: raise ValueError()
except Exception:
 sys.exit(1)
`;
export function launch(id: string, payload: string, daemonHash: string) {
  if (!/^bq_[a-zA-Z0-9]+$/.test(id)) throw fail('invalid_argument', 'Invalid instance identity');
  const root = `/tmp/briq-computesdk-${id}-0.1.8`;
  const script = daemonSeedScriptCommand(
    { name: `briq-0.1.8-${daemonHash.slice(0, 12)}`, ssePort: 38989 },
    payload,
  );
  return {
    cmd: [
      '/usr/bin/env',
      '-i',
      'PATH=/usr/local/bin:/usr/bin:/bin',
      `HOME=${root}/home`,
      `TMPDIR=${root}/tmp`,
      '/bin/sh',
      '-s',
    ],
    cwd: '/workspace',
    env: {},
    stdin: `umask 077\npython3 -c ${quote(GUARD)} ${quote(root)} ${quote(NODE_SHA256)} ${quote(daemonHash)} || exit 126\n${script}\n`,
  };
}
