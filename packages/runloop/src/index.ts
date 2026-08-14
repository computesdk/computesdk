/**
 * Runloop Provider - Factory-based Implementation
 *
 * Full-featured provider with filesystem support using the factory pattern.
 * Reduces ~400 lines of boilerplate to ~100 lines of core logic.
 */

import { RunloopSDK, type Runloop } from "@runloop/api-client";
import { defineProvider } from "@computesdk/provider";
import { posix as posixPath } from "node:path";
import type {
  CommandResult,
  SandboxInfo,
  CreateSnapshotOptions,
  ListSnapshotsOptions,
  RunCommandOptions,
} from "@computesdk/provider";
import type {
  CreateSandboxOptions,
  FileEntry,
  Snapshot,
} from "computesdk";

// Define Runloop-specific types
type RunloopTemplate = Runloop.BlueprintView;
type RunloopSandbox = Runloop.DevboxView & { client: RunloopSDK };
type RunloopCreateWaitOptions = Parameters<RunloopSDK["api"]["devboxes"]["createAndAwaitRunning"]>[1];

type CommandRunner = (
  sandbox: RunloopSandbox,
  command: string,
  options?: RunCommandOptions
) => Promise<CommandResult>;

/**
 * Runloop-specific configuration options
 */
export interface RunloopConfig {
  /** Runloop API key - if not provided, will fallback to RUNLOOP_API_KEY environment variable */
  apiKey?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

const clientCache = new WeakMap<RunloopConfig, RunloopSDK>();

function resolveApiKey(config: RunloopConfig): string {
  return (
    config.apiKey ||
    (typeof process !== "undefined" && process.env?.RUNLOOP_API_KEY) ||
    ""
  );
}

function getRunloopClient(config: RunloopConfig): RunloopSDK {
  const apiKey = resolveApiKey(config);
  if (!apiKey) {
    throw new Error(
      `Missing Runloop API key. Provide 'apiKey' in config or set RUNLOOP_API_KEY environment variable. Get your API key from https://runloop.ai/`
    );
  }

  const cached = clientCache.get(config);
  if (cached) return cached;

  const client = new RunloopSDK({
    bearerToken: apiKey,
    http2: true,
  });
  clientCache.set(config, client);
  return client;
}

function longPollOptions<TOptions>(timeoutMs?: number): TOptions | undefined {
  return timeoutMs ? ({ longPoll: { timeoutMs } } as TOptions) : undefined;
}

function quotePosixShellToken(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function assertSafeRemovalPath(value: string): void {
  const normalized = posixPath.normalize(value);
  if (value.length === 0 || normalized === "/" || normalized === "." ||
      normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Refusing to remove unsafe path: ${JSON.stringify(value)}`);
  }
}

function buildCommand(command: string, options?: RunCommandOptions): string {
  let fullCommand = command;

  if (options?.env && Object.keys(options.env).length > 0) {
    const envPrefix = Object.entries(options.env)
      .map(([key, value]) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
          throw new Error(`Invalid environment variable name: ${JSON.stringify(key)}`);
        }
        return `${key}=${quotePosixShellToken(String(value))}`;
      })
      .join(" ");
    fullCommand = `${envPrefix} ${fullCommand}`;
  }

  if (options?.cwd) {
    fullCommand = `cd -- ${quotePosixShellToken(options.cwd)} && ${fullCommand}`;
  }

  if (options?.background) {
    fullCommand = `nohup sh -lc ${quotePosixShellToken(fullCommand)} >/dev/null 2>&1 &`;
  }

  return fullCommand;
}

function isHttpNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "status" in error && error.status === 404;
}

const READDIR_ENTRY_SCRIPT = [
  "for entry; do",
  '  name=${entry##*/}',
  '  if [ -d "$entry" ]; then type=directory; else type=file; fi',
  '  encoded=$(printf %s "$name" | base64 | tr -d "\\n")',
  '  size=$(stat -c %s -- "$entry") || exit',
  '  modified=$(stat -c %Y -- "$entry") || exit',
  '  printf "%s\\t%s\\t%s\\t%s\\n" "$encoded" "$type" "$size" "$modified"',
  "done",
].join("\n");

function buildReaddirCommand(path: string): string {
  const findRoot = path.startsWith("-") ? `./${path}` : path;
  return [
    `find -- ${quotePosixShellToken(findRoot)} -mindepth 1 -maxdepth 1 -exec sh -c`,
    quotePosixShellToken(READDIR_ENTRY_SCRIPT),
    "sh {} +",
  ].join(" ");
}

function parseReaddirOutput(stdout: string): FileEntry[] {
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [encodedName, type, rawSize, rawModified] = line.split("\t");
      const size = Number(rawSize);
      const modifiedSeconds = Number(rawModified);
      if (!encodedName || (type !== "file" && type !== "directory") ||
          !Number.isFinite(size) || !Number.isFinite(modifiedSeconds)) {
        throw new Error(`Malformed Runloop directory entry: ${JSON.stringify(line)}`);
      }
      return {
        name: Buffer.from(encodedName, "base64").toString("utf8"),
        type,
        size,
        modified: new Date(modifiedSeconds * 1000),
      };
    });
}

function mapStatus(status: Runloop.DevboxView["status"]): SandboxInfo["status"] {
  switch (status) {
    case "scheduled":
    case "queued":
    case "provisioning":
    case "initializing":
    case "resuming":
    case "running":
      return "running";
    case "suspending":
    case "suspended":
    case "shutdown":
      return "stopped";
    case "failure":
      return "error";
  }
}

async function collectPaginated<T>(
  source: AsyncIterable<T>,
  limit?: number,
): Promise<T[]> {
  if (limit !== undefined && limit <= 0) return [];

  const results: T[] = [];
  for await (const item of source) {
    results.push(item);
    if (limit !== undefined && results.length >= limit) break;
  }
  return results;
}

function normalizeSnapshot(snapshot: Runloop.DevboxSnapshotView): Snapshot {
  return {
    id: snapshot.id,
    provider: "runloop",
    createdAt: new Date(snapshot.create_time_ms),
    metadata: {
      name: snapshot.name ?? null,
      sourceDevboxId: snapshot.source_devbox_id,
      sourceBlueprintId: snapshot.source_blueprint_id ?? null,
      sizeBytes: snapshot.size_bytes ?? null,
      commitMessage: snapshot.commit_message ?? null,
      userMetadata: snapshot.metadata ?? {},
    },
  };
}

function emitMissingOutput(
  emitted: string,
  complete: string,
  callback: ((chunk: string) => void) | undefined,
): void {
  if (!callback || !complete || emitted.includes(complete)) return;
  if (!emitted) {
    callback(complete);
  } else if (complete.startsWith(emitted)) {
    callback(complete.slice(emitted.length));
  } else if (!complete.includes(emitted)) {
    callback(complete);
  }
}

async function streamExecutionOutput(
  openStream: () => Promise<AsyncIterable<{ output: string }>>,
  onChunk: (chunk: string) => void,
  signal: AbortSignal,
  isActive: () => boolean,
): Promise<void> {
  try {
    const stream = await openStream();
    for await (const chunk of stream) {
      if (signal.aborted) break;
      if (isActive()) onChunk(chunk.output);
    }
  } catch {
    // Streaming is best effort, matching the native SDK callback behavior.
  }
}

async function bestEffortKillExecution(
  sandbox: RunloopSandbox,
  executionId: string,
): Promise<void> {
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      sandbox.client.api.devboxes.executions.kill(
        sandbox.id,
        executionId,
        { kill_process_group: true },
      ).catch(() => undefined),
      new Promise<void>((resolve) => {
        killTimer = setTimeout(resolve, 1_000);
      }),
    ]);
  } finally {
    if (killTimer) clearTimeout(killTimer);
  }
}

async function executeCommand(
  sandbox: RunloopSandbox,
  command: string,
  options?: RunCommandOptions,
): Promise<CommandResult> {
  const startTime = Date.now();
  const devbox = sandbox.client.devbox.fromId(sandbox.id);
  const fullCommand = buildCommand(command, options);
  let callbacksActive = true;
  const executionParams = {
    ...(options?.onStdout
      ? { stdout: (chunk: string) => callbacksActive && options.onStdout?.(chunk) }
      : {}),
    ...(options?.onStderr
      ? { stderr: (chunk: string) => callbacksActive && options.onStderr?.(chunk) }
      : {}),
  };

  const toCommandResult = async (result: Awaited<ReturnType<typeof devbox.cmd.exec>>): Promise<CommandResult> => ({
    stdout: await result.stdout(),
    stderr: await result.stderr(),
    exitCode: result.exitCode ?? -1,
    durationMs: Date.now() - startTime,
  });

  if (options?.timeout === undefined) {
    try {
      const result = await devbox.cmd.exec(fullCommand, executionParams);
      return await toCommandResult(result);
    } finally {
      callbacksActive = false;
    }
  }

  const timeoutMs = options.timeout;
  const deadline = startTime + Math.max(0, timeoutMs);
  const monitorController = new AbortController();
  let streamedStdout = "";
  let streamedStderr = "";
  let execution: Awaited<ReturnType<typeof devbox.cmd.execAsync>> | undefined;
  let resultPromise: ReturnType<Awaited<ReturnType<typeof devbox.cmd.execAsync>>["result"]> | undefined;
  let streamPromises: Promise<void>[] = [];
  let executionCompleted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      resolve("timeout");
      monitorController.abort();
    }, Math.max(0, deadline - Date.now()));
  });
  const timeoutResult = (): CommandResult => ({
    stdout: streamedStdout,
    stderr: streamedStderr,
    exitCode: 124,
    durationMs: Date.now() - startTime,
  });

  try {
    const requestTimeoutMs = Math.max(1, deadline - Date.now());
    const executionPromise = devbox.cmd.execAsync(
      fullCommand,
      {},
      { signal: monitorController.signal, timeout: requestTimeoutMs },
    );
    const creationOutcome = await Promise.race([
      executionPromise.then((createdExecution) => ({ execution: createdExecution })),
      timeoutPromise,
    ]);

    if (creationOutcome === "timeout") {
      callbacksActive = false;
      void executionPromise
        .then((lateExecution) => bestEffortKillExecution(sandbox, lateExecution.executionId))
        .catch(() => undefined);
      return timeoutResult();
    }

    const activeExecution = creationOutcome.execution;
    execution = activeExecution;
    streamPromises = [
      streamExecutionOutput(
        () => sandbox.client.api.devboxes.executions.streamStdoutUpdates(
          sandbox.id,
          activeExecution.executionId,
          {},
          { signal: monitorController.signal },
        ),
        (chunk) => {
          streamedStdout += chunk;
          options.onStdout?.(chunk);
        },
        monitorController.signal,
        () => callbacksActive,
      ),
      streamExecutionOutput(
        () => sandbox.client.api.devboxes.executions.streamStderrUpdates(
          sandbox.id,
          activeExecution.executionId,
          {},
          { signal: monitorController.signal },
        ),
        (chunk) => {
          streamedStderr += chunk;
          options.onStderr?.(chunk);
        },
        monitorController.signal,
        () => callbacksActive,
      ),
    ];
    resultPromise = activeExecution.result({ signal: monitorController.signal });
    const outcome = await Promise.race([
      resultPromise.then((result) => ({ result })),
      timeoutPromise,
    ]);

    if (outcome === "timeout") {
      callbacksActive = false;
      monitorController.abort();
      await Promise.all([
        bestEffortKillExecution(sandbox, execution.executionId),
        Promise.allSettled([resultPromise, ...streamPromises]),
      ]);
      return timeoutResult();
    }

    executionCompleted = true;
    monitorController.abort();
    await Promise.allSettled(streamPromises);
    const commandResult = await toCommandResult(outcome.result);
    emitMissingOutput(streamedStdout, commandResult.stdout, options.onStdout);
    emitMissingOutput(streamedStderr, commandResult.stderr, options.onStderr);
    return commandResult;
  } catch (error) {
    callbacksActive = false;
    monitorController.abort();
    await Promise.all([
      executionCompleted || !execution
        ? Promise.resolve()
        : bestEffortKillExecution(sandbox, execution.executionId),
      Promise.allSettled([
        ...(resultPromise ? [resultPromise] : []),
        ...streamPromises,
      ]),
    ]);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    callbacksActive = false;
    monitorController.abort();
  }
}

async function runCommandWithErrors(
  sandbox: RunloopSandbox,
  command: string,
  options?: RunCommandOptions,
): Promise<CommandResult> {
  try {
    return await executeCommand(sandbox, command, options);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Syntax error")) {
      throw error;
    }
    throw new Error(
      `Runloop execution failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Runloop-specific blueprint creation options
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
export const runloop = defineProvider<
  RunloopSandbox,
  RunloopConfig,
  RunloopTemplate,
  Snapshot
>({
  name: "runloop",
  methods: {
    sandbox: {
      create: async (config: RunloopConfig, options?: CreateSandboxOptions) => {
        const timeout = config.timeout;

        try {
          const client = getRunloopClient(config);

          const {
            timeout: optTimeout,
            envs,
            name,
            metadata,
            templateId,
            snapshotId,
            sandboxId: optSandboxId,
            ports: _ports,
            namespace: _namespace,
            directory: _directory,
            launch_parameters: optLaunchParameters,
            ...providerOptions
          } = options || {};

          const effectiveTimeout = optTimeout ?? timeout;
          const keepAliveSeconds = effectiveTimeout !== undefined
            ? Math.ceil(effectiveTimeout / 1000)
            : 1800;

          let devboxParams: Runloop.DevboxCreateParams = {
            launch_parameters: {
              keep_alive_time_seconds: keepAliveSeconds,
              ...optLaunchParameters,
            } as Runloop.DevboxCreateParams["launch_parameters"],
            name: name || optSandboxId,
            metadata,
            environment_variables: envs,
            ...providerOptions,
          };

          // snapshotId is the canonical cross-provider field — map it directly to snapshot_id.
          // templateId is kept for backwards compatibility: bpt_ prefix → blueprint_id, snp_ prefix → snapshot_id.
          if (snapshotId) {
            devboxParams.snapshot_id = snapshotId;
          } else if (templateId) {
            if (templateId.startsWith("bpt_")) {
              devboxParams.blueprint_id = templateId;
            } else if (templateId.startsWith("snp_")) {
              devboxParams.snapshot_id = templateId;
            }
          }

          const dbx = await client.api.devboxes.createAndAwaitRunning(
            devboxParams,
            longPollOptions<RunloopCreateWaitOptions>(effectiveTimeout),
          );

          const runloopSandbox: RunloopSandbox = {
            ...dbx,
            client: client
          };

          return {
            sandbox: runloopSandbox,
            sandboxId: dbx.id,
          };
        } catch (error) {
          throw new Error(
            `Failed to create Runloop devbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: RunloopConfig, sandboxId: string) => {
        try {
          const client = getRunloopClient(config);
          const devbox = await client.api.devboxes.retrieve(sandboxId);
          return {
            sandbox: { ...devbox, client } as RunloopSandbox,
            sandboxId,
          };
        } catch (error) {
          if (isHttpNotFound(error)) return null;
          throw error;
        }
      },

      list: async (config: RunloopConfig) => {
        const client = getRunloopClient(config);
        const devboxes = await collectPaginated(client.api.devboxes.list());

        return devboxes.map((devbox) => ({
          sandbox: { ...devbox, client } as RunloopSandbox,
          sandboxId: devbox.id,
        }));
      },

      destroy: async (config: RunloopConfig, sandboxId: string) => {
        try {
          const client = getRunloopClient(config);
          await client.api.devboxes.shutdown(sandboxId);
        } catch (error) {
          if (!isHttpNotFound(error)) throw error;
        }
      },

      runCommand: runCommandWithErrors,

      streamCommand: runCommandWithErrors,

      getInfo: async (sandbox: RunloopSandbox): Promise<SandboxInfo> => {
        const devbox = await sandbox.client.api.devboxes.retrieve(sandbox.id);
        const keepAliveSecs = devbox.launch_parameters?.keep_alive_time_seconds;

        return {
          id: devbox.id || "runloop-unknown",
          provider: "runloop",
          status: mapStatus(devbox.status),
          createdAt: new Date(devbox.create_time_ms || Date.now()),
          // keep_alive_time_seconds is in seconds; SandboxInfo.timeout is in milliseconds
          timeout: keepAliveSecs ? keepAliveSecs * 1000 : 300000,
          metadata: {
            runloopDevboxId: devbox.id,
            templateId: devbox.blueprint_id || devbox.snapshot_id,
            runtime: 'node',
            ...devbox.metadata,
          },
        };
      },

      getUrl: async (
        sandbox: RunloopSandbox,
        options: { port: number }
      ): Promise<string> => {
        const devbox = sandbox;
        const client = sandbox.client;

        try {
          const tunnel = await client.api.devboxes.enableTunnel(devbox.id);
          return `https://${options.port}-${tunnel.tunnel_key}.tunnel.runloop.ai`;
        } catch (error) {
          throw new Error(
            `Failed to get Runloop URL for port ${options.port}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      filesystem: {
        readFile: async (sandbox: RunloopSandbox, path: string): Promise<string> => {
          return sandbox.client.devbox.fromId(sandbox.id).file.read({ file_path: path });
        },

        writeFile: async (sandbox: RunloopSandbox, path: string, content: string): Promise<void> => {
          const result = await sandbox.client.devbox.fromId(sandbox.id).file.write({
            file_path: path,
            contents: content,
          });
          if (result.exit_status !== 0) {
            throw new Error(
              `Failed to write file ${path}: ${result.stderr || `exit ${result.exit_status}`}`,
            );
          }
        },

        mkdir: async (sandbox: RunloopSandbox, path: string, runCommand: CommandRunner): Promise<void> => {
          const result = await runCommand(sandbox, `mkdir -p -- ${quotePosixShellToken(path)}`);
          if (result.exitCode !== 0) throw new Error(`Failed to create directory ${path}: ${result.stderr}`);
        },

        readdir: async (sandbox: RunloopSandbox, path: string, runCommand: CommandRunner): Promise<FileEntry[]> => {
          const result = await runCommand(sandbox, buildReaddirCommand(path));
          if (result.exitCode !== 0) throw new Error(`Failed to list directory ${path}: ${result.stderr}`);

          return parseReaddirOutput(result.stdout || "");
        },

        exists: async (sandbox: RunloopSandbox, path: string, runCommand: CommandRunner): Promise<boolean> => {
          const result = await runCommand(sandbox, `test -e ${quotePosixShellToken(path)}`);
          return result.exitCode === 0;
        },

        remove: async (sandbox: RunloopSandbox, path: string, runCommand: CommandRunner): Promise<void> => {
          assertSafeRemovalPath(path);
          const result = await runCommand(sandbox, `rm -rf -- ${quotePosixShellToken(path)}`);
          if (result.exitCode !== 0) throw new Error(`Failed to remove ${path}: ${result.stderr}`);
        },
      },

      getInstance: (sandbox: RunloopSandbox): RunloopSandbox => sandbox,
    },

    template: {
      create: async (config: RunloopConfig, options: CreateBlueprintTemplateOptions | Runloop.BlueprintCreateParams) => {
        const client = getRunloopClient(config);
        return client.api.blueprints.create(options);
      },

      list: async (config: RunloopConfig, options?: { limit?: number }) => {
        const client = getRunloopClient(config);
        const listParams: Runloop.BlueprintListParams = {};
        if (options?.limit !== undefined) listParams.limit = options.limit;
        return collectPaginated(client.api.blueprints.list(listParams), options?.limit);
      },

      delete: async (config: RunloopConfig, blueprintId: string) => {
        const client = getRunloopClient(config);
        await client.api.blueprints.delete(blueprintId);
      },
    },

    snapshot: {
      create: async (config: RunloopConfig, sandboxId: string, options?: CreateSnapshotOptions) => {
        const client = getRunloopClient(config);
        const snapshotParams: Runloop.DevboxSnapshotDiskParams = {};
        if (options?.name) snapshotParams.name = options.name;
        if (options?.metadata) snapshotParams.metadata = options.metadata;
        const snapshot = await client.api.devboxes.snapshotDisk(sandboxId, snapshotParams);
        return normalizeSnapshot(snapshot);
      },

      list: async (config: RunloopConfig, options?: ListSnapshotsOptions) => {
        const client = getRunloopClient(config);
        const listParams: Runloop.DevboxListDiskSnapshotsParams = {};
        if (options?.limit !== undefined) listParams.limit = options.limit;
        if (options?.sandboxId) listParams.devbox_id = options.sandboxId;
        const snapshots = await collectPaginated(
          client.api.devboxes.listDiskSnapshots(listParams),
          options?.limit,
        );
        return snapshots.map(normalizeSnapshot);
      },

      delete: async (config: RunloopConfig, snapshotId: string) => {
        const client = getRunloopClient(config);
        await client.api.devboxes.deleteDiskSnapshot(snapshotId);
      },
    },
  },
});
