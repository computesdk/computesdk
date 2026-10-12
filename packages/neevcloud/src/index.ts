import {
  type InstanceMethods,
  type SnapshotMethods,
  type TemplateMethods,
  defineProvider,
} from "@computesdk/provider";
import {
  BadRequestError,
  type CreateSandboxParams,
  DeadlineExceededError,
  Neev,
  type FileEntry as NeevFileEntry,
  NotFoundError,
  type Sandbox,
  type SandboxPhase,
  type SandboxTemplate,
  type SnapshotData,
} from "@neevcloud/sdk";
import type { CommandResult, CreateInstanceOptions, FileEntry, RunCommandOptions } from "computesdk";

// Provider config. Every field is optional; the Neev client reads the matching NEEV_* env
// var when a field is omitted.
export interface NeevCloudConfig {
  /** NeevCloud API key. Read from NEEV_API_KEY when omitted. */
  apiKey?: string;
  /** Org the sandboxes belong to. Read from NEEV_ORG_ID when omitted. */
  orgId?: string;
  /** Project the sandboxes belong to. Read from NEEV_PROJECT_ID when omitted. */
  projectId?: string;
  /** Request timeout in milliseconds. */
  timeout?: number;
}

/** A NeevCloud snapshot as returned by the snapshot methods. */
export interface NeevCloudSnapshot {
  id: string;
  provider: "neevcloud";
  createdAt: Date;
  metadata: { name?: string; sandboxId: string; status: SnapshotData["status"]; sizeBytes?: number | null };
}

// Shared object used to key the client cache when the provider is created without a config.
const DEFAULT_CONFIG: NeevCloudConfig = {};
const clients = new WeakMap<NeevCloudConfig, Neev>();

// Builds (once per config object) the Neev client the lifecycle methods talk to.
function clientFor(config: NeevCloudConfig = DEFAULT_CONFIG): Neev {
  let client = clients.get(config);
  if (!client) {
    client = new Neev({
      apiKey: config.apiKey,
      orgId: config.orgId,
      projectId: config.projectId,
      timeoutMs: config.timeout,
    });
    clients.set(config, client);
  }
  return client;
}

// Single-quotes a value for a POSIX shell.
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// Neev distinguishes symlinks; ComputeSDK's FileEntry only has file|directory, so a
// symlink is surfaced as a file.
function mapFileEntry(entry: NeevFileEntry): FileEntry {
  return {
    name: entry.name,
    type: entry.type === "directory" ? "directory" : "file",
    size: entry.size,
    modified: new Date(entry.modifiedTime),
  };
}

// Maps the SDK phase onto ComputeSDK's 3-state status: Paused is stopped, RestoreFailed is
// a terminal failure, and every other phase (Ready, Pending, NotReady, Unknown) is running.
function phaseToStatus(phase: SandboxPhase): "running" | "stopped" | "error" {
  switch (phase) {
    case "Paused":
      return "stopped";
    case "RestoreFailed":
      return "error";
    default:
      return "running";
  }
}

// Maps ComputeSDK create options to a Neev create request; a snapshot overrides image/template.
function toCreateParams(options: CreateInstanceOptions = {}): CreateSandboxParams {
  const params: CreateSandboxParams = options.snapshotId
    ? { restore: options.snapshotId }
    : options.image
      ? { image: options.image }
      : { sandbox_template_id: options.templateId };
  if (options.name) params.name = options.name;
  if (options.envs) {
    params.env = Object.entries(options.envs).map(([name, value]) => ({ name, value }));
  }
  const cpu = options.cpu ?? options.cpus ?? options.vcpus;
  const memoryMb = options.memory ?? options.memoryMb;
  if (cpu !== undefined || memoryMb !== undefined) {
    params.resources = {
      ...(cpu !== undefined ? { cpu } : {}),
      ...(memoryMb !== undefined ? { memory_gb: memoryMb / 1024 } : {}),
    };
  }
  // timeout is the sandbox lifetime; it is deleted when it elapses.
  if (options.timeout !== undefined && options.timeout > 0) {
    params.lifecycle = { max_lifetime_seconds: Math.ceil(options.timeout / 1000), on_idle: "delete" };
  }
  return params;
}

