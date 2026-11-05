/**
 * Vercel Provider - Factory-based Implementation
 */

import { Sandbox as VercelSandbox, Snapshot as VercelSnapshot, Drive as VercelDrive } from '@vercel/sandbox';
import { defineProvider, resolveVolumeRef, isUnifiedVolumeMounts, withVolumeSettle } from '@computesdk/provider';
import { Writable } from 'node:stream';

export type { VercelSandbox, VercelSnapshot };

import type { CommandResult, InstanceInfo, CreateInstanceOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

export interface VercelConfig {
  token?: string;
  teamId?: string;
  projectId?: string;
  timeout?: number;
  ports?: number[];
  daemonSsePort?: number | false;
}

const DEFAULT_DAEMON_SSE_PORT = 38989;

function mergeExposedPorts(primary?: number[], fallback?: number[], daemonSsePort?: number | false): number[] {
  const daemonPort = daemonSsePort === false ? undefined : (daemonSsePort ?? DEFAULT_DAEMON_SSE_PORT);
  const merged = [...(primary ?? fallback ?? [])];
  if (typeof daemonPort === 'number') merged.push(daemonPort);
  return Array.from(new Set(merged.filter((port) => Number.isInteger(port) && port > 0 && port <= 65535)));
}

interface ResolvedCredentials {
  useOidc: boolean;
  token: string;
  teamId: string;
  projectId: string;
}

function resolveCredentials(config: VercelConfig): ResolvedCredentials {
  const token = config.token || (typeof process !== 'undefined' && process.env?.VERCEL_TOKEN) || '';
  const teamId = config.teamId || (typeof process !== 'undefined' && process.env?.VERCEL_TEAM_ID) || '';
  const projectId = config.projectId || (typeof process !== 'undefined' && process.env?.VERCEL_PROJECT_ID) || '';
  const hasConfigCredentials = !!(config.token || config.teamId || config.projectId);
  const oidcToken = typeof process !== 'undefined' && process.env?.VERCEL_OIDC_TOKEN;
  const useOidc = !hasConfigCredentials && !!oidcToken;
  return { useOidc, token, teamId, projectId };
}

function validateCredentials(creds: ResolvedCredentials): void {
  if (creds.useOidc) return;
  if (!creds.token) {
    throw new Error(
      `Missing Vercel authentication. Either:\n` +
      `1. Use OIDC token: Run 'vercel env pull' to get VERCEL_OIDC_TOKEN, or\n` +
      `2. Use traditional method: Provide 'token' in config or set VERCEL_TOKEN environment variable.`
    );
  }
  if (!creds.teamId) throw new Error(`Missing Vercel team ID. Provide 'teamId' in config or set VERCEL_TEAM_ID.`);
  if (!creds.projectId) throw new Error(`Missing Vercel project ID. Provide 'projectId' in config or set VERCEL_PROJECT_ID.`);
}

function getUtf8Sink(onChunk?: (data: string) => void) {
  const chunks: string[] = [];
  const sink = new Writable({
    decodeStrings: false,
    write(chunk, _enc, cb) {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      chunks.push(text);
      if (text && onChunk) onChunk(text);
      cb();
    },
  });
  return { sink, value: () => chunks.join("") };
}

function credentialParams(creds: ResolvedCredentials) {
  return creds.useOidc ? {} : { token: creds.token, teamId: creds.teamId, projectId: creds.projectId };
}

// `setsid` gives the command its own process group, so the watchdog can kill
// the whole tree, not just the outer shell.
const DEADLINE_WRAPPER = 'if command -v setsid >/dev/null 2>&1; then setsid sh -c "$1" & else sh -c "$1" & fi; pid=$!; (sleep "$0"; kill -KILL -"$pid" || kill -KILL "$pid") >/dev/null 2>&1 & w=$!; wait "$pid"; rc=$?; kill "$w" 2>/dev/null; exit $rc';

// Runs through the SDK's native env/cwd fields; stdout/stderr arrive on the
// sinks while the command runs, so the same path serves streamCommand.
async function execCommand(sandbox: VercelSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> {
  const startTime = Date.now();
  try {
    const env = options?.env && Object.keys(options.env).length > 0 ? options.env : undefined;
    const stdout = options?.background ? undefined : getUtf8Sink(options?.onStdout);
    const stderr = options?.background ? undefined : getUtf8Sink(options?.onStderr);
    const deadline = options?.timeout && !options.background ? options.timeout : undefined;
    // A watchdog in the box kills the command's whole process group at the
    // deadline; the abort is a backstop so the caller still returns on time.
    const args = deadline ? ['-c', DEADLINE_WRAPPER, String(deadline / 1000), command] : ['-c', command];
    const controller = deadline ? new AbortController() : undefined;
    const timer = deadline ? setTimeout(() => controller!.abort(), deadline + 3000) : undefined;
    try {
      const result = await sandbox.runCommand({
        cmd: 'sh', args,
        cwd: options?.cwd, env, detached: options?.background,
        stdout: stdout?.sink, stderr: stderr?.sink,
        signal: controller?.signal,
      });
      return { stdout: stdout?.value() ?? '', stderr: stderr?.value() ?? '', exitCode: result.exitCode ?? 0, durationMs: Date.now() - startTime };
    } catch (error) {
      if (controller?.signal.aborted) {
        return { stdout: stdout?.value() ?? '', stderr: `${stderr?.value() ?? ''}Command timed out after ${deadline}ms`, exitCode: 124, durationMs: Date.now() - startTime };
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (error) {
    return { stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 127, durationMs: Date.now() - startTime };
  }
}

export const vercel = defineProvider<VercelSandbox, VercelConfig>({
  name: 'vercel',
  methods: {
    instances: {
      create: async (config: VercelConfig, options?: CreateInstanceOptions) => {
        const creds = resolveCredentials(config);
        validateCredentials(creds);
        const timeout = options?.timeout ?? config.timeout ?? 300000;
        try {
          const {
            timeout: _timeout, envs, name, metadata: _metadata,
            templateId, snapshotId: optSnapshotId, sandboxId: _sandboxId,
            namespace: _namespace, directory: _directory,
            volumes,
            ...providerOptions
          } = options || {};
          // `volumes` only counts as unified VolumeMount[] when every entry
          // carries `volume`; a provider-native volumes spec stays in
          // providerOptions and reaches the wire untouched.
          const unifiedVolumes = isUnifiedVolumeMounts(volumes) ? volumes : undefined;
          if (volumes !== undefined && !unifiedVolumes) (providerOptions as any).volumes = volumes;
          const optRuntime = (options as any)?.runtime;
          const optPorts = (options as any)?.ports;
          const optSource = (options as any)?.source;

          const params: any = { timeout, ...providerOptions };
          if (envs && Object.keys(envs).length > 0) params.env = { ...envs, ...(providerOptions as any).env };
          if (name) params.name = name;
          // Vercel sandboxes are persistent by default, which auto-snapshots the
          // filesystem on every stop() and accrues Snapshot Storage. ComputeSDK
          // sandboxes default to non-persistent unless the caller opts in via
          // `persistent: true` or asks for the durable surface (`ephemeral: false`).
          params.persistent = providerOptions.persistent ?? (providerOptions.ephemeral === false);
          const optDaemonSsePort = (options as any)?.daemonSsePort as number | false | undefined;
          const ports = mergeExposedPorts(optPorts, config.ports, optDaemonSsePort ?? config.daemonSsePort);
          if (ports && ports.length > 0) params.ports = ports;

          if (optRuntime) {
            params.runtime =
              optRuntime === 'node' ? 'node24' :
              optRuntime === 'python' ? 'python3.13' :
              optRuntime;
          }

          const snapshotId = optSnapshotId || templateId ||
            (optSource?.type === 'snapshot' && optSource?.snapshotId);
          if (snapshotId) {
            params.source = { type: 'snapshot', snapshotId };
          } else if (optSource) {
            params.source = optSource;
          }

          // Unified mounts → vercel's {path: {drive, mode}} wire shape.
          if (unifiedVolumes) {
            params.mounts = Object.fromEntries((unifiedVolumes as any[]).map((m) => {
              const ref = resolveVolumeRef(m.volume);
              // The `drive` field serializes verbatim and the API resolves it
              // by NAME (a Drive object mounts as mount.name) — sending
              // driveId yields "Drive not found".
              return [m.mountPath, { drive: ref.name ?? ref.id, mode: m.readOnly ? 'snapshot' : 'read-write' }];
            }));
          }

          if (!creds.useOidc) {
            params.token = creds.token;
            params.teamId = creds.teamId;
            params.projectId = creds.projectId;
          }

          const sandbox = await VercelSandbox.create(params);
          return { instance: sandbox, instanceId: sandbox.name };
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('unauthorized') || error.message.includes('token')) {
              throw new Error(`Vercel authentication failed. Please check your VERCEL_TOKEN environment variable.`);
            }
            if (error.message.includes('team') || error.message.includes('project')) {
              throw new Error(`Vercel team/project configuration failed. Check VERCEL_TEAM_ID and VERCEL_PROJECT_ID.`);
            }
          }
          throw new Error(`Failed to create Vercel sandbox: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      getById: async (config: VercelConfig, sandboxId: string) => {
        const creds = resolveCredentials(config);
        try {
          const sandbox = creds.useOidc
            ? await VercelSandbox.get({ name: sandboxId })
            : await VercelSandbox.get({ name: sandboxId, token: creds.token, teamId: creds.teamId, projectId: creds.projectId });
          return { instance: sandbox, instanceId: sandboxId };
        } catch { return null; }
      },

      list: async (config: VercelConfig) => {
        const creds = resolveCredentials(config);
        validateCredentials(creds);
        const page = await VercelSandbox.list({ ...credentialParams(creds), sortBy: 'createdAt', sortOrder: 'desc' } as any);
        const live = (page.sandboxes ?? []).filter((s: any) => s.status === 'running' || s.status === 'pending');
        const sandboxes = await Promise.all(live.map((s: any) =>
          VercelSandbox.get({ name: s.name, ...credentialParams(creds) } as any).catch(() => null)));
        return sandboxes
          .filter((s): s is VercelSandbox => s !== null)
          .map((sandbox) => ({ instance: sandbox, instanceId: sandbox.name }));
      },

      destroy: async (config: VercelConfig, sandboxId: string) => {
        const creds = resolveCredentials(config);
        try {
          const sandbox = creds.useOidc
            ? await VercelSandbox.get({ name: sandboxId })
            : await VercelSandbox.get({ name: sandboxId, token: creds.token, teamId: creds.teamId, projectId: creds.projectId });
          await sandbox.stop();
        } catch { /* already destroyed or doesn't exist */ }
      },

      runCommand: (sandbox: VercelSandbox, command: string, options?: RunCommandOptions) => execCommand(sandbox, command, options),

      streamCommand: (sandbox: VercelSandbox, command: string, options: RunCommandOptions) => execCommand(sandbox, command, options),

      getInfo: async (sandbox: VercelSandbox): Promise<InstanceInfo> => {
        const status = sandbox.status;
        return {
          id: sandbox.name,
          provider: 'vercel',
          status: status === 'failed' || status === 'aborted' ? 'error'
            : status === 'stopping' || status === 'stopped' ? 'stopped'
            : 'running',
          createdAt: sandbox.createdAt,
          timeout: sandbox.timeout ?? 300000,
          metadata: { vercelSandboxName: sandbox.name, vercelStatus: status },
        };
      },

      getUrl: async (sandbox: VercelSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        try {
          let url = sandbox.domain(options.port);
          if (options.protocol) {
            const urlObj = new URL(url);
            urlObj.protocol = options.protocol + ':';
            url = urlObj.toString();
          }
          return url;
        } catch (error) {
          throw new Error(`Failed to get Vercel domain for port ${options.port}: ${error instanceof Error ? error.message : String(error)}.`);
        }
      },

      filesystem: {
        readFile: async (sandbox: VercelSandbox, path: string): Promise<string> => {
          const stream = await sandbox.readFile({ path });
          if (!stream) throw new Error(`File not found: ${path}`);
          const chunks: Buffer[] = [];
          for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          return Buffer.concat(chunks).toString('utf-8');
        },
        writeFile: async (sandbox: VercelSandbox, path: string, content: string): Promise<void> => {
          await sandbox.writeFiles([{ path, content: Buffer.from(content) }]);
        },
        mkdir: async (sandbox: VercelSandbox, path: string): Promise<void> => {
          await sandbox.fs.mkdir(path, { recursive: true });
        },
        readdir: async (sandbox: VercelSandbox, path: string): Promise<FileEntry[]> => {
          const entries = await sandbox.fs.readdir(path, { withFileTypes: true });
          return entries.map((entry) => ({
            name: entry.name,
            type: entry.isDirectory() ? 'directory' : 'file',
          }));
        },
        exists: async (sandbox: VercelSandbox, path: string): Promise<boolean> => {
          return sandbox.fs.exists(path);
        },
        remove: async (sandbox: VercelSandbox, path: string): Promise<void> => {
          await sandbox.fs.rm(path, { recursive: true, force: true });
        }
      },

      getInstance: (sandbox: VercelSandbox): VercelSandbox => sandbox,
    },

    snapshot: {
      create: async (config: VercelConfig, sandboxId: string, options?: { name?: string }) => {
        const creds = resolveCredentials(config);
        const sandbox = creds.useOidc
          ? await VercelSandbox.get({ name: sandboxId })
          : await VercelSandbox.get({ name: sandboxId, token: creds.token, teamId: creds.teamId, projectId: creds.projectId });
        const snapshot = await sandbox.snapshot();
        // @vercel/sandbox's Snapshot class exposes `snapshotId`, not `id` —
        // map it to the ComputeSDK Snapshot shape ({ id }) consumers rely on.
        return {
          id: snapshot.snapshotId,
          provider: 'vercel',
          createdAt: snapshot.createdAt,
          metadata: { name: options?.name, sourceSessionId: snapshot.sourceSessionId },
        };
      },
      list: async (config: VercelConfig) => {
        const creds = resolveCredentials(config);
        validateCredentials(creds);
        const page = await VercelSnapshot.list(credentialParams(creds) as any);
        return (page.snapshots ?? [])
          .filter((snap: any) => snap.status === 'created')
          .map((snap: any) => ({
            id: snap.id,
            provider: 'vercel',
            createdAt: new Date(snap.createdAt),
            metadata: { sourceSessionId: snap.sourceSessionId, sizeBytes: snap.sizeBytes, region: snap.region },
          }));
      },
      delete: async (config: VercelConfig, snapshotId: string) => {
        const creds = resolveCredentials(config);
        const snapshot = creds.useOidc
          ? await VercelSnapshot.get({ snapshotId })
          : await VercelSnapshot.get({ snapshotId, token: creds.token, teamId: creds.teamId, projectId: creds.projectId });
        await snapshot.delete();
      }
    },

    template: {
      create: async (_config: VercelConfig, _options: { name: string }) => {
        throw new Error(`Vercel does not support creating templates directly. Use snapshot.create() instead.`);
      },
      list: async (_config: VercelConfig) => { throw new Error(`Vercel provider does not support listing templates.`); },
      delete: async (config: VercelConfig, templateId: string) => {
        const creds = resolveCredentials(config);
        const snapshot = creds.useOidc
          ? await VercelSnapshot.get({ snapshotId: templateId })
          : await VercelSnapshot.get({ snapshotId: templateId, token: creds.token, teamId: creds.teamId, projectId: creds.projectId });
        await snapshot.delete();
      }
    },

    volume: {
      create: async (config: VercelConfig, options) => {
        const creds = resolveCredentials(config);
        validateCredentials(creds);
        const params = creds.useOidc
          ? { name: options.name }
          : { name: options.name, token: creds.token, teamId: creds.teamId, projectId: creds.projectId };
        const drive = await VercelDrive.getOrCreate(params as any);
        return { id: drive.driveId, name: drive.name, native: drive };
      },
      get: async (config: VercelConfig, name: string) => {
        const creds = resolveCredentials(config);
        validateCredentials(creds);
        try {
          const params = creds.useOidc
            ? { name }
            : { name, token: creds.token, teamId: creds.teamId, projectId: creds.projectId };
          const drive = await VercelDrive.get(params as any);
          return { id: drive.driveId, name: drive.name, native: drive };
        } catch { return null; }
      },
      list: async (config: VercelConfig) => {
        const creds = resolveCredentials(config);
        validateCredentials(creds);
        const params = creds.useOidc
          ? {}
          : { token: creds.token, teamId: creds.teamId, projectId: creds.projectId };
        const page = await VercelDrive.list(params as any);
        const out: any[] = [];
        for await (const drive of page as any) {
          out.push({ id: drive.driveId, name: drive.name, native: drive });
        }
        return out;
      },
      delete: async (config: VercelConfig, name: string) => {
        const creds = resolveCredentials(config);
        validateCredentials(creds);
        const params = creds.useOidc
          ? { name }
          : { name, token: creds.token, teamId: creds.teamId, projectId: creds.projectId };
        const drive = await VercelDrive.get(params as any);
        await withVolumeSettle(() => drive.delete());
      },
    }
  }
});
