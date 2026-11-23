/**
 * Superserve Provider - Factory-based Implementation
 *
 * Wraps `@superserve/sdk` to expose the ComputeSDK provider interface.
 */

import { randomUUID } from 'node:crypto';
import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  Sandbox as SuperserveSandbox,
  Snapshot as SuperserveSnapshot,
  Template as SuperserveTemplate,
  Volume as SuperserveVolume,
  resolveConfig,
} from '@superserve/sdk';
import type {
  ResolvedConfig,
  SnapshotInfo,
  TemplateCreateOptions,
  TemplateInfo,
  VolumeCreateOptions,
  VolumeInfo,
} from '@superserve/sdk';
import { defineProvider, escapeShellArg, InstanceSizeError, INSTANCE_SIZE_PROFILES } from '@computesdk/provider';

const DEFAULT_TIMEOUT_MS = 300_000;

import type {
  CommandResult,
  CreateInstanceOptions,
  CreateTemplateOptions,
  CreateVolumeOptions,
  FileEntry,
  InstanceSizeClass,
  RunCommandOptions,
  InstanceInfo,
  Volume,
} from '@computesdk/provider';

export interface SuperserveConfig {
  /** Superserve API key. Falls back to `SUPERSERVE_API_KEY` env var. */
  apiKey?: string;
  /** API base URL. Falls back to `SUPERSERVE_BASE_URL` env var, then the `@superserve/sdk` default. */
  baseUrl?: string;
  /** Default auto-pause timeout in milliseconds. */
  timeout?: number;
  /** Template to boot per standard `sizeClass`; defaults to {@link SUPERSERVE_SIZE_TEMPLATES}. */
  sizeTemplates?: Partial<Record<InstanceSizeClass, string>>;
}

/**
 * Superserve fixes vCPU, memory and disk when a template is built, so each
 * standard size boots its own template. `superserve/base` (2 vCPU / 4 GiB /
 * 8 GiB disk) is built in to every team; the others are team templates
 * built by `scripts/provider-setup.mjs superserve`. The largest listed plan
 * (Pro) caps a sandbox at 16 vCPU / 64 GiB, so `3xl` has no default.
 */
export const SUPERSERVE_SIZE_TEMPLATES: Readonly<Partial<Record<InstanceSizeClass, string>>> = Object.freeze({
  xs: 'csdk-node22-1cpu-1gb',
  sm: 'csdk-node22-1cpu-2gb',
  md: 'superserve/base',
  lg: 'csdk-node22-4cpu-8gb',
  xl: 'csdk-node22-8cpu-16gb',
  '2xl': 'csdk-node22-16cpu-32gb',
});

/** Disk the built-in templates fix; team templates take theirs from the build. */
const BUILT_IN_TEMPLATE_DISK_MIB: Readonly<Record<string, number>> = Object.freeze({ 'superserve/base': 8192 });

/** Native selectors that pick or size the VM; `Sandbox.create` drops the sizing ones silently. */
const SOURCE_OPTIONS = ['templateId', 'snapshotId', 'sandboxId', 'fromTemplate', 'fromSnapshot'] as const;
const NATIVE_SIZE_OPTIONS = ['vcpu', 'vcpuCount', 'memoryMib', 'memoryMaxMib', 'diskMib'] as const;

function sizeTemplateOf(config: SuperserveConfig, sizeClass: InstanceSizeClass): string | undefined {
  const name = config.sizeTemplates?.[sizeClass] ?? SUPERSERVE_SIZE_TEMPLATES[sizeClass];
  return typeof name === 'string' && name.trim() ? name : undefined;
}

