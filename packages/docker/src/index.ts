import Docker from 'dockerode';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'stream';
import { defineProvider } from '@computesdk/provider';
import type {
  CommandResult,
  RunCommandOptions,
  CreateSandboxOptions,
  SandboxInfo,
  FileEntry,
  Volume,
  CreateVolumeOptions,
  ListVolumesOptions,
} from '@computesdk/provider';

import { defaultDockerConfig } from './types/types';
import type {
  DockerConfig,
  DockerSandboxHandle,
  DockerImage,
  PortBindings,
} from './types/types';

const PROVIDER = 'docker' as const;
const LABEL_KEY = 'com.computesdk.sandbox';
const LABEL_VOLUME = 'com.computesdk.volume';
const LABEL_RUNTIME = 'com.computesdk.runtime';
const KEEPALIVE_CMD = ['/bin/sh', '-c', 'while :; do sleep 3600; done'];

function pick<T>(val: T | undefined, fallback: T): T {
  return typeof val === 'undefined' ? fallback : val;
}

function volumeInfoToVolume(info: import('dockerode').VolumeInspectInfo): Volume {
  return {
    id: info.Name,
    provider: PROVIDER,
    name: info.Name,
    createdAt: new Date(),
    size: info.UsageData?.Size ? Math.ceil(info.UsageData.Size / (1024 * 1024)) : undefined,
    metadata: { driver: info.Driver, scope: info.Scope, labels: info.Labels },
    native: info,
  };
}

function isNotFoundError(error: any): boolean {
  return error?.statusCode === 404 || (typeof error?.message === 'string' && /not found|no such volume|404/i.test(error.message));
}

function isComputeVolume(info: import('dockerode').VolumeInspectInfo): boolean {
  return info.Labels?.[LABEL_VOLUME] === 'true';
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
  return { stdout, stderr, exitCode: inspect.ExitCode ?? 0 };
}

function toHostBindings(ports?: PortBindings) {
  if (!ports) return undefined;
  const exposed: Record<string, {}> = {};
  const bindings: Record<string, Array<{ HostPort?: string; HostIp?: string }>> = {};
  for (const key of Object.keys(ports)) {
    exposed[key] = {};
    bindings[key] = (ports as any)[key].map((p: any) => ({ HostPort: p.hostPort ? String(p.hostPort) : undefined, HostIp: p.hostIP }));
  }
  return { ExposedPorts: exposed, PortBindings: bindings };
}

function dockerHostNameFromEnv(): string {
  const hostEnv = process.env.DOCKER_HOST;
  if (hostEnv?.startsWith('tcp://')) {
    try { return new URL(hostEnv).hostname || 'localhost'; } catch { /* noop */ }
  }
  return 'localhost';
}

