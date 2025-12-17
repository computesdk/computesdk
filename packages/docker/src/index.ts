import Docker from 'dockerode';
import { PassThrough } from 'stream';
import { createProvider } from 'computesdk';
import type {
  Runtime,
  CodeResult,
  CommandResult,
  RunCommandOptions,
  CreateSandboxOptions,
  SandboxInfo,
  FileEntry,
} from 'computesdk';

import { defaultDockerConfig } from './types/types';
import type {
  DockerConfig,
  DockerSandboxHandle,
  DockerImage,
  PortBindings,
} from './types/types';

const PROVIDER = 'docker' as const;
const LABEL_KEY = 'com.computesdk.sandbox';
const LABEL_RUNTIME = 'com.computesdk.runtime';
const KEEPALIVE_CMD = ['/bin/sh', '-c', 'while :; do sleep 3600; done'];

function pick<T>(val: T | undefined, fallback: T): T {
  return typeof val === 'undefined' ? fallback : val;
}

async function ensureImage(docker: Docker, image: DockerImage): Promise<void> {
  const policy = image.pullPolicy ?? 'ifNotPresent';
  if (policy === 'never') return;

  const images = await docker.listImages();
  const hasImage = images.some(img => (img.RepoTags || []).includes(image.name));

  if (policy === 'always' || (policy === 'ifNotPresent' && !hasImage)) {
    await new Promise<void>((resolve, reject) => {
      const cb = (err: any, stream?: NodeJS.ReadableStream) => {
        if (err) return reject(err);
        if (!stream) return reject(new Error('docker.pull returned no stream'));
        (docker as any).modem.followProgress(stream, (err2: any) => (err2 ? reject(err2) : resolve()));
      };
      if (image.auth) docker.pull(image.name, { authconfig: image.auth } as any, cb);
      else docker.pull(image.name, cb);
    });
  }
}

