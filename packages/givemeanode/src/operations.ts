/**
 * Everything the provider actually does, expressed against
 * {@link GmnClient} alone.
 *
 * Separate from `index.ts` for the same reason `client.ts` is: this file
 * has no dependencies, so it can be unit tested against a stub `fetch` and
 * smoke tested against the live door without `@computesdk/provider` or a
 * package install. `index.ts` is then a thin mapping from ComputeSDK's
 * interface onto these, and the only part that cannot be exercised
 * outside the ComputeSDK workspace is the mapping itself.
 *
 * The types here are structural rather than imported, and match
 * ComputeSDK's by shape: `CommandResult`, `FileEntry` and `SandboxInfo`
 * are all plain data.
 */

import type { GmnClient } from './client.js'

/**
 * The image every create gets unless one is named.
 *
 * `sbx-base` carries python3, node 24, git, curl and a compiler, so it
 * serves both the `node` and `python` runtimes rather than needing a
 * per-runtime default.
 */
export const DEFAULT_IMAGE = 'sbx-base'

/** The door's own default exec deadline. */
export const DEFAULT_TIMEOUT_MS = 60_000

const MIB_PER_GIB = 1024

export interface CommandResultShape {
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
}

export interface FileEntryShape {
  name: string
  type: 'file' | 'directory'
  size?: number
}

/**
 * A sandbox handle.
 *
 * givemeanode's sandbox ids are signed and self-describing - the id itself
 * carries the route to its host and proves its own ownership - so a handle
 * needs nothing but the id and the client that made it. Nothing is cached
 * here that could go stale.
 */
export interface SandboxHandle {
  readonly id: string
  readonly client: GmnClient
  readonly createdAt: Date
  readonly metadata: Record<string, unknown>
  /**
   * Retries for the door's reconnect error, carried on the handle rather
   * than read from config at call time: ComputeSDK's `runCommand` is
   * `(sandbox, command, options)` and never sees the provider config, so
   * the handle is the only place a per-provider setting can reach it.
   */
  readonly execRetries?: number
}

export interface CreateOptions {
  image?: string
  snapshotId?: string
  templateId?: string
  setup?: string
  egress?: 'open' | 'none'
  ramGib?: number
  memoryMiB?: number
  memMiB?: number
  memory?: number
  signal?: AbortSignal
}

export interface RunOptions {
  cwd?: string
  env?: Record<string, string>
  timeout?: number
  background?: boolean
}

export interface SnapshotShape {
  id: string
  provider: string
  createdAt: Date
  metadata?: Record<string, unknown>
}

interface CreateResponse {
  sandbox: string
  snapshot?: string
  fork_ms?: number
  boot_ms?: number
  bake_ms?: number
  reused_snapshot?: boolean
  pooled?: boolean
  egress?: string
  ram_gib?: number
}

interface ExecResult {
  sandbox: string
  stdout?: string
  stderr?: string
  exit_code?: number | null
  duration_ms?: number
  oom_kills?: number
  error?: string
}

interface StatsResponse {
  items?: Array<{ id: string; created_at?: string; snapshot?: string; depth?: number }>
  snapshots?: Array<{ id: string; created_at?: string; ram_gib?: number; egress?: string; durable?: boolean }>
}

/**
 * Quote a value for a double-quoted shell context.
 *
 * A local copy of `escapeShellArg` from `@computesdk/provider`, kept here
 * so this file stays dependency-free. It is four substitutions and a test
 * below pins all four, which is cheaper than the coupling would be.
 */
export function escapeShellArg(arg: string): string {
  return arg
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
}

/** Whole GiB, rounded up, from whichever resource option the caller used. */
export function ramGibFrom(configRamGib: number | undefined, options?: CreateOptions): number | undefined {
  if (configRamGib !== undefined) return configRamGib
  if (options?.ramGib !== undefined) return options.ramGib
  const mib = options?.memoryMiB ?? options?.memMiB
  if (typeof mib === 'number' && mib > 0) return Math.ceil(mib / MIB_PER_GIB)
  // `memory` is MB rather than MiB in the shared options, and that
  // difference never survives rounding up to whole GiB.
  if (typeof options?.memory === 'number' && options.memory > 0) {
    return Math.ceil(options.memory / MIB_PER_GIB)
  }
  return undefined
}

