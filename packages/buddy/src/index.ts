/**
 * Buddy provider for ComputeSDK.
 *
 * Buddy serves Ubuntu sandboxes from a pre-warmed pool, so `create` returns a
 * sandbox that is already booting and commands submitted to it are queued until
 * it is up. The provider does not wait for `RUNNING` on create — that keeps
 * time-to-first-command at the warm-pool latency instead of a poll interval.
 *
 * Snapshots are Buddy's only reusable image, so `compute.template.*` is mapped
 * onto them.
 *
 * @see https://buddy.works/docs/api/sandboxes
 */

import { defineProvider } from '@computesdk/provider';
import type {
  CreateSandboxOptions,
  ListSnapshotsOptions,
  SandboxInfo,
} from '@computesdk/provider';
import type { Snapshot } from 'computesdk';

import { whenBooted } from './boot.js';
import { runCommand, type BuddyRunCommandOptions } from './commands.js';
import * as fs from './filesystem.js';
import { createSnapshot, deleteSnapshot, listSnapshots } from './snapshots.js';
import {
  PROVIDER,
  applyProtocol,
  endpointMatchesPort,
  endpointPublicUrl,
  generateSandboxName,
  getClient,
  getSandboxData,
  isNotFound,
  isUnroutableId,
  mapStatus,
  normalizePort,
  resolveConfig,
  resolveResources,
  sleep,
  statusOf,
  toEndpointPayload,
  toEndpointUpdate,
  toHandle,
  toIdentifier,
  type BuddyConfig,
  type BuddyEndpoint,
  type BuddyPortInput,
  type BuddySandboxHandle,
  type ResolvedBuddyConfig,
} from './utils.js';

/** Deleting a just-created sandbox occasionally answers 5xx while succeeding. */
const DESTROY_ATTEMPTS = 3;
const DESTROY_RETRY_DELAY_MS = 500;

/** A tunnel is registered instantly but takes a moment to get its public URL. */
const URL_WAIT_TIMEOUT_MS = 15_000;
const URL_WAIT_POLL_MS = 250;

