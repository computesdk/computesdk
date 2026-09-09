import { randomUUID } from 'node:crypto';
import { PassThrough } from 'stream';
import {
  KubeConfig,
  CoreV1Api,
  Exec,
  type V1Pod,
  type V1PersistentVolumeClaim,
  type V1Volume,
  type V1VolumeMount,
} from '@kubernetes/client-node';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type {
  CommandResult,
  SandboxInfo,
  CreateSandboxOptions,
  RunCommandOptions,
  Volume,
  CreateVolumeOptions,
  ListVolumesOptions,
  AttachVolumeOptions,
} from '@computesdk/provider';

const PROVIDER = 'k8s' as const;
const LABEL_MANAGED = 'computesdk.io/managed';
const LABEL_RUNTIME = 'computesdk.io/runtime';
const LABEL_SID = 'computesdk.io/sandbox-id';
type Runtime = 'node' | 'python';

export interface K8sConfig {
  kubeConfigPath?: string;
  kubeConfigRaw?: string;
  context?: string;
  namespace?: string;
  image?: string;
  runtime?: Runtime;
  timeout?: number;
  podNamePrefix?: string;
  urlTemplate?: string;
}

interface K8sSandboxHandle {
  podName: string;
  namespace: string;
  runtime: Runtime;
  createdAt: Date;
  timeout: number;
  kubeConfigPath?: string;
  context?: string;
  urlTemplate?: string;
}

const rawKubeConfigBySandboxId = new Map<string, string>();

type KubeConfigSource =
  | { type: 'raw'; value: string }
  | { type: 'env'; value: string }
  | { type: 'path'; value: string }
  | { type: 'default' };

export function resolveKubeConfigSource(config: K8sConfig, env: NodeJS.ProcessEnv = process.env): KubeConfigSource {
  if (config.kubeConfigRaw) {
    return { type: 'raw', value: config.kubeConfigRaw };
  }

  if (env.KUBECONFIG_B64) {
    return { type: 'env', value: Buffer.from(env.KUBECONFIG_B64, 'base64').toString('utf8') };
  }

  if (config.kubeConfigPath) {
    return { type: 'path', value: config.kubeConfigPath };
  }

  return { type: 'default' };
}

function loadKubeConfig(config: K8sConfig): KubeConfig {
  const kc = new KubeConfig();

  const source = resolveKubeConfigSource(config);
  if (source.type === 'raw' || source.type === 'env') {
    kc.loadFromString(source.value);
  } else if (source.type === 'path') {
    kc.loadFromFile(source.value);
  } else {
    kc.loadFromDefault();
  }

  if (config.context) kc.setCurrentContext(config.context);
  return kc;
}

function getNamespace(config: K8sConfig, options?: CreateSandboxOptions): string {
  return options?.namespace || config.namespace || 'default';
}

function parseRuntime(runtime: unknown): Runtime {
  if (runtime === 'node' || runtime === 'python') return runtime;
  throw new Error(`Unsupported runtime '${String(runtime)}' for k8s provider. Supported runtimes: node, python.`);
}

function isValidEnvKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}

function imageForRuntime(runtime: Runtime, configured?: string): string {
  if (configured) return configured;
  return runtime === 'python' ? 'python:3.11-slim' : 'node:20-alpine';
}

function serviceNameForPod(podName: string): string {
  return `${podName}-svc`;
}

function getPodName(handle: K8sSandboxHandle): string {
  return handle.podName.includes('/') ? handle.podName.split('/', 2)[1] : handle.podName;
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const err = error as { statusCode?: number; code?: number };
  return err.statusCode === 404 || err.code === 404;
}

function parseVolumeId(volumeId: string, configNamespace: string): { namespace: string; name: string } {
  if (volumeId.includes('/')) {
    const [namespace, name] = volumeId.split('/', 2);
    return { namespace, name };
  }
  return { namespace: configNamespace, name: volumeId };
}