/**
 * Fold the per-command options into the single command string the door
 * takes.
 *
 * Environment variable NAMES are validated as POSIX identifiers rather
 * than escaped, because a name like `x; rm -rf /` is not in a quotable
 * position and no amount of escaping makes it safe. Values are escaped.
 *
 * ENV IS `export`ED RATHER THAN PREFIXED, and that is a correctness fix
 * rather than a style choice. The obvious `A=1 <command>` form is an
 * assignment scoped to ONE simple command, so `A=1 pwd && echo "$A"`
 * prints an empty line: everything after the first `&&`, `;` or `|` runs
 * without the variable. A caller passing `env` to a command that is a
 * pipeline - which is most non-trivial commands - would silently get
 * empty values. `export` applies to the whole line and to anything it
 * spawns, which is what `env` means everywhere else in ComputeSDK.
 * Caught by the live smoke, not by a unit test, because both forms build
 * a plausible-looking string.
 */
export function composeCommand(command: string, options?: RunOptions): string {
  const lead: string[] = []
  if (options?.cwd) lead.push(`cd "${escapeShellArg(options.cwd)}"`)
  if (options?.env && Object.keys(options.env).length > 0) {
    const assignments = Object.entries(options.env)
      .map(([k, v]) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
          throw new Error(`Invalid environment variable name: ${JSON.stringify(k)}`)
        }
        return `${k}="${escapeShellArg(String(v))}"`
      })
      .join(' ')
    lead.push(`export ${assignments}`)
  }
  let full = lead.length > 0 ? `${lead.join(' && ')} && ${command}` : command
  if (options?.background) full = `nohup sh -c "${escapeShellArg(full)}" >/dev/null 2>&1 &`
  return full
}

/** A snapshot id, which is the only thing a fork can start from. */
function forkableFrom(options?: CreateOptions): string | undefined {
  const from = options?.snapshotId ?? options?.templateId
  return from?.startsWith('env-') ? from : undefined
}

export async function createSandbox(
  client: GmnClient,
  configRamGib: number | undefined,
  configEgress: 'open' | 'none' | undefined,
  options?: CreateOptions,
  execRetries?: number,
): Promise<SandboxHandle> {
  // Single-flighted, and a no-op unless `fastToken: 'prime'`. When N
  // sandboxes start at once this is what stops all N taking their own
  // first call down the database path.
  await client.prime()

  // Restoring from a snapshot is a fork: a different route, and a
  // different response shape, from a create.
  const from = forkableFrom(options)
  if (from) {
    const forked = await client.request<{ sandboxes?: string[]; all_ready_ms?: number }>(
      'POST',
      '/preview/sandboxes/forks',
      { from, count: 1 },
      options?.signal,
    )
    const id = forked.sandboxes?.[0]
    if (!id) throw new Error(`givemeanode fork of ${from} returned no sandbox`)
    return {
      id,
      client,
      createdAt: new Date(),
      execRetries,
      metadata: { forkedFrom: from, allReadyMs: forked.all_ready_ms },
    }
  }

  const ramGib = ramGibFrom(configRamGib, options)
  const egress = options?.egress ?? configEgress
  const created = await client.request<CreateResponse>(
    'POST',
    '/preview/sandboxes',
    {
      image: options?.image ?? options?.templateId ?? DEFAULT_IMAGE,
      ...(ramGib === undefined ? {} : { ram_gib: ramGib }),
      ...(egress === undefined ? {} : { egress }),
      ...(options?.setup === undefined ? {} : { setup: options.setup }),
    },
    options?.signal,
  )
  return {
    id: created.sandbox,
    client,
    createdAt: new Date(),
    execRetries,
    metadata: {
      snapshot: created.snapshot,
      forkMs: created.fork_ms,
      bootMs: created.boot_ms,
      bakeMs: created.bake_ms,
      reusedSnapshot: created.reused_snapshot,
      pooled: created.pooled,
      egress: created.egress,
      ramGib: created.ram_gib,
    },
  }
}

export async function listSandboxes(client: GmnClient, execRetries?: number): Promise<SandboxHandle[]> {
  const stats = await client.request<StatsResponse>('GET', '/preview/sandboxes')
  return (stats.items ?? []).map(item => ({
    id: item.id,
    client,
    createdAt: item.created_at ? new Date(item.created_at) : new Date(),
    execRetries,
    metadata: { snapshot: item.snapshot, depth: item.depth },
  }))
}

export async function getSandbox(
  client: GmnClient,
  sandboxId: string,
  execRetries?: number,
): Promise<SandboxHandle | null> {
  const all = await listSandboxes(client, execRetries)
  return all.find(handle => handle.id === sandboxId) ?? null
}