export const buddy = defineProvider<BuddySandboxHandle, BuddyConfig, any, Snapshot>({
  name: PROVIDER,

  methods: {
    sandbox: {
      create: async (config: BuddyConfig, options?: CreateSandboxOptions) => {
        const resolved = resolveConfig(config);
        const created = await getClient(resolved).addSandbox({
          body: buildCreateBody(resolved, options),
        });

        const sandbox = toHandle(resolved, created);
        return { sandbox, sandboxId: sandbox.sandboxId };
      },

      getById: async (config: BuddyConfig, sandboxId: string) => {
        const resolved = resolveConfig(config);
        try {
          const data = await getSandboxData(resolved, sandboxId);
          const sandbox = toHandle(resolved, data);
          return { sandbox, sandboxId: sandbox.sandboxId };
        } catch (error) {
          if (isNotFound(error) || isUnroutableId(error)) return null;
          throw error;
        }
      },

      list: async (config: BuddyConfig) => {
        const resolved = resolveConfig(config);
        const response = await getClient(resolved).getSandboxes({});

        // The listing carries ids only; details are fetched on demand by
        // getInfo, so listing a hundred sandboxes stays a single request.
        return (response.sandboxes ?? [])
          .filter(entry => Boolean(entry.id))
          .map(entry => {
            const sandbox = toHandle(resolved, entry);
            return { sandbox, sandboxId: sandbox.sandboxId };
          });
      },

      destroy: async (config: BuddyConfig, sandboxId: string) => {
        const resolved = resolveConfig(config);
        const client = getClient(resolved);

        for (let attempt = 1; attempt <= DESTROY_ATTEMPTS; attempt++) {
          try {
            await client.deleteSandboxById({ path: { id: sandboxId } });
            return;
          } catch (error) {
            // Already gone is the state the caller asked for.
            if (isNotFound(error)) return;
            const status = statusOf(error);
            const retryable = status !== undefined && status >= 500;
            if (!retryable || attempt === DESTROY_ATTEMPTS) throw error;
            await sleep(DESTROY_RETRY_DELAY_MS);
          }
        }
      },

      runCommand: async (
        sandbox: BuddySandboxHandle,
        command: string,
        options?: BuddyRunCommandOptions,
      ) => runCommand(sandbox, command, options),

      // `runCommand` already forwards `onStdout`/`onStderr` from Buddy's own
      // log stream. Without this the factory would ignore that and bootstrap
      // its Node-based streaming daemon inside the sandbox instead.
      streamCommand: runCommand,

      getInfo: async (sandbox: BuddySandboxHandle): Promise<SandboxInfo> => {
        const data = await getSandboxData(sandbox.config, sandbox.sandboxId);
        sandbox.endpoints = data.endpoints ?? sandbox.endpoints;

        return {
          id: sandbox.sandboxId,
          provider: PROVIDER,
          status: mapStatus(data.status),
          createdAt: sandbox.createdAt,
          timeout: data.timeout != null ? data.timeout * 1000 : sandbox.timeout,
          metadata: {
            identifier: data.identifier ?? sandbox.identifier,
            name: data.name,
            os: data.os,
            resources: data.resources,
            buddyStatus: data.status,
            setupStatus: data.setup_status,
            workspace: sandbox.config.workspace,
            project: sandbox.config.project,
            region: sandbox.config.region,
            endpoints: (data.endpoints ?? []).map(endpoint => ({
              name: endpoint.name,
              port: Number(endpoint.endpoint),
              type: endpoint.type,
              url: endpointPublicUrl(endpoint),
            })),
          },
        };
      },

      getUrl: async (sandbox: BuddySandboxHandle, options: { port: number; protocol?: string }) =>
        getUrl(sandbox, options),

      getInstance: (sandbox: BuddySandboxHandle) => sandbox,

      filesystem: {
        readFile: (sandbox: BuddySandboxHandle, path: string) => fs.readFile(sandbox, path),
        writeFile: (sandbox: BuddySandboxHandle, path: string, content: string) =>
          fs.writeFile(sandbox, path, content),
        mkdir: (sandbox: BuddySandboxHandle, path: string) => fs.mkdir(sandbox, path),
        readdir: (sandbox: BuddySandboxHandle, path: string) => fs.readdir(sandbox, path),
        exists: (sandbox: BuddySandboxHandle, path: string) => fs.exists(sandbox, path),
        remove: (sandbox: BuddySandboxHandle, path: string) => fs.remove(sandbox, path),
      },
    },

    snapshot: {
      create: (config: BuddyConfig, sandboxId: string, options?: { name?: string }) =>
        createSnapshot(resolveConfig(config), sandboxId, options),
      list: (config: BuddyConfig, options?: ListSnapshotsOptions) =>
        listSnapshots(resolveConfig(config), options),
      delete: (config: BuddyConfig, snapshotId: string) =>
        deleteSnapshot(resolveConfig(config), snapshotId),
    },

    /**
     * Buddy has no separate template entity — a snapshot is the reusable image,
     * and `create({ templateId })` boots from one. So listing and deleting
     * templates operate on snapshots, and creating one points the caller at
     * `compute.snapshot.create`, which is where an image comes from.
     */
    template: {
      create: async () => {
        throw new Error(
          'Buddy does not have templates as a separate entity. Snapshot a ' +
          'configured sandbox instead: const snapshot = await compute.snapshot.create(sandboxId), ' +
          'then boot from it with compute.sandbox.create({ snapshotId: snapshot.id }).',
        );
      },
      list: (config: BuddyConfig) => listSnapshots(resolveConfig(config)),
      delete: (config: BuddyConfig, templateId: string) =>
        deleteSnapshot(resolveConfig(config), templateId),
    },
  },
});