/** A create that failed because a standard-size template was never built on this team. */
function missingSizeTemplate(config: SuperserveConfig, templateId: unknown, error: unknown): string | undefined {
  if (typeof templateId !== 'string' || !(error instanceof NotFoundError)) return undefined;
  const sizeClass = (Object.keys(INSTANCE_SIZE_PROFILES) as InstanceSizeClass[]).find(c => sizeTemplateOf(config, c) === templateId);
  if (!sizeClass) return undefined;
  return `Superserve size template '${templateId}' (sizeClass ${sizeClass}) is not built on this Superserve team; run \`node scripts/provider-setup.mjs superserve\` (provider-setup.yml) or point \`sizeTemplates.${sizeClass}\` at an existing template`;
}

function resolveApiKey(config: SuperserveConfig): string {
  const apiKey = config.apiKey || process.env.SUPERSERVE_API_KEY;
  if (!apiKey) {
    throw new Error(
      `Missing Superserve API key. Provide 'apiKey' in config or set SUPERSERVE_API_KEY environment variable.`,
    );
  }
  return apiKey;
}

function resolveBaseUrl(config: SuperserveConfig): string | undefined {
  // Returns undefined when unset on purpose: the SDK then applies its own
  // resolution (SUPERSERVE_BASE_URL env var, then its default endpoint), so
  // we don't duplicate that default and risk it drifting.
  return config.baseUrl || process.env.SUPERSERVE_BASE_URL || undefined;
}

function generateSandboxName(): string {
  return `cs-${randomUUID().slice(0, 8)}`;
}

type CommandRunner = (
  sandbox: SuperserveSandbox,
  command: string,
  options?: RunCommandOptions,
) => Promise<CommandResult>;

const FALLBACK_WORKDIR = '/';

/** Cached `pwd` probes: relative filesystem paths resolve against the cwd a
 *  `runCommand` exec would use, so `writeFile('a.txt')` and `cat a.txt` agree. */
const workdirs = new WeakMap<SuperserveSandbox, Promise<string>>();
const volumeConnections = new WeakMap<SuperserveSandbox, ResolvedConfig>();

function volumeReference(volume: string | Volume): string {
  const reference = typeof volume === 'string' ? volume : volume?.id || volume?.name;
  if (typeof reference !== 'string' || !reference.trim()) {
    throw new Error('A Superserve volume reference must contain an id or name.');
  }
  return reference;
}

function volumeConnection(sandbox: SuperserveSandbox): ResolvedConfig {
  const connection = volumeConnections.get(sandbox);
  if (!connection) throw new Error('The Superserve sandbox has no captured volume connection.');
  return connection;
}

function sameSandboxId(left: string, right: string): boolean {
  const pattern = /^(?:sb-([A-Za-z0-9]+)-)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
  const a = pattern.exec(left);
  const b = pattern.exec(right);
  if (!a || !b) return left === right;
  return a[2].toLowerCase() === b[2].toLowerCase() &&
    (a[1] === undefined || b[1] === undefined || a[1] === b[1]);
}

function toVolume(info: VolumeInfo): Volume {
  return {
    id: info.id,
    name: info.name,
    sizeBytes: info.capacityBytes,
    usedBytes: info.usedBytes,
    region: info.region,
    status: info.status,
    createdAt: info.createdAt,
  };
}

