/**
 * Namespace Provider
 *
 * Full-featured provider using the factory pattern.
 * Supports instance lifecycle management and command execution via Namespace Compute API.
 */

import * as fs from 'fs/promises';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type { CommandResult, SandboxInfo, CreateSandboxOptions, RunCommandOptions, CreateTemplateOptions, TemplateInfo } from '@computesdk/provider';

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

const IMAGE_SERVICE_BASE_URL = 'https://global.namespaceapis.com';

const IMAGE_SERVICE_ENDPOINTS = {
  CREATE_BLUEPRINT: '/namespace.cloud.image.v1beta.ImageService/CreateBlueprint',
  LIST_BLUEPRINTS: '/namespace.cloud.image.v1beta.ImageService/ListBlueprints',
  REMOVE_BLUEPRINT: '/namespace.cloud.image.v1beta.ImageService/RemoveBlueprint',
  FETCH_BLUEPRINT: '/namespace.cloud.image.v1beta.ImageService/FetchBlueprint',
  BUILD: '/namespace.cloud.image.v1beta.ImageService/Build',
};

const BLUEPRINT_STATE = {
  UNKNOWN: 0,
  READY: 1,
  NEEDS_BUILDING: 2,
  BUILDING: 3,
  FAILED: 4,
} as const;

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
 * Poll FetchBlueprint until the build reaches a terminal state (READY or FAILED).
 */
