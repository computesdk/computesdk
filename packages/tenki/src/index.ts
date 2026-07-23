/**
 * @computesdk/tenki — ComputeSDK provider for Tenki Cloud sandboxes.
 *
 * Usage:
 *   import { tenki } from "@computesdk/tenki";
 *   import { compute } from "computesdk";
 *
 *   compute.setConfig({
 *     provider: tenki({ apiKey: "tk_..." }),
 *   });
 *
 *   const sandbox = await compute.sandbox.create();
 *   const result = await sandbox.runCommand("echo hello");
 *   await sandbox.destroy();
 */

import { defineProvider, escapeShellArg } from "@computesdk/provider";
import type { RunCommandOptions, CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, CreateTemplateOptions } from "computesdk";
import {
  TenkiSandbox,
  Session,
  type SessionState,
  type CreateOptions,
  type Output,
  SessionNotFoundError,
  stdoutText,
  stderrText,
} from "@tenkicloud/sandbox";

export interface TenkiConfig {
  /** Tenki API key (tk_...). Falls back to TENKI_API_KEY / TENKI_AUTH_TOKEN env vars. */
  apiKey?: string;
  /** API base URL. Falls back to TENKI_API_URL, then https://api.tenki.cloud. */
  baseUrl?: string;
  /** Workspace to create sandboxes in. Falls back to TENKI_WORKSPACE_ID, then auto-resolved from the API key. */
  workspaceId?: string;
  /** Project to create sandboxes in. Falls back to TENKI_PROJECT_ID, then auto-resolved from the API key. */
  projectId?: string;
  /** Default runCommand timeout in milliseconds. */
  timeout?: number;
  /** Default sandbox resources applied at create() time. */
  cpuCores?: number;
  memoryMb?: number;
  diskSizeGb?: number;
}

interface TenkiScope {
  workspaceId: string;
  projectId: string;
}

// ---------------------------------------------------------------------------
// Client + scope resolution
// ---------------------------------------------------------------------------

/**
 * One TenkiSandbox client per (token, baseUrl) pair. The client owns a gRPC
 * transport, so we memoize rather than reconnecting on every collection-level
 * call (create/getById/list/destroy).
 */
const clients = new Map<string, TenkiSandbox>();
const scopes = new Map<string, TenkiScope>();

function resolveApiKey(config: TenkiConfig): string {
  const apiKey = config.apiKey ?? process.env.TENKI_API_KEY ?? process.env.TENKI_AUTH_TOKEN;
  if (!apiKey) {
    throw new Error(
      "Missing API key for Tenki.\n\n" +
        "Create one at https://app.tenki.cloud (workspace settings > API Keys)\n" +
        'Then pass it: tenki({ apiKey: "tk_..." })\n' +
        "Or set TENKI_API_KEY (or TENKI_AUTH_TOKEN) in your environment.",
    );
  }
  return apiKey;
}

function clientKey(config: TenkiConfig): string {
  return `${resolveApiKey(config)}::${config.baseUrl ?? process.env.TENKI_API_URL ?? ""}`;
}

function getClient(config: TenkiConfig): TenkiSandbox {
  const key = clientKey(config);
  let client = clients.get(key);
  if (!client) {
    client = new TenkiSandbox({
      authToken: resolveApiKey(config),
      baseUrl: config.baseUrl ?? process.env.TENKI_API_URL,
    });
    clients.set(key, client);
  }
  return client;
}

/**
 * Tenki sandboxes are created inside a workspace/project. When neither is
 * configured we resolve the key's identity once via whoAmI() and pick the
 * first workspace that has a project.
 */