async function deleteVolume(connection: ResolvedConfig, idOrName: string): Promise<void> {
  let volume: SuperserveVolume;
  try {
    volume = await SuperserveVolume.connect(idOrName, connection);
  } catch (error) {
    if (error instanceof NotFoundError) return;
    throw error;
  }
  // Names can be reused while closing leases settle. Resolve once so retries
  // and attachment checks stay bound to the original volume.
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      await SuperserveVolume.deleteById(volume.id, connection);
      return;
    } catch (error) {
      if (!(error instanceof ConflictError) || error.code !== 'volume_conflict') throw error;
      let attachments;
      try {
        attachments = await volume.listAttachments();
      } catch (lookupError) {
        if (lookupError instanceof NotFoundError) return;
        throw lookupError;
      }
      const closing = attachments.filter((attachment) => attachment.status !== 'revoked');
      // A destroyed sandbox can leave a closing lease briefly. Never wait on
      // an active mount, or turn another kind of conflict into successful cleanup.
      if (!closing.length || closing.some((attachment) =>
        attachment.status !== 'detaching' && attachment.status !== 'revoking') ||
        Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
}

function workdirOf(sandbox: SuperserveSandbox, runCommand: CommandRunner): Promise<string> {
  let probe = workdirs.get(sandbox);
  if (!probe) {
    probe = runCommand(sandbox, 'pwd').then((result) => {
      const dir = result.stdout.trim();
      if (result.exitCode === 0 && dir.startsWith('/')) return dir;
      // runCommand reports exec failures as results, not rejections, so a
      // transient failure must not pin the workdir to the fallback forever —
      // evict and let the next filesystem op probe again.
      workdirs.delete(sandbox);
      return FALLBACK_WORKDIR;
    });
    workdirs.set(sandbox, probe);
    probe.catch(() => workdirs.delete(sandbox));
  }
  return probe;
}

/** Join `path` onto the sandbox workdir. Absolute paths pass through and skip
 *  the probe; empty and `.` segments are dropped; `..` segments are preserved
 *  for the sandbox filesystem to resolve physically — collapsing them
 *  lexically would mis-resolve when a preceding component is a symlink. */
async function resolveSandboxPath(
  sandbox: SuperserveSandbox,
  path: string,
  runCommand: CommandRunner,
): Promise<string> {
  const combined = path.startsWith('/')
    ? path
    : `${await workdirOf(sandbox, runCommand)}/${path}`;
  const segments: string[] = [];
  for (const segment of combined.split('/')) {
    if (segment === '' || segment === '.') continue;
    segments.push(segment);
  }
  return `/${segments.join('/')}`;
}

function rethrowFriendly(error: unknown, fallbackPrefix: string): never {
  if (error instanceof AuthenticationError) {
    throw new Error(
      `Superserve authentication failed. Please check your SUPERSERVE_API_KEY environment variable.`,
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes('unauthorized') || lower.includes('401') || lower.includes('api key')) {
    throw new Error(
      `Superserve authentication failed. Please check your SUPERSERVE_API_KEY environment variable.`,
    );
  }
  if (lower.includes('quota') || lower.includes('limit') || lower.includes('429')) {
    throw new Error(`Superserve quota or rate limit reached: ${message}`);
  }
  throw new Error(`${fallbackPrefix}: ${message}`);
}

// Also serves as `streamCommand`: the SDK streams output over its own exec API
// when callbacks are passed, so no daemon or routable port is needed.
const runCommand: CommandRunner = async (sandbox, command, options) => {
  const startTime = Date.now();
  try {
    let fullCommand = command;
    if (options?.background) {
      // Run the whole command under `sh -c` so the trailing `&` backgrounds
      // the entire command (not just its last statement), and escape it so
      // the user's command can't break out of the nohup wrapper.
      fullCommand = `nohup sh -c "${escapeShellArg(fullCommand)}" > /dev/null 2>&1 &`;
    }
    const result = await sandbox.commands.run(fullCommand, {
      cwd: options?.cwd,
      env: options?.env,
      timeoutMs: options?.timeout,
      onStdout: options?.onStdout,
      onStderr: options?.onStderr,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 127,
      durationMs: Date.now() - startTime,
    };
  }
};

function toSnapshot(info: SnapshotInfo) {
  return {
    id: info.id,
    provider: 'superserve',
    createdAt: info.createdAt,
    metadata: {
      name: info.name,
      sandboxId: info.sandboxId,
      status: info.status,
      sizeBytes: info.sizeBytes,
    },
  };
}

/** Superserve sizes sandboxes at the template: vCPU, memory and disk are set
 *  here and every sandbox created from it inherits them. */
export type SuperserveTemplateCreateOptions = CreateTemplateOptions & Partial<Omit<TemplateCreateOptions, 'apiKey' | 'baseUrl' | 'name'>>;
export type SuperserveVolumeCreateOptions = CreateVolumeOptions &
  Pick<VolumeCreateOptions, 'idempotencyKey' | 'timeoutMs' | 'signal'>;

function toTemplate(info: TemplateInfo) {
  return {
    id: info.id,
    name: info.name,
    createdAt: info.createdAt,
    metadata: { status: info.status, vcpu: info.vcpu, memoryMib: info.memoryMib, diskMib: info.diskMib, errorMessage: info.errorMessage },
  };
}

export const superserve = defineProvider<SuperserveSandbox, SuperserveConfig>({
  name: 'superserve',
  sizes: (config, profile, options) => {
    const opts = options as Record<string, unknown> | undefined;
    const nativeSize = NATIVE_SIZE_OPTIONS.find(key => opts?.[key] !== undefined);
    if (nativeSize) {
      throw new InstanceSizeError('conflict', `cannot combine sizeClass with native Superserve ${nativeSize}; Superserve sizes sandboxes by template`);
    }
    const source = SOURCE_OPTIONS.find(key => opts?.[key] !== undefined);
    if (source) {
      return { status: 'unsupported', reason: `A Superserve template or snapshot fixes CPU and memory; drop ${source} to boot the standard size template.` };
    }
    const templateId = sizeTemplateOf(config, profile.sizeClass);
    if (!templateId) {
      return {
        status: 'unsupported',
        reason: `Superserve lists at most 16 vCPU / 64 GiB per sandbox (Pro plan); ${profile.sizeClass} needs ${profile.vcpus} vCPU / ${profile.memoryMiB / 1024} GiB. Set sizeTemplates.${profile.sizeClass} to a custom-size template to use it.`,
      };
    }
    const diskMiB = BUILT_IN_TEMPLATE_DISK_MIB[templateId];
    return {
      status: 'supported',
      nativeOptions: { templateId },
      ...(diskMiB === undefined ? {} : { resolved: { vcpus: profile.vcpus, memoryMiB: profile.memoryMiB, diskMiB } }),
    };
  },
  methods: {
    instances: {
      create: async (config: SuperserveConfig, options?: CreateInstanceOptions) => {
        const apiKey = resolveApiKey(config);
        const baseUrl = resolveBaseUrl(config);

        const {
          timeout: requestedTimeoutMs,
          envs,
          name,
          metadata,
          templateId,
          snapshotId,
          volumes,
          namespace: _namespace,
          directory: _directory,
          ...providerOptions
        } = options || {};

        const ttMs = requestedTimeoutMs ?? config.timeout;
        const timeoutSeconds = ttMs !== undefined ? Math.max(1, Math.ceil(ttMs / 1000)) : undefined;

        try {
          const createOptions = {
            apiKey,
            baseUrl,
            name: name ?? generateSandboxName(),
            ...(templateId ? { fromTemplate: templateId } : {}),
            ...(snapshotId ? { fromSnapshot: snapshotId } : {}),
            ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
            ...(metadata ? { metadata: metadata as Record<string, string> } : {}),
            ...(envs ? { envVars: envs } : {}),
            ...providerOptions,
            ...(volumes !== undefined ? {
              volumes: volumes.map((mount) => ({
                ...mount,
                volume: mount.volume instanceof SuperserveVolume
                  ? mount.volume
                  : volumeReference(mount.volume),
              })),
            } : {}),
          };
          const connection = resolveConfig(createOptions);
          const sandbox = await SuperserveSandbox.create(createOptions);
          volumeConnections.set(sandbox, connection);
          return { instance: sandbox, instanceId: sandbox.id };
        } catch (error) {
          const notBuilt = missingSizeTemplate(config, templateId, error);
          if (notBuilt) throw Object.assign(new Error(notBuilt), { status: 404, cause: error });
          rethrowFriendly(error, 'Failed to create Superserve sandbox');
        }
      },

      getById: async (config: SuperserveConfig, sandboxId: string) => {
        const apiKey = resolveApiKey(config);
        const baseUrl = resolveBaseUrl(config);
        try {
          const connection = resolveConfig({ apiKey, baseUrl });
          const sandbox = await SuperserveSandbox.connect(sandboxId, connection);
          volumeConnections.set(sandbox, connection);
          return { instance: sandbox, instanceId: sandbox.id };
        } catch {
          return null;
        }
      },

      list: async (config: SuperserveConfig) => {
        const apiKey = resolveApiKey(config);
        const baseUrl = resolveBaseUrl(config);
        try {
          const connection = resolveConfig({ apiKey, baseUrl });
          const infos = await SuperserveSandbox.list(connection);
          // No per-item connect() — that would POST /activate and resume paused sandboxes.
          return infos.map((info) => {
            const instance = info as unknown as SuperserveSandbox;
            volumeConnections.set(instance, connection);
            return { instance, instanceId: info.id };
          });
        } catch {
          return [];
        }
      },

      destroy: async (config: SuperserveConfig, sandboxId: string) => {
        const apiKey = resolveApiKey(config);
        const baseUrl = resolveBaseUrl(config);
        // The SDK handles already-deleted sandboxes and retries transient failures.
        await SuperserveSandbox.killById(sandboxId, { apiKey, baseUrl });
      },

      runCommand,
      streamCommand: runCommand,

      attachVolume: async (sandbox, volume, mountPath) => {
        const native = await SuperserveVolume.connect(volumeReference(volume), volumeConnection(sandbox));
        await native.attach(sandbox.id, { mountPath });
      },

      detachVolume: async (sandbox, volume, mountPath) => {
        const native = await SuperserveVolume.connect(volumeReference(volume), volumeConnection(sandbox));
        const attachments = (await native.listAttachments()).filter((attachment) =>
          attachment.volumeId === native.id &&
          sameSandboxId(attachment.sandboxId, sandbox.id) &&
          attachment.status !== 'revoked' &&
          (mountPath === undefined || attachment.mountPath === mountPath));
        if (attachments.length > 1) {
          throw new Error('Multiple matching Superserve attachments; provide their mount path to detach one.');
        }
        if (attachments[0]) await native.detach(attachments[0].id);
      },

      getInfo: async (sandbox: SuperserveSandbox): Promise<InstanceInfo> => {
        const info = await sandbox.getInfo();
        const status: InstanceInfo['status'] =
          info.status === 'paused' || info.status === 'deleted' ? 'stopped' :
          info.status === 'failed' ? 'error' :
          'running';
        return {
          id: info.id,
          provider: 'superserve',
          status,
          createdAt: info.createdAt,
          timeout: info.timeoutSeconds ? info.timeoutSeconds * 1000 : DEFAULT_TIMEOUT_MS,
          metadata: info.metadata,
        };
      },

      getUrl: async (sandbox: SuperserveSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        // A preview URL only routes once its port is published. A new port takes
        // the sandbox's `previewAccess` default; a published one keeps its mode.
        await sandbox.publishPreviewPort(options.port);
        const url = sandbox.getPreviewUrl(options.port);
        return options.protocol ? url.replace(/^https/, options.protocol) : url;
      },

      filesystem: {
        readFile: async (sandbox: SuperserveSandbox, path: string, runCommand: CommandRunner): Promise<string> => {
          return sandbox.files.readText(await resolveSandboxPath(sandbox, path, runCommand));
        },

        writeFile: async (sandbox: SuperserveSandbox, path: string, content: string, runCommand: CommandRunner): Promise<void> => {
          await sandbox.files.write(await resolveSandboxPath(sandbox, path, runCommand), content);
        },

        mkdir: async (sandbox: SuperserveSandbox, path: string, runCommand: CommandRunner): Promise<void> => {
          const resolved = await resolveSandboxPath(sandbox, path, runCommand);
          const result = await sandbox.commands.run(`mkdir -p "${escapeShellArg(resolved)}"`);
          if (result.exitCode !== 0) {
            throw new Error(`mkdir failed: ${result.stderr || `exit code ${result.exitCode}`}`);
          }
        },

        readdir: async (sandbox: SuperserveSandbox, path: string, runCommand: CommandRunner): Promise<FileEntry[]> => {
          const resolved = await resolveSandboxPath(sandbox, path, runCommand);
          // find -printf format: <type>\t<size>\t<mtime-epoch>\t<name>
          const cmd = [
            `cd "${escapeShellArg(resolved)}" || exit 2`,
            `find . -mindepth 1 -maxdepth 1 -printf '%y\\t%s\\t%T@\\t%f\\n' 2>/dev/null`,
          ].join(' && ');
          const result = await sandbox.commands.run(cmd);
          if (result.exitCode === 2) {
            throw new Error(`readdir: directory not found: ${path}`);
          }
          if (result.exitCode !== 0) {
            throw new Error(`readdir failed: ${result.stderr || `exit code ${result.exitCode}`}`);
          }
          const entries: FileEntry[] = [];
          for (const line of result.stdout.split('\n')) {
            if (!line) continue;
            const [type, sizeStr, mtimeStr, ...nameParts] = line.split('\t');
            const name = nameParts.join('\t');
            if (!name) continue;
            const size = Number.parseInt(sizeStr, 10);
            const mtime = Number.parseFloat(mtimeStr);
            entries.push({
              name,
              type: type === 'd' ? 'directory' : 'file',
              size: Number.isFinite(size) ? size : 0,
              modified: Number.isFinite(mtime) ? new Date(mtime * 1000) : new Date(),
            });
          }
          return entries;
        },

        exists: async (sandbox: SuperserveSandbox, path: string, runCommand: CommandRunner): Promise<boolean> => {
          const resolved = await resolveSandboxPath(sandbox, path, runCommand);
          const result = await sandbox.commands.run(`test -e "${escapeShellArg(resolved)}"`);
          return result.exitCode === 0;
        },

        remove: async (sandbox: SuperserveSandbox, path: string, runCommand: CommandRunner): Promise<void> => {
          // An empty or dot-only path would resolve to the workdir itself —
          // refuse it rather than `rm -rf` the sandbox's whole cwd.
          if (path.split('/').every((s) => s === '' || s === '.')) {
            throw new Error(`remove: refusing ambiguous path: ${JSON.stringify(path)}`);
          }
          const resolved = await resolveSandboxPath(sandbox, path, runCommand);
          const result = await sandbox.commands.run(`rm -rf "${escapeShellArg(resolved)}"`);
          if (result.exitCode !== 0) {
            throw new Error(`remove failed: ${result.stderr || `exit code ${result.exitCode}`}`);
          }
        },
      },

      getInstance: (sandbox: SuperserveSandbox): SuperserveSandbox => sandbox,

      pause: async (sandbox: SuperserveSandbox): Promise<void> => {
        try {
          await sandbox.pause({ wait: true });
        } catch (error) {
          rethrowFriendly(error, 'Failed to pause Superserve sandbox');
        }
      },

      resume: async (sandbox: SuperserveSandbox): Promise<void> => {
        try {
          // The access token rotates on resume; the SDK refreshes the handle in place.
          await sandbox.resume();
        } catch (error) {
          rethrowFriendly(error, 'Failed to resume Superserve sandbox');
        }
      },

      pauseCapabilities: { memory: true },
    },

    snapshot: {
      // Snapshots hold memory and disk: restores keep the whole filesystem,
      // tmpfs /tmp included, and running processes. The source keeps running.
      capabilities: { scope: 'rootfs', memory: true, destroysSource: false },
      create: async (config: SuperserveConfig, sandboxId: string, options?: { name?: string }) => {
        const apiKey = resolveApiKey(config);
        const baseUrl = resolveBaseUrl(config);
        try {
          // connect() activates the sandbox, so a paused one is resumed first.
          const sandbox = await SuperserveSandbox.connect(sandboxId, { apiKey, baseUrl });
          return toSnapshot(await sandbox.snapshot({ name: options?.name }));
        } catch (error) {
          rethrowFriendly(error, 'Failed to create Superserve snapshot');
        }
      },
      list: async (config: SuperserveConfig, options?: { sandboxId?: string; limit?: number }) => {
        // Snapshots are listed per sandbox. Callers that aggregate across
        // providers pass no options, so an unscoped call returns nothing
        // instead of throwing and failing their whole listing.
        if (!options?.sandboxId) return [];
        const apiKey = resolveApiKey(config);
        const baseUrl = resolveBaseUrl(config);
        const infos = await SuperserveSnapshot.list(options.sandboxId, { apiKey, baseUrl, limit: options.limit });
        return infos.map(toSnapshot);
      },
      delete: async (config: SuperserveConfig, snapshotId: string) => {
        const apiKey = resolveApiKey(config);
        const baseUrl = resolveBaseUrl(config);
        await SuperserveSnapshot.deleteById(snapshotId, { apiKey, baseUrl });
      },
    },

    volume: {
      create: async (config: SuperserveConfig, options: SuperserveVolumeCreateOptions) => {
        const connection = resolveConfig({ apiKey: resolveApiKey(config), baseUrl: resolveBaseUrl(config) });
        const volume = await SuperserveVolume.create({
          ...connection,
          name: options.name,
          ...(options.sizeBytes !== undefined ? { capacityBytes: options.sizeBytes } : {}),
          idempotencyKey: options.idempotencyKey,
          timeoutMs: options.timeoutMs,
          signal: options.signal,
        });
        return toVolume(volume);
      },
      get: async (config: SuperserveConfig, idOrName: string) => {
        const connection = resolveConfig({ apiKey: resolveApiKey(config), baseUrl: resolveBaseUrl(config) });
        try {
          return toVolume(await SuperserveVolume.connect(idOrName, connection));
        } catch (error) {
          if (error instanceof NotFoundError) return null;
          throw error;
        }
      },
      list: async (config: SuperserveConfig, options?: { limit?: number }) => {
        const connection = resolveConfig({ apiKey: resolveApiKey(config), baseUrl: resolveBaseUrl(config) });
        const volumes = await SuperserveVolume.list({ ...connection, limit: options?.limit });
        return volumes.map(toVolume);
      },
      delete: async (config: SuperserveConfig, idOrName: string) => {
        const connection = resolveConfig({ apiKey: resolveApiKey(config), baseUrl: resolveBaseUrl(config) });
        await deleteVolume(connection, idOrName);
      },
    },

    template: {
      create: async (config: SuperserveConfig, options: SuperserveTemplateCreateOptions) => {
        const apiKey = resolveApiKey(config);
        const baseUrl = resolveBaseUrl(config);
        const { name, from, vcpu, memoryMib, diskMib, steps, startCmd, readyCmd } = options;
        if (!from) {
          throw new Error('Superserve templates are built from an image: pass `from` (e.g. "node:22").');
        }
        try {
          const template = await SuperserveTemplate.create({
            apiKey, baseUrl, name, from, vcpu, memoryMib, diskMib, steps, startCmd, readyCmd,
          });
          return toTemplate(await template.waitUntilReady());
        } catch (error) {
          rethrowFriendly(error, 'Failed to create Superserve template');
        }
      },
      list: async (config: SuperserveConfig) => {
        const apiKey = resolveApiKey(config);
        const baseUrl = resolveBaseUrl(config);
        try {
          const infos = await SuperserveTemplate.list({ apiKey, baseUrl });
          return infos.map(toTemplate);
        } catch {
          return [];
        }
      },
      delete: async (config: SuperserveConfig, templateId: string) => {
        const apiKey = resolveApiKey(config);
        const baseUrl = resolveBaseUrl(config);
        try {
          await SuperserveTemplate.deleteById(templateId, { apiKey, baseUrl });
        } catch {
          /* already deleted */
        }
      },
    },
  },
});

export type { Sandbox as SuperserveSandbox } from '@superserve/sdk';
