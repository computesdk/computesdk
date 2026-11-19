/**
 * @computesdk/tenki — ComputeSDK provider for Luxor (formerly Tenki Cloud) sandboxes.
 *
 * Usage:
 *   import { luxor } from "@computesdk/tenki";
 *   import { compute } from "computesdk";
 *
 *   compute.setConfig({
 *     provider: luxor({ apiKey: "lx_..." }),
 *   });
 *
 *   const sandbox = await compute.sandbox.create();
 *   const result = await sandbox.runCommand("echo hello");
 *   await sandbox.destroy();
 */

import { defineProvider, escapeShellArg, resolveVolumeRef, isUnifiedVolumeMounts, withVolumeSettle, InstanceSizeError } from "@computesdk/provider";
import type { InstanceSizeResolver } from "@computesdk/provider";
import type { RunCommandOptions, CommandResult, InstanceInfo, CreateInstanceOptions, FileEntry } from "computesdk";
import {
  LuxorSandbox,
  Session,
  type SessionState,
  type CreateOptions,
  type Output,
  SessionNotFoundError,
  stdoutText,
  stderrText,
} from "@luxorai/sandbox";

export interface LuxorConfig {
  /** Luxor API key (lx_...; tk_... remains accepted). Falls back to LUXOR_API_KEY / LUXOR_AUTH_TOKEN, then LUXORAI_API_KEY / LUXORAI_AUTH_TOKEN, then TENKI_API_KEY / TENKI_AUTH_TOKEN. */
  apiKey?: string;
  /** API base URL. Falls back to LUXOR_API_ENDPOINT / LUXOR_API_URL, then LUXORAI_API_ENDPOINT / LUXORAI_API_URL, then TENKI_API_ENDPOINT / TENKI_API_URL, then the SDK default (https://api.luxor.ai). */
  baseUrl?: string;
  /** Workspace to create sandboxes in. Falls back to LUXOR_WORKSPACE_ID / LUXORAI_WORKSPACE_ID / TENKI_WORKSPACE_ID; workspace API keys infer it server-side. */
  workspaceId?: string;
  /** @deprecated Luxor no longer scopes sandboxes by project. */
  projectId?: string;
  /** Default runCommand timeout in milliseconds. */
  timeout?: number;
  /** Default sandbox resources applied at create() time. */
  cpuCores?: number;
  memoryMb?: number;
  diskSizeGb?: number;
}

/** @deprecated Use {@link LuxorConfig}; Tenki is now Luxor. */
export type TenkiConfig = LuxorConfig;

// ---------------------------------------------------------------------------
// Client resolution
// ---------------------------------------------------------------------------

/**
 * One LuxorSandbox client per (token, baseUrl) pair. The client owns a gRPC
 * transport, so we memoize rather than reconnecting on every collection-level
 * call (create/getById/list/destroy).
 */
const clients = new Map<string, LuxorSandbox>();

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function resolveApiKey(config: LuxorConfig): string {
  const apiKey = config.apiKey ?? firstEnv('LUXOR_API_KEY', 'LUXOR_AUTH_TOKEN', 'LUXORAI_API_KEY', 'LUXORAI_AUTH_TOKEN', 'TENKI_API_KEY', 'TENKI_AUTH_TOKEN');
  if (!apiKey) {
    throw new Error(
      "Missing API key for Luxor.\n\n" +
        "Create one at https://luxor.ai (workspace settings > API Keys)\n" +
        'Then pass it: luxor({ apiKey: "lx_..." })\n' +
        "Or set LUXOR_API_KEY (or LUXOR_AUTH_TOKEN) in your environment.",
    );
  }
  return apiKey;
}

function resolveBaseUrl(config: LuxorConfig): string | undefined {
  return config.baseUrl ?? firstEnv('LUXOR_API_ENDPOINT', 'LUXOR_API_URL', 'LUXORAI_API_ENDPOINT', 'LUXORAI_API_URL', 'TENKI_API_ENDPOINT', 'TENKI_API_URL');
}

function resolveWorkspaceId(config: LuxorConfig): string | undefined {
  return config.workspaceId ?? firstEnv('LUXOR_WORKSPACE_ID', 'LUXORAI_WORKSPACE_ID', 'TENKI_WORKSPACE_ID');
}

function clientKey(config: LuxorConfig): string {
  return `${resolveApiKey(config)}::${resolveBaseUrl(config) ?? ''}`;
}

