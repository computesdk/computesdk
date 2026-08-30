/**
 * `@computesdk/givemeanode` - the givemeanode provider for ComputeSDK.
 *
 * givemeanode serves sandboxes from a per-region door backed by a warm
 * pool of pre-forked microVMs. A create the pool covers touches neither a
 * database nor a fork on the host: it hands over a sandbox that was
 * already running. `./client` carries the other half of that, the signed
 * credential that takes the authentication read off the path too.
 *
 * There is no npm SDK to wrap - the door is a small JSON HTTP surface and
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

export interface GivemeanodeConfig extends GmnClientOptions {
  /**
   * Guest memory in GiB. Defaults to the door's own default (2). The
   * shared ComputeSDK resource options are in MB or MiB, so `memoryMiB`,
   * `memMiB` and `memory` on `create` are read too and rounded up to whole
   * GiB.
   */
  ramGib?: number
  /**
   * `open` or `none`. Decided at bake time rather than per exec, because
   * the guest's network interface is built with the snapshot. Omitted
   * means whatever the host is configured for.
   */
  egress?: 'open' | 'none'
  /**
   * How many times to retry an exec whose host RPC did not complete.
   * Default 1, which is the door's own contract for that error (the exec
   * lane is reaped when idle and a retry re-dials). Set 0 for a workload
   * where a command running twice would be worse than failing, since a
   * dropped channel cannot say whether the host received the request.
   */
  execRetries?: number
}

export type GivemeanodeSandbox = SandboxHandle
export type GivemeanodeSnapshot = SnapshotShape

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

export const givemeanode = defineProvider<GivemeanodeSandbox, ConfigWithClient, never, GivemeanodeSnapshot>({
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

      getUrl: async (_sandbox: GivemeanodeSandbox, _options: { port: number; protocol?: string }) => {
        throw new Error(
          'givemeanode sandboxes do not expose inbound ports. A sandbox reaches out - its egress posture is ' +
            'fixed when the guest is baked - and nothing dials in. Use a givemeanode node for a workload that ' +
            'has to be reachable.',
        )
      },

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

    snapshot: {
      create: (config: ConfigWithClient, sandboxId: string) => ops.createSnapshot(getClient(config), sandboxId),
      list: (config: ConfigWithClient) => ops.listSnapshots(getClient(config)),
      delete: (config: ConfigWithClient, snapshotId: string) => ops.deleteSnapshot(getClient(config), snapshotId),
    },
  },
})

export default givemeanode
