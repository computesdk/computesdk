/**
 * CreateOS Sandbox Provider for ComputeSDK
 *
 * VM sandboxes backed by the NodeOps createos-sandbox control plane.
 * Thin adapter over the official `@nodeops-createos/sandbox` npm package — the same
 * SDK used across the CreateOS tooling.
 *
 * Design notes:
 *  - `TSandbox` is the native `@nodeops-createos/sandbox` `Sandbox` handle, so
 *    `getInstance()` hands callers the full stateful API (pause / resume / fork /
 *    disks / networks / bandwidth) that ComputeSDK's core surface does not model.
 *    The resolving config is associated with each handle via a `WeakMap`
 *    side-channel (`sandboxConfig`), so `getInfo` can honour `config` (e.g.
 *    `timeout`) and its error policy without wrapping or mutating the handle.
 *  - createos-sandbox sizes VMs from a fixed *shape* catalog rather than free-form
 *    cpu/mem, so create() maps ComputeSDK's `cpus`/`memoryMb` onto the nearest
 *    shape and honours an explicit provider-specific `shape` override.
 *  - The control plane drops per-exec env server-side (env is sandbox-level,
 *    set at create time), so per-command `env`/`cwd` are synthesised by
 *    wrapping the command in an inline `sh -c` script.
 *  - Snapshot semantics differ from running-snapshot providers (e2b/tensorlake):
 *    `snapshot.create` *pauses* the sandbox (the source VM stops), and the
 *    paused sandbox id IS the snapshot id. `create({ snapshotId })` forks that
 *    paused bundle into a fresh sandbox.
 *
 * Error policy: provider operations fail loudly when the provider boundary is
 * broken. Only a genuine 404 (`CreateosSandboxNotFoundError`) is mapped to the
 * idempotent "absent" outcome (`getById` → null, `destroy`/`delete` → no-op).
 * Auth, network, validation, and server errors propagate.
 */

import { CreateosSandboxClient, CreateosSandboxNotFoundError, Sandbox } from "@nodeops-createos/sandbox";
import type {
  CreateSandboxRequest,
  CreateosSandboxClientOptions,
  ForkSandboxRequest,
  SandboxStatus,
  Shape,
} from "@nodeops-createos/sandbox";
import { defineProvider } from "@computesdk/provider";
import type {
  CommandResult,
  CreateSandboxOptions,
  CreateSnapshotOptions,
  FileEntry,
  ListSnapshotsOptions,
  RunCommandOptions,
  SandboxInfo,
} from "@computesdk/provider";

const PROVIDER_NAME = "createos-sandbox";

/** Per-sandbox config side-channel: associates the resolving config with each
 *  native handle without mutating it or wrapping `TSandbox` — so `getInstance()`
 *  still returns the bare native handle (the escape hatch other providers honour),
 *  while `getInfo` can still reach `config` (e.g. `timeout`). Keyed weakly, so an
 *  entry is collected with its sandbox. */
const sandboxConfig = new WeakMap<Sandbox, CreateosConfig>();

/** Quote a value into one complete, self-contained shell token. Unlike the
 *  framework's `escapeShellArg` (which only neutralises metacharacters *inside*
 *  surrounding double quotes), this wraps in single quotes so the token is safe
 *  to splice unquoted — spaces, `;`, `&`, `|`, globs and the rest cannot split
 *  the command or inject syntax. Embedded single quotes are closed/escaped/reopened. */
function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/** The framework-supplied command runner handed to filesystem callbacks. */
type CommandRunner = (
  sandbox: Sandbox,
  command: string,
  options?: RunCommandOptions,
) => Promise<CommandResult>;

/** Memory floor (MiB) for the default shape when a create() pins no size. The
 *  control plane names no default shape and `CreateSandboxRequest` requires
 *  one, so the default is a client policy — the smallest *live* catalog shape
 *  with at least this much RAM. Override per-create with `shape`/`config.shape`. */
const DEFAULT_SHAPE_MIN_MIB = 1024;

