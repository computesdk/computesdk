import { posix } from 'node:path';
import { BriqOperationError, type SandboxSize, fail, nativeSandbox } from '@briq-cloud/sdk';
import {
  type CommandResult,
  type CreateInstanceOptions,
  InstanceSizeError,
  type ProviderInstance,
  type RunCommandOptions,
  defineProvider,
} from '@computesdk/provider';
import { protect, sanitized } from './factory-errors';
import { DAEMON_SHA256, IMAGE, daemonPayload, launch } from './launcher';
import type { BriqConfig, BriqInstance } from './types';
export type { BriqConfig, BriqInstance } from './types';
const META = 'briq/computesdk-metadata';
const DIRECTORY = 'briq/computesdk-directory';
const COMMAND_TIMEOUT = 30000;
/** Briq's size for each standard size class. `xs` and `2xl` have no Briq size. */
const SIZES: Readonly<Record<string, SandboxSize>> = {
  sm: 'small',
  md: 'medium',
  lg: 'large',
  xl: 'xlarge',
};
const isSize = (value: unknown): value is SandboxSize =>
  typeof value === 'string' && Object.values(SIZES).includes(value as SandboxSize);
/** The API key from the config, else `BRIQ_API_KEY`; fails with the setup steps when neither is set. */
function resolveApiKey(config: BriqConfig): string {
  const apiKey = config.apiKey || process.env.BRIQ_API_KEY;
  if (!apiKey) {
    throw fail(
      'auth',
      'Missing API key for briq.\n\n' +
        'Create a key on the Agents page of the dashboard: https://app.briq.cloud\n' +
        'Then pass it: briq({ apiKey: "xxx" })\n' +
        'Or set BRIQ_API_KEY in your environment.',
    );
  }
  return apiKey;
}

