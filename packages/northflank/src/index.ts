import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath, posix } from 'node:path';
import {
  ApiClientInMemoryContextProvider,
  ApiClient,
} from '@northflank/js-client';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type {
  CommandResult,
  SandboxInfo,
  CreateSandboxOptions,
  RunCommandOptions,
} from '@computesdk/provider';
import {
  PROVIDER,
  RUNTIME_ENV_KEY,
  DEFAULT_DEPLOYMENT_PLAN,
  DEFAULT_KEEP_ALIVE_COMMAND,
  DEFAULT_TIMEOUT_MS,
  type Runtime,
  type NorthflankProtocol,
  type NorthflankPort,
  type NorthflankPortInput,
  type NorthflankConfig,
  type NorthflankInternalDeployment,
  generateServiceName,
  imageForRuntime,
  is404,
  isValidEnvKey,
  mapStatus,
  normalizePort,
  parseRuntime,
  prefix,
  projectParams,
  readManagedRuntime,
  serviceParams,
  withExecRetry,
} from './utils';

export type { NorthflankConfig };

interface NorthflankSandboxHandle {
  serviceId: string;
  serviceName: string;
  runtime: Runtime;
  createdAt: Date;
  timeout: number;
  config: NorthflankConfig;
  api: ApiClient;
  instanceName?: string;
}

interface NorthflankCreateOptions extends CreateSandboxOptions {
  runtime?: Runtime;
  image?: string;
  ports?: NorthflankPortInput[];
  deploymentPlan?: string;
  internalDeployment?: NorthflankInternalDeployment;
}

function readCreateOptions(options?: CreateSandboxOptions): NorthflankCreateOptions {
  return (options ?? {}) as NorthflankCreateOptions;
}

function buildClient(config: NorthflankConfig): ApiClient {
  const ctx = new ApiClientInMemoryContextProvider();
  ctx.addContext({
    name: 'computesdk',
    token: config.token,
    host: config.host ?? 'https://api.northflank.com',
  });
  ctx.useContext('computesdk');
  return new ApiClient(ctx, { throwErrorOnHttpErrorCode: true });
}

async function execArgv(
  handle: NorthflankSandboxHandle,
  argv: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { commandResult, stdOut, stdErr } = await withExecRetry(
    () =>
      handle.api.exec.execServiceCommand(serviceParams(handle.config, handle.serviceId), {
        command: argv,
        shell: 'none',
        ...(handle.instanceName ? { instanceName: handle.instanceName } : {}),
      }),
    { serviceId: handle.serviceId, timeoutMs: handle.timeout },
  );
  return { stdout: stdOut ?? '', stderr: stdErr ?? '', exitCode: commandResult.exitCode };
}

async function execCommand(
  handle: NorthflankSandboxHandle,
  command: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return execArgv(handle, ['sh', '-c', command]);
}

function withCommandOptions(command: string, options?: RunCommandOptions): string {
  let full = command;
  if (options?.env && Object.keys(options.env).length > 0) {
    const envPrefix = Object.entries(options.env)
      .map(([k, v]) => {
        if (!isValidEnvKey(k)) {
          throw new Error(`Invalid environment variable name '${k}'.`);
        }
        return `${k}="${escapeShellArg(v)}"`;
      })
      .join(' ');
    full = `${envPrefix} ${full}`;
  }
  if (options?.background) {
    full = `nohup ${full} >/tmp/computesdk-bg.log 2>&1 &`;
  }
  if (options?.cwd) {
    full = `cd "${escapeShellArg(options.cwd)}" && ${full}`;
  }
  return full;
}