/** POSIX environment variable name. Keys are spliced into a shell `export`, so
 *  anything outside this grammar is rejected rather than emitted (injection). */
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface CreateosConfig {
  /** createos-sandbox API key. Falls back to the CREATEOS_SANDBOX_API_KEY env var. */
  apiKey?: string;
  /** Control-plane base URL. Falls back to the CREATEOS_SANDBOX_BASE_URL env var. */
  baseUrl?: string;
  /** Default shape when create options pin neither `shape` nor cpus/memoryMb. */
  shape?: string;
  /** Default rootfs catalog name or template id. Empty = host default. */
  rootfs?: string;
  /** Reported `getInfo().timeout` in ms. Informational only. */
  timeout?: number;
}

/** ComputeSDK create options plus the createos-specific fields this provider
 *  reads off the (otherwise open) options bag. Declaring them turns the cast-
 *  heavy decode into a typed contract and makes unsupported fields obvious. */
export interface CreateosCreateOptions extends CreateSandboxOptions {
  /** Explicit shape id. Overrides cpus/memoryMb selection and skips the catalog fetch. */
  shape?: string;
  /** Rootfs catalog name or template id (alias of `runtime`). */
  image?: string;
  /** Rootfs catalog name or template id (alias of `image`). */
  runtime?: string;
  /** Requested RAM; mapped onto the smallest fitting shape. */
  memoryMb?: number;
  /** Requested vCPUs; mapped onto the smallest fitting shape. */
  cpus?: number;
  /** Overlay disk size (MiB). 0 / omitted = the shape's default disk. */
  ephemeralDiskMb?: number;
  /** Enable public ingress. Defaults to true. */
  ingressEnabled?: boolean;
  /** SSH public keys to inject at boot. */
  sshPubkeys?: string[];
  /** Egress allow-list. */
  egress?: string[];
}

function env(key: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[key] : undefined;
}

function resolveClient(config: CreateosConfig): CreateosSandboxClient {
  const apiKey = config.apiKey ?? env("CREATEOS_SANDBOX_API_KEY");
  if (!apiKey) {
    throw new Error(
      "Missing CreateOS API key. Provide 'apiKey' in config or set the " +
        "CREATEOS_SANDBOX_API_KEY environment variable.",
    );
  }
  const baseUrl = config.baseUrl ?? env("CREATEOS_SANDBOX_BASE_URL");
  const opts: CreateosSandboxClientOptions = { apiKey };
  if (baseUrl) opts.baseUrl = baseUrl;
  return new CreateosSandboxClient(opts);
}

/** True only for a genuine "resource does not exist" (404). Everything else —
 *  auth, network, validation, server, rate-limit — is a broken boundary. */
function isNotFound(e: unknown): boolean {
  return e instanceof CreateosSandboxNotFoundError;
}

/** Sort a catalog by ascending RAM then vCPU. Selection relies on this order;
 *  the control plane gives no ordering guarantee for `listShapes()`. */
function sortShapes(shapes: Shape[]): Shape[] {
  return shapes.toSorted((a, b) => a.mem_mib - b.mem_mib || a.vcpu - b.vcpu);
}

/** Pick the smallest live catalog shape that satisfies the requested cpu/mem.
 *  Returns undefined when neither is given (caller applies the default). */
export function pickShape(shapes: Shape[], memoryMb?: number, cpus?: number): string | undefined {
  if (memoryMb == null && cpus == null) return undefined;
  const sorted = sortShapes(shapes);
  const fit = sorted.find(
    (s) => (memoryMb == null || s.mem_mib >= memoryMb) && (cpus == null || s.vcpu >= cpus),
  );
  return (fit ?? sorted[sorted.length - 1])?.id;
}

/** Default shape when create() pins neither `shape` nor cpus/memoryMb: the
 *  smallest live shape meeting the RAM floor, else the smallest available. */
export function defaultShape(shapes: Shape[]): string | undefined {
  const sorted = sortShapes(shapes);
  const fit = sorted.find((s) => s.mem_mib >= DEFAULT_SHAPE_MIN_MIB);
  return (fit ?? sorted[0])?.id;
}

