/**
 * Namespace Provider
 *
 * Full-featured provider using the factory pattern.
 * Supports instance lifecycle management and command execution via Namespace Compute API.
 */

import * as fs from 'fs/promises';
import path from 'node:path';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type { CommandResult, SandboxInfo, CreateSandboxOptions, RunCommandOptions, FileEntry } from '@computesdk/provider';

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

// Chunk base64-encoded file writes so each runCommand stays under typical
// shell argument / command-length limits. Must be a multiple of 4 to keep
// base64 padding aligned across chunks.
const FILESYSTEM_BASE64_CHUNK_SIZE = 48_000;

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

      filesystem: {
        mkdir: async (sandbox, dirPath, runCommand) => {
          const result = await namespaceRunCommand(
            sandbox,
            runCommand,
            `mkdir -p ${shellQuotePath(dirPath)}`,
          );
          if (result.exitCode !== 0) {
            throw new Error(`Failed to create directory ${dirPath}: ${result.stderr}`);
          }
        },

        writeFile: async (sandbox, filePath, content, runCommand) => {
          const dir = path.posix.dirname(filePath);
          const escapedPath = shellQuotePath(filePath);
          const escapedDir = shellQuotePath(dir);

          if (content.length === 0) {
            const result = await namespaceRunCommand(
              sandbox,
              runCommand,
              `mkdir -p ${escapedDir} && : > ${escapedPath}`,
            );
            if (result.exitCode !== 0) {
              throw new Error(`Failed to write ${filePath}: ${result.stderr}`);
            }
            return;
          }

          const encoded = Buffer.from(content, 'utf8').toString('base64');
          const chunks: string[] = [];
          for (let offset = 0; offset < encoded.length; offset += FILESYSTEM_BASE64_CHUNK_SIZE) {
            chunks.push(encoded.slice(offset, offset + FILESYSTEM_BASE64_CHUNK_SIZE));
          }

          let first = true;
          for (const chunk of chunks) {
            const redirect = first ? '>' : '>>';
            const result = await namespaceRunCommand(
              sandbox,
              runCommand,
              `mkdir -p ${escapedDir} && printf '%s' "${escapeShellArg(chunk)}" | base64 -d ${redirect} ${escapedPath}`,
            );
            if (result.exitCode !== 0) {
              throw new Error(`Failed to write ${filePath}: ${result.stderr}`);
            }
            first = false;
          }
        },

        readFile: async (sandbox, filePath, runCommand) => {
          const result = await namespaceRunCommand(
            sandbox,
            runCommand,
            `cat ${shellQuotePath(filePath)}`,
          );
          if (result.exitCode !== 0) {
            throw new Error(`Failed to read ${filePath}: ${result.stderr}`);
          }
          return result.stdout ?? '';
        },

        readdir: async (sandbox, dirPath, runCommand): Promise<FileEntry[]> => {
          const script =
            "find " + shellQuotePath(dirPath) + " -mindepth 1 -maxdepth 1 -exec sh -c '" +
            "for f; do " +
            '[ -d "$f" ] && t=d || t=f; ' +
            "name=${f##*/}; " +
            'name64=$(printf "%s" "$name" | base64); ' +
            'printf "%s\\t%s\\0" "$t" "$name64"; ' +
            "done' _ {} +";
          const result = await namespaceRunCommand(sandbox, runCommand, script);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to list directory ${dirPath}: ${result.stderr}`);
          }
          const entries: FileEntry[] = [];
          for (const record of result.stdout.split('\0')) {
            if (!record) continue;
            const [typeChar, ...name64Parts] = record.split('\t');
            const name64 = name64Parts.join('\t').replace(/\n/g, '');
            if (!name64) continue;
            entries.push({
              name: Buffer.from(name64, 'base64').toString('utf8'),
              type: typeChar === 'd' ? 'directory' : 'file',
            });
          }
          return entries;
        },

        exists: async (sandbox, filePath, runCommand) => {
          const result = await namespaceRunCommand(
            sandbox,
            runCommand,
            `test -e ${shellQuotePath(filePath)}`,
          );
          return result.exitCode === 0;
        },

        remove: async (sandbox, targetPath, runCommand) => {
          const result = await namespaceRunCommand(
            sandbox,
            runCommand,
            `rm -rf ${shellQuotePath(targetPath)}`,
          );
          if (result.exitCode !== 0) {
            throw new Error(`Failed to remove ${targetPath}: ${result.stderr}`);
          }
        },
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
    }
  }
});

/**
 * Thin wrapper around the provider's runCommand that re-throws friendly errors
 * when the command service endpoint is unavailable.
 */
function normalizeShellPath(input: string): string {
  if (input === '' || input.startsWith('/') || input.startsWith('./') || input.startsWith('../')) {
    return input;
  }
  if (input.startsWith('-')) {
    return `./${input}`;
  }
  return input;
}

function shellQuotePath(input: string): string {
  return `"${escapeShellArg(normalizeShellPath(input))}"`;
}

async function namespaceRunCommand(
  sandbox: NamespaceSandbox,
  runCommand: (sandbox: NamespaceSandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>,
  command: string,
  options?: RunCommandOptions,
): Promise<CommandResult> {
  if (!sandbox.commandServiceEndpoint) {
    throw new Error('Command service endpoint not available. Filesystem operations require command execution support.');
  }
  return runCommand(sandbox, command, options);
}
