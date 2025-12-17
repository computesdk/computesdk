import type Docker from 'dockerode';
import type {
  DockerOptions,
  Container,
  ContainerCreateOptions,
  ContainerStartOptions,
  ContainerInspectInfo,
  ContainerInfo,
  Exec,
  ImageInfo,
  ImageBuildOptions,
  Network,
} from 'dockerode';

import type {
  Runtime,
  FileEntry,
  ExecutionResult,
  RunCommandOptions,
  CreateSandboxOptions,
  SandboxInfo,
} from 'computesdk';

/** When the provider should clean up containers it created */
export type CleanupPolicy = 'always' | 'onSuccess' | 'never';

/** Image pull strategy */
export type PullPolicy = 'always' | 'ifNotPresent' | 'never';

/** Connection to the Docker daemon (exactly what dockerode accepts) */
export type DockerConnection = DockerOptions;

/** Auth when pulling private images (Engine API AuthConfig shape) */
export interface RegistryAuth {
  username?: string;
  password?: string;
  serveraddress?: string;
  identitytoken?: string;
  registrytoken?: string;
}

/** Default image & pull policy for sandboxes */
export interface DockerImage {
  name: string;            // e.g. 'python:3.11-slim'
  pullPolicy?: PullPolicy; // default: 'ifNotPresent'
  auth?: RegistryAuth;
}

/** Convenience shape for port bindings */
export type PortBindings = Record<
  `${number}/${'tcp' | 'udp'}`,
  Array<{ hostPort?: number; hostIP?: string }>
>;

/** Subset of HostConfig resources & knobs that are commonly used */
export interface ResourceLimits {
  cpuShares?: number;
  cpuQuota?: number;
  cpuPeriod?: number;
  nanoCPUs?: number;
  memory?: number;
  memorySwap?: number;
  pidsLimit?: number;
}

/** Declarative container defaults that we’ll translate into dockerode create options */
export interface ContainerDefaults {
  user?: string;
  workdir?: string;
  env?: Record<string, string>;
  binds?: string[];
  ports?: PortBindings;
  networkMode?: string;
  privileged?: boolean;
  capabilities?: { add?: string[]; drop?: string[] };
  gpus?: 'all' | number | string;
  resources?: ResourceLimits;
  logDriver?: string;
  logOpts?: Record<string, string>;
  autoRemove?: boolean;
  tty?: boolean;
  openStdin?: boolean;
}

/** Provider-level configuration for Docker */
export interface DockerConfig {
  connection?: DockerConnection;
  runtime?: Runtime; // 'python' | 'node'
  timeout?: number;
  image: DockerImage;
  container?: ContainerDefaults;
  createOptions?: ContainerCreateOptions;
  startOptions?: ContainerStartOptions;
  cleanup?: CleanupPolicy;
  streamLogs?: boolean;
}

/** What we keep for each running sandbox */
export interface DockerSandboxHandle {
  docker: Docker;
  container: Container;
  containerId: string;
  image: string;
  createdAt: Date;
}

/** URL options for port-forwarded services */
export interface DockerUrlOptions {
  port: number;
  protocol?: 'http' | 'https';
  host?: string;
}

/** Optional FS helpers you might expose */
export interface DockerSandboxFileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  readdir(path: string): Promise<FileEntry[]>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
}

/** Sensible, safe defaults */
export const defaultDockerConfig: DockerConfig = {
  connection: {
    // Let dockerode fall back to DOCKER_HOST or /var/run/docker.sock
    timeout: 60_000,
    version: 'v1.43',
  },
  runtime: 'python',
  timeout: 300_000, // 5 minutes
  image: {
    name: 'python:3.11-slim',
    pullPolicy: 'ifNotPresent',
  },
  container: {
    workdir: '/workspace',
    env: {},
    autoRemove: false, // Keep container around for exec/FS/background
    tty: false,        // Non-tty so we can demux stdout/stderr
    openStdin: false,
    resources: { memory: 512 * 1024 * 1024 },
  },
  cleanup: 'always',
  streamLogs: false,
};

/** Re-exports for convenience */
export type {
  Docker,
  Container,
  Exec,
  ContainerCreateOptions,
  ContainerStartOptions,
  ContainerInspectInfo,
  ContainerInfo,
  ImageInfo,
  ImageBuildOptions,
  Network,
};
