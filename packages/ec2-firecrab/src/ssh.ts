// Minimal exec surface over OpenSSH.
//
// firecrab has no exec API — the reachable in-guest channel is the per-VM
// ed25519 key the API hands out at GET /api/vms/{id}/ssh-key plus the
// guest's sshd on the MicroNetwork bridge IP. When the caller isn't on the
// host, pass `proxyCommand` (e.g. `ssh -W %h:%p ubuntu@<host>`) so the guest
// connection rides a jumphost.
//
// This is the interim exec path; the durable one is computesdk-runtime in
// the guest rootfs (see repo README). The CommandResult shape is the same
// either way, so callers don't notice the swap.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface SshExecRequest {
  /** Guest IP on the MicroNetwork bridge. */
  host: string;
  /** Guest ssh user (firecrab installs root logins). */
  user?: string;
  /** PEM private key material from GET /api/vms/{id}/ssh-key. */
  identityPem: string;
  /** Optional OpenSSH ProxyCommand for off-host callers. */
  proxyCommand?: string;
  /** MicroVM id — the host key is pinned under this, not the (recyclable) IP. */
  vmId?: string;
  /**
   * Expected guest host-key fingerprint as reported by the firecrab API
   * (`sshHostFingerprint`, e.g. 'SHA256:...'). When set, a pinned key that
   * doesn't match is a hard failure — a peer microVM spoofing the guest IP
   * on the shared bridge can't impersonate the VM.
   */
  expectedHostFingerprint?: string;
  /**
   * Command run through `sh -c` in the guest (not a login shell: images'
   * profile scripts can print banners into stdout).
   */
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

export interface SshExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

// Guest host keys are pinned per VM id (HostKeyAlias) in a process-level
// known_hosts dir — guest IPs recycle on the shared bridge, so keying on the
// IP would both pin the wrong identity and throw false mismatches.
const knownHostsDir = join(tmpdir(), 'ec2-firecrab-known-hosts');

// How long past the guest-side deadline the client waits before dropping
// the connection itself.
const TIMEOUT_GRACE_MS = 5_000;

function sshArgs(
  req: SshExecRequest,
  keyPath: string,
  khPath: string,
  alias: string,
  strictness: string,
): string[] {
  return [
    '-i', keyPath,
    '-o', `StrictHostKeyChecking=${strictness}`,
    '-o', `UserKnownHostsFile=${khPath}`,
    '-o', `HostKeyAlias=${alias}`,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=15',
    '-o', 'LogLevel=ERROR',
    ...(req.proxyCommand ? ['-o', `ProxyCommand=${req.proxyCommand}`] : []),
    `${req.user ?? 'root'}@${req.host}`,
    '--',
  ];
}

function sshExec(
  args: string[],
  remote: string,
  req: Pick<SshExecRequest, 'timeoutMs' | 'onStdout' | 'onStderr'>,
): Promise<SshExecResult> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', [...args, remote], { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    // The guest enforces the deadline itself (see runSshCommand); this is a
    // backstop for a dead connection. A timeout is a failed command, not an
    // exception, so callers still get the partial output.
    let timedOut = false;
    const timer = req.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, req.timeoutMs + TIMEOUT_GRACE_MS)
      : undefined;

    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk);
      req.onStdout?.(chunk.toString());
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
      req.onStderr?.(chunk.toString());
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(new Error(`ec2-firecrab ssh exec failed to spawn: ${err.message}`));
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      const err = Buffer.concat(stderr).toString();
      resolve({
        stdout: Buffer.concat(stdout).toString(),
        stderr: timedOut
          ? `${err}ec2-firecrab: command timed out after ${req.timeoutMs}ms\n`
          : err,
        exitCode: timedOut ? 124 : code ?? 1,
        durationMs: Date.now() - started,
      });
    });
  });
}

// `ssh-keygen -lf <file>` prints '<bits> SHA256:... <comment> (<type>)' per line.
function fingerprintsOf(khPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const p = spawn('ssh-keygen', ['-lf', khPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    p.stdout.on('data', (c: Buffer) => out.push(c));
    p.on('error', reject);
    p.on('close', () => {
      resolve(
        Buffer.concat(out)
          .toString()
          .split('\n')
          .map((l) => l.trim().split(/\s+/)[1])
          .filter((f): f is string => typeof f === 'string' && f.length > 0),
      );
    });
  });
}

// Pin the guest's host key under its VM id, verifying the first-seen key
// against the fingerprint the firecrab API reported when it has one. The
// probe runs an inert `true` — nothing sensitive reaches the endpoint until
// identity is established.
async function pinGuestHostKey(
  req: SshExecRequest,
  keyPath: string,
): Promise<{ khPath: string; alias: string }> {
  mkdirSync(knownHostsDir, { recursive: true, mode: 0o700 });
  const alias = req.vmId ?? req.host;
  const khPath = join(knownHostsDir, `kh_${alias.replace(/[^A-Za-z0-9._-]/g, '_')}`);
  if (!existsSync(khPath)) {
    const probe = await sshExec(
      sshArgs(req, keyPath, khPath, alias, 'accept-new'),
      'true',
      { timeoutMs: Math.min(req.timeoutMs ?? 30_000, 30_000) },
    );
    if (probe.exitCode !== 0) {
      rmSync(khPath, { force: true });
      throw new Error(
        `ec2-firecrab: could not reach guest sshd at ${req.host}: ${probe.stderr.trim() || `exit ${probe.exitCode}`}`,
      );
    }
  }
  if (req.expectedHostFingerprint) {
    const fps = await fingerprintsOf(khPath);
    if (!fps.includes(req.expectedHostFingerprint)) {
      rmSync(khPath, { force: true });
      throw new Error(
        `ec2-firecrab: guest ${alias} host key fingerprint does not match the firecrab API's (${req.expectedHostFingerprint}) — possible bridge impersonation`,
      );
    }
  }
  return { khPath, alias };
}

export async function runSshCommand(req: SshExecRequest): Promise<SshExecResult> {
  const dir = mkdtempSync(join(tmpdir(), 'ec2-firecrab-'));
  const keyPath = join(dir, 'id_ed25519');
  writeFileSync(keyPath, req.identityPem, { mode: 0o600 });

  // env keys land unquoted in remote shell text — only allow real shell
  // identifiers so a hostile key can't inject commands.
  const envPrefix = req.env
    ? Object.entries(req.env)
        .map(([k, v]) => {
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
            throw new Error(`ec2-firecrab: invalid env var name '${k}'`);
          }
          return `${k}=${quote(v)} `;
        })
        .join('')
    : '';

  // Without a tty, dropping the ssh connection leaves the guest command
  // running, so the deadline is enforced in the guest: `timeout` kills the
  // command (GNU timeout kills its whole process group).
  const inner = `sh -c ${quote(req.command)}`;
  const timeoutSecs = req.timeoutMs ? Math.max(1, Math.ceil(req.timeoutMs / 1000)) : 0;
  const run = timeoutSecs
    ? `if command -v timeout >/dev/null 2>&1; then ${envPrefix}timeout -s KILL ${timeoutSecs} ${inner}; else ${envPrefix}${inner}; fi`
    : `${envPrefix}${inner}`;
  const remote = (req.cwd ? `cd ${quote(req.cwd)} && ` : '') + run;

  const { khPath, alias } = await pinGuestHostKey(req, keyPath);
  return sshExec(sshArgs(req, keyPath, khPath, alias, 'yes'), remote, req);
}

function quote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
