import { CommandExitError, FileType, NotFoundError, Novita } from 'novita-sandbox';
import type { BuildOptions, SandboxOpts, SnapshotInfo, TemplateClass, TemplateInfo } from 'novita-sandbox';
import { defineProvider } from '@computesdk/provider';
import type {
  CommandResult, CreateTemplateOptions, Provider, ProviderTemplateManager,
  RunCommandOptions, SandboxInfo,
} from '@computesdk/provider';

export type NovitaSandbox = Awaited<ReturnType<Novita['sandbox']['create']>>;

export interface NovitaConfig {
  /** Falls back to NOVITA_API_KEY. */
  apiKey?: string;
  /** Default sandbox lifetime in milliseconds (default: 300000). */
  timeout?: number;
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
  try {
    if (options?.background) {
      const handle = await sandbox.commands.run(command, { ...commandOptions, background: true });
      // ComputeSDK returns an acknowledgement for background commands, not a process handle.
      // Disconnect only the output stream; the remote process keeps running.
      await handle.disconnect();
      return { stdout: '', stderr: '', exitCode: 0, durationMs: Date.now() - start };
    }
    const result = await sandbox.commands.run(command, commandOptions);
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, durationMs: Date.now() - start };
  } catch (error) {
    if (error instanceof CommandExitError) {
      return { stdout: error.stdout, stderr: error.stderr, exitCode: error.exitCode, durationMs: Date.now() - start };
    }
    // Authentication, transport and timeout failures are not process exit codes.
    throw error;
  }
}

function snapshotInfo(snapshot: SnapshotInfo): NovitaSnapshot {
  return { ...snapshot, id: snapshot.snapshotId, provider: 'novita' };
}

const createNovitaProvider = defineProvider<NovitaSandbox, NovitaConfig, NovitaTemplate, NovitaSnapshot>({
  name: 'novita',
  methods: {
    sandbox: {
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
        };
        const sandbox = await sdk.sandbox.create(options?.templateId || options?.snapshotId || 'base', createOptions);
        if (!sandbox.sandboxId) throw new Error('Novita create() returned a sandbox without an ID.');
        return { sandbox, sandboxId: sandbox.sandboxId };
      },
      getById: async (config, sandboxId) => {
        try {
          const sandbox = await client(config).sandbox.connect(sandboxId);
          return { sandbox, sandboxId: sandbox.sandboxId };
        } catch (error) {
          if (error instanceof NotFoundError) return null;
          throw error;
        }
      },
      list: async (config) => {
        const sdk = client(config);
        // Connecting to a paused sandbox would resume it, so list active sandboxes only.
        const items = await collectPages(sdk.sandbox.list({ query: { state: ['running'] } }));
        const sandboxes: Array<{ sandbox: NovitaSandbox; sandboxId: string }> = [];
        for (const item of items) {
          try {
            const sandbox = await sdk.sandbox.connect(item.sandboxId);
            sandboxes.push({ sandbox, sandboxId: sandbox.sandboxId });
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
      getInfo: async (sandbox): Promise<SandboxInfo> => {
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
        if (options?.name !== undefined || options?.metadata !== undefined) {
          throw new Error('Novita snapshots do not support name or metadata.');
        }
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
    },
  },
});

/** Preserve the Novita-specific template creation options on the public provider. */
export function novita(config: NovitaConfig): NovitaProvider {
  const provider = createNovitaProvider(config);
  // This factory always registers the template manager above.
  return { ...provider, template: provider.template! };
}
