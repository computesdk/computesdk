import { defineProvider } from '@computesdk/provider';
import type { CommandResult, InstanceInfo, RunCommandOptions } from '@computesdk/provider';
import { SandboxError, type SandboxInstance } from '@tangle-network/sandbox';
import { TangleClient, defaultBaseUrl, openConnections } from './client';
import { createIdentity } from './identity';
import { createdAllocationId } from './create-failure';
import { discardResponseBody } from './http2';

export interface TangleConfig {
  /** API key, or TANGLE_API_KEY. */
  apiKey?: string;
  /** API endpoint, or TANGLE_SANDBOX_BASE_URL. */
  baseUrl?: string;
  /** Default Tangle environment identifier or OCI image reference. */
  image?: string;
  /** Requested CPU cores. */
  cpu?: number;
  /** Requested memory, passed to the SDK's memoryMB field. */
  memory?: number;
  /** Requested disk, passed to the SDK's diskGB field. */
  disk?: number;
  /** Maximum running lifetime in milliseconds. */
  timeout?: number;
  /** Create request budget in milliseconds; unset uses the native SDK default. */
  createTimeout?: number;
}

type ResolvedConfig = TangleConfig & { apiKey: string; baseUrl: string; client: TangleClient };

async function removeInstance(client: TangleClient, instanceId: string): Promise<void> {
  const response = await client.fetch('/v1/sandboxes/' + encodeURIComponent(instanceId), {
    method: 'DELETE',
  });
  // DELETE acknowledges retirement. Physical teardown belongs to the service.
  if (response.ok || response.status === 404) {
    await discardResponseBody(response);
    return;
  }
  throw new SandboxError(
    'Tangle deletion failed: ' + await response.text(),
    'SANDBOX_DELETE_FAILED',
    response.status,
  );
}

const createProvider = defineProvider<SandboxInstance, ResolvedConfig>({
  name: 'tangle',
  methods: {
    instances: {
      create: async (config, options = {}) => {
        if (options.snapshotId !== undefined) {
          throw new Error('Tangle snapshot restore is not exposed by this provider.');
        }
        if (options.ephemeral === false) {
          throw new Error('Tangle ComputeSDK instances are ephemeral; persistent instances are not supported.');
        }
        if (options.runtime !== undefined) {
          throw new Error('Tangle does not map runtime names; select an environment with image or templateId.');
        }
        const client = config.client;
        const identity = createIdentity(options);
        const image = options.image ?? options.templateId ?? config.image;
        const timeout = options.timeout ?? config.timeout;
        const cpuCores = options.cpu ?? config.cpu;
        const memoryMB = options.memory ?? config.memory;
        const diskGB = options.disk ?? config.disk;
        let instance: SandboxInstance;
        try {
          instance = await client.createIsolated({
            name: identity.name,
            idempotencyKey: identity.idempotencyKey,
            ...(image !== undefined ? { environment: image } : {}),
            agent: false,
            ephemeral: true,
            ...(cpuCores !== undefined || memoryMB !== undefined || diskGB !== undefined
              ? { resources: { cpuCores, memoryMB, diskGB } } : {}),
            env: options.envs,
            metadata: options.metadata,
            egressPolicy: { mode: 'open' },
            ...(timeout !== undefined ? { maxLifetimeSeconds: Math.ceil(timeout / 1000) } : {}),
          }, {
            timeoutMs: config.createTimeout,
            signal: options.signal,
          });
        } catch (creationError) {
          const allocationId = createdAllocationId(creationError, identity.idempotencyKey);
          if (allocationId !== undefined) {
            try {
              await removeInstance(client, allocationId);
            } catch (cleanupError) {
              throw new AggregateError(
                [creationError, cleanupError],
                'Tangle creation failed and retirement was not acknowledged for ' + allocationId + '.',
                { cause: creationError },
              );
            }
          }
          throw creationError;
        }
        return { instance, instanceId: instance.id };
      },

      getById: async (config, instanceId) => {
        const instance = await config.client.get(instanceId);
        return instance === null ? null : { instance, instanceId: instance.id };
      },

      list: async (config) => {
        const client = config.client;
        const instances: Array<{ instance: SandboxInstance; instanceId: string }> = [];
        const limit = 100;
        for (let offset = 0; ; offset += limit) {
          const page = await client.list({ limit, offset });
          instances.push(...page.map((instance) => ({ instance, instanceId: instance.id })));
          if (page.length < limit) return instances;
        }
      },

      destroy: async (config, instanceId) => {
        await removeInstance(config.client, instanceId);
      },

      runCommand: async (
        instance: SandboxInstance,
        command: string,
        options?: RunCommandOptions,
      ): Promise<CommandResult> => {
        const start = performance.now();
        const nativeOptions = {
          cwd: options?.cwd,
          env: options?.env,
          ...(options?.timeout !== undefined ? { timeoutMs: options.timeout } : {}),
        };
        if (options?.background) {
          const process = await instance.process.spawn(command, nativeOptions);
          if (!Number.isSafeInteger(process.pid) || process.pid <= 0) {
            throw new Error('Tangle did not acknowledge a background process.');
          }
          // Background success acknowledges launch, not command completion.
          return { stdout: '', stderr: '', exitCode: 0, durationMs: performance.now() - start };
        }
        const result = await instance.exec(command, nativeOptions);
        return { ...result, durationMs: performance.now() - start };
      },

      getInfo: async (instance): Promise<InstanceInfo> => {
        await instance.refresh();
        const status = instance.status === 'running' ? 'running'
          : instance.status === 'stopped' ? 'stopped' : 'error';
        return {
          id: instance.id,
          provider: 'tangle',
          status,
          createdAt: instance.createdAt,
          timeout: instance.expiresAt
            ? Math.max(0, instance.expiresAt.getTime() - instance.createdAt.getTime()) : 0,
          metadata: { ...instance.metadata, resources: instance.resources },
        };
      },

      getUrl: async () => {
        throw new Error('Tangle preview URLs are not exposed by this provider.');
      },
    },
  },
});

export function tangle(config: TangleConfig = {}) {
  const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.TANGLE_API_KEY : undefined);
  if (!apiKey?.trim()) {
    throw new Error(
      'Missing Tangle API key. Pass apiKey or set TANGLE_API_KEY. Create a key at https://sandbox.tangle.tools.',
    );
  }
  const baseUrl = config.baseUrl ??
    (typeof process !== 'undefined' ? process.env.TANGLE_SANDBOX_BASE_URL : undefined) ??
    defaultBaseUrl;
  openConnections(baseUrl);
  const client = new TangleClient({ apiKey, baseUrl, trustLocalCliAuth: false });
  return createProvider({ ...config, apiKey, baseUrl, client });
}
