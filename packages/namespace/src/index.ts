/**
 * Namespace Provider
 *
 * Full-featured provider using the factory pattern.
 * Supports instance lifecycle management and command execution via Namespace Compute API.
 */

import * as fs from 'fs/promises';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type { CommandResult, SandboxInfo, CreateSandboxOptions, RunCommandOptions } from '@computesdk/provider';

/**
 * Namespace sandbox instance
 */
export interface NamespaceSandbox {
  instanceId: string;
  name: string;
  commandServiceEndpoint?: string;
  token: string;
  targetContainerName: string;
  createdAt: Date;
  /** Instance lifecycle state from InstanceMetadata.status, lowercased (e.g. 'running', 'destroying'). */
  status?: string;
}

/**
 * Proto enum values of InstanceMetadata.Status that mean the instance is gone
 * or going away. JSON transcoding emits the enum either as its name
 * ('DESTROYED') or its number (4 = DESTROYED, 5 = DESTROYING).
 */
const GONE_INSTANCE_STATUSES = new Set<string | number>(['DESTROYED', 'DESTROYING', 4, 5]);

/** InstanceMetadata.Status names by proto number, for numeric encodings. */
const INSTANCE_STATUS_NAMES: Record<number, string> = {
  1: 'pending',
  2: 'creating',
  3: 'running',
  4: 'destroyed',
  5: 'destroying',
  6: 'suspending',
  7: 'suspended',
  8: 'error',
};

function instanceStatus(
  metadata: { status?: string | number } | undefined,
): string | undefined {
  const status = metadata?.status;
  if (typeof status === 'string') return status.toLowerCase();
  if (typeof status === 'number') return INSTANCE_STATUS_NAMES[status] ?? 'unknown';
  return undefined;
}

function isGoneInstance(
  metadata: { status?: string | number } | undefined,
): boolean {
  return metadata?.status !== undefined && GONE_INSTANCE_STATUSES.has(metadata.status);
}

/**
 * Namespace provider configuration
 */
export interface NamespaceConfig {
  /** Namespace API token - if not provided, will fallback to NSC_TOKEN environment variable */
  token?: string;
  /** Path to a JSON token file (e.g. from `nsc login`) containing bearer_token - fallback to NSC_TOKEN_FILE */
  tokenFile?: string;
  /** Virtual CPU cores for the instance */
  virtualCpu?: number;
  /** Memory in megabytes for the instance */
  memoryMegabytes?: number;
  /** Machine architecture (default: amd64) */
  machineArch?: string;
  /** Operating system (default: linux) */
  os?: string;
  /** Documented purpose for the instance */
  documentedPurpose?: string;
  /** Reason for destroying instances (default: "ComputeSDK cleanup") */
  destroyReason?: string;
  /** Target container name for command execution (default: "main-container") */
  targetContainerName?: string;
}

const API_ENDPOINTS = {
  CREATE_INSTANCE: '/namespace.cloud.compute.v1beta.ComputeService/CreateInstance',
  DESCRIBE_INSTANCE: '/namespace.cloud.compute.v1beta.ComputeService/DescribeInstance',
  LIST_INSTANCES: '/namespace.cloud.compute.v1beta.ComputeService/ListInstances',
  DESTROY_INSTANCE: '/namespace.cloud.compute.v1beta.ComputeService/DestroyInstance'
};

const COMMAND_SERVICE = {
  RUN_COMMAND_SYNC: '/namespace.cloud.compute.v1beta.CommandService/RunCommandSync',
};

/**
 * Load bearer token from a JSON token file (e.g. from `nsc login`)
 */
async function loadTokenFromFile(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, 'utf8');
  const tokenJson: { bearer_token?: string } = JSON.parse(content);
  if (!tokenJson.bearer_token) {
    throw new Error(`Token file ${filePath} does not contain a bearer_token`);
  }
  return tokenJson.bearer_token;
}

/**
 * Get and validate Namespace credentials from config and environment.
 */
export const getAndValidateCredentials = async (config: NamespaceConfig) => {
  let token = config.token || (typeof process !== 'undefined' && process.env?.NSC_TOKEN) || '';

  if (!token) {
    const tokenFile = config.tokenFile || (typeof process !== 'undefined' && process.env?.NSC_TOKEN_FILE) || '';
    if (tokenFile) {
      token = await loadTokenFromFile(tokenFile);
    }
  }

  if (!token) {
    throw new Error(
      'Missing Namespace token. Provide token in config, set NSC_TOKEN, or set NSC_TOKEN_FILE environment variable (or provide tokenFile in config).'
    );
  }

  return { token };
};