// Exit code for a timed-out command, as timeout(1) reports.
const TIMEOUT_EXIT_CODE = 124;

// Result for a timed-out command: output so far plus a note.
function timedOut(stdout: string, stderr: string, timeoutMs: number | undefined, started: number): CommandResult {
  const note = timeoutMs === undefined ? "command timed out" : `command timed out after ${timeoutMs}ms`;
  return { stdout, stderr: stderr ? `${stderr}\n${note}` : note, exitCode: TIMEOUT_EXIT_CODE, durationMs: Date.now() - started };
}

// sh -c argv; cwd via `cd` (exec cwd is workspace-only), and a failed cd exits.
function shellArgv(command: string, cwd: string | undefined): string[] {
  return ["sh", "-c", cwd === undefined ? command : `cd -- ${shellQuote(cwd)} || exit\n${command}`];
}

// True when the file API refused an absolute path outside the workspace.
function outsideWorkspace(path: string, err: unknown): boolean {
  return path.startsWith("/") && err instanceof BadRequestError;
}

type RunCommand = (sandbox: Sandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>;

// Runs a file-op shell command; throws on non-zero exit.
async function shell(run: RunCommand, sandbox: Sandbox, command: string): Promise<string> {
  const result = await run(sandbox, command);
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `command failed: ${command}`);
  return result.stdout;
}

// POSIX sh listing (GNU and BusyBox): "type<TAB>size mtime<TAB>base64 name" per line.
const LIST_SCRIPT = [
  'for f in * .[!.]* ..?*; do',
  '  [ -e "$f" ] || [ -L "$f" ] || continue',
  '  if [ -d "$f" ]; then t=d; else t=f; fi',
  '  printf "%s\\t%s\\t" "$t" "$(stat -c "%s %Y" "./$f")"',
  '  printf %s "$f" | base64 | tr -d "\\n"',
  '  echo',
  'done',
].join("\n");

// Lists a directory through the shell; names are base64 so any filename round-trips.
async function readdirViaShell(run: RunCommand, sandbox: Sandbox, path: string): Promise<FileEntry[]> {
  const out = await shell(run, sandbox, `cd -- ${shellQuote(path)} || exit\n${LIST_SCRIPT}`);
  return out
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [kind, stat, name] = line.split("\t");
      const [size, mtime] = stat.split(" ");
      return {
        name: Buffer.from(name, "base64").toString("utf8"),
        type: kind === "d" ? "directory" : "file",
        size: Number(size),
        modified: new Date(Number(mtime) * 1000),
      };
    });
}

// Maps a Neev snapshot to the provider's snapshot shape.
function mapSnapshot(snapshot: SnapshotData): NeevCloudSnapshot {
  return {
    id: snapshot.id,
    provider: "neevcloud",
    createdAt: new Date(snapshot.created_at),
    metadata: {
      name: snapshot.name,
      sandboxId: snapshot.sandbox_id,
      status: snapshot.status,
      sizeBytes: snapshot.size_bytes,
    },
  };
}

const LIST_PAGE_SIZE = 100;

// Collects all pages; stops at the total or an empty page.
async function collectPages<T>(fetchPage: (page: number) => Promise<{ items: T[]; total: number }>): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const res = await fetchPage(page);
    out.push(...res.items);
    if (res.items.length === 0 || out.length >= res.total) return out;
  }
}