async function resolveScope(config: TenkiConfig, client: TenkiSandbox): Promise<TenkiScope> {
  const workspaceId = config.workspaceId ?? process.env.TENKI_WORKSPACE_ID;
  const projectId = config.projectId ?? process.env.TENKI_PROJECT_ID;
  if (workspaceId && projectId) return { workspaceId, projectId };

  const key = clientKey(config);
  const cached = scopes.get(key);
  if (cached) return cached;

  const identity = await client.whoAmI();
  const workspace = identity.workspaces.find((w) => w.projects.length > 0);
  const project = workspace?.projects[0];
  if (!workspace || !project) {
    throw new Error(
      "Could not resolve a Tenki workspace/project for this API key.\n" +
        "Pass them explicitly: tenki({ workspaceId, projectId })\n" +
        "Or set TENKI_WORKSPACE_ID and TENKI_PROJECT_ID in your environment.",
    );
  }
  const scope = { workspaceId: workspace.id, projectId: project.id };
  scopes.set(key, scope);
  return scope;
}

// ---------------------------------------------------------------------------
// Session bookkeeping
// ---------------------------------------------------------------------------

/**
 * created_at is on the wire but not yet surfaced by the TS SDK Session, so we
 * record observation time as a best-effort createdAt for getInfo(). Instance
 * methods only receive the sandbox, so exec-time defaults (timeout) are
 * stashed per session as well.
 */
const observedAt = new WeakMap<Session, Date>();
const sessionConfig = new WeakMap<Session, TenkiConfig>();

function rememberSession(session: Session, config: TenkiConfig): Session {
  if (!observedAt.has(session)) observedAt.set(session, new Date());
  sessionConfig.set(session, config);
  return session;
}

function mapStatus(state: SessionState): SandboxInfo["status"] {
  switch (state) {
    case "RUNNING":
    case "CREATING":
    case "RESUMING":
      return "running";
    case "PAUSED":
    case "PAUSING":
    case "USER_SHUTDOWN":
    case "TERMINATING":
    case "TERMINATED":
      return "stopped";
    default:
      return "error";
  }
}