function buildCreateBody(config: ResolvedBuddyConfig, options: CreateSandboxOptions = {}) {
  const name = options.name ?? generateSandboxName();
  const timeoutMs = options.timeout ?? config.timeout;
  // `templateId` is accepted alongside `snapshotId` because Buddy's template
  // methods are backed by snapshots — both carry a snapshot id.
  const snapshotId = options.snapshotId ?? options.templateId;

  const body: Record<string, unknown> = {
    name,
    identifier: toIdentifier(name),
    os: options.image ?? config.os,
    timeout: Math.max(1, Math.round(timeoutMs / 1000)),
  };

  const resources = resolveResources(options, config.resources);
  if (resources) body.resources = resources;

  // Buddy-specific create options, passed through as they are named in the API.
  if (options.firstBootCommands) body.first_boot_commands = options.firstBootCommands;
  if (options.appDir) body.app_dir = options.appDir;
  if (options.tags) body.tags = options.tags;

  const ports = options.ports ?? config.ports;
  if (ports?.length) {
    body.endpoints = ports.map((port: BuddyPortInput) =>
      toEndpointPayload(normalizePort(port, config)));
  }
  if (options.envs && Object.keys(options.envs).length > 0) {
    body.variables = Object.entries(options.envs).map(([key, value]) => ({ key, value }));
  }
  if (snapshotId) body.snapshot_id = snapshotId;

  return body as any;
}

/**
 * Endpoint updates in flight, per sandbox. Buddy replaces the whole endpoint
 * list on update, so two concurrent `getUrl` calls built from the same list
 * would each drop the other's port — they run one after another instead.
 */
const endpointUpdates = new WeakMap<BuddySandboxHandle, Promise<unknown>>();

function getUrl(
  sandbox: BuddySandboxHandle,
  options: { port: number; protocol?: string },
): Promise<string> {
  const previous = endpointUpdates.get(sandbox) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => openPort(sandbox, options));
  endpointUpdates.set(sandbox, next);
  return next;
}

async function openPort(
  sandbox: BuddySandboxHandle,
  options: { port: number; protocol?: string },
): Promise<string> {
  const { port, protocol } = options;
  const existing = await findEndpointUrl(sandbox, port);
  if (existing) return applyProtocol(existing, protocol);

  const desired = normalizePort({ port }, sandbox.config);
  // Buddy replaces the whole endpoint list on update, so previously opened
  // tunnels have to be sent back or they would be torn down here.
  const kept = sandbox.endpoints
    .filter(endpoint => !endpointMatchesPort(endpoint, port))
    .map(toEndpointUpdate);

  // Buddy refuses configuration changes while the sandbox is still starting.
  const updated = await whenBooted(sandbox, () => sandbox.client.updateSandbox({
    path: { id: sandbox.sandboxId },
    body: { endpoints: [...kept, toEndpointPayload(desired)] } as any,
  }));
  sandbox.endpoints = (updated.endpoints ?? sandbox.endpoints) as BuddyEndpoint[];

  const deadline = Date.now() + URL_WAIT_TIMEOUT_MS;
  for (;;) {
    const url = await findEndpointUrl(sandbox, port);
    if (url) return applyProtocol(url, protocol);
    if (Date.now() >= deadline) {
      throw new Error(
        `Buddy opened a tunnel to port ${port} on sandbox ${sandbox.sandboxId} ` +
        `but published no public URL within ${URL_WAIT_TIMEOUT_MS / 1000}s.`,
      );
    }
    await sleep(URL_WAIT_POLL_MS);
  }
}

async function findEndpointUrl(
  sandbox: BuddySandboxHandle,
  port: number,
): Promise<string | undefined> {
  const data = await getSandboxData(sandbox.config, sandbox.sandboxId);
  sandbox.endpoints = data.endpoints ?? [];
  const match = sandbox.endpoints.find(endpoint => endpointMatchesPort(endpoint, port));
  return match ? endpointPublicUrl(match) : undefined;
}

export type { BuddyConfig, BuddySandboxHandle as BuddySandbox } from './utils.js';
export type { BuddyRunCommandOptions } from './commands.js';