export async function destroySandbox(client: GmnClient, sandboxId: string): Promise<void> {
  // The array route rather than `DELETE /preview/sandboxes/{id}`: the same
  // effect for one, and it is the shape a teardown of N uses. The door
  // reports an already-gone sandbox in its per-item result rather than
  // refusing the call, so destroy is idempotent.
  await client.request('POST', '/preview/sandboxes/deletes', { sandboxes: [sandboxId] })
}

/**
 * The door's own phrase for an exec whose host RPC did not complete.
 *
 * It is a TRANSPORT failure rather than a command failure: the exec
 * channel is a websocket lane that the host reaps after an idle period,
 * so the first exec after a quiet stretch can find the lane gone. The
 * door's message says "retry - reconnect-after-anything is the exec
 * channel's contract", and a retry re-dials. Matched on the phrase
 * because the door reports it in the result's `error` string and gives no
 * code; anything else with a missing exit code is not retried.
 */
const RETRYABLE_EXEC_ERROR = 'did not answer the exec call'

/** Retries for that one error. One is the contract; 0 opts out. */
export const DEFAULT_EXEC_RETRIES = 1

export async function runCommand(
  sandbox: SandboxHandle,
  command: string,
  options?: RunOptions,
  retriesOverride?: number,
): Promise<CommandResultShape> {
  const retries = retriesOverride ?? sandbox.execRetries ?? DEFAULT_EXEC_RETRIES
  const started = Date.now()
  const cmd = composeCommand(command, options)
  let lastError: string | undefined
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const body = await sandbox.client.request<{ results?: ExecResult[] }>('POST', '/preview/sandboxes/execs', {
      execs: [{ sandbox: sandbox.id, cmd, deadline_ms: options?.timeout ?? DEFAULT_TIMEOUT_MS }],
    })
    const result = body.results?.[0]
    if (!result) throw new Error(`givemeanode exec returned no result for ${sandbox.id}`)
    // The door reports a failed host RPC as `{sandbox, error}` with NO
    // exit_code. Reading a missing exit code as 0 would turn a diagnosed
    // failure into a silent success, which is the exact bug that cost a
    // whole benchmark run once already.
    if (result.exit_code === undefined || result.exit_code === null) {
      lastError = result.error ?? `givemeanode exec failed for ${sandbox.id}`
      // Retry ONLY the reconnect case. A command that ran and failed has
      // an exit code and never reaches here; anything else with no exit
      // code is a condition a retry cannot change.
      if (lastError.includes(RETRYABLE_EXEC_ERROR) && attempt < retries) continue
      throw new Error(lastError)
    }
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.exit_code,
      durationMs: result.duration_ms ?? Date.now() - started,
    }
  }
  throw new Error(lastError ?? `givemeanode exec failed for ${sandbox.id}`)
}

export async function sandboxInfo(sandbox: SandboxHandle): Promise<{
  id: string
  provider: string
  status: 'running' | 'stopped' | 'error'
  createdAt: Date
  timeout: number
  metadata: Record<string, unknown>
}> {
  const found = await getSandbox(sandbox.client, sandbox.id)
  return {
    id: sandbox.id,
    provider: 'givemeanode',
    // The listing is the plane's own routing registry rather than a cache,
    // so absence means the sandbox is gone, not that the read was stale.
    status: found ? 'running' : 'stopped',
    createdAt: found?.createdAt ?? sandbox.createdAt,
    timeout: DEFAULT_TIMEOUT_MS,
    metadata: { ...sandbox.metadata, ...(found?.metadata ?? {}) },
  }
}

export async function createSnapshot(client: GmnClient, sandboxId: string): Promise<SnapshotShape> {
  const body = await client.request<{ snapshot: string; create_ms?: number; parent?: string }>(
    'POST',
    `/preview/sandboxes/${encodeURIComponent(sandboxId)}/snapshot`,
    {},
  )
  return {
    id: body.snapshot,
    provider: 'givemeanode',
    createdAt: new Date(),
    metadata: { createMs: body.create_ms, parent: body.parent },
  }
}

export async function listSnapshots(client: GmnClient): Promise<SnapshotShape[]> {
  const stats = await client.request<StatsResponse>('GET', '/preview/sandboxes')
  return (stats.snapshots ?? []).map(s => ({
    id: s.id,
    provider: 'givemeanode',
    createdAt: s.created_at ? new Date(s.created_at) : new Date(),
    metadata: { ramGib: s.ram_gib, egress: s.egress, durable: s.durable },
  }))
}