function toCreateOptions(config: TenkiConfig, scope: TenkiScope, options?: CreateSandboxOptions): CreateOptions {
  const opts: CreateOptions = {
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
  };
  if (options?.name) opts.name = options.name;
  if (options?.envs) opts.env = options.envs;
  if (options?.metadata) {
    // Tenki metadata values are strings.
    opts.metadata = Object.fromEntries(Object.entries(options.metadata).map(([k, v]) => [k, String(v)]));
  }
  if (options?.templateId) opts.image = options.templateId;
  if (options?.snapshotId) opts.snapshotId = options.snapshotId;
  if (options?.timeout) opts.maxDurationMs = options.timeout;

  // Resources: per-call override (via CreateSandboxOptions' index signature)
  // wins over provider-level defaults.
  const cpuCores = (options as Record<string, unknown> | undefined)?.cpuCores ?? config.cpuCores;
  const memoryMb = (options as Record<string, unknown> | undefined)?.memoryMb ?? config.memoryMb;
  const diskSizeGb = (options as Record<string, unknown> | undefined)?.diskSizeGb ?? config.diskSizeGb;
  if (typeof cpuCores === "number") opts.cpuCores = cpuCores;
  if (typeof memoryMb === "number") opts.memoryMb = memoryMb;
  if (typeof diskSizeGb === "number") opts.diskSizeGb = diskSizeGb;

  return opts;
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

/**
 * Treat "no such sandbox" uniformly: the API raises SessionNotFoundError for
 * unknown UUIDs, but rejects non-UUID ids with a validation error before the
 * lookup. Either way the id names no session.
 */
function isMissingSession(err: unknown): boolean {
  if (err instanceof SessionNotFoundError) return true;
  return err instanceof Error && err.message.includes("session_id: value must be a valid UUID");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Run a command line through a shell. ComputeSDK passes runCommand a full
 * shell command string, whereas Tenki's Session.exec executes argv directly
 * (execve, no shell), so we wrap with `sh -lc`.
 */
async function runShell(session: Session, command: string, options?: RunCommandOptions): Promise<CommandResult> {
  const config = sessionConfig.get(session) ?? {};
  const line = options?.cwd ? `cd ${shellQuote(options.cwd)} && ${command}` : command;

  if (options?.background) {
    // Detach stdio so the background process does not hold the exec output
    // stream open (a bare `&` would keep exec waiting forever).
    const detached = `{ ${line} ; } >/dev/null 2>&1 </dev/null &`;
    await session.exec("sh", { args: ["-lc", detached], env: options?.env });
    return { stdout: "", stderr: "", exitCode: 0, durationMs: 0 };
  }

  // Persistent streaming decoders so multi-byte UTF-8 sequences split across
  // chunks are reassembled instead of corrupted.
  const stdoutDecoder = new TextDecoder();
  const stderrDecoder = new TextDecoder();
  const onOutput =
    options?.onStdout || options?.onStderr
      ? (out: Output) => {
          if (out.isStderr) {
            const text = stderrDecoder.decode(out.data, { stream: true });
            if (text) options?.onStderr?.(text);
          } else {
            const text = stdoutDecoder.decode(out.data, { stream: true });
            if (text) options?.onStdout?.(text);
          }
        }
      : undefined;

  const result = await session.exec("sh", {
    args: ["-lc", line],
    timeoutMs: options?.timeout ?? config.timeout,
    env: options?.env,
    onOutput,
  });

  if (onOutput) {
    // Flush any buffered partial UTF-8 sequence left at stream end.
    const stdoutTail = stdoutDecoder.decode();
    if (stdoutTail) options?.onStdout?.(stdoutTail);
    const stderrTail = stderrDecoder.decode();
    if (stderrTail) options?.onStderr?.(stderrTail);
  }

  return {
    stdout: stdoutText(result),
    stderr: stderrText(result),
    exitCode: result.exitCode,
    durationMs: result.durationMs,
  };
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const tenki = defineProvider<Session, TenkiConfig>({
  name: "tenki",
  methods: {
    sandbox: {
      create: async (config, options) => {
        const client = getClient(config);
        const scope = await resolveScope(config, client);
        const session = await client.createAndWait(toCreateOptions(config, scope, options));
        return { sandbox: rememberSession(session, config), sandboxId: session.id };
      },

      getById: async (config, sandboxId) => {
        const client = getClient(config);
        try {
          const session = await client.get(sandboxId);
          return { sandbox: rememberSession(session, config), sandboxId: session.id };
        } catch (err) {
          if (isMissingSession(err)) return null;
          throw err;
        }
      },

      list: async (config) => {
        const client = getClient(config);
        const sessions = await client.list();
        return sessions.map((session) => ({
          sandbox: rememberSession(session, config),
          sandboxId: session.id,
        }));
      },

      destroy: async (config, sandboxId) => {
        const client = getClient(config);
        try {
          const session = await client.get(sandboxId);
          await session.close();
        } catch (err) {
          if (isMissingSession(err)) return; // already gone
          throw err;
        }
      },

      runCommand: (sandbox, command, options) => runShell(sandbox, command, options),

      getInfo: async (sandbox) => {
        const remaining = sandbox.timeoutAt.getTime() - Date.now();
        return {
          id: sandbox.id,
          provider: "tenki",
          status: mapStatus(sandbox.state),
          createdAt: observedAt.get(sandbox) ?? new Date(),
          timeout: remaining > 0 ? remaining : 0,
          metadata: {
            name: sandbox.name,
            state: sandbox.state,
            cpuCores: sandbox.cpuCores,
            memoryMb: sandbox.memoryMb,
            diskSizeGb: sandbox.diskSizeGb,
            projectId: sandbox.projectId,
            tags: sandbox.tags,
          },
        };
      },

      getUrl: async (sandbox, options) => {
        const exposed = await sandbox.exposePort(options.port);
        return exposed.previewUrl;
      },

      getInstance: (sandbox) => sandbox,

      // Native filesystem: Tenki exposes real file primitives over its data
      // plane, so we bypass the shell-based fallback (and its escaping
      // hazards). The runCommand parameter is intentionally unused.
      filesystem: {
        readFile: async (sandbox, path) => {
          const bytes = await sandbox.readFile(path);
          return new TextDecoder().decode(bytes);
        },
        writeFile: async (sandbox, path, content) => {
          await sandbox.writeFile(path, content);
        },
        mkdir: async (sandbox, path) => {
          await sandbox.mkdir(path);
        },
        readdir: async (sandbox, path): Promise<FileEntry[]> => {
          const entries = await sandbox.list(path);
          return entries.map((entry) => ({
            name: basename(entry.path),
            type: entry.isDir ? ("directory" as const) : ("file" as const),
            size: Number(entry.size),
            modified: new Date(Number(entry.modifiedUnixNs / 1_000_000n)),
          }));
        },
        // exists goes through the shell: the data-plane stat can briefly
        // report a just-removed file as present, while `test -e` is always
        // consistent with the guest filesystem.
        exists: async (sandbox, path, runCommand) => {
          const result = await runCommand(sandbox, `test -e "${escapeShellArg(path)}"`);
          return result.exitCode === 0;
        },
        remove: async (sandbox, path) => {
          await sandbox.remove(path);
        },
      },
    },

    template: {
      create: async (config, options: CreateTemplateOptions) => {
        const client = getClient(config);

        // Mode 1: Capture from a running sandbox (snapshot API)
        if (options.from) {
          try {
            const snapshot = await client.createSnapshotAndWait(options.from, {
              name: options.name,
            });
            return {
              id: snapshot.id,
              provider: "tenki",
              name: options.name,
              createdAt: snapshot.createdAt,
              metadata: {
                ...options.metadata,
                source: "capture",
                sandboxId: options.from,
                sessionId: snapshot.sessionId,
                snapshotType: snapshot.type,
                snapshot,
              },
            };
          } catch (error) {
            throw new Error(
              `Failed to capture Tenki template: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        // Mode 2: Build from spec (create a template from a base image, then build it)
        try {
          const scope = await resolveScope(config, client);
          const baseImageId = options.baseImage || (options.dockerfile
            ? (options.dockerfile.split("\n").find((l) => l.toUpperCase().startsWith("FROM ")) || "").replace(/^FROM\s+/i, "").trim()
            : undefined);

          const template = await client.createTemplate({
            workspaceId: scope.workspaceId,
            projectId: scope.projectId,
            name: options.name,
            ...(baseImageId ? { baseImageId } : {}),
            ...(options.dockerfile ? { setupScript: options.dockerfile } : {}),
            ...(options.startCommand ? { startCmd: options.startCommand } : {}),
            ...(options.envs ? { env: options.envs } : {}),
            ...(options.cpuCount || options.memoryMB
              ? {
                  resources: {
                    ...(options.cpuCount ? { cpuCores: options.cpuCount } : {}),
                    ...(options.memoryMB ? { memoryMb: options.memoryMB } : {}),
                  },
                }
              : {}),
          });

          // Build the template
          await client.buildTemplate(template.id);

          return {
            id: template.id,
            provider: "tenki",
            name: options.name,
            createdAt: new Date(),
            metadata: {
              ...options.metadata,
              source: "build",
              baseImageId: template.baseImageId,
              template,
            },
          };
        } catch (error) {
          throw new Error(
            `Failed to create Tenki template: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },

      list: async (config) => {
        const client = getClient(config);
        try {
          const snapshots = await client.listSnapshots();
          return snapshots.map((snap) => ({
            id: snap.id,
            provider: "tenki",
            name: snap.name,
            createdAt: snap.createdAt,
            metadata: {
              sessionId: snap.sessionId,
              snapshotType: snap.type,
              state: snap.state,
              sizeBytes: snap.sizeBytes,
              snapshot: snap,
            },
          }));
        } catch {
          return [];
        }
      },

      delete: async (config, templateId: string) => {
        const client = getClient(config);
        try {
          await client.deleteSnapshot(templateId);
        } catch {
          /* already deleted or not found */
        }
      },
    },
  },
});

export default tenki;