function storageQuantityToMB(quantity: string | undefined): number | undefined {
  if (!quantity) return undefined;
  const match = quantity.match(/^([0-9.]+)\s*([A-Za-z]*)$/);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]);
  if (Number.isNaN(value)) return undefined;
  const suffix = match[2] || '';
  const bytesPerUnit: Record<string, number> = {
    '': 1,
    'B': 1,
    'Ki': 1024,
    'Mi': 1024 * 1024,
    'Gi': 1024 * 1024 * 1024,
    'Ti': 1024 * 1024 * 1024 * 1024,
    'Pi': 1024 * 1024 * 1024 * 1024 * 1024,
    'K': 1000,
    'M': 1000 * 1000,
    'G': 1000 * 1000 * 1000,
    'T': 1000 * 1000 * 1000 * 1000,
    'P': 1000 * 1000 * 1000 * 1000 * 1000,
  };
  const bytes = value * (bytesPerUnit[suffix] ?? 1);
  return Math.ceil(bytes / (1024 * 1024));
}

function pvcToVolume(pvc: V1PersistentVolumeClaim, namespace: string): Volume {
  const storage = pvc.status?.capacity?.storage;
  return {
    id: `${namespace}/${pvc.metadata?.name || ''}`,
    provider: PROVIDER,
    name: pvc.metadata?.name,
    createdAt: pvc.metadata?.creationTimestamp || new Date(),
    size: storageQuantityToMB(storage),
    metadata: {
      namespace,
      phase: pvc.status?.phase,
      accessModes: pvc.spec?.accessModes,
      storageClassName: pvc.spec?.storageClassName,
    },
    native: pvc,
  };
}