function getClient(config: LuxorConfig): LuxorSandbox {
  const key = clientKey(config);
  let client = clients.get(key);
  if (!client) {
    client = new LuxorSandbox({
      authToken: resolveApiKey(config),
      baseUrl: resolveBaseUrl(config),
    });
    clients.set(key, client);
  }
  return client;
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
const sessionConfig = new WeakMap<Session, LuxorConfig>();

function rememberSession(session: Session, config: LuxorConfig): Session {
  if (!observedAt.has(session)) observedAt.set(session, new Date());
  sessionConfig.set(session, config);
  return session;
}

function mapStatus(state: SessionState): InstanceInfo["status"] {
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

function toCreateOptions(config: LuxorConfig, options?: CreateInstanceOptions): CreateOptions {
  const opts: CreateOptions = {};
  const workspaceId = resolveWorkspaceId(config);
  if (workspaceId) opts.workspaceId = workspaceId;
  if (options?.name) opts.name = options.name;
  if (options?.envs) opts.env = options.envs;
  if (options?.metadata) {
    // Luxor metadata values are strings.
    opts.metadata = Object.fromEntries(Object.entries(options.metadata).map(([k, v]) => [k, String(v)]));
  }
  if (options?.templateId) opts.image = options.templateId;
  if (options?.snapshotId) opts.snapshotId = options.snapshotId;
  if (options?.timeout) opts.maxDurationMs = options.timeout;

  // Resources: per-call override (via CreateInstanceOptions' index signature)
  // wins over provider-level defaults.
  const cpuCores = (options as Record<string, unknown> | undefined)?.cpuCores ?? config.cpuCores;
  const memoryMb = (options as Record<string, unknown> | undefined)?.memoryMb ?? config.memoryMb;
  const diskSizeGb = (options as Record<string, unknown> | undefined)?.diskSizeGb ?? config.diskSizeGb;
  if (typeof cpuCores === "number") opts.cpuCores = cpuCores;
  if (typeof memoryMb === "number") opts.memoryMb = memoryMb;
  if (typeof diskSizeGb === "number") opts.diskSizeGb = diskSizeGb;

  if (isUnifiedVolumeMounts(options?.volumes)) {
    opts.volumes = options!.volumes!.map((m) => {
      const ref = resolveVolumeRef(m.volume);
      return { volumeId: ref.id ?? ref.name!, mountPath: m.mountPath, readOnly: m.readOnly };
    });
  }

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
 * shell command string, whereas Luxor's Session.exec executes argv directly
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

  const timedOut = result.status === "TIMED_OUT";
  const stderr = stderrText(result);
  return {
    stdout: stdoutText(result),
    stderr: timedOut ? [stderr, "Luxor command timed out."].filter(Boolean).join("\n") : stderr,
    exitCode: timedOut ? 124 : result.exitCode,
    durationMs: result.durationMs,
  };
}

/**
 * Luxor's data-plane filesystem API is scoped to the sandbox workdir
 * (/home/tenki) and rejects other paths, though the guest can reach them.
 */
function isOutsideWorkdir(err: unknown): boolean {
  return err instanceof Error && err.message.includes("path outside workdir");
}

async function shellOrThrow(session: Session, command: string): Promise<string> {
  const result = await runShell(session, command);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `Command failed with exit code ${result.exitCode}: ${command}`);
  }
  return result.stdout;
}

// Base64 chunk per exec, well under the kernel's per-argument limit.
const SHELL_WRITE_CHUNK = 96 * 1024;

async function shellWriteFile(session: Session, path: string, content: string): Promise<void> {
  const b64 = Buffer.from(content, "utf8").toString("base64");
  const q = shellQuote(path);
  await shellOrThrow(session, `mkdir -p "$(dirname ${q})" && : > ${q}`);
  for (let i = 0; i < b64.length; i += SHELL_WRITE_CHUNK) {
    await shellOrThrow(session, `printf '%s' '${b64.slice(i, i + SHELL_WRITE_CHUNK)}' | base64 -d >> ${q}`);
  }
}

async function shellReadFile(session: Session, path: string): Promise<string> {
  const out = await shellOrThrow(session, `base64 < ${shellQuote(path)}`);
  return Buffer.from(out.replace(/\s+/g, ""), "base64").toString("utf8");
}

async function shellReaddir(session: Session, path: string): Promise<FileEntry[]> {
  const out = await shellOrThrow(
    session,
    `find ${shellQuote(path)} -mindepth 1 -maxdepth 1 -printf '%y\\t%s\\t%T@\\t%f\\n'`,
  );
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [kind, size, mtime, ...name] = line.split("\t");
      return {
        name: name.join("\t"),
        type: kind === "d" ? ("directory" as const) : ("file" as const),
        size: Number(size),
        modified: new Date(Number(mtime) * 1000),
      };
    });
}

