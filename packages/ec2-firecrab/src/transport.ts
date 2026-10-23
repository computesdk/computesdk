// Self-brokering transport for the ec2-firecrab adapter.
//
// firecrab's API is an unauthenticated loopback listener and guest bridge IPs
// are only routable from the host, so off-host callers need SSH twice: a
// local-forward for the API and a ProxyCommand jumphost for guest exec.
// Rather than making the caller wire both (and a tunnel step in CI), one
// `sshTarget` + key is used to lazily establish both, cached per process.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Ec2FirecrabConfig } from './index.js';

export interface FirecrabAccess {
  /** Base URL for the firecrab API (local forward if tunneled). */
  apiUrl: string;
  /** Derived OpenSSH ProxyCommand for guest exec, when tunneled. */
  proxyCommand?: string;
}

interface ResolvedSsh {
  target: string;
  /** Host key material written to a 0600 temp file, or explicit path. */
  identityPath?: string;
}

const sshBase = [
  '-o', 'BatchMode=yes',
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'UserKnownHostsFile=/dev/null',
  '-o', 'IdentitiesOnly=yes',
  '-o', 'ConnectTimeout=15',
  '-o', 'LogLevel=ERROR',
];

function resolveSsh(config: Ec2FirecrabConfig): ResolvedSsh | null {
  const target = config.sshTarget ?? process.env.EC2_FIRECRAB_SSH_TARGET;
  if (!target) return null;
  const pem =
    config.sshIdentityPem ??
    process.env.EC2_FIRECRAB_SSH_KEY ??
    undefined;
  const path =
    config.sshIdentityPath ?? process.env.EC2_FIRECRAB_SSH_KEY_PATH ?? undefined;
  if (pem && pem.includes('-----BEGIN')) {
    const dir = mkdtempSync(join(tmpdir(), 'ec2-firecrab-host-'));
    const identityPath = join(dir, 'id_key');
    writeFileSync(identityPath, pem.endsWith('\n') ? pem : pem + '\n', {
      mode: 0o600,
    });
    return { target, identityPath };
  }
  return { target, identityPath: path ?? (pem || undefined) };
}

function quote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

async function waitForApi(apiUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      // /api/vms is a cheap authenticated-surface probe; any HTTP response
      // (even a 4xx) proves the forward is live.
      await fetch(apiUrl + '/api/vms', { signal: AbortSignal.timeout(2000) });
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(
    `ec2-firecrab: SSH tunnel to ${apiUrl} did not come up: ${String(lastErr)}`,
  );
}

// One tunnel per (target, key) for the process; all sandboxes share it.
const tunnelCache = new Map<string, Promise<FirecrabAccess>>();
const children = new Set<ReturnType<typeof spawn>>();
process.on('exit', () => {
  for (const child of children) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
});

async function establish(config: Ec2FirecrabConfig): Promise<FirecrabAccess> {
  const ssh = resolveSsh(config);
  if (!ssh) {
    // No SSH target: caller is on the host or already tunneled.
    const apiUrl = config.apiUrl ?? process.env.EC2_FIRECRAB_API_URL;
    return apiUrl
      ? { apiUrl, proxyCommand: config.sshProxyCommand }
      : { apiUrl: 'http://127.0.0.1:5523', proxyCommand: config.sshProxyCommand };
  }

  const key = `${ssh.target}|${ssh.identityPath ?? ''}`;
  let access = tunnelCache.get(key);
  if (!access) {
    access = (async (): Promise<FirecrabAccess> => {
      const port = await freePort();
      const identityArgs = ssh.identityPath ? ['-i', ssh.identityPath] : [];
      const child = spawn(
        'ssh',
        [
          ...sshBase,
          ...identityArgs,
          '-N',
          '-L',
          `${port}:127.0.0.1:5523`,
          ssh.target,
        ],
        { stdio: 'ignore' },
      );
      children.add(child);
      child.once('exit', () => children.delete(child));
      child.unref();
      const apiUrl = `http://127.0.0.1:${port}`;
      try {
        await waitForApi(apiUrl, 15_000);
      } catch (err) {
        child.kill('SIGKILL');
        throw err;
      }
      const proxyCommand =
        config.sshProxyCommand ??
        process.env.EC2_FIRECRAB_SSH_PROXY_COMMAND ??
        `ssh ${sshBase.join(' ')} ${ssh.identityPath ? `-i ${quote(ssh.identityPath)}` : ''} -W %h:%p ${quote(ssh.target)}`;
      return { apiUrl, proxyCommand };
    })();
    tunnelCache.set(key, access);
    access.catch(() => tunnelCache.delete(key));
  }
  return access;
}

export function ensureAccess(config: Ec2FirecrabConfig): Promise<FirecrabAccess> {
  return establish(config);
}
