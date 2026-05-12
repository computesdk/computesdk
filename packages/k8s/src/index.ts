import { PassThrough } from 'stream';
import {
  KubeConfig,
  CoreV1Api,
  Exec,
  type V1Pod,
  type V1Service,
} from '@kubernetes/client-node';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type {
  CommandResult,
  SandboxInfo,
  CreateSandboxOptions,
  RunCommandOptions,
} from '@computesdk/provider';

const PROVIDER = 'k8s' as const;
const LABEL_MANAGED = 'computesdk.io/managed';
const LABEL_RUNTIME = 'computesdk.io/runtime';
const LABEL_SID = 'computesdk.io/sandbox-id';
type Runtime = 'node' | 'python';

export interface K8sConfig {
  kubeConfigPath?: string;
  context?: string;
  namespace?: string;
  image?: string;
  runtime?: Runtime;
  timeout?: number;
  serviceType?: 'ClusterIP' | 'NodePort';
  podNamePrefix?: string;
  ttlSeconds?: number;
  urlTemplate?: string;
}

interface K8sSandboxHandle {
  podName: string;
  namespace: string;
  runtime: Runtime;
  createdAt: Date;
  kubeConfigPath?: string;
  context?: string;
  urlTemplate?: string;
  serviceType?: 'ClusterIP' | 'NodePort';
}

function loadKubeConfig(config: K8sConfig): KubeConfig {
  const kc = new KubeConfig();
  if (config.kubeConfigPath) kc.loadFromFile(config.kubeConfigPath);
  else kc.loadFromDefault();
  if (config.context) kc.setCurrentContext(config.context);
  return kc;
}

function getNamespace(config: K8sConfig, options?: CreateSandboxOptions): string {
  return options?.namespace || config.namespace || 'default';
}

function imageForRuntime(runtime: Runtime, configured?: string): string {
  if (configured) return configured;
  return runtime === 'python' ? 'python:3.11-slim' : 'node:20-alpine';
}

function serviceNameForPod(podName: string): string {
  return `${podName}-svc`;
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { statusCode?: number }).statusCode === 404;
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
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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

  const code = await exec.exec(
    namespace,
    podName,
    'sandbox',
    ['/bin/sh', '-c', command],
    stdout,
    stderr,
    null,
    false,
  );

  return { stdout: out, stderr: err, exitCode: code.status === 'Success' ? 0 : 1 };
}

function loadKubeConfigFromHandle(sandbox: K8sSandboxHandle): KubeConfig {
  return loadKubeConfig({
    kubeConfigPath: sandbox.kubeConfigPath,
    context: sandbox.context,
  });
}

function withCommandOptions(command: string, options?: RunCommandOptions): string {
  let full = command;
  if (options?.cwd) {
    full = `cd '${escapeShellArg(options.cwd)}' && ${full}`;
  }
  if (options?.env && Object.keys(options.env).length > 0) {
    const envPrefix = Object.entries(options.env)
      .map(([k, v]) => `${k}='${escapeShellArg(v)}'`)
      .join(' ');
    full = `${envPrefix} ${full}`;
  }
  if (options?.background) {
    full = `nohup ${full} >/tmp/computesdk-bg.log 2>&1 &`;
  }
  return full;
}