async function pollBlueprintStatus(
  token: string,
  blueprintName: string,
  maxWaitMs: number = 10 * 60 * 1000,
  intervalMs: number = 5000
): Promise<any> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const resp = await fetchNamespace(
      token,
      IMAGE_SERVICE_ENDPOINTS.FETCH_BLUEPRINT,
      {
        method: 'POST',
        body: JSON.stringify({ blueprint_name: blueprintName }),
      },
      IMAGE_SERVICE_BASE_URL
    );
    const blueprint = resp.blueprint;
    if (!blueprint) {
      throw new Error(`FetchBlueprint returned no blueprint for "${blueprintName}"`);
    }
    const states = Object.values(blueprint.state || {}) as Array<{ state?: number; image_ref?: string }>;
    const anyBuilding = states.some(s => s?.state === BLUEPRINT_STATE.BUILDING);
    const anyFailed = states.some(s => s?.state === BLUEPRINT_STATE.FAILED);
    const anyReady = states.some(s => s?.state === BLUEPRINT_STATE.READY);

    if (anyFailed) {
      const errorMsg = blueprint.status?.error || 'Build failed';
      throw new Error(`Namespace blueprint build failed: ${errorMsg}`);
    }
    if (anyReady && !anyBuilding) {
      return blueprint;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for blueprint "${blueprintName}" to build`);
}

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
              image_ref: (options as any)?.image ?? 'ubuntu:latest',
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

          const instanceId = responseData.metadata.instanceId;
          const sandbox: NamespaceSandbox = {
            instanceId,
            name: `instance-${instanceId}`,
            commandServiceEndpoint: responseData.extendedMetadata?.commandServiceEndpoint,
            token,
            targetContainerName: config.targetContainerName || 'main-container',
            createdAt: responseData.metadata?.createdAt ? new Date(responseData.metadata.createdAt) : new Date(0),
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
            .filter((instanceData: any) => instanceData.instanceId || instanceData.metadata?.instanceId)
            .map((instanceData: any) => {
              const instanceId = instanceData.instanceId || instanceData.metadata.instanceId;
              const sandbox: NamespaceSandbox = {
                instanceId,
                name: `instance-${instanceId}`,
                commandServiceEndpoint: instanceData.extendedMetadata?.commandServiceEndpoint,
                token,
                targetContainerName: config.targetContainerName || 'main-container',
                createdAt: instanceData.metadata?.createdAt ? new Date(instanceData.metadata.createdAt) : new Date(0),
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
          const data = await fetchNamespace(token, API_ENDPOINTS.DESTROY_INSTANCE, {
            method: 'POST',
            body: JSON.stringify({
              instance_id: sandboxId,
              reason: config.destroyReason || "ComputeSDK cleanup"
            })
          });

          if (data.error) {
            console.warn(`Namespace destroy warning: ${data.error}`);
          }
        } catch (error) {
          console.warn(`Namespace destroy warning: ${error instanceof Error ? error.message : String(error)}`);
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
              .map(([k, v]) => `${k}=${escapeShellArg(v)}`)
              .join(' ');
            fullCommand = `${envPrefix} ${fullCommand}`;
          }

          if (options?.cwd) {
            fullCommand = `cd ${escapeShellArg(options.cwd)} && ${fullCommand}`;
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
          status: 'running',
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
    },

    template: {
      create: async (config: NamespaceConfig, options: CreateTemplateOptions): Promise<TemplateInfo> => {
        const { token } = await getAndValidateCredentials(config);

        // Mode 1: Capture from running sandbox
        if (options.from) {
          throw new Error(
            'Namespace does not support capturing templates from running sandboxes. ' +
              'The ImageService API only supports building from a Dockerfile or APT-based spec. ' +
              'To use a custom image, build it with template.create({ dockerfile }) or ' +
              'template.create({ baseImage }), then reference it via the `image` option.'
          );
        }

        // Mode 2: Build from spec via ImageService API
        let spec: Record<string, any>;

        if (options.dockerfile) {
          spec = {
            dockerfile: {
              content: options.dockerfile,
            },
          };
        } else if (options.baseImage) {
          // Construct a Dockerfile from the base image + envs + startCommand
          const lines: string[] = [`FROM ${options.baseImage}`];
          if (options.envs) {
            for (const [k, v] of Object.entries(options.envs)) {
              lines.push(`ENV ${k}=${v}`);
            }
          }
          if (options.startCommand) {
            lines.push(`CMD ${JSON.stringify(options.startCommand)}`);
          }
          spec = {
            dockerfile: {
              content: lines.join('\n'),
            },
          };
        } else {
          throw new Error(
            'Namespace template.create requires either `dockerfile`, `baseImage`, or `from`. ' +
              'Provide a Dockerfile string, a base image name, or a sandbox ID to capture from.'
          );
        }

        // Step 1: Create the blueprint
        const createResp = await fetchNamespace(
          token,
          IMAGE_SERVICE_ENDPOINTS.CREATE_BLUEPRINT,
          {
            method: 'POST',
            body: JSON.stringify({
              blueprint_name: options.name,
              spec,
            }),
          },
          IMAGE_SERVICE_BASE_URL
        );

        const blueprint = createResp.blueprint;
        if (!blueprint) {
          throw new Error(`CreateBlueprint did not return a blueprint. Response: ${JSON.stringify(createResp)}`);
        }

        // Step 2: Trigger the build
        await fetchNamespace(
          token,
          IMAGE_SERVICE_ENDPOINTS.BUILD,
          {
            method: 'POST',
            body: JSON.stringify({
              blueprint_name: options.name,
            }),
          },
          IMAGE_SERVICE_BASE_URL
        );

        // Step 3: Poll until build completes
        const builtBlueprint = await pollBlueprintStatus(token, options.name);

        // Extract the image ref from the built blueprint
        const states = Object.values(builtBlueprint.state || {}) as Array<{ image_ref?: string }>;
        const imageRef = builtBlueprint.status?.image_ref ||
          states.find(s => s?.image_ref)?.image_ref ||
          options.name;

        return {
          id: builtBlueprint.id || options.name,
          provider: 'namespace',
          name: options.name,
          createdAt: builtBlueprint.created_at
            ? new Date(builtBlueprint.created_at)
            : new Date(),
          status: 'active',
          metadata: {
            ...options.metadata,
            source: 'build',
            imageRef,
            blueprintId: builtBlueprint.id,
          },
        };
      },

      list: async (config: NamespaceConfig): Promise<TemplateInfo[]> => {
        const { token } = await getAndValidateCredentials(config);

        try {
          const resp = await fetchNamespace(
            token,
            IMAGE_SERVICE_ENDPOINTS.LIST_BLUEPRINTS,
            {
              method: 'POST',
              body: JSON.stringify({}),
            },
            IMAGE_SERVICE_BASE_URL
          );

          const blueprints = resp.blueprints || [];
          return blueprints.map((bp: any) => {
            const bpStates = Object.values(bp.state || {}) as Array<{ state?: number }>;
            const allReady = bpStates.length > 0 && bpStates.every(s => s?.state === BLUEPRINT_STATE.READY);
            const anyFailed = bpStates.some(s => s?.state === BLUEPRINT_STATE.FAILED);
            const anyBuilding = bpStates.some(s => s?.state === BLUEPRINT_STATE.BUILDING);

            return {
              id: bp.id || bp.name,
              provider: 'namespace',
              name: bp.name || 'unnamed',
              createdAt: bp.created_at ? new Date(bp.created_at) : new Date(),
              status: anyFailed ? 'error' as const : anyBuilding ? 'building' as const : allReady ? 'active' as const : 'inactive' as const,
              metadata: {
                blueprintId: bp.id,
                imageRef: bp.status?.image_ref,
                creatorId: bp.creator_id,
              },
            };
          });
        } catch (error) {
          throw new Error(
            `Failed to list Namespace blueprints: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      delete: async (config: NamespaceConfig, templateId: string): Promise<void> => {
        const { token } = await getAndValidateCredentials(config);

        try {
          await fetchNamespace(
            token,
            IMAGE_SERVICE_ENDPOINTS.REMOVE_BLUEPRINT,
            {
              method: 'POST',
              body: JSON.stringify({
                blueprint_name: templateId,
              }),
            },
            IMAGE_SERVICE_BASE_URL
          );
        } catch (error) {
          throw new Error(
            `Failed to remove Namespace blueprint: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },
    },
  }
});
