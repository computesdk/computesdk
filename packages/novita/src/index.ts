import { CommandExitError, FileType, NotFoundError, Novita, TimeoutError, Volume as NovitaVolume } from 'novita-sandbox';
import type { BuildOptions, SandboxOpts, SnapshotInfo, TemplateClass, TemplateInfo } from 'novita-sandbox';
import { defineProvider, resolveVolumeRef, isUnifiedVolumeMounts, withVolumeSettle, InstanceSizeError } from '@computesdk/provider';
import type {
  CommandResult, CreateTemplateOptions, Provider, ProviderTemplateManager,
  RunCommandOptions, InstanceInfo, InstanceSizeClass, InstanceSizeManager,
} from '@computesdk/provider';

export type NovitaSandbox = Awaited<ReturnType<Novita['sandbox']['create']>>;

export interface NovitaConfig {
  /** Falls back to NOVITA_API_KEY. */
  apiKey?: string;
  /** Default sandbox lifetime in milliseconds (default: 300000). */
  timeout?: number;
  /** Template to boot per standard `sizeClass`; defaults to {@link NOVITA_SIZE_TEMPLATES}. Only those sizes are honored. */
  sizeTemplates?: Partial<Record<InstanceSizeClass, string>>;
}

/**
 * Novita fixes CPU and memory when a template is built, so each standard size
 * boots its own account template (node:22, same names as E2B). Limits: whole
 * vCPUs up to 8, memory up to 8 GiB in 512 MiB steps at 0.5-4 GiB per vCPU,
 * 20 GB disk (https://novita.ai/docs/guides/sandbox-quota-limit). `xl` and up
 * need more than 8 GiB and are not offered.
 */
export const NOVITA_SIZE_TEMPLATES: Readonly<Partial<Record<InstanceSizeClass, string>>> = Object.freeze({
  xs: 'csdk-node22-1cpu-1gb',
  sm: 'csdk-node22-1cpu-2gb',
  md: 'csdk-node22-2cpu-4gb',
  lg: 'csdk-node22-4cpu-8gb',
});

/** Fixed runtime disk per sandbox (quota `diskMb: 20480`). */
const NOVITA_DISK_MIB = 20480;

function sizeTemplateOf(config: NovitaConfig, sizeClass: InstanceSizeClass): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(NOVITA_SIZE_TEMPLATES, sizeClass)) return undefined;
  const name = config.sizeTemplates?.[sizeClass] ?? NOVITA_SIZE_TEMPLATES[sizeClass];
  return typeof name === 'string' && name.trim() ? name : undefined;
}

/** A create that failed because a standard-size template was never built on this account. */
function missingSizeTemplate(config: NovitaConfig, templateId: unknown, error: unknown): string | undefined {
  if (typeof templateId !== 'string') return undefined;
  if (!(error instanceof NotFoundError) && !/\b404\b|not found/i.test(error instanceof Error ? error.message : String(error))) return undefined;
  const sizeClass = (Object.keys(NOVITA_SIZE_TEMPLATES) as InstanceSizeClass[]).find(c => sizeTemplateOf(config, c) === templateId);
  if (!sizeClass) return undefined;
  return `Novita size template '${templateId}' (sizeClass ${sizeClass}) is not built on this Novita account; run \`node scripts/provider-setup.mjs novita\` (provider-setup.yml) or point \`sizeTemplates.${sizeClass}\` at an existing template`;
}

export interface NovitaSnapshot extends SnapshotInfo {
  id: string;
  provider: 'novita';
}

export interface NovitaCreateTemplateOptions extends CreateTemplateOptions {
  /** Container image to build from. Mutually exclusive with template. */
  image?: string;
  /** Native Novita builder, including any build steps and readiness checks. */
  template?: TemplateClass;
  /** Resource allocation, cache, tags and build log callback. */
  build?: Pick<BuildOptions, 'cpuCount' | 'memoryMB' | 'skipCache' | 'tags' | 'onBuildLogs'>;
}

export interface NovitaTemplate extends Partial<TemplateInfo> {
  id: string;
  templateId: string;
  buildId: string;
  provider: 'novita';
  name?: string;
  alias?: string;
  tags?: string[];
}

export interface NovitaProvider extends Provider<NovitaSandbox, NovitaTemplate, NovitaSnapshot> {
  template: ProviderTemplateManager<NovitaTemplate, NovitaCreateTemplateOptions>;
  readonly sizes: InstanceSizeManager;
}