const createNorthflankProvider = defineProvider<NorthflankSandboxHandle, NorthflankConfig>({
  name: PROVIDER,
  methods: {
    sandbox: {
      create: async (config: NorthflankConfig, options?: CreateSandboxOptions) => {
        const opts = readCreateOptions(options);
        const client = buildClient(config);
        const p = prefix(config);
        const runtime = parseRuntime(opts.runtime ?? config.runtime ?? 'node');
        const internalDeployment = opts.internalDeployment ?? config.internalDeployment;
        const portsInput = opts.ports ?? config.ports;
        const ports = portsInput?.map(normalizePort);
        const timeout = opts.timeout ?? config.timeout ?? DEFAULT_TIMEOUT_MS;
        const serviceName = generateServiceName(p, opts.name);
        const plan = opts.deploymentPlan ?? config.deploymentPlan ?? DEFAULT_DEPLOYMENT_PLAN;

        const deployment: Record<string, unknown> = {
          instances: 1,
          docker: { configType: 'customCommand', customCommand: DEFAULT_KEEP_ALIVE_COMMAND },
        };
        if (internalDeployment) {
          deployment.internal = {
            id: internalDeployment.id,
            branch: internalDeployment.branch ?? 'main',
            buildSHA: internalDeployment.buildSHA ?? 'latest',
          };
        } else {
          deployment.external = { imagePath: imageForRuntime(runtime, opts.image ?? config.image) };
        }

        const data: Parameters<typeof client.create.service.deployment>[0]['data'] = {
          name: serviceName,
          billing: { deploymentPlan: plan },
          deployment: deployment as Parameters<typeof client.create.service.deployment>[0]['data']['deployment'],
          runtimeEnvironment: { [RUNTIME_ENV_KEY]: runtime, ...opts.envs },
        };

        if (ports && ports.length > 0) {
          data.ports = ports.map(port => ({
            name: port.name,
            internalPort: port.internalPort,
            public: port.public ?? true,
            protocol: port.protocol ?? 'HTTP',
          }));
        }

        const created = await client.create.service.deployment({
          parameters: projectParams(config),
          data,
        });
        const serviceId = created.data.id;
        return {
          sandbox: {
            serviceId,
            serviceName,
            runtime,
            createdAt: new Date(),
            timeout,
            config,
            api: client,
            instanceName: undefined,
          },
          sandboxId: serviceId,
        };
      },

      getById: async (config: NorthflankConfig, sandboxId: string) => {
        const client = buildClient(config);
        const params = serviceParams(config, sandboxId);

        try {
          const serviceRes = await client.get.service({ parameters: params });
          const service = serviceRes.data;
          if (!service.name.startsWith(prefix(config))) {
            throw new Error(`Service ${sandboxId} is not managed by ComputeSDK`);
          }
          const envRes = await client.get.service.runtimeEnvironment({ parameters: params });
          const runtime = readManagedRuntime(envRes.data.runtimeEnvironment);
          if (!runtime) {
            throw new Error(`Service ${sandboxId} missing ${RUNTIME_ENV_KEY}`);
          }
          return {
            sandbox: {
              serviceId: service.id,
              serviceName: service.name,
              runtime,
              createdAt: new Date(service.createdAt),
              timeout: config.timeout ?? DEFAULT_TIMEOUT_MS,
              config,
              api: client,
              instanceName: undefined,
            },
            sandboxId: service.id,
          };
        } catch (error) {
          if (is404(error)) return null;
          throw error;
        }
      },

      list: async (config: NorthflankConfig) => {
        const client = buildClient(config);
        const p = prefix(config);
        const managed: Array<{ id: string; name: string; createdAt: string }> = [];
        let cursor: string | undefined;

        do {
          const res = await client.list.services({
            parameters: projectParams(config),
            ...(cursor ? { options: { cursor } } : {}),
          });
          for (const svc of res.data.services ?? []) {
            if (svc.name?.startsWith(p)) {
              managed.push({
                id: svc.id,
                name: svc.name,
                createdAt: (svc as { createdAt?: string }).createdAt ?? new Date().toISOString(),
              });
            }
          }
          cursor = res.pagination?.hasNextPage ? res.pagination.cursor : undefined;
        } while (cursor);

        const results: Array<{ sandbox: NorthflankSandboxHandle; sandboxId: string }> = [];
        for (const svc of managed) {
          try {
            const params = serviceParams(config, svc.id);
            const [envRes, serviceRes] = await Promise.all([
              client.get.service.runtimeEnvironment({ parameters: params }),
              client.get.service({ parameters: params }),
            ]);
            const runtime = readManagedRuntime(envRes.data.runtimeEnvironment);
            if (!runtime) continue;
            if (serviceRes.data.status.deployment?.status === 'FAILED') continue;
            results.push({
              sandbox: {
                serviceId: svc.id,
                serviceName: svc.name,
                runtime,
                createdAt: new Date(svc.createdAt),
                timeout: config.timeout ?? DEFAULT_TIMEOUT_MS,
                config,
                api: client,
                instanceName: undefined,
              },
              sandboxId: svc.id,
            });
          } catch {
            // Skip services whose runtime env can't be read
          }
        }
        return results;
      },

      destroy: async (config: NorthflankConfig, sandboxId: string) => {
        const client = buildClient(config);
        const params = serviceParams(config, sandboxId);

        try {
          const serviceRes = await client.get.service({ parameters: params });
          if (!serviceRes.data.name.startsWith(prefix(config))) {
            throw new Error(`Service ${sandboxId} is not managed by ComputeSDK`);
          }
          await client.delete.service({ parameters: params });
        } catch (error) {
          if (is404(error)) {
            return;
          }
          throw error;
        }
      },

      runCommand: async (
        sandbox: NorthflankSandboxHandle,
        command: string,
        options?: RunCommandOptions,
      ): Promise<CommandResult> => {
        const start = Date.now();
        try {
          const fullCommand = withCommandOptions(command, options);
          const result = await execCommand(sandbox, fullCommand);
          return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            durationMs: Date.now() - start,
          };
        } catch (error) {
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 1,
            durationMs: Date.now() - start,
          };
        }
      },

      getInfo: async (sandbox: NorthflankSandboxHandle): Promise<SandboxInfo> => {
        const res = await sandbox.api.get.service({
          parameters: serviceParams(sandbox.config, sandbox.serviceId),
        });
        const service = res.data;

        return {
          id: service.id,
          provider: PROVIDER,
          status: mapStatus(service.status.deployment?.status, service.servicePaused),
          createdAt: new Date(service.createdAt),
          timeout: sandbox.timeout,
          metadata: {
            runtime: sandbox.runtime,
            projectId: sandbox.config.projectId,
            serviceName: service.name,
            deploymentStatus: service.status.deployment?.status,
            paused: service.servicePaused,
          },
        };
      },

      getUrl: async (
        sandbox: NorthflankSandboxHandle,
        options: { port: number; protocol?: string },
      ): Promise<string> => {
        const portParams = serviceParams(sandbox.config, sandbox.serviceId);
        const proto = options.protocol ?? 'https';

        const ports = await sandbox.api.get.service.ports({ parameters: portParams });
        const existing = ports.data.ports?.find(port => port.internalPort === options.port);
        if (existing?.dns) return `${proto}://${existing.dns}`;

        const current = (ports.data.ports ?? []).map(port => ({
          id: port.id,
          name: port.name,
          internalPort: port.internalPort,
          public: port.public,
          protocol: port.protocol,
          domains: port.domains?.map(d => d.name) ?? [],
        }));

        const hasPort = current.some(port => port.internalPort === options.port);
        const updated = hasPort
          ? current.map(port =>
              port.internalPort === options.port ? { ...port, public: true } : port,
            )
          : [
              ...current,
              {
                name: `p${options.port}`,
                internalPort: options.port,
                public: true,
                protocol: 'HTTP' as NorthflankProtocol,
              },
            ];

        await sandbox.api.update.service.ports({
          parameters: portParams,
          data: { ports: updated },
        });

        const maxAttempts = 10;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const refreshed = await sandbox.api.get.service.ports({ parameters: portParams });
          const port = refreshed.data.ports?.find(p => p.internalPort === options.port);
          if (port?.dns) return `${proto}://${port.dns}`;
          if (attempt < maxAttempts - 1) {
            await new Promise(r => setTimeout(r, 2000));
          }
        }
        throw new Error(`No public DNS found for port ${options.port} after ${maxAttempts} attempts`);
      },

      getInstance: (sandbox: NorthflankSandboxHandle) => sandbox,

      filesystem: {
        readFile: async (sandbox: NorthflankSandboxHandle, path: string) => {
          const tmpDir = await fs.mkdtemp(joinPath(tmpdir(), 'cs-nf-'));
          try {
            await withExecRetry(
              () =>
                sandbox.api.fileCopy.downloadServiceFiles(
                  serviceParams(sandbox.config, sandbox.serviceId),
                  {
                    remotePath: path,
                    localPath: tmpDir,
                    ...(sandbox.instanceName ? { instanceName: sandbox.instanceName } : {}),
                  },
                ),
              { serviceId: sandbox.serviceId, timeoutMs: sandbox.timeout },
            );
            const local = joinPath(tmpDir, posix.basename(path));
            return await fs.readFile(local, 'utf8');
          } catch (error) {
            throw new Error(`File not found or cannot be read: ${path} (${error instanceof Error ? error.message : String(error)})`);
          } finally {
            await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
          }
        },

        writeFile: async (sandbox: NorthflankSandboxHandle, path: string, content: string) => {
          const parent = posix.dirname(path);
          if (parent && parent !== '/' && parent !== '.') {
            const mk = await execArgv(sandbox, ['mkdir', '-p', '--', parent]);
            if (mk.exitCode !== 0) {
              throw new Error(`Failed to write file: ${path} (mkdir parent failed: ${mk.stderr.trim()})`);
            }
          }
          const tmpDir = await fs.mkdtemp(joinPath(tmpdir(), 'cs-nf-'));
          const tmpFile = joinPath(tmpDir, posix.basename(path));
          try {
            await fs.writeFile(tmpFile, content, 'utf8');
            await withExecRetry(
              () =>
                sandbox.api.fileCopy.uploadServiceFiles(
                  serviceParams(sandbox.config, sandbox.serviceId),
                  {
                    localPath: tmpFile,
                    remotePath: path,
                    ...(sandbox.instanceName ? { instanceName: sandbox.instanceName } : {}),
                  },
                ),
              { serviceId: sandbox.serviceId, timeoutMs: sandbox.timeout },
            );
          } catch (error) {
            throw new Error(`Failed to write file: ${path} (${error instanceof Error ? error.message : String(error)})`);
          } finally {
            await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
          }
        },

        mkdir: async (sandbox: NorthflankSandboxHandle, path: string) => {
          const r = await execArgv(sandbox, ['mkdir', '-p', '--', path]);
          if (r.exitCode !== 0) throw new Error(`Failed to create directory: ${path}`);
        },

        readdir: async (sandbox: NorthflankSandboxHandle, path: string) => {
          const r = await execArgv(sandbox, ['ls', '-1Ap', '--', path]);
          if (r.exitCode !== 0) throw new Error(`Directory not found: ${path}`);

          return r.stdout
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .map(entry => {
              const isDir = entry.endsWith('/');
              const name = isDir ? entry.slice(0, -1) : entry;
              return {
                name,
                type: (isDir ? 'directory' : 'file') as 'directory' | 'file',
                size: 0,
                modified: new Date(),
              };
            });
        },

        exists: async (sandbox: NorthflankSandboxHandle, path: string) => {
          try {
            return (await execArgv(sandbox, ['test', '-e', path])).exitCode === 0;
          } catch {
            return false;
          }
        },

        remove: async (sandbox: NorthflankSandboxHandle, path: string) => {
          const r = await execArgv(sandbox, ['rm', '-rf', '--', path]);
          if (r.exitCode !== 0) throw new Error(`Failed to remove: ${path}`);
        },
      },
    },
  },
});

export const northflank = (config: NorthflankConfig) => createNorthflankProvider(config);

export type { NorthflankSandboxHandle };
