/**
 * Egress router setup — writes the self-contained on-box proxy shim into an
 * instance and starts it as a daemon job. Runs once at instance create when
 * the caller passes `CreateInstanceOptions.egress`.
 *
 * The shim holds no credentials: its config carries the injector URL, an
 * injector token, host rules and a mode — the off-box injector does the
 * credential substitution.
 */

import { egressShimScript } from 'daemond';
import type {
  ProcessHandle,
  InstanceEgressInfo,
  InstanceEgressOptions,
  InstanceFileSystem,
} from './types/index.js';
import { randomBytes } from 'node:crypto';

/** Root dir inside the instance; each router gets a subdirectory. */
export const EGRESS_SHIM_DIR = '/tmp/computesdk-egress';

/** Points at the most recent router's info so reconnects can recover it. */
const POINTER_PATH = `${EGRESS_SHIM_DIR}/current.json`;
const READY_PREFIX = 'EGRESS_READY ';
const ERROR_PREFIX = 'EGRESS_ERROR ';
const READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 250;

interface EgressHost {
  readonly filesystem: InstanceFileSystem;
  startProcess(command: string): Promise<ProcessHandle>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^[[\]]+/g, '').replace(/[\]]+$/g, '');
  return normalized === 'localhost' || normalized === '::1' || normalized.startsWith('127.');
}

function validateEgressOptions(egress: InstanceEgressOptions): void {
  if (!egress || typeof egress !== 'object') {
    throw new Error('egress: options must be an object');
  }
  let injectorUrl: URL;
  try {
    injectorUrl = new URL(egress.injectorUrl);
  } catch {
    throw new Error(`egress: injectorUrl must be an http(s) URL (got ${JSON.stringify(egress.injectorUrl)})`);
  }
  if (injectorUrl.protocol !== 'https:' && injectorUrl.protocol !== 'http:') {
    throw new Error(`egress: injectorUrl must be an http(s) URL (got ${JSON.stringify(egress.injectorUrl)})`);
  }
  if (injectorUrl.protocol === 'http:' && !isLoopbackHost(injectorUrl.hostname)) {
    throw new Error(
      'egress: injectorUrl must be https — plain http is only allowed for loopback injectors ' +
        '(the token and decrypted requests travel in cleartext)'
    );
  }
  if (!Array.isArray(egress.credentialedHosts) || egress.credentialedHosts.length === 0) {
    throw new Error('egress: credentialedHosts must be a non-empty array of hostnames');
  }
  for (const host of egress.credentialedHosts) {
    if (typeof host !== 'string' || !host.trim()) {
      throw new Error('egress: credentialedHosts entries must be non-empty hostnames');
    }
  }
  const mode = egress.mode ?? 'passthrough';
  if (mode !== 'passthrough' && mode !== 'allowlist') {
    throw new Error(`egress: mode must be "passthrough" or "allowlist" (got ${JSON.stringify(egress.mode)})`);
  }
  if (egress.port !== undefined && (!Number.isInteger(egress.port) || egress.port < 0 || egress.port > 65535)) {
    throw new Error('egress: port must be an integer between 0 and 65535');
  }
}

/**
 * Shell that resolves a node binary for the shim the same way the daemon
 * bootstrap does: PATH first, then the cached download under
 * `~/.computesdk/daemond`. startProcess boots the daemon first, so a binary
 * is guaranteed reachable by the time this runs.
 */
const nodeResolverFor = (shimPath: string, configPath: string) =>
  'NODE_BIN="$(command -v node || command -v nodejs || true)"; ' +
  'if [ -z "$NODE_BIN" ]; then ' +
  'NODE_BIN="$(ls -d "${HOME:-/tmp}/.computesdk/daemond/node-v"*-linux-*/bin/node 2>/dev/null | head -n 1)"; ' +
  'fi; ' +
  'if [ -z "$NODE_BIN" ]; then echo "egress: no JavaScript runtime found in instance" >&2; exit 127; fi; ' +
  `exec "$NODE_BIN" ${shimPath} ${configPath}`;

interface ReadyMarker {
  port: number;
  caCertPath: string;
  caBundlePath?: string;
  pid?: number;
}

function findMarker(stdout: string, prefix: string): Record<string, unknown> | undefined {
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(prefix)) continue;
    try {
      const parsed = JSON.parse(trimmed.slice(prefix.length));
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      /* partial line — keep polling */
    }
  }
  return undefined;
}

