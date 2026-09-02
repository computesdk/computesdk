/**
 * `@computesdk/givemeanode` - the givemeanode provider for ComputeSDK.
 *
 * Very fast microVM sandboxes. `./client` carries the signed credential
 * that keeps the authentication cost off the path.
 *
 * There is no npm SDK to wrap - the API is a small JSON HTTP surface and
 * this package talks to it with `fetch`, which is also one fewer layer
 * between a caller and the measurement.
 *
 * THIS FILE IS ONLY THE MAPPING. Every behaviour lives in `./operations`
 * and `./client`, both dependency-free and both tested on their own; what
 * is here is the translation between ComputeSDK's interface and them.
 *
 * @see https://givemeanode.com/docs
 */

import { defineProvider } from '@computesdk/provider'
import type {
  CommandResult,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
  SandboxInfo,
} from '@computesdk/provider'

import { GmnClient, type GmnClientOptions } from './client.js'
import * as ops from './operations.js'
import type { SandboxHandle, SnapshotShape } from './operations.js'

export {
  GmnClient,
  GmnError,
  DEFAULT_BASE_URL,
  FAST_TOKEN_HEADER,
  FAST_TOKEN_EXPIRES_HEADER,
  resetFastTokenCache,
  type FastTokenMode,
} from './client.js'

export {
  exposePort,
  unexposePort,
  plainSandboxId,
  sameSandbox,
  isImageReference,
  prepareImage,
  resetPreparedImageCache,
  CREATE_IMAGE_EXPIRY,
  PREPARE_IMAGE_TIMEOUT_MS,
} from './operations.js'

export interface GivemeanodeConfig extends GmnClientOptions {
  /**
   * Guest memory in GiB. Defaults to 2. The
   * shared ComputeSDK resource options are in MB or MiB, so `memoryMiB`,
   * `memMiB` and `memory` on `create` are read too and rounded up to whole
   * GiB.
   */
  ramGib?: number
  /**
   * `open` or `none`. Decided when the guest image is prepared rather
   * than per command. Omitted means the account default.
   */
  egress?: 'open' | 'none'
  /**
   * How many times to retry an exec whose host RPC did not complete.
   * Default 1: the connection to a sandbox is re-established on demand,
   * so a redial is the documented answer to that one error. Set 0 for a
   * workload where a command running twice would be worse than failing,
   * since a dropped connection cannot say whether the sandbox received
   * the request.
   */
  execRetries?: number
}

export type GivemeanodeSandbox = SandboxHandle
export type GivemeanodeSnapshot = SnapshotShape

/**
 * A prepared container image, ready to start sandboxes from.
 *
 * `id` is what to pass back as `templateId` on a create. It is the same
 * kind of id a snapshot has, because for givemeanode a prepared image and
 * a snapshot are the same thing: something a sandbox can start from
 * immediately.
 */
export interface GivemeanodeTemplate {
  id: string
  provider: string
  createdAt: Date
  metadata?: Record<string, unknown>
}

/**
 * `create` takes a container image reference and prepares it.
 *
 * ComputeSDK's `CreateTemplateOptions` is `{ name, description?,
 * metadata? }`, which is about naming a template rather than saying what
 * goes in it, so the reference is read from `image` (or `fromImage`).
 * `name` is accepted and ignored: givemeanode names a prepared image by
 * its own id, and inventing an alias that only this client knows about
 * would be a mapping with nothing on the other side of it.
 */
export interface GivemeanodeCreateTemplateOptions {
  name?: string
  description?: string
  metadata?: Record<string, string>
  /** The container image, digest-pinned. */
  image?: string
  /** Alias for `image`. */
  fromImage?: string
  /** Guest memory for every sandbox started from this template. */
  ramGib?: number
  /** Network posture for every sandbox started from this template. */
  egress?: 'open' | 'none'
  /** `"24h"`, `"7d"`, `"never"`. Omitted keeps it until deleted. */
  expiresAfter?: string
}

type ConfigWithClient = GivemeanodeConfig & { __client?: GmnClient }

function getClient(config: ConfigWithClient): GmnClient {
  if (!config.__client) config.__client = new GmnClient(config)
  return config.__client
}

type FsRunCommand = (
  sandbox: GivemeanodeSandbox,
  command: string,
  options?: RunCommandOptions,
) => Promise<CommandResult>

export const givemeanode = defineProvider<
  GivemeanodeSandbox,
  ConfigWithClient,
  GivemeanodeTemplate,
  GivemeanodeSnapshot
