// Self-brokering transport for the ec2-firecrab adapter.
//
// firecrab's API is an unauthenticated loopback listener and guest bridge IPs
// are only routable from the host, so off-host callers need SSH twice: a
// local-forward for the API and a ProxyCommand jumphost for guest exec.
// Rather than making the caller wire both (and a tunnel step in CI), one
// `sshTarget` + key is used to lazily establish both, cached per process.
// Multiple hosts (a pool) come from `sshTargets` / EC2_FIRECRAB_SSH_TARGETS —
// one tunnel per host, the same key material.

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

// Host-facing ssh pins the first-seen host key (accept-new): a pool host's
// identity is stable, so impersonation after the first connect is detected.
const sshBase = [
  '-o', 'BatchMode=yes',
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'IdentitiesOnly=yes',
  '-o', 'ConnectTimeout=15',
  '-o', 'LogLevel=ERROR',
];

function resolveSshTargets(config: Ec2FirecrabConfig): string[] {
  if (config.sshTargets?.length) return config.sshTargets;
  if (config.sshTarget) return [config.sshTarget];
  // An explicit apiUrl means the caller owns the transport; env targets
  // are only fallbacks and must not override it.
  if (config.apiUrl) return [];
  const csv = process.env.EC2_FIRECRAB_SSH_TARGETS;
  if (csv) return csv.split(',').map((s) => s.trim()).filter(Boolean);
  const single = config.sshTarget ?? process.env.EC2_FIRECRAB_SSH_TARGET;
  return single ? [single] : [];
}

// PEM material is written once per unique blob — reusing the path keeps the
// tunnelCache key (target|identityPath) stable, so repeated operations share
// one tunnel instead of leaking a tunnel + port per call.
const pemFileCache = new Map<string, string>();

// Vaults that can't hold multi-line values store the PEM base64-encoded
// (`base64 < key.pem | tr -d '\n'`); accept both forms.
function decodePem(value: string | undefined): string | undefined {
  if (!value || value.includes('-----BEGIN')) return value;
  const compact = value.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return value;
  const decoded = Buffer.from(compact, 'base64').toString('utf8');
  return decoded.includes('-----BEGIN') ? decoded : value;
}

function resolveSsh(config: Ec2FirecrabConfig, target: string): ResolvedSsh {
  const pem = decodePem(
    config.sshIdentityPem ||
    process.env.EC2_FIRECRAB_SSH_KEY ||
    undefined,
  );
  const path =
    config.sshIdentityPath || process.env.EC2_FIRECRAB_SSH_KEY_PATH || undefined;
  if (pem && pem.includes('-----BEGIN')) {
    let identityPath = pemFileCache.get(pem);
    if (!identityPath) {
      const dir = mkdtempSync(join(tmpdir(), 'ec2-firecrab-host-'));
      identityPath = join(dir, 'id_key');
      writeFileSync(identityPath, pem.endsWith('\n') ? pem : pem + '\n', {
        mode: 0o600,
      });
      pemFileCache.set(pem, identityPath);
    }
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

async function waitForApi(
  apiUrl: string,
  timeoutMs: number,
  tunnelExited: () => string | undefined = () => undefined,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline && !tunnelExited()) {
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

async function establish(
  config: Ec2FirecrabConfig,
  target: string | null,
): Promise<FirecrabAccess> {
  if (!target) {
    // No SSH target: caller is on the host or already tunneled.
    const apiUrl = config.apiUrl ?? process.env.EC2_FIRECRAB_API_URL;
    return apiUrl
      ? { apiUrl, proxyCommand: config.sshProxyCommand }
      : { apiUrl: 'http://127.0.0.1:5523', proxyCommand: config.sshProxyCommand };
  }
  const ssh = resolveSsh(config, target);

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
          '--',
          ssh.target,
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      children.add(child);
      // Keep ssh's own diagnostics (auth, host key, routing) for the error.
      let sshStderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        if (sshStderr.length < 2000) sshStderr += chunk.toString();
      });
      let exited: string | undefined;
      child.once('exit', (code, signal) => {
        children.delete(child);
        exited = signal ? `signal ${signal}` : `exit ${code}`;
      });
      child.unref();
      (child.stderr as { unref?: () => void } | null)?.unref?.();
      const apiUrl = `http://127.0.0.1:${port}`;
      try {
        await waitForApi(apiUrl, 15_000, () => exited);
      } catch (err) {
        child.kill('SIGKILL');
        const detail = sshStderr.trim();
        throw new Error(
          `${(err as Error).message}${exited ? ` (ssh ${exited})` : ''}${detail ? `: ${detail}` : ''}`,
        );
      }
      const proxyCommand =
        config.sshProxyCommand ||
        process.env.EC2_FIRECRAB_SSH_PROXY_COMMAND ||
        `ssh ${sshBase.join(' ')} ${ssh.identityPath ? `-i ${quote(ssh.identityPath)}` : ''} -W %h:%p -- ${quote(ssh.target)}`;
      return { apiUrl, proxyCommand };
    })();
    tunnelCache.set(key, access);
    access.catch(() => tunnelCache.delete(key));
  }
  return access;
}

export function ensureAccess(config: Ec2FirecrabConfig): Promise<FirecrabAccess> {
  return establish(config, resolveSshTargets(config)[0] ?? null);
}

/**
 * Access for every configured host. With multiple sshTargets each host gets
 * its own API tunnel and derived ProxyCommand; the caller round-robins
 * creates and routes per-instance ops through the stamped apiUrl/proxyCommand.
 */
export async function ensureAccesses(
  config: Ec2FirecrabConfig,
): Promise<FirecrabAccess[]> {
  const targets = resolveSshTargets(config);
  if (!targets.length) return [await establish(config, null)];
  // One unreachable pool member shouldn't take down the rest — establish
  // every host independently and keep the ones that came up.
  const settled = await Promise.allSettled(
    targets.map((t) => establish(config, t)),
  );
  const accesses = settled
    .filter(
      (r): r is PromiseFulfilledResult<FirecrabAccess> =>
        r.status === 'fulfilled',
    )
    .map((r) => r.value);
  if (!accesses.length) {
    const reasons = settled
      .map((r, i) =>
        r.status === 'rejected' ? `${targets[i]}: ${r.reason}` : null,
      )
      .filter(Boolean)
      .join('; ');
    throw new Error(`ec2-firecrab: no configured host is reachable (${reasons})`);
  }
  return accesses;
}
