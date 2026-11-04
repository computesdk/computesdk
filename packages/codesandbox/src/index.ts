/**
 * Codesandbox Provider - Factory-based Implementation
 */

import { CodeSandbox } from '@codesandbox/sdk';
import type { Sandbox as CodesandboxSandbox } from '@codesandbox/sdk';
import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { CommandResult, InstanceInfo, CreateInstanceOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

export interface CodesandboxConfig {
  /** CodeSandbox API key - if not provided, will fallback to CSB_API_KEY environment variable */
  apiKey?: string;
  /** Template to use for new sandboxes */
  templateId?: string;
  /** Default runtime environment (e.g. 'node', 'python') */
  runtime?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

/** Safe lifecycle diagnostics, without native errors, request data or causes. */
export class CodeSandboxLifecycleError extends Error {
  readonly code = 'CODESANDBOX_LIFECYCLE_ERROR' as const;
  readonly provider = 'codesandbox' as const;
  declare readonly httpStatus?: number;

  constructor(readonly operation: 'get' | 'resume' | 'delete', httpStatus?: number) {
    super(operation === 'delete'
      ? 'Failed to delete CodeSandbox sandbox.'
      : 'Failed to get CodeSandbox sandbox.');
    this.name = 'CodeSandboxLifecycleError';
    if (typeof httpStatus === 'number' && Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) {
      this.httpStatus = httpStatus;
    }
  }
}

function validateSandboxId(sandboxId: string): void {
  if (typeof sandboxId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(sandboxId)) {
    throw new Error('Invalid CodeSandbox sandbox ID.');
  }
}

// SDK 2.4.2's handleResponse discards HTTP status when it throws. Observe the
// response through its public fetch option, never infer absence from error text
// or a status-shaped thrown object. Each client observes one exact operation.
function lifecycleSdk(apiKey: string, method: 'GET' | 'POST' | 'DELETE', path: string) {
  let status: number | undefined;
  const sdk = new CodeSandbox(apiKey, {
    fetch: async (input, init) => {
      // A 307/308 must not replay this operation against a different resource.
      // Set policy before sending, not merely after observing response.redirected.
      const request = new Request(input, { ...init, redirect: 'manual' });
      const matches = request.method === method && new URL(request.url).pathname.endsWith(path);
      if (matches) status = undefined;
      const response = await fetch(request);
      if (matches && !response.redirected) status = response.status;
      return response;
    },
  });
  return { sdk, getStatus: () => status };
}

export const codesandbox = defineProvider<CodesandboxSandbox, CodesandboxConfig, any, any>({
  name: 'codesandbox',
  methods: {
    instances: {
      create: async (config: CodesandboxConfig, options?: CreateInstanceOptions) => {
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.CSB_API_KEY) || '';
        if (!apiKey) {
          throw new Error(`Missing CodeSandbox API key. Provide 'apiKey' in config or set CSB_API_KEY environment variable.`);
        }
        const sdk = new CodeSandbox(apiKey);
        try {
          let sandbox: CodesandboxSandbox;
          let sandboxId: string;
          if (options?.snapshotId) {
            sandbox = await sdk.sandboxes.resume(options.snapshotId);
            sandboxId = options.snapshotId;
          } else {
            const {
              timeout: _timeout, envs, name: _name, metadata: _metadata,
              templateId: optTemplateId, snapshotId: _snapshotId, sandboxId: _sandboxId,
              namespace: _namespace, directory: _directory, ...providerOptions
            } = options || {};
            const createOptions: any = { ...providerOptions };
            const templateId = optTemplateId || config.templateId;
            if (templateId) createOptions.id = templateId;
            if (envs && Object.keys(envs).length > 0) createOptions.envVars = envs;
            sandbox = await sdk.sandboxes.create(createOptions);
            sandboxId = sandbox.id;
          }
          return { instance: sandbox, instanceId: sandboxId };
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('unauthorized') || error.message.includes('API key')) {
              throw new Error(`CodeSandbox authentication failed. Please check your CSB_API_KEY environment variable.`);
            }
            if (error.message.includes('quota') || error.message.includes('limit')) {
              throw new Error(`CodeSandbox quota exceeded. Please check your usage at https://codesandbox.io/dashboard`);
            }
          }
          throw new Error(`Failed to create CodeSandbox sandbox: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      getById: async (config: CodesandboxConfig, sandboxId: string) => {
        validateSandboxId(sandboxId);
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.CSB_API_KEY) || '';
        if (!apiKey) throw new Error(`Missing CodeSandbox API key.`);
        const { sdk, getStatus } = lifecycleSdk(apiKey, 'GET', `/sandbox/${sandboxId}`);
        let metadata;
        try {
          metadata = await sdk.sandboxes.get(sandboxId);
        } catch {
          if (getStatus() === 404) return null;
          throw new CodeSandboxLifecycleError('get', getStatus());
        }
        if (metadata.id !== sandboxId) throw new CodeSandboxLifecycleError('get', getStatus());
        const resume = lifecycleSdk(apiKey, 'POST', `/vm/${sandboxId}/start`);
        try {
          const sandbox = await resume.sdk.sandboxes.resume(sandboxId);
          return { instance: sandbox, instanceId: sandboxId };
        } catch {
          // Resume starts a VM; a failure here (even HTTP 404) is not a
          // metadata absence observation and must never become null.
          throw new CodeSandboxLifecycleError('resume', resume.getStatus());
        }
      },

      list: async (_config: CodesandboxConfig) => {
        throw new Error(`CodeSandbox provider does not support listing sandboxes.`);
      },

      destroy: async (config: CodesandboxConfig, sandboxId: string) => {
        validateSandboxId(sandboxId);
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.CSB_API_KEY) || '';
        if (!apiKey) throw new Error(`Missing CodeSandbox API key.`);
        const { sdk, getStatus } = lifecycleSdk(apiKey, 'DELETE', `/vm/${sandboxId}`);
        try {
          // Public permanent deletion includes this sandbox's data. Shutdown
          // only stops the VM and adds retries that can exhaust cleanup budgets.
          await sdk.sandboxes.delete(sandboxId);
        } catch {
          if (getStatus() !== 404) throw new CodeSandboxLifecycleError('delete', getStatus());
        }
      },

      runCommand: async (sandbox: CodesandboxSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          const client = await sandbox.connect();
          let fullCommand = command;
          if (options?.env && Object.keys(options.env).length > 0) {
            const envPrefix = Object.entries(options.env).map(([k, v]) => `${k}="${escapeShellArg(v)}"`).join(' ');
            fullCommand = `${envPrefix} ${fullCommand}`;
          }
          if (options?.cwd) fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
          if (options?.background) fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
          // commands.run returns a bare output string — capture the real exit
          // code and stderr in-band via a delimiter + stderr file.
          const errFile = `/tmp/.computesdk-stderr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const delim = `__COMPUTESDK_EXIT_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
          const wrapped = `{ ${fullCommand} ; } 2>${escapeShellArg(errFile)}; __cs_ec=$?; echo "${delim}$__cs_ec"; cat ${escapeShellArg(errFile)} 2>/dev/null; rm -f ${escapeShellArg(errFile)}`;
          const output = await client.commands.run(wrapped);
          const delimIdx = output.lastIndexOf(delim);
          if (delimIdx === -1) {
            return { stdout: output, stderr: '', exitCode: 0, durationMs: Date.now() - startTime };
          }
          const after = output.substring(delimIdx + delim.length);
          const newlineIdx = after.indexOf('\n');
          const exitCode = parseInt(newlineIdx === -1 ? after : after.substring(0, newlineIdx), 10) || 0;
          const stderr = newlineIdx === -1 ? '' : after.substring(newlineIdx + 1);
          const stdout = output.substring(0, delimIdx).replace(/\n$/, '');
          return { stdout, stderr, exitCode, durationMs: Date.now() - startTime };
        } catch (error) {
          return { stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 127, durationMs: Date.now() - startTime };
        }
      },

      getInfo: async (sandbox: CodesandboxSandbox): Promise<InstanceInfo> => ({
        id: sandbox.id,
        provider: 'codesandbox',
        status: 'running',
        createdAt: new Date(),
        timeout: 300000,
        metadata: { cluster: sandbox.cluster, bootupType: sandbox.bootupType, isUpToDate: sandbox.isUpToDate }
      }),

      getUrl: async (sandbox: CodesandboxSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        const protocol = options.protocol || 'https';
        return `${protocol}://${sandbox.id}.${sandbox.cluster}.csb.app:${options.port}`;
      },

      filesystem: {
        readFile: async (sandbox: CodesandboxSandbox, path: string): Promise<string> => {
          const client = await sandbox.connect();
          return client.fs.readTextFile(path);
        },
        writeFile: async (sandbox: CodesandboxSandbox, path: string, content: string): Promise<void> => {
          const client = await sandbox.connect();
          await client.fs.writeTextFile(path, content);
        },
        mkdir: async (sandbox: CodesandboxSandbox, path: string): Promise<void> => {
          const client = await sandbox.connect();
          await client.commands.run(`mkdir -p "${path}"`);
        },
        readdir: async (sandbox: CodesandboxSandbox, path: string): Promise<FileEntry[]> => {
          const client = await sandbox.connect();
          const entries = await client.fs.readdir(path);
          return entries.map((entry: any) => ({
            name: entry.name,
            type: entry.isDirectory ? 'directory' as const : 'file' as const,
            size: entry.size || 0,
            modified: entry.lastModified ? new Date(entry.lastModified) : new Date()
          }));
        },
        exists: async (sandbox: CodesandboxSandbox, path: string): Promise<boolean> => {
          const client = await sandbox.connect();
          try { await client.commands.run(`ls "${path}"`); return true; } catch { return false; }
        },
        remove: async (sandbox: CodesandboxSandbox, path: string): Promise<void> => {
          const client = await sandbox.connect();
          await client.fs.remove(path);
        }
      },

      getInstance: (sandbox: CodesandboxSandbox): CodesandboxSandbox => sandbox,
    },

    snapshot: {
      create: async (config: CodesandboxConfig, sandboxId: string, options?: { name?: string }) => {
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.CSB_API_KEY) || '';
        if (!apiKey) throw new Error(`Missing CodeSandbox API key.`);
        const sdk = new CodeSandbox(apiKey);
        try {
          const sandbox = await sdk.sandboxes.resume(sandboxId);
          await sdk.sandboxes.hibernate(sandboxId);
          return { id: sandbox.id, provider: 'codesandbox', createdAt: new Date(), metadata: { name: options?.name, bootupType: sandbox.bootupType } };
        } catch (error) {
          throw new Error(`Failed to create CodeSandbox snapshot: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      list: async (_config: CodesandboxConfig) => { throw new Error(`CodeSandbox provider does not support listing snapshots.`); },
      delete: async (config: CodesandboxConfig, snapshotId: string) => {
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.CSB_API_KEY) || '';
        if (!apiKey) throw new Error(`Missing CodeSandbox API key.`);
        const sdk = new CodeSandbox(apiKey);
        try { await sdk.sandboxes.shutdown(snapshotId); } catch { /* ignore */ }
      }
    },

    template: {
      create: async (_config: CodesandboxConfig, _options: { name: string }) => {
        throw new Error(`CodeSandbox templates must be created via the dashboard.`);
      },
      list: async (_config: CodesandboxConfig) => { throw new Error(`CodeSandbox provider does not support listing templates via API.`); },
      delete: async (_config: CodesandboxConfig, _templateId: string) => { throw new Error(`CodeSandbox templates must be deleted via the dashboard.`); }
    }
  }
});