const sandboxMethods: InstanceMethods<Sandbox, NeevCloudConfig> = {
  // Create and wait until Ready; an abort after the request deletes the sandbox.
  create: async (config, options) => {
    options?.signal?.throwIfAborted();
    const sandbox = await clientFor(config).sandboxes.create(toCreateParams(options));
    try {
      options?.signal?.throwIfAborted();
      await sandbox.waitUntilReady();
      options?.signal?.throwIfAborted();
    } catch (err) {
      await sandbox.delete().catch(() => undefined);
      throw err;
    }
    return { instance: sandbox, instanceId: sandbox.id };
  },

  // Look a sandbox up; a missing id is not an error to ComputeSDK — return null.
  getById: async (config, sandboxId) => {
    try {
      const sandbox = await clientFor(config).sandboxes.get(sandboxId);
      return { instance: sandbox, instanceId: sandbox.id };
    } catch (err) {
      if (err instanceof NotFoundError) return null;
      throw err;
    }
  },

  // ComputeSDK expects the full set, so read every page.
  list: async (config) => {
    const client = clientFor(config);
    const sandboxes = await collectPages((page) => client.sandboxes.list({ page, limit: LIST_PAGE_SIZE }));
    return sandboxes.map((sandbox) => ({ instance: sandbox, instanceId: sandbox.id }));
  },

  destroy: async (config, sandboxId) => {
    await clientFor(config).sandboxes.delete(sandboxId);
  },

  // Buffered sh -c; background starts a supervised process and returns at once.
  runCommand: async (sandbox, command, options) => {
    const argv = shellArgv(command, options?.cwd);
    const started = Date.now();
    if (options?.background) {
      await sandbox.processes.start(argv, { env: options.env });
      return { stdout: "", stderr: "", exitCode: 0, durationMs: Date.now() - started };
    }
    try {
      const result = await sandbox.exec(argv, { env: options?.env, timeoutMs: options?.timeout });
      return { ...result, durationMs: Date.now() - started };
    } catch (err) {
      if (err instanceof DeadlineExceededError) return timedOut("", "", options?.timeout, started);
      throw err;
    }
  },

  // Streams over the exec API, so no in-sandbox port is needed.
  streamCommand: async (sandbox, command, options) => {
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    let exitCode = -1;
    const events = sandbox.exec(shellArgv(command, options.cwd), {
      stream: true,
      env: options.env,
      timeoutMs: options.timeout,
    });
    try {
      for await (const event of events) {
        if (event.type === "stdout") {
          stdout += event.data;
          options.onStdout?.(event.data);
        } else if (event.type === "stderr") {
          stderr += event.data;
          options.onStderr?.(event.data);
        } else if (event.type === "exit") {
          exitCode = event.exitCode;
        }
      }
    } catch (err) {
      if (err instanceof DeadlineExceededError) return timedOut(stdout, stderr, options.timeout, started);
      throw err;
    }
    return { stdout, stderr, exitCode, durationMs: Date.now() - started };
  },

  // timeout is the create-time lifetime, 0 if none.
  getInfo: async (sandbox) => ({
    id: sandbox.id,
    provider: "neevcloud",
    status: phaseToStatus(sandbox.phase),
    createdAt: new Date(sandbox.data.created_at),
    timeout: (sandbox.data.max_lifetime_seconds ?? 0) * 1000,
    metadata: {
      name: sandbox.name,
      region: sandbox.region,
      templateId: sandbox.templateId,
      phase: sandbox.phase,
    },
  }),

  getUrl: async (sandbox, options) => sandbox.getUrl({ port: options.port }),

  getInstance: (sandbox) => sandbox,

  // File API inside the workspace; absolute paths outside it (e.g. /tmp) use the shell.
  filesystem: {
    readFile: async (sandbox, path, run) => {
      try {
        return await sandbox.files.readText(path);
      } catch (err) {
        if (!outsideWorkspace(path, err)) throw err;
        return shell(run, sandbox, `cat ${shellQuote(path)}`);
      }
    },
    writeFile: async (sandbox, path, content, run) => {
      try {
        await sandbox.files.write(path, content);
      } catch (err) {
        if (!outsideWorkspace(path, err)) throw err;
        const encoded = Buffer.from(content, "utf8").toString("base64");
        await shell(run, sandbox, `mkdir -p "$(dirname ${shellQuote(path)})" && printf %s ${shellQuote(encoded)} | base64 -d > ${shellQuote(path)}`);
      }
    },
    mkdir: async (sandbox, path, run) => {
      try {
        await sandbox.files.mkdir(path);
      } catch (err) {
        if (!outsideWorkspace(path, err)) throw err;
        await shell(run, sandbox, `mkdir -p ${shellQuote(path)}`);
      }
    },
    readdir: async (sandbox, path, run) => {
      try {
        return (await sandbox.files.list(path)).map(mapFileEntry);
      } catch (err) {
        if (!outsideWorkspace(path, err)) throw err;
        return readdirViaShell(run, sandbox, path);
      }
    },
    exists: async (sandbox, path, run) => {
      try {
        return await sandbox.files.exists(path);
      } catch (err) {
        if (!outsideWorkspace(path, err)) throw err;
        return (await run(sandbox, `test -e ${shellQuote(path)}`)).exitCode === 0;
      }
    },
    // Recursive, matching the shell's rm -rf.
    remove: async (sandbox, path, run) => {
      try {
        await sandbox.files.remove(path, { recursive: true });
      } catch (err) {
        if (!outsideWorkspace(path, err)) throw err;
        await shell(run, sandbox, `rm -rf ${shellQuote(path)}`);
      }
    },
  },
};

