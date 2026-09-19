/**
 * Sandbox as a Service provider.
 *
 * Each sandbox is a full cloud VM with its own kernel, not a microVM and not a
 * container. That trade cuts both ways and the README says so: starting one
 * takes roughly thirty seconds rather than milliseconds, and in exchange the
 * guest is an ordinary Linux machine, sessions run up to 24 hours on any
 * account, and a port inside it can be given a public URL.
 *
 * There is no vendor SDK to depend on — the service is a small REST API, so
 * this package talks to it with fetch.
 */

import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type {
  CommandResult,
  SandboxInfo,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
} from '@computesdk/provider';

export const DEFAULT_BASE_URL = 'https://sandbox-as-a-service.com/v1';

export interface SandboxAsAServiceConfig {
  /** API key from sandbox-as-a-service.com/dashboard/keys. Falls back to `AAS_API_KEY`. */
  apiKey?: string;
  /** Override the API base URL. Falls back to `AAS_BASE_URL`. */
  baseUrl?: string;
  /** Machine size. `small` = 2 vCPU / 4 GB, `medium` = 4 / 8, `large` = 8 / 16. */
  size?: 'small' | 'medium' | 'large';
  /** Lifetime in minutes, up to 1440. The platform destroys the sandbox at expiry regardless. */
  timeoutMinutes?: number;
}

/** A sandbox as the API describes it. */
export interface SandboxRecord {
  id: string;
  status: string;
  size: string;
  created_at: string;
  expires_at?: string;
  [key: string]: unknown;
}

/**
 * Instance methods receive only the sandbox, so it has to carry what it needs
 * to talk to the API. Same shape as the other REST-backed providers here.
 */
export interface SandboxAsAServiceSandbox {
  record: SandboxRecord;
  apiKey: string;
  baseUrl: string;
}

function resolveApiKey(config: SandboxAsAServiceConfig): string {
  const key = config.apiKey || (typeof process !== 'undefined' ? process.env?.AAS_API_KEY : '') || '';
  if (!key) {
    throw new Error(
      `Missing Sandbox as a Service API key. Provide 'apiKey' in config or set AAS_API_KEY. ` +
        `Keys are created at https://sandbox-as-a-service.com/dashboard/keys`
    );
  }
  return key;
}

function resolveBaseUrl(config: SandboxAsAServiceConfig): string {
  const url =
    config.baseUrl || (typeof process !== 'undefined' ? process.env?.AAS_BASE_URL : '') || DEFAULT_BASE_URL;
  return url.replace(/\/+$/, '');
}

/**
 * Every request goes through here so that every failure carries the API's own
 * message. Collapsing those into "request failed" would make the caller guess
 * at things the service already said plainly — an expired sandbox, an exhausted
 * balance, a quota.
 */
async function request<T>(
  apiKey: string,
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await res.text();
  let payload: any = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(
        `Sandbox as a Service returned a non-JSON response (${res.status}): ${text.slice(0, 200)}`
      );
    }
  }

  if (!res.ok) {
    const err = payload?.error;
    throw new Error(
      err?.message
        ? `Sandbox as a Service: ${err.message}${err.type ? ` [${err.type}]` : ''}`
        : `Sandbox as a Service request failed with ${res.status}`
    );
  }
  return payload as T;
}

function wrap(record: SandboxRecord, apiKey: string, baseUrl: string): SandboxAsAServiceSandbox {
  return { record, apiKey, baseUrl };
}

