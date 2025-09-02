/**
 * Runloop Provider - Factory-based Implementation
 *
 * Full-featured provider with filesystem support using the factory pattern.
 * Reduces ~400 lines of boilerplate to ~100 lines of core logic.
 */

import { Runloop } from "@runloop/api-client";
import { createProvider } from "computesdk";
import type {
  ExecutionResult,
  SandboxInfo,
  CreateSandboxOptions,
  FileEntry,
} from "computesdk";

/**
 * Runloop-specific configuration options
 */
export interface RunloopConfig {
  /** Runloop API key - if not provided, will fallback to RUNLOOP_API_KEY environment variable */
  apiKey?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

/**
 * Options for creating snapshots
 */
export interface CreateSnapshotOptions {
  /** Optional name for the snapshot */
  name?: string;
  /** Optional metadata for the snapshot */
  metadata?: Record<string, string>;
}

/**
 * Options for listing snapshots
 */
export interface ListSnapshotsOptions {
  /** Filter by sandbox ID */
  sandboxId?: string;
  /** Limit the number of results */
  limit?: number;
}

/**
 * Options for creating blueprint templates
 */
export interface CreateBlueprintTemplateOptions {
  /** Name of the blueprint template */
  name: string;
  /** Custom Dockerfile content */
  dockerfile?: string;
  /** System setup commands to run during blueprint creation */
  systemSetupCommands?: string[];
  /** Launch commands to run when starting a devbox from this blueprint */
  launchCommands?: string[];
  /** File mounts as key-value pairs (path -> content) */
  fileMounts?: Record<string, string>;
  /** Code repository mounts */
  codeMounts?: Array<{
    repoName: string;
    repoOwner: string;
    token?: string;
    installCommand?: string;
  }>;
  /** Resource size for devboxes created from this blueprint */
  resourceSize?:
    | "X_SMALL"
    | "SMALL"
    | "MEDIUM"
    | "LARGE"
    | "X_LARGE"
    | "XX_LARGE"
    | "CUSTOM_SIZE";
  /** CPU architecture */
  architecture?: "x86_64" | "arm64";
  /** Custom CPU cores (requires CUSTOM_SIZE) */
  customCpuCores?: number;
  /** Custom memory in GB (requires CUSTOM_SIZE) */
  customMemoryGb?: number;
  /** Custom disk size (requires CUSTOM_SIZE) */
  customDiskSize?: number;
  /** Available ports for the devbox */
  availablePorts?: number[];
  /** Action to take when devbox is idle */
  afterIdle?: { action: string; timeSeconds: number };
  /** Keep alive time in seconds */
  keepAliveTimeSeconds?: number;
}

/**
 * Create a Runloop provider instance using the factory pattern
 */
export const runloop = createProvider<any, RunloopConfig>({
  name: "runloop",
  methods: {
    sandbox: {
      // Collection operations (map to compute.sandbox.*)
      create: async (config: RunloopConfig, options?: CreateSandboxOptions) => {
        // Validate API key
        const apiKey =
          config.apiKey ||
          (typeof process !== "undefined" && process.env?.RUNLOOP_API_KEY) ||
          "";

        if (!apiKey) {
          throw new Error(
            `Missing Runloop API key. Provide 'apiKey' in config or set RUNLOOP_API_KEY environment variable. Get your API key from https://runloop.ai/`
          );
        }

        const timeout = config.timeout || 300000;

        try {
          const client = new Runloop({
            bearerToken: apiKey,
          });

          let devboxParams: Runloop.DevboxCreateParams = {
            launch_parameters: {
              keep_alive_time_seconds: options?.timeout || 300000,
            },
            name: options?.sandboxId,
            metadata: options?.metadata,
            environment_variables: options?.envs,
          };

          // Use blueprint if specified
          if (options?.templateId) {
            const templateId = options?.templateId;
            // Check template prefix to determine parameter type
            if (templateId?.startsWith("bpt_")) {
              devboxParams.blueprint_id = templateId;
            } else if (templateId?.startsWith("snp_")) {
              devboxParams.snapshot_id = templateId;
            } else {
              // empty
            }
          }

          const dbx = await client.devboxes.createAndAwaitRunning(devboxParams);

          return {
            sandbox: dbx,
            sandboxId: dbx.id,
          };
        } catch (error) {
          throw new Error(
            `Failed to create Runloop devbox: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      },

      getById: async (config: RunloopConfig, sandboxId: string) => {
        const apiKey = config.apiKey || process.env.RUNLOOP_API_KEY!;

        try {
          const client = new Runloop({
            bearerToken: apiKey,
          });

          const devbox = await client.devboxes.retrieve(sandboxId);

          return {
            sandbox: devbox,
            sandboxId,
          };
        } catch (error) {
          // Devbox doesn't exist or can't be accessed
          return null;
        }
      },

      list: async (config: RunloopConfig) => {
        const apiKey = config.apiKey || process.env.RUNLOOP_API_KEY!;

        try {
          const client = new Runloop({
            bearerToken: apiKey,
          });

          const response = await client.devboxes.list();
          const devboxes = response.devboxes || [];

          return devboxes.map((devbox: any) => ({
            sandbox: devbox,
            sandboxId: devbox.id,
          }));
        } catch (error) {
          // Return empty array if listing fails
          return [];
        }
      },

      destroy: async (config: RunloopConfig, sandboxId: string) => {
        const apiKey = config.apiKey || process.env.RUNLOOP_API_KEY!;

        try {
          const client = new Runloop({
            bearerToken: apiKey,
          });

          await client.devboxes.shutdown(sandboxId);
        } catch (error) {
          // Devbox might already be destroyed or doesn't exist
          // This is acceptable for destroy operations
        }
      },

      // Instance operations (map to individual Sandbox methods)
      runCode: async (sandbox: any, code: string): Promise<ExecutionResult> => {
        throw new Error("Please use runCommand instead");
      },

      runCommand: async (
        sandbox: any,
        command: string,
        args: string[] = []
      ): Promise<ExecutionResult> => {
        const startTime = Date.now();
        const { devbox, client } = sandbox;

        try {
          // Execute code using Runloop's executeAsync
          // Runloop supports all runtimes

          const execution = await client.devboxes.executeAsync(devbox.id, {
            command: `${command} ${args.join(" ")}`,
          });

          const executionResult =
            await client.devboxes.executions.awaitCompleted(
              devbox.id,
              execution.execution_id
            );

          return {
            stdout: executionResult.stdout || "",
            stderr: executionResult.stderr || "",
            exitCode: executionResult.exit_status || 0,
            executionTime: Date.now() - startTime,
            sandboxId: devbox.id || "runloop-unknown",
            provider: "runloop",
          };
        } catch (error) {
          // Re-throw syntax errors
          if (
            error instanceof Error &&
            error.message.includes("Syntax error")
          ) {
            throw error;
          }
          throw new Error(
            `Runloop execution failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      },

      getInfo: async (sandbox: any): Promise<SandboxInfo> => {
        const { devbox } = sandbox;

        return {
          id: devbox.id || "runloop-unknown",
          provider: "runloop",
          status: devbox.status,
          createdAt: new Date(devbox.create_time_ms || Date.now()),
          timeout: devbox.launch_parameters.keep_alive_time_seconds || 300000,
          metadata: {
            runloopDevboxId: devbox.id,
            templateId: devbox.blueprint_id || devbox.snapshot_id,
            ...devbox.metadata,
          },
        };
      },

      getUrl: async (
        sandbox: any,
        options: { port: number }
      ): Promise<string> => {
        const { devbox, client } = sandbox;

        try {
          const tunnel = await client.devboxes.createTunnel(devbox.id, {
            port: options.port,
          });

          return tunnel.url;
        } catch (error) {
          throw new Error(
            `Failed to get Runloop URL for port ${options.port}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      },

      // Optional filesystem methods - using Runloop's file operations
      filesystem: {
        readFile: async (sandbox: any, path: string): Promise<string> => {
          const { devbox, client } = sandbox;

          try {
            const result = await client.devboxes.readFileContents(devbox.id, {
              path: path,
            });
            return result.content || "";
          } catch (error) {
            throw new Error(
              `Failed to read file ${path}: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        },

        writeFile: async (
          sandbox: any,
          path: string,
          content: string
        ): Promise<void> => {
          const { devbox, client } = sandbox;

          try {
            await client.devboxes.writeFileContents(devbox.id, {
              path: path,
              content: content,
            });
          } catch (error) {
            throw new Error(
              `Failed to write file ${path}: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        },

        mkdir: async (
          sandbox: any,
          path: string,
          runCommand: any
        ): Promise<void> => {
          const result = await runCommand(sandbox, "mkdir", ["-p", path]);
          if (result.exitCode !== 0) {
            throw new Error(
              `Failed to create directory ${path}: ${result.stderr}`
            );
          }
        },

        readdir: async (
          sandbox: any,
          path: string,
          runCommand: any
        ): Promise<FileEntry[]> => {
          const result = await runCommand(sandbox, "ls", ["-la", path]);

          if (result.exitCode !== 0) {
            throw new Error(
              `Failed to list directory ${path}: ${result.stderr}`
            );
          }

          const lines = (result.stdout || "")
            .split("\n")
            .filter((line: string) => line.trim() && !line.startsWith("total"));

          return lines.map((line: string) => {
            const parts = line.trim().split(/\s+/);
            const name = parts[parts.length - 1];
            const isDirectory = line.startsWith("d");

            return {
              name,
              path: `${path}/${name}`,
              isDirectory,
              size: parseInt(parts[4]) || 0,
              lastModified: new Date(),
            };
          });
        },

        exists: async (
          sandbox: any,
          path: string,
          runCommand: any
        ): Promise<boolean> => {
          const result = await runCommand(sandbox, "test", ["-e", path]);
          return result.exitCode === 0;
        },

        remove: async (
          sandbox: any,
          path: string,
          runCommand: any
        ): Promise<void> => {
          const result = await runCommand(sandbox, "rm", ["-rf", path]);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to remove ${path}: ${result.stderr}`);
          }
        },
      },

      // Provider-specific typed getInstance method
      getInstance: (sandbox: any): any => {
        return sandbox;
      },

      // Snapshot management methods
      snapshot: {
        create: async (
          config: RunloopConfig,
          sandboxId: string,
          options?: CreateSnapshotOptions
        ) => {
          const apiKey = config.apiKey || process.env.RUNLOOP_API_KEY!;

          if (!apiKey) {
            throw new Error("Missing Runloop API key for snapshot creation");
          }

          try {
            const client = new Runloop({
              bearerToken: apiKey,
            });

            const snapshotParams: any = {};
            if (options?.name) {
              snapshotParams.name = options.name;
            }
            if (options?.metadata) {
              snapshotParams.metadata = options.metadata;
            }

            const snapshot = await client.devboxes.snapshotDisk(
              sandboxId,
              snapshotParams
            );
            return snapshot;
          } catch (error) {
            throw new Error(
              `Failed to create snapshot for sandbox ${sandboxId}: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        },

        list: async (
          config: RunloopConfig,
          options?: ListSnapshotsOptions
        ) => {
          const apiKey = config.apiKey || process.env.RUNLOOP_API_KEY!;

          if (!apiKey) {
            throw new Error("Missing Runloop API key for listing snapshots");
          }

          try {
            const client = new Runloop({
              bearerToken: apiKey,
            });

            const listParams: any = {};
            if (options?.limit) {
              listParams.limit = options.limit;
            }

            const response = await client.devboxes.listDiskSnapshots(listParams);
            return response || [];
          } catch (error) {
            throw new Error(
              `Failed to list snapshots: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        },

        delete: async (config: RunloopConfig, snapshotId: string) => {
          const apiKey = config.apiKey || process.env.RUNLOOP_API_KEY!;

          if (!apiKey) {
            throw new Error("Missing Runloop API key for snapshot deletion");
          }

          try {
            const client = new Runloop({
              bearerToken: apiKey,
            });

            await client.devboxes.deleteDiskSnapshot(snapshotId);
          } catch (error) {
            throw new Error(
              `Failed to delete snapshot ${snapshotId}: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        },
      },
    },

    template: {
      // Blueprint template management methods
      create: async (
        config: RunloopConfig,
        options: Runloop.BlueprintCreateParams
      ) => {
        const apiKey = config.apiKey || process.env.RUNLOOP_API_KEY!;

        if (!apiKey) {
          throw new Error(
            "Missing Runloop API key for blueprint template creation"
          );
        }

        try {
          const client = new Runloop({
            bearerToken: apiKey,
          });

          const blueprint = await client.blueprints.create(options);
          return blueprint;
        } catch (error) {
          throw new Error(
            `Failed to create blueprint template: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      },

      list: async (config: RunloopConfig, options?: { limit?: number }) => {
        const apiKey = config.apiKey || process.env.RUNLOOP_API_KEY!;

        if (!apiKey) {
          throw new Error(
            "Missing Runloop API key for listing blueprint templates"
          );
        }

        try {
          const client = new Runloop({
            bearerToken: apiKey,
          });

          const listParams: any = {};
          if (options?.limit) {
            listParams.limit = options.limit;
          }

          const response = await client.blueprints.list(listParams);
          return response || [];
        } catch (error) {
          throw new Error(
            `Failed to list blueprint templates: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      },

      delete: async (config: RunloopConfig, blueprintId: string) => {
        const apiKey = config.apiKey || process.env.RUNLOOP_API_KEY!;

        if (!apiKey) {
          throw new Error(
            "Missing Runloop API key for blueprint template deletion"
          );
        }

        try {
          const client = new Runloop({
            bearerToken: apiKey,
          });

          await client.blueprints.delete(blueprintId);
        } catch (error) {
          throw new Error(
            `Failed to delete blueprint template ${blueprintId}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      },
    },
  },
});