/** ComputeSDK provider for Briq: the official factory and daemon, with foreground commands run through Briq's own command API. */
export function briq(config: BriqConfig = {}) {
  // Built on first use, so a provider can be constructed before the key is known and the missing
  // key is reported by the first call that needs it, with the setup steps.
  let native: ReturnType<typeof nativeSandbox> | undefined;
  const backend = () =>
    (native ??= nativeSandbox({
      ...config,
      apiKey: resolveApiKey(config),
      baseUrl: config.baseUrl || process.env.BRIQ_API_URL || undefined,
      stack: config.stack ?? 'computesdk',
      image: IMAGE,
      marker: 'briq/computesdk-provider',
      // create is the POST alone: the first exec is the caller's own command.
      eagerChecks: false,
    }));
  const directories = new Map<string, string>();
  const directory = (id: string) => directories.get(id) ?? '/workspace';
  const execute = async (
    instance: BriqInstance,
    command: string,
    options: RunCommandOptions = {},
  ): Promise<CommandResult> => {
    if (options.background) {
      // Detached like the other providers: the launcher exits 0 once the command is started.
      // The command is an argument of the script, never part of it. Its output goes nowhere and
      // its stdin is closed, so nothing keeps the exec stream open.
      const started = performance.now();
      const launched = await backend().run(instance.id, {
        cmd: ['/bin/sh', '-c', 'nohup sh -c "$1" </dev/null >/dev/null 2>&1 &', 'sh', command],
        cwd: options.cwd ?? directory(instance.id),
        env: options.env ?? {},
        stdin: '',
        timeoutMs: options.timeout ?? COMMAND_TIMEOUT,
        live: false,
        onChunk() {},
      });
      if (launched.timedOut) throw fail('timeout', 'Background launch timed out');
      if (launched.exitCode === null)
        throw fail('outcome_unknown', 'Background launch did not report a confirmed exit');
      return { stdout: '', stderr: '', exitCode: launched.exitCode, durationMs: performance.now() - started };
    }
    let payload = daemonPayload(command);
    if (payload !== undefined) {
      const job = JSON.parse(payload) as { command?: unknown; env?: Record<string, string> };
      if (typeof job.command === 'string') {
        // Read the persisted guest environment anew for every job, including after reconnect.
        // Values stay in RAM and the job payload; never install them on the control launcher.
        let text = '';
        const inherited = await backend().run(instance.id, {
          cmd: [
            '/usr/local/bin/python3',
            '-I',
            '-S',
            '-c',
            'import os,json;print(json.dumps(dict(os.environ),ensure_ascii=True))',
          ],
          cwd: '/',
          env: {},
          timeoutMs: COMMAND_TIMEOUT,
          live: false,
          onChunk(chunk) {
            if (chunk.stream === 'stdout') text += chunk.text;
            if (Buffer.byteLength(text) > 524288)
              throw fail('quota', 'Guest environment exceeds the adapter limit');
          },
        });
        if (inherited.timedOut) throw fail('timeout', 'Guest environment read timed out');
        if (inherited.exitCode !== 0) throw fail('provider', 'Guest environment could not be read');
        let values: unknown;
        try {
          values = JSON.parse(text);
        } catch {
          throw fail('provider', 'Invalid guest environment');
        }
        if (
          !values ||
          typeof values !== 'object' ||
          Array.isArray(values) ||
          Object.values(values).some((v) => typeof v !== 'string')
        )
          throw fail('provider', 'Invalid guest environment');
        payload = JSON.stringify({ ...job, env: { ...values, ...job.env } });
      }
    }
    const control = payload === undefined ? undefined : launch(instance.id, payload, DAEMON_SHA256);
    const started = performance.now();
    let stdout = '';
    let stderr = '';
    const result = await backend().run(instance.id, {
      ...(control ?? {
        cmd: ['/bin/sh', '-c', command],
        cwd: options.cwd ?? directory(instance.id),
        env: options.env ?? {},
        stdin: '',
      }),
      timeoutMs: options.timeout ?? COMMAND_TIMEOUT,
      // The plain HTTP route when nobody reads the output as it comes. A daemon launch stays on
      // the stream: what it starts in the background may hold the output open.
      live: control !== undefined || !!(options.onStdout || options.onStderr),
      onChunk(chunk) {
        if (chunk.stream === 'stdout') {
          stdout += chunk.text;
          options.onStdout?.(chunk.text);
        } else {
          stderr += chunk.text;
          options.onStderr?.(chunk.text);
        }
        if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 8 * 1024 * 1024)
          throw fail('quota', 'Command output exceeds the adapter limit');
      },
    });
    if (result.timedOut)
      throw fail(
        'timeout',
        control
          ? 'Daemon control timed out; detached process state must be inspected separately'
          : 'Foreground command timed out and Briq confirmed it was stopped',
      );
    // The launcher guard failed (`|| exit 126` in `launch`): the daemon was never started.
    if (control && result.exitCode === 126)
      throw fail('unsupported', 'The Node binary and launcher files in the sandbox image could not be verified');
    if (result.exitCode === null)
      throw fail('outcome_unknown', 'Command did not report a confirmed exit');
    return { stdout, stderr, exitCode: result.exitCode, durationMs: performance.now() - started };
  };
  const remember = (row: { id: string; labels: Record<string, string> }) => {
    directories.set(row.id, row.labels[DIRECTORY] ?? '/workspace');
    return { instance: { id: row.id }, instanceId: row.id };
  };
  const factory = defineProvider<BriqInstance, BriqConfig>({
    name: 'briq',
    sizes: (_config, profile, options) => {
      if (options?.size !== undefined)
        throw new InstanceSizeError('conflict', 'cannot combine sizeClass with the size option');
      const size = SIZES[profile.sizeClass];
      if (!size)
        return {
          status: 'unsupported',
          reason: `Briq has no size for ${profile.sizeClass}. Use sm, md, lg or xl.`,
        };
      return { status: 'supported', nativeOptions: { size } };
    },
    methods: {
      instances: {
        async create(_config, options: CreateInstanceOptions = {}) {
          const supported = new Set([
            'provider',
            'name',
            'envs',
            'metadata',
            'signal',
            'directory',
            'ephemeral',
            'size',
          ]);
          for (const [key, value] of Object.entries(options)) {
            if (value !== undefined && !supported.has(key))
              throw fail(
                'unsupported',
                key === 'egress'
                  ? 'egress: unsupported before allocation'
                  : `Unsupported create option: ${key}`,
              );
          }
          if (options.size !== undefined && !isSize(options.size))
            throw fail('unsupported', 'size must be small, medium, large or xlarge');
          if (options.provider !== undefined && options.provider !== 'briq')
            throw fail('invalid_argument', 'Provider name does not match');
          const cwd = options.directory ?? '/workspace';
          if (!posix.isAbsolute(cwd) || cwd.includes('\0'))
            throw fail('invalid_argument', 'Directory must be an absolute POSIX path');
          let metadata: string;
          try {
            metadata = JSON.stringify(options.metadata ?? {});
            if (!metadata || typeof options.metadata === 'function' || !metadata.startsWith('{'))
              throw new Error();
          } catch {
            throw fail('invalid_argument', 'Metadata must be a JSON object');
          }
          if (metadata.length > 1024 || cwd.length > 1024)
            throw fail('invalid_argument', 'Metadata or directory exceeds label limits');
          const row = await backend().create({
            labels: {
              ...(metadata === '{}' ? {} : { [META]: metadata }),
              ...(cwd === '/workspace' ? {} : { [DIRECTORY]: cwd }),
            },
            env: options.envs ?? {},
            ...(options.size === undefined ? {} : { size: options.size }),
            ...(options.name === undefined ? {} : { name: options.name }),
            ...(options.signal ? { signal: options.signal } : {}),
          });
          try {
            // The sandbox command (`mkdir -p /workspace`) creates /workspace before the row is running.
            if (cwd !== '/workspace') await backend().files.mkdir(row.id, cwd);
            // Nothing else runs here. The pinned image is Node's guarantee for a plain command; the
            // launcher guard (Node hash, private directories, daemon hash) opens the stdin of every
            // daemon job (`launch`), so it runs before the first daemon use and again on each one,
            // after a reconnect included.
            return remember(row);
          } catch (error) {
            try {
              await backend().destroy(row.id);
            } catch {
              throw fail(
                'outcome_unknown',
                'Initialization failed and owned instance cleanup was not confirmed',
              );
            }
            throw error;
          }
        },
        async getById(_config, id) {
          try {
            return remember(await backend().connect(id));
          } catch (error) {
            if (error instanceof BriqOperationError && error.code === 'not_found') return null;
            throw error;
          }
        },
        async list() {
          return (await backend().list({})).map(remember);
        },
        async destroy(_config, id) {
          await backend().destroy(id);
          directories.delete(id);
        },
        runCommand: execute,
        streamCommand: execute,
        async getInfo(instance) {
          const row = await backend().native(instance.id).status();
          return {
            id: row.id,
            provider: 'briq',
            status:
              row.state === 'running' ? 'running' : row.state === 'error' ? 'error' : 'stopped',
            createdAt: new Date(row.createdAt),
            timeout: COMMAND_TIMEOUT,
            metadata: JSON.parse(row.labels[META] ?? '{}'),
          };
        },
        // Internal SSE URLs are never exposed. The official factory falls back to its status polling.
        getUrl: async () => {
          throw fail('unsupported', 'Internal daemon SSE is not externally exposed');
        },
        filesystem: {
          async readFile(instance, path) {
            const bytes = await backend().files.read(instance.id, path);
            try {
              return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            } catch {
              throw fail('unsupported', 'File is not UTF-8 text');
            }
          },
          async writeFile(instance, path, text) {
            await backend().files.write(instance.id, path, new TextEncoder().encode(text));
          },
          async mkdir(instance, path) {
            await backend().files.mkdir(instance.id, path);
          },
          async exists(instance, path) {
            try {
              await backend().files.stat(instance.id, path);
              return true;
            } catch (error) {
              if (error instanceof BriqOperationError && error.code === 'file_not_found')
                return false;
              throw error;
            }
          },
          async remove(instance, path) {
            await backend().files.remove(instance.id, path, { recursive: true });
          },
          async readdir(instance, path) {
            const entries = await backend().files.list(instance.id, path);
            return entries.map((entry) => {
              if (entry.type === 'symlink')
                throw fail(
                  'unsupported',
                  'Native symlink metadata cannot be represented by ComputeSDK FileEntry',
                );
              return {
                name: posix.basename(entry.path),
                type: entry.type,
                size: entry.size,
                modified: new Date(entry.modifiedAt),
              };
            });
          },
        },
      },
    },
  })(config);
  const original = factory.instances;
  const facade = (instance: ProviderInstance<BriqInstance>) => {
    const start = instance.startProcess.bind(instance);
    instance.runCommand = protect(instance.runCommand.bind(instance));
    instance.getInfo = protect(instance.getInfo.bind(instance));
    instance.destroy = protect(instance.destroy.bind(instance));
    const fs = instance.filesystem;
    fs.readFile = protect(fs.readFile.bind(fs));
    fs.writeFile = protect(fs.writeFile.bind(fs));
    fs.mkdir = protect(fs.mkdir.bind(fs));
    fs.readdir = protect(fs.readdir.bind(fs));
    fs.exists = protect(fs.exists.bind(fs));
    fs.remove = protect(fs.remove.bind(fs));
    instance.startProcess = protect(async (command, options) => {
      const handle = await start(command, { cwd: directory(instance.instanceId), ...options });
      return {
        pid: handle.pid,
        jobId: handle.jobId,
        write: protect(handle.write.bind(handle)),
        closeStdin: protect(handle.closeStdin.bind(handle)),
        status: protect(handle.status.bind(handle)),
        kill: protect(handle.kill.bind(handle)),
        wait: async (waitOptions) => {
          const started = performance.now();
          try {
            return await handle.wait(waitOptions);
          } catch (error) {
            if (
              !(error instanceof BriqOperationError) &&
              waitOptions?.timeout !== undefined &&
              performance.now() - started >= waitOptions.timeout
            )
              throw fail(
                'timeout',
                'Process wait deadline elapsed; inspect process status separately',
              );
            throw sanitized(error);
          }
        },
      };
    });
    // A preview keeps its private credentials; the factory's internal event stream is refused.
    instance.getUrl = protect(async ({ port, protocol }) => {
      if (protocol !== undefined && protocol !== 'http' && protocol !== 'https')
        throw fail('unsupported', 'Only HTTP previews are supported');
      return (await backend().previewUrl(instance.instanceId, port)).url;
    });
    return instance;
  };
  const manager = {
    create: protect(async (options?: CreateInstanceOptions) =>
      facade(await original.create(options)),
    ),
    getById: protect(async (id: string) => {
      const instance = await original.getById(id);
      return instance ? facade(instance) : null;
    }),
    list: protect(async () => (await original.list()).map(facade)),
    destroy: protect((id: string) => original.destroy(id)),
  };
  return Object.assign(factory, { instances: manager, sandbox: manager });
}
