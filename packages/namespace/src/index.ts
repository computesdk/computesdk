/**
 * Namespace Provider
 *
 * Full-featured provider using the factory pattern.
 * Supports instance lifecycle management and command execution via Namespace Compute API.
 */

import * as fs from 'fs/promises';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type { Runtime, CodeResult, CommandResult, SandboxInfo, CreateSandboxOptions, RunCommandOptions } from '@computesdk/provider';

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
 * Supports:
 *  - config.token (direct bearer token)
 *  - NSC_TOKEN env var (direct bearer token)
 *  - NSC_TOKEN_FILE env var (path to JSON file with bearer_token field)
 */
export const getAndValidateCredentials = async (config: NamespaceConfig) => {
  // 1. Direct token from config or env
  let token = config.token || (typeof process !== 'undefined' && process.env?.NSC_TOKEN) || '';

  // 2. If no direct token, try loading from token file
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

  // Standard error handling for all operations
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
      // Collection operations (map to compute.sandbox.*)
      create: async (config: NamespaceConfig, options?: CreateSandboxOptions) => {
        const { token } = await getAndValidateCredentials(config);
        const containerName = config.targetContainerName || 'main-container';

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
              image_ref: options?.image ?? 'ubuntu:latest',
              args: ['sleep', 'infinity'],
              ...(options?.envs && Object.keys(options.envs).length > 0 && {
                environment: options.envs
              })
            }],
            documented_purpose: config.documentedPurpose || 'ComputeSDK sandbox',
            deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString()
          };

          const responseData = await fetchNamespace(token, API_ENDPOINTS.CREATE_INSTANCE, {
            method: 'POST',
            body: JSON.stringify(requestBody)
          });

          // Extract instance ID from the Namespace API response structure
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

          return {
            sandbox,
            sandboxId: instanceId
          };
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

          // Extract instance ID from the Namespace API response structure
          if (!responseData.metadata?.instanceId) {
            throw new Error('Instance data is missing from Namespace response');
          }

          const instanceId = responseData.metadata.instanceId;
          const commandServiceEndpoint = responseData.extendedMetadata?.commandServiceEndpoint;

          const sandbox: NamespaceSandbox = {
            instanceId,
            name: `instance-${instanceId}`,
            commandServiceEndpoint,
            token,
            targetContainerName: config.targetContainerName || 'main-container',
            createdAt: responseData.metadata?.createdAt ? new Date(responseData.metadata.createdAt) : new Date(0),
          };

          return {
            sandbox,
            sandboxId: instanceId
          };
        } catch (error) {
          // Handle 404 errors by returning null (instance not found)
          if (error instanceof Error && error.message.includes('404')) {
            return null;
          }

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

          // Extract instances from the response
          const instances = responseData?.instances || [];

          // Filter to instances with valid IDs, then transform
          return instances
            .filter((instanceData: any) => instanceData.instanceId || instanceData.metadata?.instanceId)
            .map((instanceData: any) => {
              const instanceId = instanceData.instanceId || instanceData.metadata.instanceId;
              const commandServiceEndpoint = instanceData.extendedMetadata?.commandServiceEndpoint;

              const sandbox: NamespaceSandbox = {
                instanceId,
                name: `instance-${instanceId}`,
                commandServiceEndpoint,
                token,
                targetContainerName: config.targetContainerName || 'main-container',
                createdAt: instanceData.metadata?.createdAt ? new Date(instanceData.metadata.createdAt) : new Date(0),
              };

              return {
                sandbox,
                sandboxId: instanceId
              };
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
          const data = await fetchNamespace(token, API_ENDPOINTS.DESTROY_INSTANCE, {
            method: 'POST',
            body: JSON.stringify({
              instance_id: sandboxId,
              reason: config.destroyReason || "ComputeSDK cleanup"
            })
          });

          if (data.error) {
            // Log errors but don't throw for destroy operations
            console.warn(`Namespace destroy warning: ${data.error}`);
          }
        } catch (error) {
          // For destroy operations, we log warnings rather than throwing
          // since the resource may already be gone
          console.warn(`Namespace destroy warning: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      // Command execution via Namespace CommandService
      runCommand: async (sandbox: NamespaceSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        if (!sandbox.commandServiceEndpoint) {
          throw new Error('Command service endpoint not available. The instance may not support command execution.');
        }

        const startTime = Date.now();

        try {
          // Build the full command with options
          let fullCommand = command;

          // Handle environment variables
          if (options?.env && Object.keys(options.env).length > 0) {
            const envPrefix = Object.entries(options.env)
              .map(([k, v]) => `${k}=${escapeShellArg(v)}`)
              .join(' ');
            fullCommand = `${envPrefix} ${fullCommand}`;
          }

          // Handle working directory
          if (options?.cwd) {
            fullCommand = `cd ${escapeShellArg(options.cwd)} && ${fullCommand}`;
          }

          // Handle background execution
          if (options?.background) {
            fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
          }

          // Call CommandService RunCommandSync via Connect protocol
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
            stdout?: string; // base64-encoded
            stderr?: string; // base64-encoded
            exitCode?: number;
          };

          // Decode base64-encoded stdout/stderr, falling back to raw string on invalid data
          const decodeBase64 = (data?: string): string => {
            if (!data) return '';
            try {
              return Buffer.from(data, 'base64').toString();
            } catch {
              return data;
            }
          };
          const stdout = decodeBase64(result.stdout);
          const stderr = decodeBase64(result.stderr);

          return {
            stdout,
            stderr,
            exitCode: result.exitCode ?? 0,
            durationMs: Date.now() - startTime
          };
        } catch (error) {
          // Re-throw infrastructure errors (network, auth, API) so they propagate
          // rather than being masked as command execution failures
          throw new Error(
            `Namespace command execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      // Not supported - throw as no-op
      runCode: async (_sandbox: NamespaceSandbox, _code: string, _runtime?: Runtime, _config?: NamespaceConfig): Promise<CodeResult> => {
        throw new Error('Namespace provider does not support runCode. Use runCommand instead.');
      },

      getInfo: async (sandbox: NamespaceSandbox): Promise<SandboxInfo> => {
        return {
          id: sandbox.instanceId,
          provider: 'namespace',
          runtime: 'node',
          status: 'running',
          createdAt: sandbox.createdAt,
          timeout: 0,
          metadata: {
            name: sandbox.name,
            commandServiceEndpoint: sandbox.commandServiceEndpoint,
          }
        };
      },

      // Not supported - throw as no-op
      getUrl: async (_sandbox: NamespaceSandbox, _options: { port: number; protocol?: string }): Promise<string> => {
        throw new Error('Namespace provider does not support getUrl.');
      },

      getInstance: (sandbox: NamespaceSandbox): NamespaceSandbox => {
        return sandbox;
      },
    }
  }
});
