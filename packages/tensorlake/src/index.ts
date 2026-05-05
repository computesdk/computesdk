/// <reference types="node" />
/**
 * Tensorlake Provider - SDK-based Implementation
 *
 * Stateful MicroVM sandboxes for agentic applications and LLM-generated code execution.
 * Uses the official tensorlake npm SDK (0.5.7).
 */

import { Sandbox, SandboxStatus, OutputMode } from "tensorlake";
import type { SandboxInfo } from "tensorlake";
import { defineProvider } from "@computesdk/provider";
import type {
  CodeResult,
  CommandResult,
  SandboxInfo as ComputeSandboxInfo,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
} from "@computesdk/provider";

const DEFAULT_IMAGE = "ubuntu-minimal";

export interface TensorlakeConfig {
  /** Tensorlake API key — falls back to TENSORLAKE_API_KEY environment variable */
  apiKey?: string;
  /** Override for the management API base URL */
  apiUrl?: string;
  /** Override for the sandbox proxy URL */
  proxyUrl?: string;
  /** Default container image for new sandboxes (default: ubuntu-minimal) */
  image?: string;
  /** Default timeout in milliseconds for sandboxes */
  timeout?: number;
}

export interface TensorlakeSandboxContext {
  config: TensorlakeConfig;
  /** Connected SDK Sandbox instance — used for all proxy operations */
  sandbox: InstanceType<typeof Sandbox>;
}

function resolveAuth(config: TensorlakeConfig): {
  apiKey: string;
  apiUrl?: string;
} {
  const apiKey =
    config.apiKey ||
    (typeof process !== "undefined" && process.env?.TENSORLAKE_API_KEY) ||
    "";
  if (!apiKey) {
    throw new Error(
      `Missing Tensorlake API key. Provide 'apiKey' in config or set TENSORLAKE_API_KEY environment variable. ` +
        `Get your API key from https://app.tensorlake.ai`
    );
  }
  const apiUrl =
    config.apiUrl ||
    (typeof process !== "undefined" && process.env?.TENSORLAKE_API_URL) ||
    undefined;
  return { apiKey, apiUrl };
}

export const tensorlake = defineProvider<
  TensorlakeSandboxContext,
  TensorlakeConfig
