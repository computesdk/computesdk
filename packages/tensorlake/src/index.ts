/// <reference types="node" />
/**
 * Tensorlake Provider - SDK-based Implementation
 *
 * Stateful MicroVM sandboxes for agentic applications and LLM-generated code execution.
 * Uses the official tensorlake npm SDK (^0.4.47).
 */

import { SandboxClient, SandboxStatus, OutputMode } from 'tensorlake';
import type { Sandbox } from 'tensorlake';
import { defineProvider } from '@computesdk/provider';
import type {
  Runtime,
  CodeResult,
  CommandResult,
  SandboxInfo,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
} from '@computesdk/provider';

const DEFAULT_IMAGE = 'ubuntu-minimal';

export interface TensorlakeConfig {
  /** Tensorlake API key — falls back to TENSORLAKE_API_KEY environment variable */
  apiKey?: string;
  /** Override for the management API base URL */
  apiUrl?: string;
  /** Override for the sandbox proxy URL */
  proxyUrl?: string;
  /** Default container image for new sandboxes (default: ubuntu-minimal) */
  image?: string;
  /** Default timeout in seconds for sandboxes */
  timeout?: number;
}

export interface TensorlakeSandboxContext {
  sandboxId: string;
  config: TensorlakeConfig;
  /** Connected SDK Sandbox instance — used for all proxy operations */
  sandbox: Sandbox;
}

function getClient(config: TensorlakeConfig): SandboxClient {
  const key =
    config.apiKey ||
    (typeof process !== 'undefined' && process.env?.TENSORLAKE_API_KEY) ||
    '';
  if (!key) {
    throw new Error(
      `Missing Tensorlake API key. Provide 'apiKey' in config or set TENSORLAKE_API_KEY environment variable. ` +
        `Get your API key from https://app.tensorlake.ai`
    );
  }
  const apiUrl =
    config.apiUrl ||
    (typeof process !== 'undefined' && process.env?.TENSORLAKE_API_URL) ||
    undefined;
  return new SandboxClient({ apiKey: key, apiUrl });
}