export const sandboxAsAService = defineProvider<SandboxAsAServiceSandbox, SandboxAsAServiceConfig>({
  name: 'sandbox-as-a-service',
  methods: {
    sandbox: {
      create: async (config: SandboxAsAServiceConfig, options?: CreateSandboxOptions) => {
        const apiKey = resolveApiKey(config);
        const baseUrl = resolveBaseUrl(config);

        // The create call blocks until the machine will accept commands, so
        // there is no readiness loop to write here.
        const record = await request<SandboxRecord>(apiKey, baseUrl, 'POST', '/sandboxes', {
          size: config.size || 'small',
          ...(config.timeoutMinutes ? { timeout_minutes: config.timeoutMinutes } : {}),
        });
        void options;
        return { sandbox: wrap(record, apiKey, baseUrl), sandboxId: record.id };
      },

      getById: async (config: SandboxAsAServiceConfig, sandboxId: string) => {
        const apiKey = resolveApiKey(config);
        const baseUrl = resolveBaseUrl(config);
        try {
          const record = await request<SandboxRecord>(
            apiKey,
            baseUrl,
            'GET',
            `/sandboxes/${encodeURIComponent(sandboxId)}`
          );
          return { sandbox: wrap(record, apiKey, baseUrl), sandboxId };
        } catch (err) {
          // A sandbox that is gone is a null, not a throw.
          if (err instanceof Error && /not_found|No sandbox/i.test(err.message)) return null;
          throw err;
        }
      },

      list: async (config: SandboxAsAServiceConfig) => {
        const apiKey = resolveApiKey(config);
        const baseUrl = resolveBaseUrl(config);
        const res = await request<{ data: SandboxRecord[] }>(
          apiKey,
          baseUrl,
          'GET',
          '/sandboxes?limit=100'
        );
        return (res.data || []).map((record) => ({
          sandbox: wrap(record, apiKey, baseUrl),
          sandboxId: record.id,
        }));
      },

      destroy: async (config: SandboxAsAServiceConfig, sandboxId: string) => {
        await request(
          resolveApiKey(config),
          resolveBaseUrl(config),
          'DELETE',
          `/sandboxes/${encodeURIComponent(sandboxId)}`
        );
      },

      runCommand: async (
        sandbox: SandboxAsAServiceSandbox,
        command: string,
        options?: RunCommandOptions
      ): Promise<CommandResult> => {
        const result = await request<{ stdout: string; stderr: string; exit_code: number }>(
          sandbox.apiKey,
          sandbox.baseUrl,
          'POST',
          `/sandboxes/${encodeURIComponent(sandbox.record.id)}/exec`,
          {
            command,
            ...(options?.cwd ? { cwd: options.cwd } : {}),
            // The API exports these before running the command, so they survive
            // shell chaining rather than applying to the first word only.
            ...(options?.env && Object.keys(options.env).length ? { env: options.env } : {}),
          }
        );
        return {
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? '',
          exitCode: result.exit_code ?? 0,
        };
      },

      getInfo: async (sandbox: SandboxAsAServiceSandbox): Promise<SandboxInfo> => {
        const status = sandbox.record.status;
        return {
          id: sandbox.record.id,
          // The API reports provisioning, running, deleting, deleted and failed.
          // Anything neither running nor failed is stopped rather than invented
          // as running.
          status: status === 'running' ? 'running' : status === 'failed' ? 'error' : 'stopped',
          createdAt: new Date(sandbox.record.created_at),
        };
      },

      /**
       * A public https URL for a port inside the sandbox.
       *
       * The server only has to listen on localhost: no inbound port is opened on
       * the machine, and the request is carried in over the control plane's
       * existing connection. Asking twice for the same port returns the same URL.
       */
      getUrl: async (
        sandbox: SandboxAsAServiceSandbox,
        options: { port: number; protocol?: string }
      ): Promise<string> => {
        const res = await request<{ url: string }>(
          sandbox.apiKey,
          sandbox.baseUrl,
          'POST',
          `/sandboxes/${encodeURIComponent(sandbox.record.id)}/ports`,
          { port: options.port }
        );
        return res.url;
      },

      filesystem: {
        // Files move through a dedicated endpoint rather than through the shell,
        // so quotes, newlines and binary content survive without escaping.
        readFile: async (sandbox: SandboxAsAServiceSandbox, path: string): Promise<string> => {
          const res = await request<{ content: string }>(
            sandbox.apiKey,
            sandbox.baseUrl,
            'GET',
            `/sandboxes/${encodeURIComponent(sandbox.record.id)}/files?path=${encodeURIComponent(path)}`
          );
          return res.content;
        },

        writeFile: async (
          sandbox: SandboxAsAServiceSandbox,
          path: string,
          content: string
        ): Promise<void> => {
          await request(
            sandbox.apiKey,
            sandbox.baseUrl,
            'PUT',
            `/sandboxes/${encodeURIComponent(sandbox.record.id)}/files`,
            { path, content }
          );
        },

        mkdir: async (
          sandbox: SandboxAsAServiceSandbox,
          path: string,
          runCommand: (
            sandbox: SandboxAsAServiceSandbox,
            command: string,
            options?: RunCommandOptions
          ) => Promise<CommandResult>
        ): Promise<void> => {
          const result = await runCommand(sandbox, `mkdir -p ${escapeShellArg(path)}`);
          if (result.exitCode !== 0) {
            throw new Error(`Could not create ${path}: ${result.stderr.trim() || 'unknown error'}`);
          }
        },

        readdir: async (sandbox: SandboxAsAServiceSandbox, path: string): Promise<FileEntry[]> => {
          const res = await request<{
            entries: Array<{ name: string; type: string; size_bytes: number }>;
          }>(
            sandbox.apiKey,
            sandbox.baseUrl,
            'GET',
            `/sandboxes/${encodeURIComponent(sandbox.record.id)}/files` +
              `?path=${encodeURIComponent(path)}&list=true&recursive=false`
          );
          const base = path.replace(/\/+$/, '');
          return (res.entries || []).map((entry) => ({
            name: entry.name,
            path: `${base}/${entry.name}`,
            isDirectory: entry.type === 'dir',
            size: entry.size_bytes ?? 0,
          })) as FileEntry[];
        },

        exists: async (
          sandbox: SandboxAsAServiceSandbox,
          path: string,
          runCommand: (
            sandbox: SandboxAsAServiceSandbox,
            command: string,
            options?: RunCommandOptions
          ) => Promise<CommandResult>
        ): Promise<boolean> => {
          const result = await runCommand(sandbox, `test -e ${escapeShellArg(path)}`);
          return result.exitCode === 0;
        },

        remove: async (sandbox: SandboxAsAServiceSandbox, path: string): Promise<void> => {
          await request(
            sandbox.apiKey,
            sandbox.baseUrl,
            'DELETE',
            `/sandboxes/${encodeURIComponent(sandbox.record.id)}/files` +
              `?path=${encodeURIComponent(path)}&recursive=true`
          );
        },
      },
    },
  },
});

export default sandboxAsAService;