function client(config: NovitaConfig): Novita {
  const apiKey = config.apiKey || (typeof process !== 'undefined' ? process.env.NOVITA_API_KEY : undefined);
  if (!apiKey) {
    throw new Error("Missing Novita API key. Provide 'apiKey' in config or set NOVITA_API_KEY.");
  }
  return new Novita({ apiKey });
}

async function collectPages<T>(
  paginator: { hasNext: boolean; nextItems(): Promise<T[]> },
  limit?: number,
): Promise<T[]> {
  const items: T[] = [];
  while (paginator.hasNext && (limit === undefined || items.length < limit)) {
    items.push(...await paginator.nextItems());
  }
  return limit === undefined ? items : items.slice(0, limit);
}

async function runCommand(
  sandbox: NovitaSandbox,
  command: string,
  options?: RunCommandOptions,
): Promise<CommandResult> {
  const start = Date.now();
  const commandOptions = {
    cwd: options?.cwd,
    envs: options?.env,
    timeoutMs: options?.timeout,
    onStdout: options?.onStdout,
    onStderr: options?.onStderr,
  };
  if (options?.background) {
    const handle = await sandbox.commands.run(command, { ...commandOptions, background: true });
    // ComputeSDK returns an acknowledgement for background commands, not a process handle.
    // Disconnect only the output stream; the remote process keeps running.
    await handle.disconnect();
    return { stdout: '', stderr: '', exitCode: 0, durationMs: Date.now() - start };
  }
  // Start the command in the background so we retain the handle, then await completion
  // ourselves. This lets us honor the timeout contract: the SDK stops streaming at the
  // deadline but leaves the remote process running, so we must kill it explicitly.
  const handle = await sandbox.commands.run(command, { ...commandOptions, background: true });
  try {
    const result = await handle.wait();
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, durationMs: Date.now() - start };
  } catch (error) {
    if (error instanceof CommandExitError) {
      return { stdout: error.stdout, stderr: error.stderr, exitCode: error.exitCode, durationMs: Date.now() - start };
    }
    if (error instanceof TimeoutError) {
      // Terminate the orphaned remote process; disconnecting the stream alone would leave it running.
      await handle.kill().catch(() => {});
      // 124 is the conventional timeout exit code (GNU coreutils `timeout`). Output already
      // streamed to onStdout/onStderr callbacks is preserved on the handle.
      return { stdout: handle.stdout, stderr: handle.stderr, exitCode: 124, durationMs: Date.now() - start };
    }
    // Authentication and transport failures are not process exit codes.
    throw error;
  }
}

// Resuming re-arms the sandbox lifetime, so remember the one it was created with.
const sandboxTimeouts = new WeakMap<NovitaSandbox, number>();

function snapshotInfo(snapshot: SnapshotInfo): NovitaSnapshot {
  return { ...snapshot, id: snapshot.snapshotId, provider: 'novita' };
}