export const tensorlake = defineProvider<TensorlakeSandboxContext, TensorlakeConfig>({
  name: 'tensorlake',
  methods: {
    sandbox: {
      create: async (config: TensorlakeConfig, options?: CreateSandboxOptions) => {
        const client = getClient(config);
        const image = options?.image || config.image || DEFAULT_IMAGE;
        const timeoutSecs = options?.timeout
          ? Math.ceil(options.timeout / 1000)
          : config.timeout;

        let sandbox: Sandbox;
        try {
          sandbox = await client.createAndConnect({
            image,
            cpus: 1,
            memoryMb: 1024,
            ephemeralDiskMb: 2048,
            ...(timeoutSecs && { timeoutSecs }),
            ...(options?.name && { name: options.name }),
            ...(options?.snapshotId && { snapshotId: options.snapshotId }),
          });
        } catch (error) {
          if (error instanceof Error && error.message.includes('401')) {
            throw new Error(
              `Tensorlake authentication failed. Please check your TENSORLAKE_API_KEY. ` +
                `Get your API key from https://app.tensorlake.ai`
            );
          }
          throw new Error(
            `Failed to create Tensorlake sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }

        const sandboxId = sandbox.sandboxId;
        const ctx: TensorlakeSandboxContext = { sandboxId, config, sandbox };
        return { sandbox: ctx, sandboxId };
      },

      getById: async (config: TensorlakeConfig, sandboxId: string) => {
        try {
          const client = getClient(config);
          const info = await client.get(sandboxId);
          if (!info) return null;
          const sandbox = client.connect(sandboxId, config.proxyUrl);
          const ctx: TensorlakeSandboxContext = { sandboxId, config, sandbox };
          return { sandbox: ctx, sandboxId };
        } catch {
          return null;
        }
      },

      list: async (config: TensorlakeConfig) => {
        try {
          const client = getClient(config);
          const sandboxes = await client.list();
          return sandboxes.map((s) => {
            const sandbox = client.connect(s.sandboxId, config.proxyUrl);
            return {
              sandbox: { sandboxId: s.sandboxId, config, sandbox } as TensorlakeSandboxContext,
              sandboxId: s.sandboxId,
            };
          });
        } catch {
          return [];
        }
      },

      destroy: async (config: TensorlakeConfig, sandboxId: string) => {
        try {
          const client = getClient(config);
          await client.delete(sandboxId);
        } catch {
          // Sandbox may already be terminated
        }
      },

      runCode: async (
        ctx: TensorlakeSandboxContext,
        code: string,
        runtime?: Runtime
      ): Promise<CodeResult> => {
        const effectiveRuntime =
          runtime ||
          (code.includes('print(') ||
          code.includes('import ') ||
          code.includes('def ') ||
          code.includes('sys.') ||
          code.includes('f"') ||
          code.includes("f'") ||
          code.includes('raise ')
            ? 'python'
            : 'node');

        const encoded = Buffer.from(code).toString('base64');
        const interpreter = effectiveRuntime === 'python' ? 'python3' : 'node';
        const script = `echo "${encoded}" | base64 -d | ${interpreter}`;

        try {
          const result = await ctx.sandbox.run('sh', { args: ['-c', script] });
          const exitCode = result.exitCode ?? 0;

          if (
            exitCode !== 0 &&
            result.stderr &&
            (result.stderr.includes('SyntaxError') ||
              result.stderr.includes('invalid syntax') ||
              result.stderr.includes('Unexpected token') ||
              result.stderr.includes('Unexpected identifier'))
          ) {
            throw new Error(`Syntax error: ${result.stderr.trim()}`);
          }

          const output = result.stderr
            ? `${result.stdout}${result.stdout && result.stderr ? '\n' : ''}${result.stderr}`
            : result.stdout;

          return { output, exitCode, language: effectiveRuntime };
        } catch (error) {
          if (error instanceof Error && error.message.includes('Syntax error')) throw error;
          throw new Error(
            `Tensorlake code execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      runCommand: async (
        ctx: TensorlakeSandboxContext,
        command: string,
        options?: RunCommandOptions
      ): Promise<CommandResult> => {
        const startTime = Date.now();

        if (options?.background) {
          try {
            const [bin, ...args] = command.split(' ');
            await ctx.sandbox.startProcess(bin, {
              args,
              stdoutMode: OutputMode.DISCARD,
              stderrMode: OutputMode.DISCARD,
              ...(options.env && Object.keys(options.env).length > 0 && { env: options.env }),
              ...(options.cwd && { workingDir: options.cwd }),
            });
          } catch {
            // background — ignore errors
          }
          return { stdout: '', stderr: '', exitCode: 0, durationMs: Date.now() - startTime };
        }

        try {
          const [executable, ...commandArgs] = command.split(' ');
          const result = await ctx.sandbox.run(executable, {
              args: commandArgs,
              ...(options?.env && Object.keys(options.env).length > 0 && { env: options.env }),
              ...(options?.cwd && { workingDir: options.cwd }),
          });
          return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode ?? 0,
            durationMs: Date.now() - startTime,
          };
        } catch (error) {
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 1,
            durationMs: Date.now() - startTime,
          };
        }
      },

      getInfo: async (ctx: TensorlakeSandboxContext): Promise<SandboxInfo> => {
        try {
          const client = getClient(ctx.config);
          const info = await client.get(ctx.sandboxId);
          if (info) {
            return {
              id: ctx.sandboxId,
              provider: 'tensorlake',
              runtime: (info.image?.startsWith('python') ? 'python' : 'node') as Runtime,
              status: info.status === SandboxStatus.RUNNING ? 'running' : 'stopped',
              createdAt: new Date(),
              timeout: info.timeoutSecs != null ? info.timeoutSecs * 1000 : 300_000,
              metadata: { tensorlakeSandboxId: ctx.sandboxId },
            };
          }
        } catch {
          // fall through to default
        }
        return {
          id: ctx.sandboxId,
          provider: 'tensorlake',
          runtime: 'python',
          status: 'running',
          createdAt: new Date(),
          timeout: 300_000,
          metadata: { tensorlakeSandboxId: ctx.sandboxId },
        };
      },

      getUrl: async (
        ctx: TensorlakeSandboxContext,
        options: { port: number; protocol?: string }
      ): Promise<string> => {
        const protocol = options.protocol || 'https';
        // Derive proxy domain from apiUrl (api.tensorlake.X → sandbox.tensorlake.X)
        const apiUrl =
          ctx.config.apiUrl ||
          (typeof process !== 'undefined' && process.env?.TENSORLAKE_API_URL) ||
          'https://api.tensorlake.ai';
        const proxyDomain = apiUrl.replace(/^https?:\/\/api\./, '').replace(/\/$/, '');
        return `${protocol}://${ctx.sandboxId}.sandbox.${proxyDomain}:${options.port}`;
      },

      filesystem: {
        readFile: async (ctx: TensorlakeSandboxContext, path: string): Promise<string> => {
          const bytes = await ctx.sandbox.readFile(path);
          return Buffer.from(bytes).toString('utf-8');
        },

        writeFile: async (
          ctx: TensorlakeSandboxContext,
          path: string,
          content: string
        ): Promise<void> => {
          await ctx.sandbox.writeFile(path, Buffer.from(content, 'utf-8'));
        },

        mkdir: async (ctx: TensorlakeSandboxContext, path: string): Promise<void> => {
          const result = await ctx.sandbox.run('mkdir', { args: ['-p', path] });
          if (result.exitCode !== 0) {
            throw new Error(`Failed to create directory ${path}: ${result.stderr}`);
          }
        },

        readdir: async (ctx: TensorlakeSandboxContext, path: string): Promise<FileEntry[]> => {
          const response = await ctx.sandbox.listDirectory(path);
          return response.entries.map((e) => ({
            name: e.name,
            type: e.isDir ? ('directory' as const) : ('file' as const),
            size: e.size || 0,
            modified: e.modifiedAt ?? new Date(),
          }));
        },

        exists: async (ctx: TensorlakeSandboxContext, path: string): Promise<boolean> => {
          try { await ctx.sandbox.readFile(path); return true; } catch {}
          try { await ctx.sandbox.listDirectory(path); return true; } catch {}
          return false;
        },

        remove: async (ctx: TensorlakeSandboxContext, path: string): Promise<void> => {
          try {
            await ctx.sandbox.deleteFile(path);
          } catch {
            // May be a directory — fall back to rm -rf
            const result = await ctx.sandbox.run('rm', { args: ['-rf', path] });
            if (result.exitCode !== 0) {
              throw new Error(`Failed to remove ${path}: ${result.stderr}`);
            }
          }
        },
      },

      getInstance: (ctx: TensorlakeSandboxContext): TensorlakeSandboxContext => ctx,
    },

    snapshot: {
      create: async (
        config: TensorlakeConfig,
        sandboxId: string,
        options?: { name?: string }
      ) => {
        const client = getClient(config);
        const result = await client.snapshotAndWait(sandboxId);
        return {
          id: result.snapshotId,
          provider: 'tensorlake',
          createdAt: new Date(),
          metadata: { name: options?.name },
        };
      },

      list: async (config: TensorlakeConfig) => {
        try {
          const client = getClient(config);
          return await client.listSnapshots();
        } catch {
          return [];
        }
      },

      delete: async (config: TensorlakeConfig, snapshotId: string) => {
        try {
          const client = getClient(config);
          await client.deleteSnapshot(snapshotId);
        } catch {
          // Ignore
        }
      },
    },
  },
});

export type { TensorlakeSandboxContext as TensorlakeSandbox };