export const k8s = defineProvider<K8sSandboxHandle, K8sConfig>({
  name: PROVIDER,
  methods: {
    sandbox: {
      create: async (config: K8sConfig, options?: CreateSandboxOptions) => {
        const namespace = getNamespace(config, options);
        const runtime = (options?.runtime || config.runtime || 'node') as Runtime;
        const timeout = options?.timeout ?? config.timeout ?? 120000;
        const podNamePrefix = config.podNamePrefix || 'computesdk-sbx';

        const kc = loadKubeConfig(config);
        const core = kc.makeApiClient(CoreV1Api);

        const sandboxId = `${podNamePrefix}-${Math.random().toString(36).slice(2, 10)}`;
        const podName = sandboxId;
        const image = imageForRuntime(runtime, config.image);

        const labels: Record<string, string> = {
          [LABEL_MANAGED]: 'true',
          [LABEL_RUNTIME]: runtime,
          [LABEL_SID]: sandboxId,
        };

        for (const [key, value] of Object.entries(options?.metadata || {})) {
          labels[`computesdk.io/meta-${key}`] = typeof value === 'string' ? value : JSON.stringify(value);
        }

        const pod: V1Pod = {
          metadata: {
            name: podName,
            namespace,
            labels,
          },
          spec: {
            restartPolicy: 'Never',
            terminationGracePeriodSeconds: 5,
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
              },
            ],
          },
        };

        await core.createNamespacedPod({ namespace, body: pod });
        await waitForPodRunning(core, namespace, podName, timeout);

        return {
          sandbox: {
            podName,
            namespace,
            runtime,
            createdAt: new Date(),
            kubeConfigPath: config.kubeConfigPath,
            context: config.context,
            urlTemplate: config.urlTemplate,
            serviceType: config.serviceType || 'ClusterIP',
          },
          sandboxId,
        };
      },

      getById: async (config: K8sConfig, sandboxId: string) => {
        const kc = loadKubeConfig(config);
        const core = kc.makeApiClient(CoreV1Api);
        const namespace = config.namespace || 'default';

        try {
          const pod = await core.readNamespacedPod({ name: sandboxId, namespace });
          const runtime = (pod.metadata?.labels?.[LABEL_RUNTIME] || config.runtime || 'node') as Runtime;
          return {
            sandbox: {
              podName: sandboxId,
              namespace,
              runtime,
              createdAt: pod.metadata?.creationTimestamp || new Date(),
              kubeConfigPath: config.kubeConfigPath,
              context: config.context,
              urlTemplate: config.urlTemplate,
              serviceType: config.serviceType || 'ClusterIP',
            },
            sandboxId,
          };
        } catch (error) {
          if (isNotFound(error)) return null;
          throw new Error(`Failed to fetch Kubernetes sandbox ${sandboxId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      list: async (config: K8sConfig) => {
        const kc = loadKubeConfig(config);
        const core = kc.makeApiClient(CoreV1Api);
        const namespace = config.namespace || 'default';

        const pods = await core.listNamespacedPod({ namespace, labelSelector: `${LABEL_MANAGED}=true` });
        return (pods.items || []).map(pod => {
          const podName = pod.metadata?.name || '';
          const runtime = (pod.metadata?.labels?.[LABEL_RUNTIME] || config.runtime || 'node') as Runtime;
          return {
            sandbox: {
              podName,
              namespace,
              runtime,
              createdAt: pod.metadata?.creationTimestamp || new Date(),
              kubeConfigPath: config.kubeConfigPath,
              context: config.context,
              urlTemplate: config.urlTemplate,
              serviceType: config.serviceType || 'ClusterIP',
            },
            sandboxId: podName,
          };
        }).filter(item => item.sandboxId);
      },

      destroy: async (config: K8sConfig, sandboxId: string) => {
        const kc = loadKubeConfig(config);
        const core = kc.makeApiClient(CoreV1Api);
        const namespace = config.namespace || 'default';

        await core.deleteNamespacedPod({ namespace, name: sandboxId }).catch(error => {
          if (!isNotFound(error)) throw error;
        });

        await core.deleteNamespacedService({ namespace, name: serviceNameForPod(sandboxId) }).catch(error => {
          if (!isNotFound(error)) throw error;
        });
      },

      runCommand: async (sandbox: K8sSandboxHandle, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const start = Date.now();
        const fullCommand = withCommandOptions(command, options);

        const kc = loadKubeConfigFromHandle(sandbox);
        const result = await execInPod(kc, sandbox.namespace, sandbox.podName, fullCommand);

        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs: Date.now() - start,
        };
      },

      getInfo: async (sandbox: K8sSandboxHandle): Promise<SandboxInfo> => {
        const kc = loadKubeConfigFromHandle(sandbox);
        const core = kc.makeApiClient(CoreV1Api);
        const pod = await core.readNamespacedPod({ namespace: sandbox.namespace, name: sandbox.podName });
        const phase = pod.status?.phase || 'Unknown';

        return {
          id: sandbox.podName,
          provider: PROVIDER,
          status: phase === 'Running' ? 'running' : phase === 'Succeeded' ? 'stopped' : 'error',
          createdAt: pod.metadata?.creationTimestamp || sandbox.createdAt,
          timeout: 120000,
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
        const protocol = options.protocol || 'http';
        const serviceName = serviceNameForPod(sandbox.podName);

        const kc = loadKubeConfigFromHandle(sandbox);
        const core = kc.makeApiClient(CoreV1Api);

        let service: V1Service | null = null;
        try {
          const existing = await core.readNamespacedService({ namespace: sandbox.namespace, name: serviceName });
          service = existing;
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }

        if (!service) {
          const created = await core.createNamespacedService({
            namespace: sandbox.namespace,
            body: {
              metadata: {
                name: serviceName,
                namespace: sandbox.namespace,
                labels: {
                  [LABEL_MANAGED]: 'true',
                  [LABEL_SID]: sandbox.podName,
                },
              },
              spec: {
                type: sandbox.serviceType || 'ClusterIP',
                selector: { [LABEL_SID]: sandbox.podName },
                ports: [{
                  name: `p${options.port}`,
                  port: options.port,
                  targetPort: options.port,
                  protocol: 'TCP',
                }],
              },
            },
          });
          service = created;
        }

        if (service.spec?.type === 'NodePort') {
          const nodePort = service.spec.ports?.[0]?.nodePort;
          if (nodePort) return `${protocol}://localhost:${nodePort}`;
        }

        if (service.spec?.clusterIP && service.spec.clusterIP !== 'None') {
          return `${protocol}://${serviceName}.${sandbox.namespace}.svc.cluster.local:${options.port}`;
        }

        if (sandbox.urlTemplate) {
          return sandbox.urlTemplate
            .replace('{protocol}', protocol)
            .replace('{service}', serviceName)
            .replace('{namespace}', sandbox.namespace)
            .replace('{port}', String(options.port));
        }

        return `${protocol}://${serviceName}.${sandbox.namespace}.svc.cluster.local:${options.port}`;
      },
    },
  },
});