const createNovitaProvider = defineProvider<NovitaSandbox, NovitaConfig, NovitaTemplate, NovitaSnapshot>({
  name: 'novita',
  sizes: (config, profile, options) => {
    const conflict = (['cpuCount', 'memoryMB', 'build'] as const).find(key => (options as Record<string, unknown> | undefined)?.[key] !== undefined);
    if (conflict) throw new InstanceSizeError('conflict', `cannot combine sizeClass with native Novita ${conflict}`);
    if (options?.templateId !== undefined || options?.snapshotId !== undefined || options?.sandboxId !== undefined) {
      return { status: 'unsupported', reason: 'A Novita template or snapshot fixes CPU and memory; drop templateId/snapshotId/sandboxId to boot the standard size template.' };
    }
    if (!Object.prototype.hasOwnProperty.call(NOVITA_SIZE_TEMPLATES, profile.sizeClass)) {
      return {
        status: 'unsupported',
        reason: `Novita sandboxes top out at 8 vCPU and 8 GiB memory on every listed tier; ${profile.sizeClass} needs ${profile.vcpus} vCPU / ${profile.memoryMiB / 1024} GiB.`,
      };
    }
    const templateId = sizeTemplateOf(config, profile.sizeClass);
    if (!templateId) return { status: 'unconfigured', reason: `sizeTemplates.${profile.sizeClass} is empty; set it to a Novita template built with ${profile.vcpus} vCPU / ${profile.memoryMiB} MiB.` };
    return {
      status: 'supported',
      nativeOptions: { templateId },
      resolved: { vcpus: profile.vcpus, memoryMiB: profile.memoryMiB, diskMiB: NOVITA_DISK_MIB },
    };
  },
  methods: {
    instances: {
      create: async (config, options) => {
        if (options?.templateId && options?.snapshotId) {
          throw new Error('Specify either templateId or snapshotId, not both.');
        }
        const sdk = client(config);
        const createOptions: SandboxOpts = {
          timeoutMs: options?.timeout ?? config.timeout ?? 300_000,
          envs: options?.envs,
          metadata: options?.metadata,
          secure: options?.secure,
          allowInternetAccess: options?.allowInternetAccess,
          network: options?.network,
          lifecycle: options?.lifecycle,
          // Unified mounts → novita's {path: volumeName} wire shape.
          ...(isUnifiedVolumeMounts(options?.volumes) && {
            volumeMounts: Object.fromEntries(options.volumes!.map((m: any) => {
              const ref = resolveVolumeRef(m.volume);
              // Wire wants the volume NAME — a Volume handle's `native` is the
              // NovitaVolume object, not a mountable string.
              return [m.mountPath, ref.name ?? ref.id ?? ref.native];
            })),
          }),
        };
        let sandbox: NovitaSandbox;
        try {
          sandbox = await sdk.sandbox.create(options?.templateId || options?.snapshotId || 'base', createOptions);
        } catch (error) {
          const notBuilt = missingSizeTemplate(config, options?.templateId, error);
          if (notBuilt) throw new Error(notBuilt);
          throw error;
        }
        if (!sandbox.sandboxId) throw new Error('Novita create() returned a sandbox without an ID.');
        sandboxTimeouts.set(sandbox, createOptions.timeoutMs!);
        return { instance: sandbox, instanceId: sandbox.sandboxId };
      },
      getById: async (config, sandboxId) => {
        try {
          const sandbox = await client(config).sandbox.connect(sandboxId);
          return { instance: sandbox, instanceId: sandbox.sandboxId };
        } catch (error) {
          if (error instanceof NotFoundError) return null;
          throw error;
        }
      },
      list: async (config) => {
        const sdk = client(config);
        // Connecting to a paused sandbox would resume it, so list active sandboxes only.
        const items = await collectPages(sdk.sandbox.list({ query: { state: ['running'] } }));
        const sandboxes: Array<{ instance: NovitaSandbox; instanceId: string }> = [];
        for (const item of items) {
          try {
            const sandbox = await sdk.sandbox.connect(item.sandboxId);
            sandboxes.push({ instance: sandbox, instanceId: sandbox.sandboxId });
          } catch (error) {
            // A sandbox can expire between listing and connecting.
            if (!(error instanceof NotFoundError)) throw error;
          }
        }
        return sandboxes;
      },
      destroy: async (config, sandboxId) => {
        // The native API returns false when already gone; other errors propagate.
        await client(config).sandbox.kill(sandboxId);
      },
      runCommand,
      streamCommand: runCommand,
      getInfo: async (sandbox): Promise<InstanceInfo> => {
        const info = await sandbox.getInfo();
        return {
          id: info.sandboxId,
          provider: 'novita',
          status: info.state === 'running' ? 'running' : 'stopped',
          createdAt: info.startedAt,
          timeout: Math.max(0, info.endAt.getTime() - info.startedAt.getTime()),
          metadata: { ...info.metadata, templateId: info.templateId, state: info.state },
        };
      },
      getUrl: async (sandbox, options) => `${options.protocol || 'https'}://${sandbox.getHost(options.port)}`,
      filesystem: {
        readFile: (sandbox, path) => sandbox.files.read(path),
        writeFile: async (sandbox, path, content) => { await sandbox.files.write(path, content); },
        mkdir: async (sandbox, path) => { await sandbox.files.makeDir(path); },
        readdir: async (sandbox, path) => (await sandbox.files.list(path)).map(entry => ({
          name: entry.name,
          type: entry.type === FileType.DIR ? 'directory' as const : 'file' as const,
          size: entry.size,
          modified: entry.modifiedTime,
        })),
        exists: (sandbox, path) => sandbox.files.exists(path),
        remove: (sandbox, path) => sandbox.files.remove(path),
      },
      getInstance: sandbox => sandbox,

      pause: async (sandbox) => { await sandbox.pause(); },
      // Connecting resumes a paused sandbox and refreshes its traffic token.
      resume: (sandbox) => sandbox.connect({ timeoutMs: sandboxTimeouts.get(sandbox) }),
      pauseCapabilities: { memory: true },

      attachVolume: async (sandbox, volume, mountPath) => {
        const ref = resolveVolumeRef(volume);
        await sandbox.mountVolume(ref.name ?? ref.id!, mountPath);
      },
      detachVolume: async (sandbox, _volume, mountPath) => {
        await sandbox.unmountVolume(mountPath!);
      },
    },
    template: {
      create: async (config, options: NovitaCreateTemplateOptions): Promise<NovitaTemplate> => {
        if (!options.name.trim()) throw new Error('A Novita template name is required.');
        if (options.image !== undefined && options.template !== undefined) {
          throw new Error('Specify either image or template, not both.');
        }
        if (options.description !== undefined || options.metadata !== undefined) {
          throw new Error('Novita template builds do not support description or metadata.');
        }
        const sdk = client(config);
        const definition = options.template ?? (options.image !== undefined
          ? sdk.template.new().fromImage(options.image)
          : sdk.template.new().fromBaseImage());
        const build = await sdk.template.build(definition, options.name, {
          cpuCount: options.build?.cpuCount,
          memoryMB: options.build?.memoryMB,
          skipCache: options.build?.skipCache,
          tags: options.build?.tags,
          onBuildLogs: options.build?.onBuildLogs,
        });
        return { ...build, id: build.templateId, provider: 'novita' };
      },
      list: async (config, options): Promise<NovitaTemplate[]> => {
        const limit = options?.limit;
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
          throw new Error('Template limit must be a non-negative integer.');
        }
        if (limit === 0) return [];
        const paginator = client(config).template.list({
          templateType: 'template_build',
          limit: Math.min(limit ?? 100, 100),
        });
        const items: NovitaTemplate[] = [];
        while (paginator.hasNext && (limit === undefined || items.length < limit)) {
          const page = await paginator.nextPage();
          items.push(...page.templates.map(template => ({
            ...template, id: template.templateId, provider: 'novita' as const,
          })));
        }
        return limit === undefined ? items : items.slice(0, limit);
      },
      delete: async (config, templateId) => { await client(config).template.delete(templateId); },
    },
    snapshot: {
      create: async (config, sandboxId, options) => {
        // The API takes no label: name/metadata are caller-side tags, so they
        // are accepted and dropped rather than rejected (a caller that always
        // names its snapshots — e.g. the fidelity bench — must not fail).
        void options;
        return snapshotInfo(await client(config).sandbox.createSnapshot(sandboxId));
      },
      list: async (config, options) => {
        if (options?.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 0)) {
          throw new Error('Snapshot limit must be a non-negative integer.');
        }
        if (options?.limit === 0) return [];
        const paginator = client(config).sandbox.listSnapshots({ sandboxId: options?.sandboxId });
        return (await collectPages(paginator, options?.limit)).map(snapshotInfo);
      },
      delete: async (config, snapshotId) => { await client(config).sandbox.deleteSnapshot(snapshotId); },
      capabilities: { scope: 'rootfs', memory: true, destroysSource: false },
    },

    volume: {
      create: async (config: NovitaConfig, options) => {
        const apiKey = config.apiKey || process.env.NOVITA_API_KEY!;
        const v = await NovitaVolume.create(options.name, {
          apiKey,
          ...(options.sizeBytes ? { quotaSizeGiB: Math.ceil(options.sizeBytes / (1024 ** 3)) } : {}),
        });
        return { id: v.volumeId, name: v.name, native: v };
      },
      get: async (config: NovitaConfig, id: string) => {
        const apiKey = config.apiKey || process.env.NOVITA_API_KEY!;
        try {
          const info = await NovitaVolume.getInfo(id, { apiKey });
          return info ? { id, name: (info as any).name, native: info } : null;
        } catch { return null; }
      },
      list: async (config: NovitaConfig) => {
        const apiKey = config.apiKey || process.env.NOVITA_API_KEY!;
        const volumes = await NovitaVolume.list({ apiKey });
        return (volumes ?? []).map((v: any) => ({ id: v.volumeId ?? v.id, name: v.name, native: v }));
      },
      delete: async (config: NovitaConfig, id: string) => {
        const apiKey = config.apiKey || process.env.NOVITA_API_KEY!;
        await withVolumeSettle(() => NovitaVolume.destroy(id, { apiKey }));
      },
    }
  },
});

/** Preserve the Novita-specific template creation options on the public provider. */
export function novita(config: NovitaConfig): NovitaProvider {
  const provider = createNovitaProvider(config);
  // This factory always registers the template manager above.
  return { ...provider, template: provider.template! };
}
