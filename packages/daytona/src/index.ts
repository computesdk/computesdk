/**
 * Daytona Provider - Factory-based Implementation
 */

import { Daytona, Sandbox as DaytonaSandbox } from '@daytonaio/sdk';
import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

/**
 * Daytona-specific configuration options
 */
export interface DaytonaConfig {
  /** Daytona API key - if not provided, will fallback to DAYTONA_API_KEY environment variable */
  apiKey?: string;
  /** Default runtime environment (e.g. 'python', 'node') */
  runtime?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

/**
 * Create a Daytona provider instance using the factory pattern
 */
export const daytona = defineProvider<DaytonaSandbox, DaytonaConfig>({
  name: 'daytona',
  methods: {
    sandbox: {
      create: async (config: DaytonaConfig, options?: CreateSandboxOptions) => {
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.DAYTONA_API_KEY) || '';

        if (!apiKey) {
          throw new Error(
            `Missing Daytona API key. Provide 'apiKey' in config or set DAYTONA_API_KEY environment variable. Get your API key from https://daytona.io/`
          );
        }

        const runtime = (options as any)?.runtime || config.runtime || 'node';
        const timeout = options?.timeout ?? config.timeout;

        try {
          const daytona = new Daytona({ apiKey: apiKey });

          const {
            timeout: _timeout,
            envs,
            name,
            metadata,
            templateId,
            snapshotId,
            sandboxId: _sandboxId,
            namespace: _namespace,
            directory: _directory,
            ...providerOptions
          } = options || {};

          const createParams: Record<string, any> = {
            language: runtime === 'python' ? 'python' : 'javascript',
            ...providerOptions,
          };

          if (envs && Object.keys(envs).length > 0) {
            createParams.envVars = envs;
          }

          if (name) {
            createParams.name = name;
          }

          if (metadata && typeof metadata === 'object') {
            const labels: Record<string, string> = {};
            for (const [k, v] of Object.entries(metadata)) {
              labels[k] = typeof v === 'string' ? v : JSON.stringify(v);
            }
            createParams.labels = labels;
          }

          const sourceId = templateId || snapshotId;
          if (sourceId) {
            createParams.snapshot = sourceId;
          }

          const createOptions = timeout
            ? { timeout: Math.ceil(timeout / 1000) }
            : undefined;

          const session = await daytona.create(createParams as any, createOptions);
          const sandboxId = session.id;

          return { sandbox: session, sandboxId };
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('unauthorized') || error.message.includes('API key')) {
              throw new Error(`Daytona authentication failed. Please check your DAYTONA_API_KEY environment variable.`);
            }
            if (error.message.includes('quota') || error.message.includes('limit')) {
              throw new Error(`Daytona quota exceeded. Please check your usage at https://daytona.io/`);
            }
          }
          throw new Error(`Failed to create Daytona sandbox: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      getById: async (config: DaytonaConfig, sandboxId: string) => {
        const apiKey = config.apiKey || process.env.DAYTONA_API_KEY!;
        try {
          const daytona = new Daytona({ apiKey: apiKey });
          const session = await daytona.get(sandboxId);
          return { sandbox: session, sandboxId };
        } catch (error) {
          if (error instanceof Error && (error.message.includes('not found') || error.message.includes('404'))) {
            return null;
          }
          throw new Error(`Failed to get Daytona sandbox ${sandboxId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      list: async (config: DaytonaConfig) => {
        const apiKey = config.apiKey || process.env.DAYTONA_API_KEY!;
        try {
          const daytona = new Daytona({ apiKey: apiKey });
          const result = await daytona.list();
          return result.items.map((session: any) => ({ sandbox: session, sandboxId: session.id }));
        } catch (error) {
          throw new Error(`Failed to list Daytona sandboxes: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      destroy: async (config: DaytonaConfig, sandboxId: string) => {
        const apiKey = config.apiKey || process.env.DAYTONA_API_KEY!;
        try {
          const daytona = new Daytona({ apiKey: apiKey });
          const sandbox = await daytona.get(sandboxId);
          await sandbox.delete();
        } catch (error) {
          if (error instanceof Error && (error.message.includes('not found') || error.message.includes('404'))) {
            return;
          }
          throw new Error(`Failed to destroy Daytona sandbox ${sandboxId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      runCommand: async (sandbox: DaytonaSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          let fullCommand = command;
          if (options?.env && Object.keys(options.env).length > 0) {
            const envPrefix = Object.entries(options.env)
              .map(([k, v]) => `${k}="${escapeShellArg(v)}"`)
              .join(' ');
            fullCommand = `${envPrefix} ${fullCommand}`;
          }
          if (options?.cwd) fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
          if (options?.background) fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;

          const response = await sandbox.process.executeCommand(fullCommand);
          return {
            stdout: response.result || '',
            stderr: '',
            exitCode: response.exitCode || 0,
            durationMs: Date.now() - startTime
          };
        } catch (error) {
          throw new Error(`Daytona command execution failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      getInfo: async (sandbox: DaytonaSandbox): Promise<SandboxInfo> => {
        return {
          id: sandbox.id,
          provider: 'daytona',
          status: 'running',
          createdAt: new Date(),
          timeout: 300000,
          metadata: { daytonaSandboxId: sandbox.id }
        };
      },

      getUrl: async (sandbox: DaytonaSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        try {
          const previewInfo = await sandbox.getPreviewLink(options.port);
          let url = previewInfo.url;
          if (options.protocol) {
            const urlObj = new URL(url);
            urlObj.protocol = options.protocol + ':';
            url = urlObj.toString();
          }
          return url;
        } catch (error) {
          throw new Error(`Failed to get Daytona preview URL for port ${options.port}: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      filesystem: {
        readFile: async (sandbox: DaytonaSandbox, path: string): Promise<string> => {
          const response = await sandbox.process.executeCommand(`cat "${path}"`);
          if (response.exitCode !== 0) throw new Error(`File not found or cannot be read: ${path}`);
          return response.result || '';
        },
        writeFile: async (sandbox: DaytonaSandbox, path: string, content: string): Promise<void> => {
          const encoded = Buffer.from(content).toString('base64');
          const response = await sandbox.process.executeCommand(`echo "${encoded}" | base64 -d > "${path}"`);
          if (response.exitCode !== 0) throw new Error(`Failed to write to file: ${path}`);
        },
        mkdir: async (sandbox: DaytonaSandbox, path: string): Promise<void> => {
          const response = await sandbox.process.executeCommand(`mkdir -p "${path}"`);
          if (response.exitCode !== 0) throw new Error(`Failed to create directory: ${path}`);
        },
        readdir: async (sandbox: DaytonaSandbox, path: string): Promise<FileEntry[]> => {
          const response = await sandbox.process.executeCommand(`ls -la "${path}"`);
          if (response.exitCode !== 0) throw new Error(`Directory not found or cannot be read: ${path}`);
          const lines = response.result.split('\n').filter((l: string) => l.trim());
          const entries: FileEntry[] = [];
          for (const line of lines) {
            if (line.startsWith('total ') || line.endsWith(' .') || line.endsWith(' ..')) continue;
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 9) {
              entries.push({
                name: parts.slice(8).join(' '),
                type: parts[0].startsWith('d') ? 'directory' as const : 'file' as const,
                size: parseInt(parts[4]) || 0,
                modified: new Date()
              });
            }
          }
          return entries;
        },
        exists: async (sandbox: DaytonaSandbox, path: string): Promise<boolean> => {
          const response = await sandbox.process.executeCommand(`test -e "${path}"`);
          return response.exitCode === 0;
        },
        remove: async (sandbox: DaytonaSandbox, path: string): Promise<void> => {
          const response = await sandbox.process.executeCommand(`rm -rf "${path}"`);
          if (response.exitCode !== 0) throw new Error(`Failed to remove: ${path}`);
        }
      },

      getInstance: (sandbox: DaytonaSandbox): DaytonaSandbox => sandbox,
    },

    snapshot: {
      create: async (config: DaytonaConfig, sandboxId: string, options?: { name?: string }) => {
        const apiKey = config.apiKey || process.env.DAYTONA_API_KEY!;
        const daytona = new Daytona({ apiKey: apiKey });
        try {
          const snapshot = await (daytona as any).snapshots.create({
            workspaceId: sandboxId,
            name: options?.name || `snapshot-${Date.now()}`
          });
          return snapshot;
        } catch (error) {
          throw new Error(`Failed to create Daytona snapshot: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      list: async (config: DaytonaConfig) => {
        const apiKey = config.apiKey || process.env.DAYTONA_API_KEY!;
        const daytona = new Daytona({ apiKey: apiKey });
        try { return await (daytona as any).snapshots.list(); } catch { return []; }
      },
      delete: async (config: DaytonaConfig, snapshotId: string) => {
        const apiKey = config.apiKey || process.env.DAYTONA_API_KEY!;
        const daytona = new Daytona({ apiKey: apiKey });
        try { await (daytona as any).snapshots.delete(snapshotId); } catch { /* ignore */ }
      }
    },

    template: {
      create: async (_config: DaytonaConfig, _options: { name: string }) => {
        throw new Error('To create a template in Daytona, create a snapshot from a running sandbox using snapshot.create()');
      },
      list: async (config: DaytonaConfig) => {
        const apiKey = config.apiKey || process.env.DAYTONA_API_KEY!;
        const daytona = new Daytona({ apiKey: apiKey });
        try { return await (daytona as any).snapshots.list(); } catch { return []; }
      },
      delete: async (config: DaytonaConfig, templateId: string) => {
        const apiKey = config.apiKey || process.env.DAYTONA_API_KEY!;
        const daytona = new Daytona({ apiKey: apiKey });
        try { await (daytona as any).snapshots.delete(templateId); } catch { /* ignore */ }
      }
    }
  }
});
