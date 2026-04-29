/**
 * Vercel Provider - Factory-based Implementation
 */

import { Sandbox as VercelSandbox, Snapshot as VercelSnapshot } from '@vercel/sandbox';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import { Writable } from 'node:stream';

export type { VercelSandbox, VercelSnapshot };

import type { CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

export interface VercelConfig {
  token?: string;
  teamId?: string;
  projectId?: string;
  timeout?: number;
  ports?: number[];
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

function getUtf8Sink() {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
      cb();
    },
  });
  return { sink, value: () => chunks.join("") };
}

export const vercel = defineProvider<VercelSandbox, VercelConfig, any, VercelSnapshot>({
  name: 'vercel',
  methods: {
    sandbox: {
      create: async (config: VercelConfig, options?: CreateSandboxOptions) => {
        const creds = resolveCredentials(config);
        validateCredentials(creds);
        const timeout = options?.timeout ?? config.timeout ?? 300000;
        try {
          const {
            timeout: _timeout, envs: _envs, name: _name, metadata: _metadata,
            templateId, snapshotId: optSnapshotId, sandboxId: _sandboxId,
            namespace: _namespace, directory: _directory,
            ...providerOptions
          } = options || {};
          const optRuntime = (options as any)?.runtime;
          const optPorts = (options as any)?.ports;
          const optSource = (options as any)?.source;

          const params: any = { timeout, ...providerOptions };
          const ports = optPorts ?? config.ports;
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

          if (!creds.useOidc) {
            params.token = creds.token;
            params.teamId = creds.teamId;
            params.projectId = creds.projectId;
          }

          const sandbox = await VercelSandbox.create(params);
          return { sandbox, sandboxId: sandbox.sandboxId };
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
            ? await VercelSandbox.get({ sandboxId })
            : await VercelSandbox.get({ sandboxId, token: creds.token, teamId: creds.teamId, projectId: creds.projectId });
          return { sandbox, sandboxId };
        } catch { return null; }
      },

      list: async (_config: VercelConfig) => {
        throw new Error(`Vercel provider does not support listing sandboxes.`);
      },

      destroy: async (config: VercelConfig, sandboxId: string) => {
        const creds = resolveCredentials(config);
        try {
          const sandbox = creds.useOidc
            ? await VercelSandbox.get({ sandboxId })
            : await VercelSandbox.get({ sandboxId, token: creds.token, teamId: creds.teamId, projectId: creds.projectId });
          await sandbox.stop();
        } catch { /* already destroyed or doesn't exist */ }
      },

      runCommand: async (sandbox: VercelSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          let fullCommand = command;
          if (options?.env && Object.keys(options.env).length > 0) {
            const envPrefix = Object.entries(options.env).map(([k, v]) => `${k}="${escapeShellArg(v)}"`).join(' ');
            fullCommand = `${envPrefix} ${fullCommand}`;
          }
          const stdout = options?.background ? undefined : getUtf8Sink();
          const stderr = options?.background ? undefined : getUtf8Sink();
          const result = await sandbox.runCommand({
            cmd: 'sh', args: ['-c', fullCommand],
            cwd: options?.cwd, detached: options?.background,
            stdout: stdout?.sink, stderr: stderr?.sink,
          });
          return { stdout: stdout?.value() ?? '', stderr: stderr?.value() ?? '', exitCode: result.exitCode ?? 0, durationMs: Date.now() - startTime };
        } catch (error) {
          return { stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 127, durationMs: Date.now() - startTime };
        }
      },

      getInfo: async (_sandbox: VercelSandbox): Promise<SandboxInfo> => ({
        id: 'vercel-unknown',
        provider: 'vercel',
        status: 'running',
        createdAt: new Date(),
        timeout: 300000,
        metadata: { vercelSandboxId: 'vercel-unknown' }
      }),

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
        mkdir: async (sandbox: VercelSandbox, path: string): Promise<void> => { await sandbox.mkDir(path); },
        readdir: async (_sandbox: VercelSandbox, _path: string): Promise<FileEntry[]> => {
          throw new Error('Vercel sandbox does not support readdir.');
        },
        exists: async (_sandbox: VercelSandbox, _path: string): Promise<boolean> => {
          throw new Error('Vercel sandbox does not support exists.');
        },
        remove: async (_sandbox: VercelSandbox, _path: string): Promise<void> => {
          throw new Error('Vercel sandbox does not support remove.');
        }
      },

      getInstance: (sandbox: VercelSandbox): VercelSandbox => sandbox,
    },

    snapshot: {
      create: async (config: VercelConfig, sandboxId: string) => {
        const creds = resolveCredentials(config);
        const sandbox = creds.useOidc
          ? await VercelSandbox.get({ sandboxId })
          : await VercelSandbox.get({ sandboxId, token: creds.token, teamId: creds.teamId, projectId: creds.projectId });
        return await sandbox.snapshot();
      },
      list: async (_config: VercelConfig) => { throw new Error(`Vercel provider does not support listing snapshots.`); },
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
    }
  }
});