export async function deleteSnapshot(client: GmnClient, snapshotId: string): Promise<void> {
  try {
    await client.request('DELETE', `/preview/sandboxes/snapshots/${encodeURIComponent(snapshotId)}`)
  } catch {
    // Idempotent: a snapshot already deleted, or expired out from under
    // us, is the state the caller asked for.
  }
}

/** Base64, without assuming a Node `Buffer` is in scope. */
export function toBase64(content: string): string {
  const bytes = new TextEncoder().encode(content)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** The command a `writeFile` runs. Separated so a test can read it. */
export function writeFileCommand(path: string, content: string): string {
  // BASE64, NOT A HEREDOC, and the reason is exactness. A heredoc's body
  // is every line up to the marker, so the marker must start its own line
  // - which means a heredoc can only ever produce a file ENDING IN A
  // NEWLINE. Writing "hello" and reading it back returned "hello\n", one
  // byte longer than what was written. There is no way to fix that within
  // the heredoc, and a `printf` rewrite trades it for percent-escaping.
  //
  // Base64 has neither problem: the content needs no escaping at all
  // (the alphabet is shell-inert), nothing is expanded, the bytes are
  // exact, and it works for content a heredoc cannot carry - no trailing
  // newline, a line equal to the marker, NUL bytes, invalid UTF-8.
  //
  // The cost is that the encoded content rides in ONE argv entry, so a
  // write is bounded by the guest's ARG_MAX (typically ~2 MB, so ~1.5 MB
  // of content). Every image givemeanode ships has coreutils, so `base64`
  // is present. Both limits are documented in the README.
  const quoted = escapeShellArg(path)
  return `mkdir -p "$(dirname "${quoted}")" && printf %s '${toBase64(content)}' | base64 -d > "${quoted}"`
}

type Run = (sandbox: SandboxHandle, command: string, options?: RunOptions) => Promise<CommandResultShape>

export const filesystem = {
  readFile: async (sandbox: SandboxHandle, path: string, run: Run): Promise<string> => {
    const r = await run(sandbox, `cat "${escapeShellArg(path)}"`)
    if (r.exitCode !== 0) throw new Error(r.stderr || `Cannot read file: ${path}`)
    return r.stdout
  },

  writeFile: async (sandbox: SandboxHandle, path: string, content: string, run: Run): Promise<void> => {
    const r = await run(sandbox, writeFileCommand(path, content))
    if (r.exitCode !== 0) throw new Error(r.stderr || `Cannot write file: ${path}`)
  },

  mkdir: async (sandbox: SandboxHandle, path: string, run: Run): Promise<void> => {
    const r = await run(sandbox, `mkdir -p "${escapeShellArg(path)}"`)
    if (r.exitCode !== 0) throw new Error(r.stderr || `Cannot create directory: ${path}`)
  },

  readdir: async (sandbox: SandboxHandle, path: string, run: Run): Promise<FileEntryShape[]> => {
    // `ls -la`, not `find -printf`: BusyBox images lack `-printf`.
    const r = await run(sandbox, `ls -la "${escapeShellArg(path)}"`)
    if (r.exitCode !== 0) throw new Error(r.stderr || `Cannot read directory: ${path}`)
    return parseLsLong(r.stdout)
  },

  exists: async (sandbox: SandboxHandle, path: string, run: Run): Promise<boolean> => {
    const r = await run(sandbox, `test -e "${escapeShellArg(path)}"`)
    return r.exitCode === 0
  },

  remove: async (sandbox: SandboxHandle, path: string, run: Run): Promise<void> => {
    const r = await run(sandbox, `rm -rf "${escapeShellArg(path)}"`)
    if (r.exitCode !== 0) throw new Error(r.stderr || `Cannot remove: ${path}`)
  },
}

/** `ls -la` output to entries. Exported so a test can feed it real output. */
export function parseLsLong(stdout: string): FileEntryShape[] {
  const entries: FileEntryShape[] = []
  for (const line of stdout.split('\n')) {
    if (!line.trim() || line.startsWith('total ')) continue
    const parts = line.split(/\s+/)
    if (parts.length < 9) continue
    const name = parts.slice(8).join(' ')
    if (name === '.' || name === '..') continue
    entries.push({
      name,
      type: parts[0].startsWith('d') ? 'directory' : 'file',
      size: Number.parseInt(parts[4], 10) || 0,
    })
  }
  return entries
}
