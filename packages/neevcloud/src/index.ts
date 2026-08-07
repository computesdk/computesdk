import { type SandboxMethods, defineProvider } from "@computesdk/provider";
import {
  Neev,
  type FileEntry as NeevFileEntry,
  NotFoundError,
  type Sandbox,
  type SandboxPhase,
} from "@neevcloud/sdk";
import type { FileEntry } from "computesdk";

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

// Neev files.* take workspace-relative paths and reject absolute ones; strip a leading
// slash so ComputeSDK's absolute paths resolve under the sandbox workspace root.
function toWorkspacePath(path: string): string {
  return path.replace(/^\/+/, "");
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

const LIST_PAGE_SIZE = 100;

const sandboxMethods: SandboxMethods<Sandbox, NeevCloudConfig> = {
  // Create a sandbox and wait until Ready. Boot from a raw OCI image or a catalogue template
  // (mutually exclusive; image wins, else templateId, else platform default). Name is left
  // unset so the server generates one.
  create: async (config, options) => {
    const source = options?.image
      ? { image: options.image }
      : { sandbox_template_id: options?.templateId };
    const sandbox = await clientFor(config).sandboxes.create(source);
    await sandbox.waitUntilReady();
    return { sandbox, sandboxId: sandbox.id };
  },

  // Look a sandbox up; a missing id is not an error to ComputeSDK — return null.
  getById: async (config, sandboxId) => {
    try {
      const sandbox = await clientFor(config).sandboxes.get(sandboxId);
      return { sandbox, sandboxId: sandbox.id };
    } catch (err) {
      if (err instanceof NotFoundError) return null;
      throw err;
    }
  },

  // Page through every sandbox; ComputeSDK's list returns the full set. Driven by the
  // reported total, with an empty-page guard so it always terminates.
  list: async (config) => {
    const client = clientFor(config);
    const out: Array<{ sandbox: Sandbox; sandboxId: string }> = [];
    for (let page = 1; ; page++) {
      const res = await client.sandboxes.list({ page, limit: LIST_PAGE_SIZE });
      for (const sandbox of res.items) out.push({ sandbox, sandboxId: sandbox.id });
      if (res.items.length === 0 || out.length >= res.total) break;
    }
    return out;
  },

  destroy: async (config, sandboxId) => {
    await clientFor(config).sandboxes.delete(sandboxId);
  },

  // Run a command. ComputeSDK passes a shell string, so wrap it in `sh -c`; Neev exec runs
  // a program. Buffered by default; stream only when output callbacks are supplied.
  runCommand: async (sandbox, command, options) => {
    const argv = ["sh", "-c", command];
    // sandboxd requires a workspace-relative cwd, like file paths.
    const cwd = options?.cwd === undefined ? undefined : toWorkspacePath(options.cwd);
    const started = Date.now();
    if (options?.background) {
      await sandbox.processes.start(argv, { cwd, env: options.env });
      return { stdout: "", stderr: "", exitCode: 0, durationMs: Date.now() - started };
    }
    const execOptions = { cwd, env: options?.env, timeoutMs: options?.timeout };
    if (options?.onStdout || options?.onStderr) {
      let stdout = "";
      let stderr = "";
      let exitCode = 0;
      for await (const event of sandbox.execStream(argv, execOptions)) {
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
      return { stdout, stderr, exitCode, durationMs: Date.now() - started };
    }
    const result = await sandbox.exec(argv, execOptions);
    return { ...result, durationMs: Date.now() - started };
  },

  // Neev has no per-sandbox timeout, so report 0.
  getInfo: async (sandbox) => ({
    id: sandbox.id,
    provider: "neevcloud",
    status: phaseToStatus(sandbox.phase),
    createdAt: new Date(sandbox.data.created_at),
    timeout: 0,
  }),

  getUrl: async (sandbox, options) => sandbox.getUrl({ port: options.port }),

  getInstance: (sandbox) => sandbox,

  // Workspace-rooted filesystem over the native sandboxd file endpoints. The `runCommand`
  // helper is unused because Neev has real file APIs.
  filesystem: {
    readFile: (sandbox, path) => sandbox.files.readText(toWorkspacePath(path)),
    writeFile: async (sandbox, path, content) => {
      await sandbox.files.write(toWorkspacePath(path), content);
    },
    mkdir: async (sandbox, path) => {
      await sandbox.files.mkdir(toWorkspacePath(path));
    },
    readdir: async (sandbox, path) =>
      (await sandbox.files.list(toWorkspacePath(path))).map(mapFileEntry),
    exists: (sandbox, path) => sandbox.files.exists(toWorkspacePath(path)),
    remove: async (sandbox, path) => {
      await sandbox.files.remove(toWorkspacePath(path));
    },
  },
};

// ComputeSDK provider for NeevCloud sandboxes.
// Usage: `createCompute({ defaultProvider: neevcloud({ apiKey }) })`.
export const neevcloud = defineProvider<Sandbox, NeevCloudConfig>({
  name: "neevcloud",
  methods: { sandbox: sandboxMethods },
});