const handleApiErrors = (response: any) => {
  if (response.error) {
    throw new Error(`Namespace API error: ${response.error}`);
  }
};

export const fetchNamespace = async (
  token: string,
  endpoint: string,
  options: RequestInit = {},
  baseUrl: string = 'https://us.compute.namespaceapis.com'
) => {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers
    }
  });

  if (!response.ok) {
    throw new Error(`Namespace API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  handleApiErrors(data);
  return data;
};

/**
 * Namespace provider
 *
 * Creates Namespace instances and supports command execution via CommandService.
 */
export const namespace = defineProvider<NamespaceSandbox, NamespaceConfig>({
  name: 'namespace',

  methods: {
    sandbox: {
      create: async (config: NamespaceConfig, options?: CreateSandboxOptions) => {
        const { token } = await getAndValidateCredentials(config);
        const containerName = config.targetContainerName || 'main-container';
        const image = options?.image;

        try {
          const requestBody = {
            shape: {
              virtual_cpu: config.virtualCpu || 2,
              memory_megabytes: config.memoryMegabytes || 4096,
              machine_arch: config.machineArch || 'amd64',
              os: config.os || 'linux'
            },
            containers: [{
              name: containerName,
              ...(image === undefined
                ? { known_image_id: 'builtin:base' }
                : { image_ref: image }),
              args: ['sleep', 'infinity'],
              ...(options?.envs && Object.keys(options.envs).length > 0 && {
                environment: options.envs
              }),
              // Mounts the instance's managed dockerd socket (e.g.
              // '/var/run/docker.sock') so the container can drive Docker —
              // the daemon runs on the micro-VM, not inside the container,
              // which needs no elevated container privileges.
              ...(typeof options?.dockerSockPath === 'string' &&
                options.dockerSockPath !== '' && {
                  docker_sock_path: options.dockerSockPath
                })
            }],
            documented_purpose: config.documentedPurpose || 'ComputeSDK sandbox',
            deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString()
          };

          const responseData = await fetchNamespace(token, API_ENDPOINTS.CREATE_INSTANCE, {
            method: 'POST',
            body: JSON.stringify(requestBody)
          });

          if (!responseData.metadata?.instanceId) {
            throw new Error(`Instance ID is undefined. Full response object: ${JSON.stringify(responseData, null, 2)}`);
          }

          const instanceId = responseData.metadata.instanceId;
          const commandServiceEndpoint = responseData.extendedMetadata?.commandServiceEndpoint;

          const sandbox: NamespaceSandbox = {
            instanceId,
            name: `instance-${instanceId}`,
            commandServiceEndpoint,
            token,
            targetContainerName: containerName,
            createdAt: new Date(),
          };

          return { sandbox, sandboxId: instanceId };
        } catch (error) {
          throw new Error(
            `Failed to create Namespace instance: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: NamespaceConfig, sandboxId: string) => {
        const { token } = await getAndValidateCredentials(config);

        try {
          const responseData = await fetchNamespace(token, API_ENDPOINTS.DESCRIBE_INSTANCE, {
            method: 'POST',
            body: JSON.stringify({ instance_id: sandboxId })
          });

          if (!responseData.metadata?.instanceId) {
            throw new Error('Instance data is missing from Namespace response');
          }

          // A destroyed instance stays describable (its status moves to
          // DESTROYING/DESTROYED, NotFound only comes later) — absent the
          // status check, callers confirming a deletion see it alive forever.
          if (isGoneInstance(responseData.metadata)) return null;

          const instanceId = responseData.metadata.instanceId;
          const sandbox: NamespaceSandbox = {
            instanceId,
            name: `instance-${instanceId}`,
            commandServiceEndpoint: responseData.extendedMetadata?.commandServiceEndpoint,
            token,
            targetContainerName: config.targetContainerName || 'main-container',
            createdAt: responseData.metadata?.createdAt ? new Date(responseData.metadata.createdAt) : new Date(0),
            status: instanceStatus(responseData.metadata),
          };

          return { sandbox, sandboxId: instanceId };
        } catch (error) {
          if (error instanceof Error && error.message.includes('404')) return null;
          throw new Error(
            `Failed to get Namespace instance: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      list: async (config: NamespaceConfig) => {
        const { token } = await getAndValidateCredentials(config);

        try {
          const responseData = await fetchNamespace(token, API_ENDPOINTS.LIST_INSTANCES, {
            method: 'POST',
            body: JSON.stringify({})
          });

          const instances = responseData?.instances || [];

          return instances
            .filter(
              (instanceData: any) =>
                (instanceData.instanceId || instanceData.metadata?.instanceId) &&
                !isGoneInstance(instanceData.metadata),
            )
            .map((instanceData: any) => {
              const instanceId = instanceData.instanceId || instanceData.metadata.instanceId;
              const sandbox: NamespaceSandbox = {
                instanceId,
                name: `instance-${instanceId}`,
                commandServiceEndpoint: instanceData.extendedMetadata?.commandServiceEndpoint,
                token,
                targetContainerName: config.targetContainerName || 'main-container',
                createdAt: instanceData.metadata?.createdAt ? new Date(instanceData.metadata.createdAt) : new Date(0),
                status: instanceStatus(instanceData.metadata),
              };
              return { sandbox, sandboxId: instanceId };
            });
        } catch (error) {
          throw new Error(
            `Failed to list Namespace instances: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      destroy: async (config: NamespaceConfig, sandboxId: string) => {
        const { token } = await getAndValidateCredentials(config);

        try {
          await fetchNamespace(token, API_ENDPOINTS.DESTROY_INSTANCE, {
            method: 'POST',
            body: JSON.stringify({
              instance_id: sandboxId,
              reason: config.destroyReason || "ComputeSDK cleanup"
            })
          });
        } catch (error) {
          throw new Error(
            `Failed to destroy Namespace instance: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      runCommand: async (sandbox: NamespaceSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        if (!sandbox.commandServiceEndpoint) {
          throw new Error('Command service endpoint not available. The instance may not support command execution.');
        }

        const startTime = Date.now();

        try {
          let fullCommand = command;

          if (options?.env && Object.keys(options.env).length > 0) {
            const envPrefix = Object.entries(options.env)
              .map(([k, v]) => `${k}="${escapeShellArg(v)}"`)
              .join(' ');
            fullCommand = `${envPrefix} ${fullCommand}`;
          }

          if (options?.cwd) {
            fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
          }

          if (options?.background) {
            fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
          }

          const result = await fetchNamespace(
            sandbox.token,
            COMMAND_SERVICE.RUN_COMMAND_SYNC,
            {
              method: 'POST',
              body: JSON.stringify({
                instanceId: sandbox.instanceId,
                targetContainerName: sandbox.targetContainerName,
                command: {
                  command: ['sh', '-c', fullCommand],
                },
              })
            },
            sandbox.commandServiceEndpoint
          ) as {
            stdout?: string;
            stderr?: string;
            exitCode?: number;
          };

          const decodeBase64 = (data?: string): string => {
            if (!data) return '';
            try { return Buffer.from(data, 'base64').toString(); } catch { return data; }
          };

          return {
            stdout: decodeBase64(result.stdout),
            stderr: decodeBase64(result.stderr),
            exitCode: result.exitCode ?? 0,
            durationMs: Date.now() - startTime
          };
        } catch (error) {
          throw new Error(
            `Namespace command execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getInfo: async (sandbox: NamespaceSandbox): Promise<SandboxInfo> => {
        return {
          id: sandbox.instanceId,
          provider: 'namespace',
          status:
            sandbox.status === 'error'
              ? 'error'
              : sandbox.status === undefined ||
                  sandbox.status === 'pending' ||
                  sandbox.status === 'creating' ||
                  sandbox.status === 'running'
                ? 'running'
                : 'stopped',
          createdAt: sandbox.createdAt,
          timeout: 0,
          metadata: {
            name: sandbox.name,
            commandServiceEndpoint: sandbox.commandServiceEndpoint,
          }
        };
      },

      getUrl: async (_sandbox: NamespaceSandbox, _options: { port: number; protocol?: string }): Promise<string> => {
        throw new Error('Namespace provider does not support getUrl.');
      },

      getInstance: (sandbox: NamespaceSandbox): NamespaceSandbox => sandbox,
    }
  }
});