>({
  name: 'givemeanode',
  methods: {
    sandbox: {
      create: async (config: ConfigWithClient, options?: CreateSandboxOptions) => {
        const sandbox = await ops.createSandbox(
          getClient(config),
          config.ramGib,
          config.egress,
          options,
          config.execRetries,
        )
        return { sandbox, sandboxId: sandbox.id }
      },

      getById: async (config: ConfigWithClient, sandboxId: string) => {
        const sandbox = await ops.getSandbox(getClient(config), sandboxId, config.execRetries)
        return sandbox ? { sandbox, sandboxId } : null
      },

      list: async (config: ConfigWithClient) => {
        const all = await ops.listSandboxes(getClient(config), config.execRetries)
        return all.map(sandbox => ({ sandbox, sandboxId: sandbox.id }))
      },

      destroy: async (config: ConfigWithClient, sandboxId: string) => {
        await ops.destroySandbox(getClient(config), sandboxId)
      },

      runCommand: (sandbox: GivemeanodeSandbox, command: string, options?: RunCommandOptions) =>
        ops.runCommand(sandbox, command, options) as Promise<CommandResult>,

      getInfo: (sandbox: GivemeanodeSandbox) => ops.sandboxInfo(sandbox) as Promise<SandboxInfo>,

      // A public HTTPS URL for a port inside the sandbox. The request
      // never arrives as a packet on the guest's interface: the host
      // connects INTO the guest over vsock and the guest's agent dials
      // its own loopback, which is why this works even for a sandbox
      // prepared with `egress: 'none'`.
      getUrl: (sandbox: GivemeanodeSandbox, options: { port: number; protocol?: string }) =>
        ops.exposePort(sandbox, options),

      getInstance: (sandbox: GivemeanodeSandbox) => sandbox,

      filesystem: {
        readFile: (sandbox: GivemeanodeSandbox, path: string, run: FsRunCommand) =>
          ops.filesystem.readFile(sandbox, path, run),
        writeFile: (sandbox: GivemeanodeSandbox, path: string, content: string, run: FsRunCommand) =>
          ops.filesystem.writeFile(sandbox, path, content, run),
        mkdir: (sandbox: GivemeanodeSandbox, path: string, run: FsRunCommand) =>
          ops.filesystem.mkdir(sandbox, path, run),
        readdir: (sandbox: GivemeanodeSandbox, path: string, run: FsRunCommand) =>
          ops.filesystem.readdir(sandbox, path, run) as Promise<FileEntry[]>,
        exists: (sandbox: GivemeanodeSandbox, path: string, run: FsRunCommand) =>
          ops.filesystem.exists(sandbox, path, run),
        remove: (sandbox: GivemeanodeSandbox, path: string, run: FsRunCommand) =>
          ops.filesystem.remove(sandbox, path, run),
      },
    },

    // A TEMPLATE is a container image prepared once so that starting
    // sandboxes from it is fast (docs: "Container images"). Preparing is
    // the slow part and it happens here, deliberately, so a caller who
    // knows the image up front never pays it inside a create.
    template: {
      create: async (
        config: ConfigWithClient,
        options: GivemeanodeCreateTemplateOptions,
      ): Promise<GivemeanodeTemplate> => {
        const reference = options?.image ?? options?.fromImage
        if (!reference) {
          throw new Error(
            'givemeanode builds a template from a container image: pass ' +
              "image: '<registry>/<repo>@sha256:<64 hex>'. To snapshot a RUNNING sandbox instead, use " +
              'compute.snapshot.create(sandboxId).',
          )
        }
        const id = await ops.prepareImage(
          getClient(config),
          reference,
          options.ramGib ?? config.ramGib,
          options.egress ?? config.egress,
          // No expiry: a caller who asked for a template asked to keep it.
          options.expiresAfter,
        )
        return {
          id,
          provider: 'givemeanode',
          createdAt: new Date(),
          metadata: { fromImage: reference, ...(options.metadata ?? {}) },
        }
      },

      // Templates and snapshots are one kind of thing here, so these are
      // the same two calls. A template made from a container image carries
      // no marker distinguishing it, which is honest rather than lossy:
      // what a caller can do with either is identical.
      list: (config: ConfigWithClient, options?: { limit?: number }) =>
        ops.listSnapshots(getClient(config), options),
      delete: (config: ConfigWithClient, templateId: string) =>
        ops.deleteSnapshot(getClient(config), templateId),
    },

    snapshot: {
      create: (config: ConfigWithClient, sandboxId: string) => ops.createSnapshot(getClient(config), sandboxId),
      list: (config: ConfigWithClient, options?: { sandboxId?: string; limit?: number }) =>
        ops.listSnapshots(getClient(config), options),
      delete: (config: ConfigWithClient, snapshotId: string) => ops.deleteSnapshot(getClient(config), snapshotId),
    },
  },
})

export default givemeanode