/** Resolve the shape for a create() call. Fetches the live catalog only when
 *  no explicit `shape` is pinned, so the explicit path never depends on
 *  `/v1/shapes` being reachable. */
async function resolveShape(
  client: CreateosSandboxClient,
  opts: CreateosCreateOptions,
  config: CreateosConfig,
): Promise<string> {
  const explicit = opts.shape ?? config.shape;
  if (explicit) return explicit;
  const shapes = await client.listShapes();
  const picked = pickShape(shapes, opts.memoryMb, opts.cpus) ?? defaultShape(shapes);
  if (!picked) {
    throw new Error("CreateOS control plane returned an empty shape catalog.");
  }
  return picked;
}

/** Map an createos-sandbox lifecycle state onto ComputeSDK's running|stopped|error. */
export function mapStatus(status: SandboxStatus): SandboxInfo["status"] {
  if (status === "running") return "running";
  if (status === "error" || status === "failed") return "error";
  return "stopped";
}

/** A non-empty env record from `envs` (preferred) or the legacy `env` alias. */
function envsOf(opts: CreateosCreateOptions): Record<string, string> | undefined {
  const envs = opts.envs ?? (opts as { env?: Record<string, string> }).env;
  return envs && Object.keys(envs).length > 0 ? envs : undefined;
}

/** A string[] when the value is an array, else undefined. */
function strArray(v: unknown): string[] | undefined {
  return Array.isArray(v) ? (v as string[]) : undefined;
}

/** Pure map: ComputeSDK create options → createos-sandbox fork request body. */
export function toForkRequest(opts: CreateosCreateOptions): ForkSandboxRequest {
  const req: ForkSandboxRequest = {
    ingress_enabled: opts.ingressEnabled !== undefined ? Boolean(opts.ingressEnabled) : true,
  };
  const ssh = strArray(opts.sshPubkeys);
  if (ssh) req.ssh_pubkeys = ssh;
  const egress = strArray(opts.egress);
  if (egress) req.egress = egress;
  const envs = envsOf(opts);
  if (envs) req.envs = envs;
  return req;
}

/** Pure map: ComputeSDK create options (+ resolved shape/rootfs) → create request. */
export function toCreateRequest(
  opts: CreateosCreateOptions,
  shape: string,
  rootfs?: string,
): CreateSandboxRequest {
  const req: CreateSandboxRequest = {
    shape,
    ingress_enabled: opts.ingressEnabled !== undefined ? Boolean(opts.ingressEnabled) : true,
  };
  if (rootfs) req.rootfs = rootfs;
  if (opts.name) req.name = String(opts.name);
  // Pass the requested overlay-disk size straight through; the control plane
  // validates it (0 / omitted = shape default). No client-side menu.
  if (typeof opts.ephemeralDiskMb === "number" && opts.ephemeralDiskMb > 0) {
    req.disk_mib = opts.ephemeralDiskMb;
  }
  const envs = envsOf(opts);
  if (envs) req.envs = envs;
  const ssh = strArray(opts.sshPubkeys);
  if (ssh) req.ssh_pubkeys = ssh;
  const egress = strArray(opts.egress);
  if (egress) req.egress = egress;
  return req;
}

/** Wrap a command so per-call cwd/env/background work despite the server dropping
 *  exec env. Env *keys* are validated before being spliced into `export` —
 *  values are shell-quoted, but a malformed key would otherwise be raw shell. */
export function buildScript(command: string, options?: RunCommandOptions): string {
  let script = command;
  if (options?.cwd) script = `cd ${shellQuote(options.cwd)} && ${script}`;
  if (options?.env && Object.keys(options.env).length > 0) {
    const exports = Object.entries(options.env)
      .map(([k, v]) => {
        if (!ENV_KEY_RE.test(k)) {
          throw new Error(
            `Invalid environment variable name ${JSON.stringify(k)}: ` +
              `must match ${ENV_KEY_RE.source}.`,
          );
        }
        return `export ${k}=${shellQuote(String(v))}`;
      })
      .join("; ");
    script = `${exports}; ${script}`;
  }
  if (options?.background) {
    script = `nohup sh -c ${shellQuote(script)} > /dev/null 2>&1 &`;
  }
  return script;
}