async function waitForPodRunning(core: CoreV1Api, namespace: string, podName: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pod = await core.readNamespacedPod({ name: podName, namespace });
    const phase = pod.status?.phase;
    if (phase === 'Running') return;
    if (phase === 'Failed' || phase === 'Unknown') {
      throw new Error(`Pod ${namespace}/${podName} entered ${phase} state`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for pod ${namespace}/${podName} to become Running`);
}

async function execInPod(
  kc: KubeConfig,
  namespace: string,
  podName: string,
  command: string,
): Promise<{ stdout: string; stderr: string }> {
  const exec = new Exec(kc);
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = '';
  let err = '';

  stdout.on('data', chunk => {
    out += chunk.toString('utf8');
  });
  stderr.on('data', chunk => {
    err += chunk.toString('utf8');
  });

  await new Promise<void>((resolve, reject) => {
    exec.exec(
      namespace,
      podName,
      'sandbox',
      ['/bin/sh', '-c', command],
      stdout,
      stderr,
      null,
      false,
      (status) => {
        if (status?.status === 'Success') {
          resolve();
        } else {
          resolve();
        }
      },
    ).catch(reject);
  });

  await new Promise(r => setTimeout(r, 25));

  return { stdout: out, stderr: err };
}

function loadKubeConfigFromHandle(sandbox: K8sSandboxHandle): KubeConfig {
  const sandboxId = sandbox.podName;
  return loadKubeConfig({
    kubeConfigPath: sandbox.kubeConfigPath,
    kubeConfigRaw: rawKubeConfigBySandboxId.get(sandboxId),
    context: sandbox.context,
  });
}

function withCommandOptions(command: string, options?: RunCommandOptions): string {
  let full = command;
  if (options?.cwd) {
    full = `cd "${escapeShellArg(options.cwd)}" && ${full}`;
  }
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
  return full;
}

function parseExitCode(stdout: string, stderr: string): { stdout: string; stderr: string; exitCode: number } {
  const marker = '__COMPUTESDK_EXIT_CODE__=';
  const parse = (text: string) => {
    const idx = text.lastIndexOf(marker);
    if (idx < 0) return null;
    const before = text.slice(0, idx).replace(/\n$/, '');
    const token = text.slice(idx + marker.length).trim().split(/\s+/)[0] || '1';
    const parsed = Number.parseInt(token, 10);
    return { before, code: Number.isNaN(parsed) ? 1 : parsed };
  };

  const outParsed = parse(stdout);
  if (outParsed) {
    return { stdout: outParsed.before, stderr, exitCode: outParsed.code };
  }

  const errParsed = parse(stderr);
  if (errParsed) {
    return { stdout, stderr: errParsed.before, exitCode: errParsed.code };
  }

  return { stdout, stderr, exitCode: stderr.trim().length > 0 ? 1 : 0 };
}

const createK8sProvider = defineProvider<K8sSandboxHandle, K8sConfig>({
  name: PROVIDER,
  methods: {
    sandbox: {
      create: async (config: K8sConfig, options?: CreateSandboxOptions) => {
        const namespace = getNamespace(config, options);
        const runtime = parseRuntime(options?.runtime || config.runtime || 'node');
        const timeout = options?.timeout ?? config.timeout ?? 120000;
        const podNamePrefix = config.podNamePrefix || 'computesdk-sbx';

        const kc = loadKubeConfig(config);
        const core = kc.makeApiClient(CoreV1Api);

        const podName = `${podNamePrefix}-${Math.random().toString(36).slice(2, 10)}`;
        const image = imageForRuntime(runtime, config.image);

        const labels: Record<string, string> = {
          [LABEL_MANAGED]: 'true',
          [LABEL_RUNTIME]: runtime,
          [LABEL_SID]: podName,
        };

        const annotations = Object.fromEntries(
          Object.entries(options?.metadata || {}).map(([key, value]) => [
            `computesdk.io/meta-${key}`,
            typeof value === 'string' ? value : JSON.stringify(value),
          ]),
        );

        const volumes: V1Volume[] = [];
        const volumeMounts: V1VolumeMount[] = [];
        if (options?.volumeIds && options.volumeIds.length > 0) {
          for (let i = 0; i < options.volumeIds.length; i++) {
            const volumeId = options.volumeIds[i];
            const { namespace: volNamespace, name: volName } = parseVolumeId(volumeId, namespace);
            if (volNamespace !== namespace) {
              throw new Error(
                `Volume ${volumeId} is not in the same namespace as the sandbox (${namespace}). PersistentVolumeClaims can only be mounted within their own namespace.`,
              );
            }
            const volumeName = `computesdk-volume-${i}`;
            volumes.push({
              name: volumeName,
              persistentVolumeClaim: { claimName: volName },
            });
            volumeMounts.push({
              name: volumeName,
              mountPath: `/mnt/volume-${i}`,
            });
          }
        }

        const pod: V1Pod = {
          metadata: {
            name: podName,
            namespace,
            labels,
            annotations,
          },
          spec: {
            restartPolicy: 'Never',
            terminationGracePeriodSeconds: 5,
            volumes: volumes.length > 0 ? volumes : undefined,
            containers: [
              {
                name: 'sandbox',
                image,
                command: ['/bin/sh', '-c', 'while true; do sleep 3600; done'],
                env: Object.entries(options?.envs || {}).map(([name, value]) => ({ name, value: String(value) })),
                resources: {
                  requests: { cpu: '250m', memory: '256Mi' },
                  limits: { cpu: '1', memory: '1Gi' },
                },
                volumeMounts: volumeMounts.length > 0 ? volumeMounts : undefined,
              },
            ],
          },
        };

        await core.createNamespacedPod({ namespace, body: pod });
        await waitForPodRunning(core, namespace, podName, timeout);
        if (config.kubeConfigRaw) {
          rawKubeConfigBySandboxId.set(`${namespace}/${podName}`, config.kubeConfigRaw);
        }

        return {
          sandbox: {
            podName: `${namespace}/${podName}`,
            namespace,
            runtime,
            createdAt: new Date(),
            timeout,
            kubeConfigPath: config.kubeConfigPath,
            context: config.context,
            urlTemplate: config.urlTemplate,
          },
          sandboxId: `${namespace}/${podName}`,
        };
      },

      getById: async (config: K8sConfig, sandboxId: string) => {
        const kc = loadKubeConfig(config);
        const core = kc.makeApiClient(CoreV1Api);
        const [namespace, name] = sandboxId.includes('/')
          ? sandboxId.split('/', 2)
          : [config.namespace || 'default', sandboxId];

        try {
          const pod = await core.readNamespacedPod({ name, namespace });
          const runtime = parseRuntime(pod.metadata?.labels?.[LABEL_RUNTIME] || config.runtime || 'node');
          if (config.kubeConfigRaw) {
            rawKubeConfigBySandboxId.set(`${namespace}/${name}`, config.kubeConfigRaw);
          }
          return {
            sandbox: {
              podName: `${namespace}/${name}`,
              namespace,
              runtime,
              createdAt: pod.metadata?.creationTimestamp || new Date(),
              timeout: config.timeout ?? 120000,
              kubeConfigPath: config.kubeConfigPath,
              context: config.context,
              urlTemplate: config.urlTemplate,
            },
            sandboxId: `${namespace}/${name}`,
          };
        } catch (error) {
          if (isNotFound(error)) return null;
          throw new Error(`Failed to fetch Kubernetes sandbox ${namespace}/${name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      list: async (config: K8sConfig) => {
        const kc = loadKubeConfig(config);
        const core = kc.makeApiClient(CoreV1Api);
        const namespace = config.namespace || 'default';

        const pods = await core.listNamespacedPod({ namespace, labelSelector: `${LABEL_MANAGED}=true` });
        return (pods.items || []).map(pod => {
          const podName = pod.metadata?.name || '';
          const runtime = parseRuntime(pod.metadata?.labels?.[LABEL_RUNTIME] || config.runtime || 'node');
          if (config.kubeConfigRaw) {
            rawKubeConfigBySandboxId.set(`${namespace}/${podName}`, config.kubeConfigRaw);
          }
          return {
            sandbox: {
              podName: `${namespace}/${podName}`,
              namespace,
              runtime,
              createdAt: pod.metadata?.creationTimestamp || new Date(),
              timeout: config.timeout ?? 120000,
              kubeConfigPath: config.kubeConfigPath,
              context: config.context,
              urlTemplate: config.urlTemplate,
            },
            sandboxId: `${namespace}/${podName}`,
          };
        }).filter(item => item.sandboxId);
      },

      destroy: async (config: K8sConfig, sandboxId: string) => {
        const kc = loadKubeConfig(config);
        const core = kc.makeApiClient(CoreV1Api);
        const [namespace, name] = sandboxId.includes('/')
          ? sandboxId.split('/', 2)
          : [config.namespace || 'default', sandboxId];

        await core.deleteNamespacedPod({ namespace, name }).catch(error => {
          if (!isNotFound(error)) throw error;
        });

        await core.deleteNamespacedService({ namespace, name: serviceNameForPod(name) }).catch(error => {
          if (!isNotFound(error)) throw error;
        });

        rawKubeConfigBySandboxId.delete(`${namespace}/${name}`);
      },

      runCommand: async (sandbox: K8sSandboxHandle, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const start = Date.now();
        const fullCommand = withCommandOptions(command, options);
        const wrappedCommand = `(${fullCommand}); __ec=$?; printf '\n__COMPUTESDK_EXIT_CODE__=%s\n' "$__ec"`;

        const kc = loadKubeConfigFromHandle(sandbox);
        const result = await execInPod(kc, sandbox.namespace, getPodName(sandbox), wrappedCommand);
        const parsed = parseExitCode(result.stdout, result.stderr);

        return {
          stdout: parsed.stdout,
          stderr: parsed.stderr,
          exitCode: parsed.exitCode,
          durationMs: Date.now() - start,
        };
      },

      getInfo: async (sandbox: K8sSandboxHandle): Promise<SandboxInfo> => {
        const kc = loadKubeConfigFromHandle(sandbox);
        const core = kc.makeApiClient(CoreV1Api);
        const pod = await core.readNamespacedPod({ namespace: sandbox.namespace, name: getPodName(sandbox) });
        const phase = pod.status?.phase || 'Unknown';

        return {
          id: sandbox.podName,
          provider: PROVIDER,
          status: phase === 'Running' ? 'running' : phase === 'Succeeded' ? 'stopped' : 'error',
          createdAt: pod.metadata?.creationTimestamp || sandbox.createdAt,
          timeout: sandbox.timeout,
          metadata: {
            runtime: sandbox.runtime,
            namespace: sandbox.namespace,
            podIP: pod.status?.podIP,
            nodeName: pod.spec?.nodeName,
            phase,
          },
        };
      },

      getUrl: async (sandbox: K8sSandboxHandle, options: { port: number; protocol?: string }): Promise<string> => {
        if (!sandbox.urlTemplate) {
          return `${options.protocol || 'http'}://k8s-sandbox-url-not-configured.invalid:${options.port}`;
        }

        const protocol = options.protocol || 'http';
        const serviceName = serviceNameForPod(getPodName(sandbox));
        return sandbox.urlTemplate
          .replace('{protocol}', protocol)
          .replace('{service}', serviceName)
          .replace('{namespace}', sandbox.namespace)
          .replace('{port}', String(options.port));
      },
    },
    volume: {
      create: async (config: K8sConfig, options?: CreateVolumeOptions): Promise<Volume> => {
        const namespace = config.namespace || 'default';
        const kc = loadKubeConfig(config);
        const core = kc.makeApiClient(CoreV1Api);

        const name = options?.name || `computesdk-vol-${randomUUID().slice(0, 8)}`;
        const sizeInMB = options?.size;
        const annotations = Object.fromEntries(
          Object.entries(options?.metadata || {}).map(([key, value]) => [
            `computesdk.io/meta-${key}`,
            typeof value === 'string' ? value : JSON.stringify(value),
          ]),
        );

        const pvc: V1PersistentVolumeClaim = {
          metadata: {
            name,
            namespace,
            labels: {
              [LABEL_MANAGED]: 'true',
            },
            annotations,
          },
          spec: {
            accessModes: ['ReadWriteOnce'],
            resources: {
              requests: {
                storage: sizeInMB ? `${sizeInMB}Mi` : '1Gi',
              },
            },
          },
        };

        const created = await core.createNamespacedPersistentVolumeClaim({ namespace, body: pvc });
        return pvcToVolume(created, namespace);
      },

      list: async (config: K8sConfig, options?: ListVolumesOptions): Promise<Volume[]> => {
        const namespace = options?.namespace || config.namespace || 'default';
        const kc = loadKubeConfig(config);
        const core = kc.makeApiClient(CoreV1Api);

        const pvcs = await core.listNamespacedPersistentVolumeClaim({
          namespace,
          labelSelector: `${LABEL_MANAGED}=true`,
        });
        return (pvcs.items || []).map(pvc => pvcToVolume(pvc, namespace));
      },

      getById: async (config: K8sConfig, volumeId: string): Promise<Volume | null> => {
        const { namespace, name } = parseVolumeId(volumeId, config.namespace || 'default');
        const kc = loadKubeConfig(config);
        const core = kc.makeApiClient(CoreV1Api);

        try {
          const pvc = await core.readNamespacedPersistentVolumeClaim({ namespace, name });
          return pvcToVolume(pvc, namespace);
        } catch (error) {
          if (isNotFound(error)) return null;
          throw new Error(`Failed to fetch Kubernetes volume ${namespace}/${name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      delete: async (config: K8sConfig, volumeId: string): Promise<void> => {
        const { namespace, name } = parseVolumeId(volumeId, config.namespace || 'default');
        const kc = loadKubeConfig(config);
        const core = kc.makeApiClient(CoreV1Api);

        await core.deleteNamespacedPersistentVolumeClaim({ namespace, name }).catch(error => {
          if (isNotFound(error)) return;
          throw error;
        });
      },

      attach: async (_config: K8sConfig, _volumeId: string, _sandboxId: string, _options?: AttachVolumeOptions): Promise<void> => {
        throw new Error('k8s provider does not support attaching a volume to a running sandbox. Use volumeIds when creating the sandbox.');
      },

      detach: async (_config: K8sConfig, _volumeId: string, _sandboxId: string, _options?: AttachVolumeOptions): Promise<void> => {
        throw new Error('k8s provider does not support detaching a volume from a running sandbox.');
      },
    },
  },
});

export const k8s = (config: K8sConfig = {}) => createK8sProvider(config);