async function readInstanceFile(instance: EgressHost, path: string, timeoutMs = 5_000): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    instance.filesystem.readFile(path),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('instance read timed out')), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Recovers the router info of an instance after a reconnect (getById/list) by
 * reading the pointer file the most recent setup wrote. Returns undefined
 * when the instance has no router or the filesystem read fails.
 */
export async function readInstanceEgress(instance: EgressHost): Promise<InstanceEgressInfo | undefined> {
  try {
    const parsed = JSON.parse(await readInstanceFile(instance, POINTER_PATH));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.proxyUrl !== 'string') {
      return undefined;
    }
    // Liveness: a dead router leaves a stale pointer, so only advertise the
    // info while its process still exists on the box — and is actually the
    // shim, since the kernel can hand a dead router's pid to something else.
    if (typeof parsed.pid === 'number') {
      const cmdline = await readInstanceFile(instance, `/proc/${parsed.pid}/cmdline`);
      if (!cmdline.includes('egress-shim')) return undefined;
    }
    return parsed as InstanceEgressInfo;
  } catch {
    /* no pointer file, dead router, or unreadable filesystem */
  }
  return undefined;
}

/** @deprecated Use {@link readInstanceEgress}. */
export const readSandboxEgress = readInstanceEgress;

/**
 * Writes the shim + config into the instance, starts the router via
 * `startProcess`, and waits for its EGRESS_READY marker. Returns the
 * `InstanceEgressInfo` callers expose as `instance.egress`.
 */
export async function setupInstanceEgress(
  instance: EgressHost,
  egress: InstanceEgressOptions,
  providerName: string
): Promise<InstanceEgressInfo> {
  validateEgressOptions(egress);

  const config = {
    injectorUrl: egress.injectorUrl,
    injectorToken: egress.injectorToken,
    credentialedHosts: egress.credentialedHosts,
    mode: egress.mode ?? 'passthrough',
    port: egress.port ?? 0,
  };

  // Each router gets its own workdir so two routers on one instance never
  // share a CA or host rules; the shim treats the config's directory as its
  // workdir.
  const instanceDir = `${EGRESS_SHIM_DIR}/${randomBytes(8).toString('hex')}`;
  const shimPath = `${instanceDir}/egress-shim.js`;
  const configPath = `${instanceDir}/config.json`;

  try {
    await instance.filesystem.mkdir(EGRESS_SHIM_DIR).catch(() => {});
    await instance.filesystem.mkdir(instanceDir);
    await instance.filesystem.writeFile(shimPath, egressShimScript());
    await instance.filesystem.writeFile(configPath, JSON.stringify(config));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`egress: provider "${providerName}" cannot host the egress router — ${detail}`);
  }

  const handle = await instance.startProcess(nodeResolverFor(shimPath, configPath));

  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastStdout = '';
  let lastStderr = '';
  for (;;) {
    const status = await handle.status();
    lastStdout = status.stdout;
    lastStderr = status.stderr;

    const ready = findMarker(lastStdout, READY_PREFIX);
    if (ready && typeof ready.port === 'number' && typeof ready.caCertPath === 'string') {
      const marker = ready as unknown as ReadyMarker;
      const info: InstanceEgressInfo = {
        proxyUrl: `http://127.0.0.1:${marker.port}`,
        caCertPath: marker.caCertPath,
        caBundlePath: marker.caBundlePath,
        port: marker.port,
        pid: marker.pid,
        processJobId: handle.jobId,
      };
      // Best-effort pointer for reconnects (getById/list); not fatal.
      await instance.filesystem
        .writeFile(POINTER_PATH, JSON.stringify(info))
        .catch(() => {});
      return info;
    }

    const reported = findMarker(lastStdout, ERROR_PREFIX);
    if (reported && typeof reported.message === 'string') {
      throw new Error(`egress: router failed to start: ${reported.message}`);
    }

    if (status.status === 'exited') {
      const detail = (lastStderr || lastStdout).trim().slice(-400) || `exit code ${status.exitCode}`;
      throw new Error(`egress: router exited before becoming ready — ${detail}`);
    }

    if (Date.now() >= deadline) {
      const detail = (lastStderr || lastStdout).trim().slice(-400);
      await handle.kill().catch(() => {});
      throw new Error(
        `egress: router did not become ready within ${READY_TIMEOUT_MS}ms` + (detail ? ` — ${detail}` : '')
      );
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

/** @deprecated Use {@link setupInstanceEgress}. */
export const setupSandboxEgress = setupInstanceEgress;