/** Parse `ls -lA --time-style=+%s` output into ComputeSDK FileEntry rows. */
export function parseLsOutput(stdout: string): FileEntry[] {
  const entries: FileEntry[] = [];
  for (const line of stdout.split("\n")) {
    if (!line || line.startsWith("total ")) continue;
    const m = line.match(/^(\S+)\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    const name = m[4]!.replace(/ -> .*$/, ""); // strip symlink target
    entries.push({
      name,
      type: m[1]!.startsWith("d") ? "directory" : "file",
      size: Number(m[2]),
      modified: new Date(Number(m[3]) * 1000),
    });
  }
  return entries;
}

export const createosSandbox = defineProvider<Sandbox, CreateosConfig>({
  name: PROVIDER_NAME,
  methods: {
    sandbox: {
      create: async (config: CreateosConfig, options?: CreateSandboxOptions) => {
        const client = resolveClient(config);
        const opts = (options ?? {}) as CreateosCreateOptions;

        // A snapshot id is a paused sandbox: fork it into a fresh sandbox.
        if (opts.snapshotId) {
          const source = await client.getSandbox(opts.snapshotId);
          const forked = await source.fork(toForkRequest(opts));
          // Surface lifecycle failures: a fork that never reaches "running"
          // (or hits a terminal state) must not be reported as success.
          await forked.waitUntilRunning();
          sandboxConfig.set(forked, config);
          return { sandbox: forked, sandboxId: forked.id };
        }

        const shape = await resolveShape(client, opts, config);
        const rootfs = opts.image ?? opts.runtime ?? config.rootfs;
        const sandbox = await client.createSandbox(toCreateRequest(opts, shape, rootfs));
        sandboxConfig.set(sandbox, config);
        return { sandbox, sandboxId: sandbox.id };
      },

      getById: async (config: CreateosConfig, sandboxId: string) => {
        const client = resolveClient(config);
        try {
          const sandbox = await client.getSandbox(sandboxId);
          sandboxConfig.set(sandbox, config);
          return { sandbox, sandboxId: sandbox.id };
        } catch (e) {
          if (isNotFound(e)) return null;
          throw e;
        }
      },

      list: async (config: CreateosConfig) => {
        const client = resolveClient(config);
        // No catch: a failed list is a broken boundary, not an empty account.
        const sandboxes = await client.listSandboxes({ limit: 100 });
        return sandboxes.map((sandbox) => {
          sandboxConfig.set(sandbox, config);
          return { sandbox, sandboxId: sandbox.id };
        });
      },

      destroy: async (config: CreateosConfig, sandboxId: string) => {
        const client = resolveClient(config);
        try {
          const sandbox = await client.getSandbox(sandboxId);
          await sandbox.destroy();
        } catch (e) {
          if (isNotFound(e)) return; // already gone; destroy is idempotent
          throw e;
        }
      },

      runCommand: async (
        sandbox: Sandbox,
        command: string,
        options?: RunCommandOptions,
      ): Promise<CommandResult> => {
        // `sh -c` (not `bash -lc`): POSIX-portable so bare rootfses without
        // bash still run. buildScript only emits POSIX constructs. Transport /
        // auth errors propagate; a command that ran reports its own exit code.
        const { result, exec_ms } = await sandbox.runCommand("sh", [
          "-c",
          buildScript(command, options),
        ]);
        const stderr = result.error ? `${result.stderr}${result.error}` : result.stderr;
        return {
          stdout: result.stdout,
          stderr,
          exitCode: result.exit_code,
          durationMs: exec_ms,
        };
      },

      getInfo: async (sandbox: Sandbox): Promise<SandboxInfo> => {
        // Refresh failures propagate (no swallow): a getInfo that cannot reach
        // the control plane must surface that rather than return stale data.
        await sandbox.refresh();
        const v = sandbox.data;
        return {
          id: v.id,
          provider: PROVIDER_NAME,
          status: mapStatus(v.status),
          createdAt: new Date(v.created_at),
          timeout: sandboxConfig.get(sandbox)?.timeout ?? 0,
          metadata: {
            createosStatus: v.status,
            shape: v.shape,
            rootfs: v.rootfs,
            region: v.region,
            ip: v.ip,
            ingressEnabled: v.ingress_enabled,
          },
        };
      },

      getUrl: async (sandbox: Sandbox, options: { port: number; protocol?: string }) => {
        const scheme = options.protocol === "http" ? "http" : "https";
        return sandbox.previewUrl(options.port, { scheme });
      },

      // Escape hatch: the bare native @nodeops-createos/sandbox handle
      // (pause/resume/fork/disks/...).
      getInstance: (sandbox: Sandbox): Sandbox => sandbox,

      filesystem: {
        readFile: async (sandbox: Sandbox, path: string): Promise<string> => {
          const buf = await sandbox.files.download(path);
          return new TextDecoder().decode(buf);
        },
        writeFile: async (sandbox: Sandbox, path: string, content: string): Promise<void> => {
          await sandbox.files.upload(path, content);
        },
        mkdir: async (sandbox: Sandbox, path: string, runCommand: CommandRunner): Promise<void> => {
          const r = await runCommand(sandbox, `mkdir -p ${shellQuote(path)}`);
          if (r.exitCode !== 0) throw new Error(`mkdir ${path} failed: ${r.stderr}`);
        },
        readdir: async (sandbox: Sandbox, path: string, runCommand: CommandRunner): Promise<FileEntry[]> => {
          const r = await runCommand(sandbox, `ls -lA --time-style=+%s ${shellQuote(path)}`);
          if (r.exitCode !== 0) throw new Error(`readdir ${path} failed: ${r.stderr}`);
          return parseLsOutput(r.stdout);
        },
        exists: async (sandbox: Sandbox, path: string, runCommand: CommandRunner): Promise<boolean> => {
          const r = await runCommand(sandbox, `test -e ${shellQuote(path)}`);
          return r.exitCode === 0;
        },
        remove: async (sandbox: Sandbox, path: string, runCommand: CommandRunner): Promise<void> => {
          const r = await runCommand(sandbox, `rm -rf ${shellQuote(path)}`);
          if (r.exitCode !== 0) throw new Error(`remove ${path} failed: ${r.stderr}`);
        },
      },
    },

    snapshot: {
      create: async (
        config: CreateosConfig,
        sandboxId: string,
        options?: CreateSnapshotOptions,
      ) => {
        const client = resolveClient(config);
        const sandbox = await client.getSandbox(sandboxId);
        // createos-sandbox has no decoupled snapshot object: pausing IS the snapshot,
        // and the paused sandbox id is the snapshot id. This stops the source VM.
        await sandbox.pause();
        // The success claim is "it paused" — surface a pause that timed out or
        // entered a terminal state rather than returning a phantom snapshot.
        await sandbox.waitUntilPaused();
        return {
          id: sandboxId,
          provider: PROVIDER_NAME,
          createdAt: new Date(),
          metadata: { name: options?.name, ...options?.metadata },
        };
      },
      list: async (config: CreateosConfig, _options?: ListSnapshotsOptions) => {
        const client = resolveClient(config);
        // The typed status filter excludes "paused", so list all and filter.
        const all = await client.listSandboxes({ limit: 500 });
        return all
          .filter((s) => s.status === "paused")
          .map((s) => ({
            id: s.id,
            provider: PROVIDER_NAME,
            createdAt: new Date(s.data.paused_at ?? s.data.created_at),
          }));
      },
      delete: async (config: CreateosConfig, snapshotId: string) => {
        const client = resolveClient(config);
        try {
          const sandbox = await client.getSandbox(snapshotId);
          await sandbox.destroy();
        } catch (e) {
          if (isNotFound(e)) return; // already gone
          throw e;
        }
      },
    },
  },
});

export type { Sandbox as CreateosSandbox } from "@nodeops-createos/sandbox";