// Memory + filesystem snapshots; restore with create({ snapshotId }).
const snapshotMethods: SnapshotMethods<NeevCloudSnapshot, NeevCloudConfig> = {
  // Waits for Ready so the id is restorable at once.
  create: async (config, sandboxId, options) => {
    const client = clientFor(config);
    const created = await client.sandboxes.createSnapshot(sandboxId, { name: options?.name });
    return mapSnapshot(await client.sandboxes.waitForSnapshot(created.id));
  },

  // Listed per sandbox; with no sandboxId, every sandbox is read.
  list: async (config, options) => {
    const client = clientFor(config);
    const sandboxIds = options?.sandboxId
      ? [options.sandboxId]
      : (await collectPages((page) => client.sandboxes.list({ page, limit: LIST_PAGE_SIZE }))).map((s) => s.id);
    const snapshots: NeevCloudSnapshot[] = [];
    for (const id of sandboxIds) {
      const items = await collectPages((page) => client.sandboxes.listSnapshots(id, { page, limit: LIST_PAGE_SIZE }));
      snapshots.push(...items.map(mapSnapshot));
    }
    return options?.limit !== undefined ? snapshots.slice(0, options.limit) : snapshots;
  },

  delete: async (config, snapshotId) => {
    await clientFor(config).sandboxes.deleteSnapshot(snapshotId);
  },
};

// Managed template catalogue: list only.
const templateMethods: TemplateMethods<SandboxTemplate, NeevCloudConfig> = {
  create: async () => {
    throw new Error("NeevCloud sandbox templates are a managed catalogue and cannot be created through the API. Boot from a custom image with create({ image }) or save a sandbox with snapshot.create().");
  },
  list: async (config, options) => {
    const client = clientFor(config);
    const templates = await collectPages((page) => client.templates.list({ page, limit: LIST_PAGE_SIZE }));
    return options?.limit !== undefined ? templates.slice(0, options.limit) : templates;
  },
  delete: async () => {
    throw new Error("NeevCloud sandbox templates are a managed catalogue and cannot be deleted through the API.");
  },
};

// ComputeSDK provider for NeevCloud sandboxes.
// Usage: `createCompute({ defaultProvider: neevcloud({ apiKey }) })`.
export const neevcloud = defineProvider<Sandbox, NeevCloudConfig, SandboxTemplate, NeevCloudSnapshot>({
  name: "neevcloud",
  methods: { instances: sandboxMethods, snapshot: snapshotMethods, template: templateMethods },
});