function pickImageForRuntime(runtime: string, configured?: DockerImage): DockerImage {
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

export const docker = defineProvider<DockerSandboxHandle, DockerConfig>({
  name: PROVIDER,
  methods: {
    sandbox: {
      create: async (config: DockerConfig, options?: CreateSandboxOptions) => {
        const cfg: DockerConfig = { ...defaultDockerConfig, ...config };
        const effectiveRuntime: string = ((options as any)?.runtime ?? cfg.runtime ?? 'python') as string;

        if (effectiveRuntime !== 'python' && effectiveRuntime !== 'node') {
          throw new Error(`Docker provider supports only 'python' or 'node'. Received: ${String(effectiveRuntime)}`);
        }

        const docker = new Docker(cfg.connection as any);
        const chosenImage = pickImageForRuntime(effectiveRuntime, cfg.image);
        await ensureImage(docker, chosenImage);

        const mergedEnv = { ...cfg.container?.env, ...options?.envs };
        const hb = toHostBindings(cfg.container?.ports);
        const { HostConfig: userHostConfigRaw, ...userCreateRest } = cfg.createOptions || {};
        const userHostConfig = userHostConfigRaw || {};
        const volumeBinds: string[] = [];
        if (options?.volumeIds) {
          for (let i = 0; i < options.volumeIds.length; i++) {
            volumeBinds.push(`${options.volumeIds[i]}:/mnt/volume-${i}`);
          }
        }

        const baseBinds = [...(cfg.container?.binds || []), ...(userHostConfig.Binds || []), ...volumeBinds];
        const bindByTarget = new Map<string, string>();
        for (const bind of baseBinds) {
          const parts = bind.split(':');
          if (parts.length >= 2) bindByTarget.set(parts[1], bind);
        }
        const finalBinds = Array.from(bindByTarget.values());

        const baseHostConfig = {
          AutoRemove: cfg.container?.autoRemove ?? false,
          Binds: finalBinds.length > 0 ? finalBinds : undefined,
          NetworkMode: cfg.container?.networkMode,
          Privileged: cfg.container?.privileged,
          CapAdd: cfg.container?.capabilities?.add,
          CapDrop: cfg.container?.capabilities?.drop,
          LogConfig: cfg.container?.logDriver
            ? { Type: cfg.container.logDriver, Config: cfg.container.logOpts || {} }
            : undefined,
          Resources: cfg.container?.resources,
          DeviceRequests: cfg.container?.gpus ? [{
            Driver: 'nvidia',
            Count: cfg.container.gpus === 'all' ? -1 : typeof cfg.container.gpus === 'number' ? cfg.container.gpus : 1,
            DeviceIDs: typeof cfg.container.gpus === 'string' && cfg.container.gpus !== 'all' ? [String(cfg.container.gpus)] : undefined,
            Capabilities: [['gpu']],
          }] : undefined,
          ...(hb ? { PortBindings: hb.PortBindings } : {}),
        };

        const createOptions = {
          Image: chosenImage.name,
          Tty: pick(cfg.container?.tty, false),
          OpenStdin: pick(cfg.container?.openStdin, false),
          Labels: {
            ...(options?.metadata ? Object.fromEntries(
              Object.entries(options.metadata).map(([k, v]) => [`com.computesdk.meta.${k}`, typeof v === 'string' ? v : JSON.stringify(v)])
            ) : {}),
            [LABEL_KEY]: 'true',
            [LABEL_RUNTIME]: effectiveRuntime,
          },
          WorkingDir: cfg.container?.workdir,
          Env: Object.keys(mergedEnv).length > 0
            ? Object.entries(mergedEnv).map(([k, v]) => `${k}=${v}`)
            : undefined,
          Cmd: KEEPALIVE_CMD,
          HostConfig: {
            ...baseHostConfig,
            ...userHostConfig,
            Binds: finalBinds.length > 0 ? finalBinds : undefined,
            PortBindings: { ...baseHostConfig.PortBindings, ...userHostConfig.PortBindings },
          },
          ...(hb ? { ExposedPorts: hb.ExposedPorts } : {}),
          ...userCreateRest,
        } as import('dockerode').ContainerCreateOptions;

        const container = await docker.createContainer(createOptions);
        await container.start(cfg.startOptions || {});
        await waitUntilRunning(container);
        const inspect = await container.inspect();
        const handle: DockerSandboxHandle = {
          docker, container, containerId: inspect.Id,
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
          return { sandbox: { docker, container, containerId: sandboxId, image: info.Config?.Image ?? '', createdAt: new Date(info.Created || Date.now()) } as DockerSandboxHandle, sandboxId };
        } catch { return null; }
      },

      list: async (config: DockerConfig) => {
        const docker = new Docker((config || defaultDockerConfig).connection as any);
        try {
          const items = await docker.listContainers({ all: true, filters: { label: [LABEL_KEY] } as any });
          return items.map(ci => ({
            sandbox: { docker, container: docker.getContainer(ci.Id), containerId: ci.Id, image: ci.Image, createdAt: new Date((ci as any).Created * 1000) } as DockerSandboxHandle,
            sandboxId: ci.Id,
          }));
        } catch { return []; }
      },

      destroy: async (config: DockerConfig, sandboxId: string) => {
        const docker = new Docker((config || defaultDockerConfig).connection as any);
        try {
          const c = docker.getContainer(sandboxId);
          try { await c.stop({ t: 5 } as any); } catch { /* stopped */ }
          await c.remove({ force: true });
        } catch { /* ok if already gone */ }
      },

      runCommand: async (handle: DockerSandboxHandle, command: string, _options?: RunCommandOptions): Promise<CommandResult> => {
        const start = Date.now();
        const { stdout, stderr, exitCode } = await runExec(handle, command);
        return { stdout, stderr, exitCode, durationMs: Date.now() - start };
      },

      getInfo: async (handle: DockerSandboxHandle): Promise<SandboxInfo> => {
        const info = await handle.container.inspect();
        const state = info.State || {};
        return {
          id: handle.containerId,
          provider: PROVIDER,
          status: state.Running ? 'running' : 'stopped',
          createdAt: new Date(info.Created || handle.createdAt),
          timeout: 300000,
          metadata: {
            image: info.Config?.Image,
            name: info.Name,
            runtime: info.Config?.Labels?.[LABEL_RUNTIME],
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
          const ip = info.NetworkSettings?.IPAddress || Object.values(info.NetworkSettings?.Networks || {})[0]?.IPAddress;
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
          const { stdout, exitCode, stderr } = await runExec(handle, `if [ -d ${JSON.stringify(path)} ]; then ls -la ${JSON.stringify(path)}; else exit 1; fi`);
          if (exitCode !== 0) throw new Error(stderr || `Not a directory: ${path}`);
          const lines = stdout.split('\n').slice(1);
          const entries: FileEntry[] = [];
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 9) continue;
            const name = parts.slice(8).join(' ');
            if (name === '.' || name === '..') continue;
            entries.push({ name, type: parts[0].startsWith('d') ? 'directory' as const : 'file' as const, size: Number(parts[4]) || 0, modified: new Date() });
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

    volume: {
      create: async (config: DockerConfig, options?: CreateVolumeOptions): Promise<Volume> => {
        const cfg: DockerConfig = { ...defaultDockerConfig, ...config };
        const docker = new Docker(cfg.connection as any);
        const name = options?.name || `computesdk-volume-${randomUUID()}`;

        const driver = options?.metadata?.driver as string | undefined;
        const driverOpts = options?.metadata?.driverOpts as Record<string, string> | undefined;
        const labels: Record<string, string> = { [LABEL_VOLUME]: 'true' };
        if (options?.metadata) {
          for (const [k, v] of Object.entries(options.metadata)) {
            if (k === 'driver' || k === 'driverOpts') continue;
            labels[`com.computesdk.meta.${k}`] = typeof v === 'string' ? v : JSON.stringify(v);
          }
        }

        const created = await docker.createVolume({
          Name: name,
          Labels: labels,
          Driver: driver,
          DriverOpts: driverOpts,
        } as import('dockerode').VolumeCreateOptions);
        const info = await docker.getVolume(created.Name).inspect();
        return volumeInfoToVolume(info);
      },
      list: async (config: DockerConfig, _options?: ListVolumesOptions): Promise<Volume[]> => {
        const cfg: DockerConfig = { ...defaultDockerConfig, ...config };
        const docker = new Docker(cfg.connection as any);
        const result = await docker.listVolumes();
        return (result.Volumes || [])
          .filter((info) => isComputeVolume(info))
          .map(volumeInfoToVolume);
      },
      getById: async (config: DockerConfig, volumeId: string): Promise<Volume | null> => {
        const cfg: DockerConfig = { ...defaultDockerConfig, ...config };
        const docker = new Docker(cfg.connection as any);
        try {
          const info = await docker.getVolume(volumeId).inspect();
          if (!isComputeVolume(info)) return null;
          return volumeInfoToVolume(info);
        } catch (error) {
          if (isNotFoundError(error)) return null;
          throw error;
        }
      },
      delete: async (config: DockerConfig, volumeId: string): Promise<void> => {
        const cfg: DockerConfig = { ...defaultDockerConfig, ...config };
        const docker = new Docker(cfg.connection as any);
        try {
          const info = await docker.getVolume(volumeId).inspect();
          if (!isComputeVolume(info)) throw new Error(`Volume ${volumeId} is not a ComputeSDK-managed Docker volume`);
          await docker.getVolume(volumeId).remove({ force: true } as import('dockerode').VolumeRemoveOptions);
        } catch (error) {
          if (isNotFoundError(error)) return;
          throw error;
        }
      },
    },
  },
});
