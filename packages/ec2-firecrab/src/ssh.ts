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
import { mkdtempSync, writeFileSync } from 'node:fs';
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
  /** Command run through `sh -lc` in the guest. */
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

export async function runSshCommand(req: SshExecRequest): Promise<SshExecResult> {
  const dir = mkdtempSync(join(tmpdir(), 'ec2-firecrab-'));
  const keyPath = join(dir, 'id_ed25519');
  writeFileSync(keyPath, req.identityPem, { mode: 0o600 });

  const remote =
    (req.cwd ? `cd ${quote(req.cwd)} && ` : '') +
    (req.env ? Object.entries(req.env).map(([k, v]) => `${k}=${quote(v)} `).join('') : '') +
    `sh -lc ${quote(req.command)}`;

  const args = [
    '-i', keyPath,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=15',
    '-o', 'LogLevel=ERROR',
    ...(req.proxyCommand ? ['-o', `ProxyCommand=${req.proxyCommand}`] : []),
    `${req.user ?? 'root'}@${req.host}`,
    '--',
    remote,
  ];

  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    const timer = req.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`ec2-firecrab runCommand timed out after ${req.timeoutMs}ms`));
        }, req.timeoutMs)
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
      resolve({
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
        exitCode: code ?? 1,
        durationMs: Date.now() - started,
      });
    });
  });
}

function quote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