async function waitUntilRunning(container: Docker.Container, timeoutMs = 4000) {
  const start = Date.now();
  try {
    const s = await container.inspect();
    if (s.State?.Running) return;
  } catch { /* ignore */ }

  while (Date.now() - start < timeoutMs) {
    const s = await container.inspect();
    if (s.State?.Running) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Container did not reach Running state in time');
}

async function runExec(
  handle: DockerSandboxHandle,
  shellCommand: string,
  attachTTY = false
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  await waitUntilRunning(handle.container);

  const exec = await handle.container.exec({
    Cmd: ['/bin/sh', '-c', shellCommand],
    AttachStdout: true,
    AttachStderr: true,
    Tty: attachTTY,
  });

  const stream = (await exec.start({ hijack: true, stdin: false })) as NodeJS.ReadableStream;

  let stdout = '';
  let stderr = '';

  await new Promise<void>((resolve, reject) => {
    if (attachTTY) {
      stream.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
      stream.on('end', resolve);
      stream.on('error', reject);
      return;
    }
    const out = new PassThrough();
    const err = new PassThrough();
    out.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    err.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    (handle.docker as any).modem.demuxStream(stream as any, out as any, err as any);
    stream.on('end', resolve);
    stream.on('error', reject);
  });

  const inspect = await exec.inspect();
  const exitCode = inspect.ExitCode ?? 0;
  return { stdout, stderr, exitCode };
}

function toHostBindings(ports?: PortBindings) {
  if (!ports) return undefined;
  const exposed: Record<string, {}> = {};
  const bindings: Record<string, Array<{ HostPort?: string; HostIp?: string }>> = {};
  for (const key of Object.keys(ports)) {
    exposed[key] = {};
    bindings[key] = (ports as any)[key].map((p: any) => ({
      HostPort: p.hostPort ? String(p.hostPort) : undefined,
      HostIp: p.hostIP,
    }));
  }
  return { ExposedPorts: exposed, PortBindings: bindings };
}

function dockerHostNameFromEnv(): string {
  const hostEnv = process.env.DOCKER_HOST;
  if (hostEnv?.startsWith('tcp://')) {
    try {
      const u = new URL(hostEnv);
      return u.hostname || 'localhost';
    } catch { /* noop */ }
  }
  return 'localhost';
}

function pickImageForRuntime(runtime: Runtime, configured?: DockerImage): DockerImage {
  // If user supplied an image that already matches, use it. Otherwise pick a sensible default.
  if (configured?.name) {
    if (runtime === 'python' && /python|conda|pypy/i.test(configured.name)) return configured;
    if (runtime === 'node' && /node/i.test(configured.name)) return configured;
  }
  return {
    name: runtime === 'python' ? 'python:3.11-slim' : 'node:20-alpine',
    pullPolicy: configured?.pullPolicy ?? 'ifNotPresent',
    auth: configured?.auth,
  };
}

export const docker = createProvider<DockerSandboxHandle, DockerConfig>({
  name: PROVIDER,
  methods: {
    sandbox: {
      create: async (config: DockerConfig, options?: CreateSandboxOptions) => {
        const cfg: DockerConfig = { ...defaultDockerConfig, ...config };
        const effectiveRuntime: Runtime = (options?.runtime ?? cfg.runtime ?? 'python') as Runtime;

        if (effectiveRuntime !== 'python' && effectiveRuntime !== 'node') {
          throw new Error(`Docker provider supports only 'python' or 'node'. Received: ${String(effectiveRuntime)}`);
        }

        const docker = new Docker(cfg.connection as any);

        // Reattach?
        if (options?.sandboxId) {
          try {
            const container = docker.getContainer(options.sandboxId);
            const info = await container.inspect();
            return {
              sandbox: <DockerSandboxHandle>{
                docker,
                container,
                containerId: options.sandboxId,
                image: info.Config?.Image ?? cfg.image.name,
                createdAt: new Date(info.Created || Date.now()),
              },
              sandboxId: options.sandboxId,
            };
          } catch (err) {
            // Failed to reattach to existing container; will create a new one.
            console.warn(`Could not reattach to Docker container with ID ${options.sandboxId}:`, err);
          }
        }

        // Choose image based on runtime if needed
        const chosenImage = pickImageForRuntime(effectiveRuntime, cfg.image);
        await ensureImage(docker, chosenImage);

        // Build container create options
        const hb = toHostBindings(cfg.container?.ports);
        const createOptions = {
          Image: chosenImage.name,
          Tty: pick(cfg.container?.tty, false),
          OpenStdin: pick(cfg.container?.openStdin, false),
          Labels: { [LABEL_KEY]: 'true', [LABEL_RUNTIME]: effectiveRuntime }, // <-- store runtime per sandbox
          WorkingDir: cfg.container?.workdir,
          Env: cfg.container?.env
            ? Object.entries(cfg.container.env).map(([k, v]) => `${k}=${v}`)
            : undefined,
          Cmd: KEEPALIVE_CMD, // keep container alive
          HostConfig: {
            AutoRemove: cfg.container?.autoRemove ?? false, // keep around for exec/FS ops
            Binds: cfg.container?.binds,
            NetworkMode: cfg.container?.networkMode,
            Privileged: cfg.container?.privileged,
            CapAdd: cfg.container?.capabilities?.add,
            CapDrop: cfg.container?.capabilities?.drop,
            LogConfig: cfg.container?.logDriver
              ? { Type: cfg.container.logDriver, Config: cfg.container.logOpts || {} }
              : undefined,
            Resources: cfg.container?.resources,
            DeviceRequests: cfg.container?.gpus
              ? [
                {
                  Driver: 'nvidia',
                  Count:
                    cfg.container.gpus === 'all'
                      ? -1
                      : typeof cfg.container.gpus === 'number'
                        ? cfg.container.gpus
                        : 1,
                  DeviceIDs:
                    typeof cfg.container.gpus === 'string' && cfg.container.gpus !== 'all'
                      ? [String(cfg.container.gpus)]
                      : undefined,
                  Capabilities: [['gpu']],
                },
              ]
              : undefined,
            ...(hb ? { PortBindings: hb.PortBindings } : {}),
          },
          ...(hb ? { ExposedPorts: hb.ExposedPorts } : {}),
          ...(cfg.createOptions || {}),
        } as import('dockerode').ContainerCreateOptions;

        const container = await docker.createContainer(createOptions);
        await container.start(cfg.startOptions || {});
        await waitUntilRunning(container);

        const inspect = await container.inspect();
        const handle: DockerSandboxHandle = {
          docker,
          container,
          containerId: inspect.Id,
          image: inspect.Config?.Image ?? chosenImage.name,
          createdAt: new Date(inspect.Created || Date.now()),
        };

        return { sandbox: handle, sandboxId: handle.containerId };
      },

      getById: async (config: DockerConfig, sandboxId: string) => {
        const docker = new Docker((config || defaultDockerConfig).connection as any);
        try {
          const container = docker.getContainer(sandboxId);
          const info = await container.inspect();
          return {
            sandbox: <DockerSandboxHandle>{
              docker,
              container,
              containerId: sandboxId,
              image: info.Config?.Image ?? '',
              createdAt: new Date(info.Created || Date.now()),
            },
            sandboxId,
          };
        } catch {
          return null;
        }
      },

      list: async (config: DockerConfig) => {
        const docker = new Docker((config || defaultDockerConfig).connection as any);
        try {
          const items = await docker.listContainers({
            all: true,
            filters: { label: [LABEL_KEY] } as any,
          });
          return items.map(ci => ({
            sandbox: <DockerSandboxHandle>{
              docker,
              container: docker.getContainer(ci.Id),
              containerId: ci.Id,
              image: ci.Image,
              createdAt: new Date((ci as any).Created * 1000),
            },
            sandboxId: ci.Id,
          }));
        } catch {
          return [];
        }
      },

      destroy: async (config: DockerConfig, sandboxId: string) => {
        const docker = new Docker((config || defaultDockerConfig).connection as any);
        try {
          const c = docker.getContainer(sandboxId);
          try { await c.stop({ t: 5 } as any); } catch { /* stopped */ }
          await c.remove({ force: true });
        } catch {
          // ok if already gone
        }
      },

      runCode: async (handle: DockerSandboxHandle, code: string, runtime?: Runtime): Promise<CodeResult> => {
        const start = Date.now();

        // Resolve runtime: param → label → error
        let rt: Runtime | undefined = runtime;
        if (!rt) {
          const info = await handle.container.inspect();
          rt = (info.Config?.Labels?.[LABEL_RUNTIME] as Runtime) || undefined;
        }
        if (rt !== 'python' && rt !== 'node') {
          throw new Error(`Docker runtime must be 'python' or 'node'. Pass runtime in config or as a parameter.`);
        }

        // Write to file, then execute. This is robust on Alpine/Debian.
        const tmpFile = rt === 'python' ? '/tmp/compute_code.py' : '/tmp/compute_code.js';
        const b64 = Buffer.from(code, 'utf8').toString('base64');
        const makeAndRun =
          `printf '%s' "${b64}" | base64 -d > ${tmpFile} && ` +
          (rt === 'python' ? `python3 ${tmpFile}` : `node ${tmpFile}`);

        const { stdout, stderr, exitCode } = await runExec(handle, makeAndRun);

        if (exitCode !== 0 && stderr) {
          // Throw ONLY on syntax errors (SDK contract)
          const isSyntax =
            stderr.includes('SyntaxError') ||
            stderr.includes('invalid syntax') ||
            stderr.includes('Unexpected token') ||
            stderr.includes('Unexpected identifier');
          if (isSyntax) {
            const last = stderr.trim().split('\n').slice(-1)[0] || 'Syntax error';
            throw new Error(`Syntax error: ${last}`);
          }
        }

        return {
          output: stdout + stderr,
          exitCode,
          language: rt,
        };
      },

      runCommand: async (
        handle: DockerSandboxHandle,
        command: string,
        args: string[] = []
      ): Promise<CommandResult> => {
        const start = Date.now();
        const shell = args.length ? `${command} ${args.join(' ')}` : command;

        const { stdout, stderr, exitCode } = await runExec(handle, shell);

        return {
          stdout,
          stderr,
          exitCode,
          durationMs: Date.now() - start,
        };
      },

      getInfo: async (handle: DockerSandboxHandle): Promise<SandboxInfo> => {
        const info = await handle.container.inspect();
        const state = info.State || {};
        return {
          id: handle.containerId,
          provider: PROVIDER,
          runtime: (info.Config?.Labels?.[LABEL_RUNTIME] as Runtime) || 'python',
          status: state.Running ? 'running' : 'stopped',
          createdAt: new Date(info.Created || handle.createdAt),
          timeout: 300000,
          metadata: {
            image: info.Config?.Image,
            name: info.Name,
          },
        };
      },

      getUrl: async (handle: DockerSandboxHandle, options: { port: number; protocol?: string }): Promise<string> => {
        const info = await handle.container.inspect();
        const protocol = options.protocol || 'http';
        const portKeyTcp = `${options.port}/tcp`;

        const ports = info.NetworkSettings?.Ports || {};
        const bindings = ports[portKeyTcp] || ports[`${options.port}/udp`] || [];

        let host = dockerHostNameFromEnv();
        let hostPort = String(options.port);

        if (Array.isArray(bindings) && bindings.length > 0) {
          hostPort = bindings[0].HostPort || hostPort;
        } else {
          const ip =
            info.NetworkSettings?.IPAddress ||
            Object.values(info.NetworkSettings?.Networks || {})[0]?.IPAddress;
          if (ip) host = ip;
        }

        return `${protocol}://${host}:${hostPort}`;
      },

      filesystem: {
        readFile: async (handle: DockerSandboxHandle, path: string): Promise<string> => {
          const cmd = `if [ -f ${JSON.stringify(path)} ]; then base64 ${JSON.stringify(path)} | tr -d '\\n'; else exit 1; fi`;
          const { stdout, exitCode, stderr } = await runExec(handle, cmd);
          if (exitCode !== 0) throw new Error(stderr || `File not found: ${path}`);
          return Buffer.from(stdout, 'base64').toString('utf8');
        },

        writeFile: async (handle: DockerSandboxHandle, path: string, content: string): Promise<void> => {
          const b64 = Buffer.from(content, 'utf8').toString('base64');
          const cmd = `mkdir -p $(dirname ${JSON.stringify(path)}) && echo "${b64}" | base64 -d > ${JSON.stringify(path)}`;
          const { exitCode, stderr } = await runExec(handle, cmd);
          if (exitCode !== 0) throw new Error(stderr || `Failed to write: ${path}`);
        },

        mkdir: async (handle: DockerSandboxHandle, path: string): Promise<void> => {
          const { exitCode, stderr } = await runExec(handle, `mkdir -p ${JSON.stringify(path)}`);
          if (exitCode !== 0) throw new Error(stderr || `Failed to mkdir: ${path}`);
        },

        readdir: async (handle: DockerSandboxHandle, path: string): Promise<FileEntry[]> => {
          const { stdout, exitCode, stderr } = await runExec(
            handle,
            `if [ -d ${JSON.stringify(path)} ]; then ls -la ${JSON.stringify(path)}; else exit 1; fi`
          );
          if (exitCode !== 0) throw new Error(stderr || `Not a directory: ${path}`);

          const lines = stdout.split('\n').slice(1);
          const entries: FileEntry[] = [];
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 9) continue;
            const name = parts.slice(8).join(' ');
            if (name === '.' || name === '..') continue;
            const isDir = parts[0].startsWith('d');
            const size = Number(parts[4]) || 0;
            entries.push({
              name,
              path: `${path.replace(/\/$/, '')}/${name}`,
              isDirectory: isDir,
              size,
              lastModified: new Date(),
            });
          }
          return entries;
        },

        exists: async (handle: DockerSandboxHandle, path: string): Promise<boolean> => {
          const { exitCode } = await runExec(handle, `test -e ${JSON.stringify(path)}`);
          return exitCode === 0;
        },

        remove: async (handle: DockerSandboxHandle, path: string): Promise<void> => {
          const { exitCode, stderr } = await runExec(handle, `rm -rf ${JSON.stringify(path)}`);
          if (exitCode !== 0) throw new Error(stderr || `Failed to remove: ${path}`);
        },
      },

      getInstance: (handle: DockerSandboxHandle): DockerSandboxHandle => handle,
    },
  },
});