>({
  name: "tensorlake",
  methods: {
    sandbox: {
      create: async (
        config: TensorlakeConfig,
        options?: CreateSandboxOptions
      ) => {
        const { apiKey, apiUrl } = resolveAuth(config);
        const image = options?.image || config.image || DEFAULT_IMAGE;
        const timeoutSecs = options?.timeout
          ? Math.ceil(options.timeout / 1000)
          : config.timeout;

        try {
          const startTime = Date.now();
          const instance = await Sandbox.create({
            image,
            cpus: 1,
            memoryMb: 1024,
            ephemeralDiskMb: 2048,
            ...(timeoutSecs && { timeoutSecs }),
            ...(options?.name && { name: options.name }),
            ...(options?.snapshotId && { snapshotId: options.snapshotId }),
            proxyUrl: config.proxyUrl,
            apiKey,
            apiUrl,
          });

          const sandbox: TensorlakeSandboxContext = {
            config,
            sandbox: instance,
          };
          const durationMs = Date.now() - startTime;
          return {
            sandbox,
            sandboxId: instance.sandboxId,
            durationMs,
          };
        } catch (error) {
          if (error instanceof Error && error.message.includes("401")) {
            throw new Error(
              `Tensorlake authentication failed. Please check your TENSORLAKE_API_KEY. ` +
                `Get your API key from https://app.tensorlake.ai`
            );
          }
          throw new Error(
            `Failed to create Tensorlake sandbox: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      },

      getById: async (config: TensorlakeConfig, sandboxId: string) => {
        try {
          const { apiKey, apiUrl } = resolveAuth(config);
          const sandbox = await Sandbox.connect({ sandboxId, apiKey, apiUrl });
          const ctx: TensorlakeSandboxContext = {
            config,
            sandbox,
          };
          return { sandbox: ctx, sandboxId: sandbox.sandboxId };
        } catch {
          return null;
        }
      },

      list: async (config: TensorlakeConfig) => {
        try {
          const { apiKey, apiUrl } = resolveAuth(config);
          const sandboxes = await Sandbox.list({ apiKey, apiUrl });
          return Promise.all(
            sandboxes.map(async (s) => {
              const sandbox = await Sandbox.connect({
                sandboxId: s.sandboxId,
                proxyUrl: config.proxyUrl,
                routingHint: s.routingHint,
                apiKey,
                apiUrl,
              });
              return {
                sandbox: {
                  sandboxId: s.sandboxId,
                  config,
                  sandbox,
                } as TensorlakeSandboxContext,
                sandboxId: s.sandboxId,
              };
            })
          );
        } catch {
          return [];
        }
      },

      destroy: async (config: TensorlakeConfig, sandboxId: string) => {
        try {
          const { apiKey, apiUrl } = resolveAuth(config);
          const sandbox = await Sandbox.connect({ sandboxId, apiKey, apiUrl });
          await sandbox.terminate();
        } catch {
          // Sandbox may already be terminated
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
            await ctx.sandbox.startProcess("sh", {
              args: ["-c", command],
              args,
              stdoutMode: OutputMode.DISCARD,
              stderrMode: OutputMode.DISCARD,
              ...(options.env &&
                Object.keys(options.env).length > 0 && { env: options.env }),
              ...(options.cwd && { workingDir: options.cwd }),
            });
          } catch (error) {
            return {
              stdout: "",
              stderr: error instanceof Error ? error.message : String(error),
              exitCode: 127,
              durationMs: Date.now() - startTime,
            };
          }
        }

        try {
          const result = await ctx.sandbox.run("sh", {
            args: ["-c", command],
            ...(options?.env &&
              Object.keys(options.env).length > 0 && { env: options.env }),
            ...(options?.cwd && { workingDir: options.cwd }),
          });

          const durationMs = Date.now() - startTime;
          return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode ?? 0,
            durationMs,
          };
        } catch (error) {
          return {
            stdout: "",
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 127,
            durationMs: Date.now() - startTime,
          };
        }
      },

      getInfo: async (
        ctx: TensorlakeSandboxContext
      ): Promise<ComputeSandboxInfo> => {
        try {
          const info = await ctx.sandbox.info();
          return {
            id: ctx.sandbox.sandboxId,
            provider: "tensorlake",
            status:
              info.status === SandboxStatus.RUNNING ? "running" : "stopped",
            createdAt: info.createdAt || new Date(),
            timeout:
              info.timeoutSecs != null ? info.timeoutSecs * 1000 : 300_000,
            metadata: {},
          };
        } catch {
          return {
            id: ctx.sandbox.sandboxId,
            provider: "tensorlake",
            status: "running",
            createdAt: new Date(),
            timeout: 300_000,
            metadata: {},
          };
        }
      },

      getUrl: async (
        ctx: TensorlakeSandboxContext,
        options: { port: number; protocol?: string }
      ): Promise<string> => {
        const { port, protocol: optionsProtocol } = options;
        const protocol = optionsProtocol || "https";

        const apiUrl =
          ctx.config.apiUrl ||
          (typeof process !== "undefined" && process.env?.TENSORLAKE_API_URL) ||
          "https://api.tensorlake.ai";

        const proxyDomain = new URL(apiUrl).hostname;
        const subdomain =
          port === 443 || port === 80
            ? ctx.sandbox.sandboxId
            : `${port}-${ctx.sandbox.sandboxId}`;

        return `${protocol}://${subdomain}.${proxyDomain}`;
      },

      filesystem: {
        readFile: async (
          ctx: TensorlakeSandboxContext,
          path: string
        ): Promise<string> => {
          const bytes = await ctx.sandbox.readFile(path);
          return Buffer.from(bytes).toString("utf-8");
        },

        writeFile: async (
          ctx: TensorlakeSandboxContext,
          path: string,
          content: string
        ): Promise<void> => {
          await ctx.sandbox.writeFile(path, Buffer.from(content, "utf-8"));
        },

        mkdir: async (
          ctx: TensorlakeSandboxContext,
          path: string
        ): Promise<void> => {
          const result = await ctx.sandbox.run("mkdir", { args: ["-p", path] });
          if (result.exitCode !== 0) {
            throw new Error(
              `Failed to create directory ${path}: ${result.stderr}`
            );
          }
        },

        readdir: async (
          ctx: TensorlakeSandboxContext,
          path: string
        ): Promise<FileEntry[]> => {
          const response = await ctx.sandbox.listDirectory(path);
          return response.entries.map((e) => ({
            name: e.name,
            type: e.isDir ? ("directory" as const) : ("file" as const),
            size: e.size || 0,
            modified: e.modifiedAt ?? new Date(),
          }));
        },

        exists: async (
          ctx: TensorlakeSandboxContext,
          path: string
        ): Promise<boolean> => {
          try {
            await ctx.sandbox.readFile(path);
            return true;
          } catch {}
          try {
            await ctx.sandbox.listDirectory(path);
            return true;
          } catch {}
          return false;
        },

        remove: async (
          ctx: TensorlakeSandboxContext,
          path: string
        ): Promise<void> => {
          try {
            await ctx.sandbox.deleteFile(path);
          } catch {
            // May be a directory — fall back to rm -rf
            const result = await ctx.sandbox.run("rm", { args: ["-rf", path] });
            if (result.exitCode !== 0) {
              throw new Error(`Failed to remove ${path}: ${result.stderr}`);
            }
          }
        },
      },

      getInstance: (ctx: TensorlakeSandboxContext): TensorlakeSandboxContext =>
        ctx,
    },

    snapshot: {
      create: async (
        config: TensorlakeConfig,
        sandboxId: string,
        options?: { name?: string }
      ) => {
        const { apiKey, apiUrl } = resolveAuth(config);
        const sandbox = await Sandbox.connect({ sandboxId, apiKey, apiUrl });
        const result = await sandbox.checkpoint();

        if (!result) {
          throw new Error(
            `Failed to create snapshot for sandbox '${sandboxId}': checkpoint() did not return a snapshot result.`
          );
        }

        return {
          id: result.snapshotId,
          provider: "tensorlake",
          createdAt: new Date(),
          metadata: { name: options?.name },
        };
      },

      list: async (config: TensorlakeConfig) => {
        try {
          const { apiKey, apiUrl } = resolveAuth(config);
          return await Sandbox.listSnapshots({ apiKey, apiUrl });
        } catch {
          return [];
        }
      },

      delete: async (config: TensorlakeConfig, snapshotId: string) => {
        try {
          const { apiKey, apiUrl } = resolveAuth(config);
          await Sandbox.deleteSnapshot(snapshotId, { apiKey, apiUrl });
        } catch {
          // Ignore
        }
      },
    },
  },
});

export type { TensorlakeSandboxContext as TensorlakeSandbox };