async function nativeOrShell<T>(native: () => Promise<T>, shell: () => Promise<T>): Promise<T> {
  try {
    return await native();
  } catch (err) {
    if (isOutsideWorkdir(err)) return shell();
    throw err;
  }
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

// ---------------------------------------------------------------------------
// Standard sizes
// ---------------------------------------------------------------------------

/**
 * Luxor takes arbitrary per-create `cpuCores` (1-128) and even `memoryMb`
 * (128-524288), so every standard size maps to its exact profile. Starter
 * caps machines at 4 cores / 8 GB and Team at 16 / 64 GB; Enterprise lists
 * larger machines. The root disk mirrors the benchmarks platform's presets.
 */
const SIZE_DISK_GB: Partial<Record<string, number>> = { sm: 5, md: 10, lg: 20, xl: 40 };

const luxorSizes: InstanceSizeResolver<LuxorConfig> = (config, profile, options) => {
  const native = options as Record<string, unknown> | undefined;
  for (const field of ["cpuCores", "memoryMb"]) {
    if (native?.[field] !== undefined) {
      throw new InstanceSizeError("conflict", `cannot combine sizeClass with ${field}`);
    }
  }
  if (options?.snapshotId) {
    return {
      status: "unknown",
      reason: "A Luxor snapshot restore resumes its source VM's memory; Luxor does not document restoring it at a different CPU/RAM size.",
    };
  }
  const { vcpus, memoryMiB } = profile;
  const callerDisk = native?.diskSizeGb;
  if (callerDisk !== undefined && (typeof callerDisk !== "number" || !Number.isSafeInteger(callerDisk) || callerDisk <= 0)) {
    throw new InstanceSizeError("invalid", "diskSizeGb must be a positive integer number of GiB");
  }
  const sizeDisk = SIZE_DISK_GB[profile.sizeClass];
  const disk = (callerDisk as number | undefined) ?? sizeDisk ?? config.diskSizeGb;
  return {
    status: "supported",
    nativeOptions: {
      cpuCores: vcpus,
      memoryMb: memoryMiB,
      ...(callerDisk === undefined && sizeDisk !== undefined ? { diskSizeGb: sizeDisk } : {}),
    },
    ...(disk === undefined ? {} : { resolved: { vcpus, memoryMiB, diskMiB: disk * 1024 } }),
  };
};

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const luxorProvider = defineProvider<Session, LuxorConfig>({
  // Keep the provider id stable: benchmark history, platform credentials, and
  // routing keys still use "tenki" for the same Luxor service.
  name: "tenki",
  sizes: luxorSizes,
  methods: {
    instances: {
      create: async (config, options) => {
        const client = getClient(config);
        const session = await client.createAndWait(toCreateOptions(config, options));
        return { instance: rememberSession(session, config), instanceId: session.id };
      },

      getById: async (config, sandboxId) => {
        const client = getClient(config);
        try {
          const session = await client.get(sandboxId);
          return { instance: rememberSession(session, config), instanceId: session.id };
        } catch (err) {
          if (isMissingSession(err)) return null;
          throw err;
        }
      },

      list: async (config) => {
        const client = getClient(config);
        const sessions = await client.list();
        return sessions.map((session) => ({ instance: rememberSession(session, config), instanceId: session.id,
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
            workspaceId: sandbox.workspaceId,
            tags: sandbox.tags,
          },
        };
      },

      getUrl: async (sandbox, options) => {
        const exposed = await sandbox.exposePort(options.port);
        return exposed.previewUrl;
      },

      getInstance: (sandbox) => sandbox,

      // Pause keeps memory: processes, /tmp and the rest of the guest survive.
      pause: async (sandbox) => {
        await sandbox.pause();
        if (sandbox.state !== "PAUSED") await sandbox.waitPaused();
      },
      resume: async (sandbox) => {
        await sandbox.resume();
        if (sandbox.state !== "RUNNING") await sandbox.waitResumed();
      },
      pauseCapabilities: { memory: true },

      attachVolume: async (sandbox, volume, mountPath) => {
        const ref = resolveVolumeRef(volume);
        await (sandbox as Session).attachVolume(ref.id ?? ref.name!, mountPath);
      },
      detachVolume: async (sandbox, volume) => {
        const ref = resolveVolumeRef(volume);
        await (sandbox as Session).detachVolume(ref.id ?? ref.name!);
      },

      // Native filesystem: Luxor exposes real file primitives over its data
      // plane, so we bypass the shell-based fallback (and its escaping
      // hazards). The runCommand parameter is intentionally unused.
      filesystem: {
        // Paths outside the workdir fall back to the shell.
        readFile: (sandbox, path) =>
          nativeOrShell(
            async () => new TextDecoder().decode(await sandbox.readFile(path)),
            () => shellReadFile(sandbox, path),
          ),
        writeFile: (sandbox, path, content) =>
          nativeOrShell(
            () => sandbox.writeFile(path, content),
            () => shellWriteFile(sandbox, path, content),
          ),
        mkdir: (sandbox, path) =>
          nativeOrShell(
            () => sandbox.mkdir(path),
            async () => { await shellOrThrow(sandbox, `mkdir -p ${shellQuote(path)}`); },
          ),
        readdir: (sandbox, path): Promise<FileEntry[]> =>
          nativeOrShell(
            async () => {
              const entries = await sandbox.list(path);
              return entries.map((entry) => ({
                name: basename(entry.path),
                type: entry.isDir ? ("directory" as const) : ("file" as const),
                size: Number(entry.size),
                modified: new Date(Number(entry.modifiedUnixNs / 1_000_000n)),
              }));
            },
            () => shellReaddir(sandbox, path),
          ),
        // exists goes through the shell: the data-plane stat can briefly
        // report a just-removed file as present, while `test -e` is always
        // consistent with the guest filesystem.
        exists: async (sandbox, path, runCommand) => {
          const result = await runCommand(sandbox, `test -e "${escapeShellArg(path)}"`);
          return result.exitCode === 0;
        },
        remove: (sandbox, path) =>
          nativeOrShell(
            () => sandbox.remove(path),
            async () => { await shellOrThrow(sandbox, `rm -rf ${shellQuote(path)}`); },
          ),
      },
    },

    snapshot: {
      // Memory snapshots: the restore resumes running processes and keeps the
      // root filesystem, except /tmp, which Luxor empties on the source while
      // capturing. The source keeps running.
      capabilities: { scope: "rootfs", path: "/home/tenki", memory: true, destroysSource: false },
      create: async (config, sandboxId, options) => {
        const client = getClient(config);
        const snap = await client.createSnapshotAndWait(sandboxId, { name: options?.name });
        return { id: snap.id, provider: "tenki", createdAt: snap.createdAt, metadata: options?.metadata, native: snap };
      },
      list: async (config, options) => {
        const client = getClient(config);
        const instanceId = options?.instanceId ?? options?.sandboxId;
        const workspaceId = resolveWorkspaceId(config);
        const snaps = instanceId
          ? await client.listSessionSnapshots(instanceId)
          : await client.listSnapshots(workspaceId ? { workspaceId } : undefined);
        const items = snaps.map((snap) => ({ id: snap.id, provider: "tenki", createdAt: snap.createdAt, native: snap }));
        return options?.limit ? items.slice(0, options.limit) : items;
      },
      delete: async (config, snapshotId) => {
        const client = getClient(config);
        await client.deleteSnapshot(snapshotId);
      },
    },

    volume: {
      create: async (config, options) => {
        const client = getClient(config);
        const workspaceId = resolveWorkspaceId(config);
        const v = await client.createVolume({
          name: options.name,
          sizeBytes: options.sizeBytes ?? 10 * 1024 * 1024 * 1024,
          ...(workspaceId ? { workspaceId } : {}),
        });
        // SYNC_PENDING on a fresh volume is the create-time equivalent of the
        // attach race the API already reports; wait before handing it back.
        const ready = await client.waitVolumeReady(v.id);
        return { id: ready.id, name: ready.name, native: ready };
      },
      get: async (config, volumeIdOrName: string) => {
        const client = getClient(config);
        try {
          const v = await client.getVolume(volumeIdOrName);
          return v ? { id: v.id, name: v.name, native: v } : null;
        } catch { return null; }
      },
      list: async (config) => {
        const client = getClient(config);
        const volumes = await client.listVolumes();
        return (volumes ?? []).map((v) => ({ id: v.id, name: v.name, native: v }));
      },
      delete: async (config, volumeIdOrName: string) => {
        const client = getClient(config);
        await withVolumeSettle(() => client.deleteVolume(volumeIdOrName));
      },
    }
  },
});

export const luxor = luxorProvider;

/** @deprecated Tenki is now Luxor; use {@link luxor}. The provider id remains "tenki" for compatibility. */
export const tenki = luxorProvider;

export default luxor;
