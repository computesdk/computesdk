/**
 * Egress router setup — writes the self-contained on-box proxy shim into a
 * sandbox and starts it as a daemon job. Runs once at sandbox create when the
 * caller passes `CreateSandboxOptions.egress`.
 *
 * The shim holds no credentials: its config carries the injector URL, an
 * injector token, host rules and a mode — the off-box injector does the
 * credential substitution.
 */

import { egressShimScript } from 'daemond';
import type {
  ProcessHandle,
  SandboxEgressInfo,
  SandboxEgressOptions,
  SandboxFileSystem,
} from './types/index.js';

/** Directory the shim works out of inside the sandbox (CA, leaf certs, config). */
export const EGRESS_SHIM_DIR = '/tmp/computesdk-egress';

const SHIM_PATH = `${EGRESS_SHIM_DIR}/egress-shim.js`;
const CONFIG_PATH = `${EGRESS_SHIM_DIR}/config.json`;
const READY_PREFIX = 'EGRESS_READY ';
const ERROR_PREFIX = 'EGRESS_ERROR ';
const READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 250;

interface EgressHost {
  readonly filesystem: SandboxFileSystem;
  startProcess(command: string): Promise<ProcessHandle>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateEgressOptions(egress: SandboxEgressOptions): void {
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
const NODE_RESOLVER =
  'NODE_BIN="$(command -v node || command -v nodejs || true)"; ' +
  'if [ -z "$NODE_BIN" ]; then ' +
  'NODE_BIN="$(ls -d "${HOME:-/tmp}/.computesdk/daemond/node-v"*-linux-*/bin/node 2>/dev/null | head -n 1)"; ' +
  'fi; ' +
  'if [ -z "$NODE_BIN" ]; then echo "egress: no JavaScript runtime found in sandbox" >&2; exit 127; fi; ' +
  `exec "$NODE_BIN" ${SHIM_PATH} ${CONFIG_PATH}`;

interface ReadyMarker {
  port: number;
  caCertPath: string;
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

/**
 * Writes the shim + config into the sandbox, starts the router via
 * `startProcess`, and waits for its EGRESS_READY marker. Returns the
 * `SandboxEgressInfo` callers expose as `sandbox.egress`.
 */
export async function setupSandboxEgress(
  sandbox: EgressHost,
  egress: SandboxEgressOptions,
  providerName: string
): Promise<SandboxEgressInfo> {
  validateEgressOptions(egress);

  const config = {
    injectorUrl: egress.injectorUrl,
    injectorToken: egress.injectorToken,
    credentialedHosts: egress.credentialedHosts,
    mode: egress.mode ?? 'passthrough',
    port: egress.port ?? 0,
  };

  try {
    await sandbox.filesystem.mkdir(EGRESS_SHIM_DIR);
    await sandbox.filesystem.writeFile(SHIM_PATH, egressShimScript());
    await sandbox.filesystem.writeFile(CONFIG_PATH, JSON.stringify(config));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`egress: provider "${providerName}" cannot host the egress router — ${detail}`);
  }

  const handle = await sandbox.startProcess(NODE_RESOLVER);

  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastStdout = '';
  let lastStderr = '';
  for (;;) {
    const status = await handle.status();
    lastStdout = status.stdout;
    lastStderr = status.stderr;

    const ready = findMarker(lastStdout, READY_PREFIX);
    if (ready && typeof ready.port === 'number' && typeof ready.caCertPath === 'string') {
      return {
        proxyUrl: `http://127.0.0.1:${ready.port}`,
        caCertPath: ready.caCertPath,
        port: ready.port,
        processJobId: handle.jobId,
      };
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
