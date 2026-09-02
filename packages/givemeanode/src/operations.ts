/**
 * Everything the provider actually does, expressed against
 * {@link GmnClient} alone.
 *
 * Separate from `index.ts` for the same reason `client.ts` is: this file
 * has no dependencies, so it can be unit tested against a stub `fetch` and
 * smoke tested against the live API without `@computesdk/provider` or a
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

/** The default command deadline. */
export const DEFAULT_TIMEOUT_MS = 60_000

/**
 * How much longer the HTTP call gets than the command it is waiting on.
 *
 * The exec route blocks until the command finishes, so the request has to
 * outlive the command's own deadline or the client aborts a command that is
 * still running and reports a failure for something that then succeeds.
 * Probe 10 measured the door's overhead at 11-21 ms, so this is generous by
 * three orders of magnitude and exists only so a slow network cannot turn a
 * command that finished into an error.
 */
const EXEC_DEADLINE_HEADROOM_MS = 15_000

/**
 * How long to allow for preparing a container image.
 *
 * A container image has to be pulled and converted before anything can
 * start from it, and a large one (a SWE-bench instance image is ~1.8 GB
 * over a quarter of a million files) genuinely takes minutes. The ordinary
 * per-request timeout is sized for a call that should answer in
 * milliseconds, so using it here would abort work that was going to
 * succeed - and abort it AFTER paying for most of it.
 */
export const PREPARE_IMAGE_TIMEOUT_MS = 900_000

/**
 * Is this a container image reference rather than a curated image name?
 *
 * `@sha256:` is the test because it is also the requirement: givemeanode
 * refuses a tag, since the prepared image is cached under the image's
 * identity and a tag is a name whose meaning its owner can change. So
 * every acceptable container reference contains it, and no curated name
 * can.
 */
export function isImageReference(image: string): boolean {
  return image.includes('@sha256:')
}

/**
 * Refuse, locally, a reference that is CLEARLY meant to be a container
 * image but cannot be used as one.
 *
 * Not validation for its own sake: without this, `ghcr.io/acme/x:latest`
 * falls through to the curated-name path and comes back as "unknown image,
 * available: sbx-base; sbx-min; sbx-task", which is true and useless. The
 * service's own advice for a tag is the advice the caller needs, so say it
 * here where we can tell the two mistakes apart. A bare `python:3.12` is
 * NOT caught: it is genuinely ambiguous, and the curated-name refusal that
 * lists the catalog is the better answer for it.
 */
export function checkImageReference(image: string): void {
  if (isImageReference(image)) return
  const first = image.split('/')[0] ?? ''
  const looksLikeRegistry = image.includes('/') && first.includes('.')
  if (!looksLikeRegistry) return
  throw new Error(
    `givemeanode needs a container image pinned by digest, and ${JSON.stringify(image)} is not. ` +
      'Pass it as <registry>/<repo>@sha256:<64 hex> - read the digest with ' +
      '`docker buildx imagetools inspect <ref>` or `crane digest <ref>`. A tag can be moved to point at ' +
      'different bytes, and the prepared image is cached under the image\'s identity, so a tag would ' +
      'eventually start a sandbox from content that no longer answers to that name.',
  )
}

const MIB_PER_GIB = 1024
const BYTES_PER_GIB = 1024 * 1024 * 1024

/**
 * The named instance types, mirroring `sbx/sizes.toml` in the givemeanode
 * repo. Used ONLY to turn ComputeSDK's provider-agnostic `vcpus`/`memory`
 * hints into a size NAME; the door validates the name against the real
 * manifest, so this table drifting cannot silently mis-size a guest - it
 * gets a refusal naming the sizes that exist.
 */
const SIZES: ReadonlyArray<{ size: string; vcpus: number; ramGib: number }> = [
  { size: 'sandbox-sm', vcpus: 1, ramGib: 2 },
  { size: 'sandbox-md', vcpus: 4, ramGib: 8 },
  { size: 'sandbox-lg', vcpus: 8, ramGib: 32 },
  { size: 'sandbox-xl', vcpus: 16, ramGib: 64 },
]

/** The vCPU count the caller asked for, under any of the accepted spellings. */
export function requestedVcpus(options?: CreateOptions): number | undefined {
  return options?.vcpus ?? options?.resources?.vcpus ?? options?.cpus
}

/**
 * The smallest named size that satisfies both requested dimensions.
 *
 * Smallest rather than largest on purpose: a caller asking for 8 vCPUs gets
 * the 8-vCPU size, never a bigger one that would flatter a benchmark it did
 * not ask to run. An ask past the top of the range clamps to the largest
 * shape we sell rather than failing, because the door's own ceiling check is
 * the thing that should refuse it, with a message about the customer's limit.
 */
export function sizeFor(vcpus: number | undefined, ramGib: number | undefined): string | undefined {
  if (vcpus === undefined && ramGib === undefined) return undefined
  const fit = SIZES.find(
    (candidate) =>
      (vcpus === undefined || candidate.vcpus >= vcpus) &&
      (ramGib === undefined || candidate.ramGib >= ramGib),
  )
  return (fit ?? SIZES[SIZES.length - 1]).size
}

export interface CommandResultShape {
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
  /** True when stdout hit the door's 1 MiB cap and is a prefix. */
  truncated?: boolean
}

export interface FileEntryShape {
  name: string
  type: 'file' | 'directory'
  size?: number
}

/**
 * A sandbox handle.
 *
 * A givemeanode sandbox id is self-describing, so a handle needs nothing
 * but the id and the client that made it. Nothing is cached here that
 * could go stale.
 */
export interface SandboxHandle {
  readonly id: string
  readonly client: GmnClient
  readonly createdAt: Date
  readonly metadata: Record<string, unknown>
  /**
   * Retries for the redial error, carried on the handle rather
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
  /** Named instance type, e.g. `sandbox-lg`. Wins over the hints below. */
  size?: string
  vcpus?: number
  /** ComputeSDK's nested form, as `{ resources: { vcpus } }`. */
  resources?: { vcpus?: number }
  cpus?: number
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
  truncated?: boolean
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
  // `memory` is MB (decimal) rather than MiB in the shared options, so it
  // converts through 1000^2 bytes and not 1024^2. Dividing by 1024 instead
  // overstates the ask right at the boundary that matters: 2049 MB is 1.908
  // GiB, which is 2 GiB rounded up, but `ceil(2049 / 1024)` is 3 - a whole
  // extra GiB the caller did not ask for and, on a provider that bills by
  // GiB-equivalents, is charged for.
  if (typeof options?.memory === 'number' && options.memory > 0) {
    return Math.ceil((options.memory * 1_000_000) / BYTES_PER_GIB)
  }
  return undefined
}

/**
 * Fold the per-command options into the single command string the API
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

/**
 * How long a template made as a side effect of `create({ image })` lives.
 *
 * The caller asked for a sandbox, not for a template to keep, so leaving
 * these forever would accumulate stored bytes nobody asked to pay for. A
 * day is long enough that a CI fleet or a training run reuses one all day
 * and short enough to be self-cleaning. `template.create` is the call for
 * one that should outlive that, and it sets no expiry.
 */
export const CREATE_IMAGE_EXPIRY = '24h'

/**
 * Start one sandbox from a snapshot or prepared template.
 */
async function forkSnapshot(
  client: GmnClient,
  from: string,
  options?: CreateOptions,
  execRetries?: number,
  extra?: Record<string, unknown>,
): Promise<SandboxHandle> {
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
    metadata: { forkedFrom: from, allReadyMs: forked.all_ready_ms, ...(extra ?? {}) },
  }
}

/**
 * Container images already prepared in this process, and the ones being
 * prepared right now.
 *
 * MODULE level and single-flighted, for the same reason the signed
 * credential's cache is: a prepared image is a property of the (endpoint,
 * token, reference, shape) tuple rather than of an object, and starting N
 * sandboxes from one image must prepare it ONCE. Without the single
 * flight, `Promise.all` over 20 creates from a fresh reference would start
 * twenty conversions of the same bytes and bill for all of them.
 *
 * Keyed on the shape as well as the reference because every sandbox
 * started from a prepared image inherits its memory size and egress and
 * cannot change them, so two different shapes are two different prepared
 * images.
 */
const prepared = new Map<string, Prepared>()
const preparing = new Map<string, Promise<string>>()

/** Test seam, and the escape hatch for a caller that wants a fresh one. */
export function resetPreparedImageCache(): void {
  prepared.clear()
  preparing.clear()
}

/**
 * A cached preparation, and when it stops being usable.
 *
 * `expiresAtMs` is undefined for a durable template (nothing takes it
 * away). For one baked as a side effect of `create({ image })` it is the
 * instant the door will delete it, so this cache must not hand the id
 * out past it: a fork of a snapshot that has expired fails, and it fails
 * long after the create that would have explained why.
 */
interface Prepared {
  id: string
  expiresAtMs?: number
}

function prepareKey(
  client: GmnClient,
  reference: string,
  ramGib: number | undefined,
  egress: 'open' | 'none' | undefined,
  size: string | undefined,
  expiresAfter: string | undefined,
): string {
  // The RETENTION POLICY and the SIZE are part of the identity, not
  // decoration. Without the policy, a `create({ image })` - which asks
  // for a throwaway that expires - would populate the cache and a later
  // `template.create` for the same image would be handed that expiring
  // id, so a template the caller asked to keep would vanish under them.
  // Without the size, a create asking for 8 vCPUs would reuse a
  // single-core bake, and the size is fixed AT THE BAKE.
  return [
    client.baseUrl,
    client.apiKey,
    reference,
    ramGib ?? '',
    egress ?? '',
    size ?? '',
    expiresAfter ?? 'keep',
  ].join('\u0000')
}

/** How long before a cached id's own expiry we stop handing it out. */
const PREPARED_REUSE_MARGIN_MS = 60_000

/** Parse the door's duration grammar ("24h", "7d", "90m") to ms. */
export function expiryToMs(expiresAfter: string | undefined): number | undefined {
  if (!expiresAfter) return undefined
  const match = /^(\d+)([mhd])$/.exec(expiresAfter.trim())
  if (!match) return undefined
  const n = Number(match[1])
  return match[2] === 'm' ? n * 60_000 : match[2] === 'h' ? n * 3_600_000 : n * 86_400_000
}

/**
 * Prepare a container image and return the id to start sandboxes from,
 * reusing an in-flight or completed preparation of the same image.
 *
 * `expiresAfter` is the caller's, and the two callers want different
 * things. An explicit `template.create` is something the caller asked to
 * keep, so it keeps it. A `create({ image })` produces one as a side
 * effect the caller never named, and leaving those around forever would
 * accumulate stored bytes nobody asked to pay for, so that one expires.
 */
export async function prepareImage(
  client: GmnClient,
  reference: string,
  ramGib: number | undefined,
  egress: 'open' | 'none' | undefined,
  expiresAfter?: string,
  size?: string,
): Promise<string> {
  checkImageReference(reference)
  const key = prepareKey(client, reference, ramGib, egress, size, expiresAfter)
  const done = prepared.get(key)
  if (done) {
    // Reuse only while it is comfortably alive. A cached id handed out
    // just before its expiry produces a fork failure minutes later,
    // with nothing pointing back at the cache.
    if (done.expiresAtMs === undefined || done.expiresAtMs - PREPARED_REUSE_MARGIN_MS > Date.now()) {
      return done.id
    }
    prepared.delete(key)
  }
  const inFlight = preparing.get(key)
  if (inFlight) return inFlight
  const run = client
    .request<{ snapshot?: string; bake_ms?: number }>(
      'POST',
      '/preview/sandboxes/envs',
      {
        from_image: reference,
        // `size` and `ram_gib` are mutually exclusive at the door, and
        // the size is what fixes BOTH dimensions - so a named size wins
        // and the bare memory ask only travels without one.
        ...(size === undefined ? (ramGib === undefined ? {} : { ram_gib: ramGib }) : { size }),
        ...(egress === undefined ? {} : { egress }),
        ...(expiresAfter === undefined ? {} : { expires_after: expiresAfter }),
      },
      undefined,
      PREPARE_IMAGE_TIMEOUT_MS,
    )
    .then(body => {
      const id = body.snapshot
      if (!id) throw new Error(`givemeanode prepared ${reference} but returned no id`)
      const ttlMs = expiryToMs(expiresAfter)
      prepared.set(key, { id, ...(ttlMs === undefined ? {} : { expiresAtMs: Date.now() + ttlMs }) })
      return id
    })
    .finally(() => {
      preparing.delete(key)
    })
  preparing.set(key, run)
  return run
}

// ------------------------------------------------------------ sandbox ids
//
// A givemeanode sandbox id comes back in one of two forms, and a client
// that assumes one of them is silently wrong about the other.
//
//   sbx-<12 hex>   a plain id
//   sbx-<base64url>  a SIGNED id, carrying its own route and the plain id
//
// Which one you get is not a property of the request: a sandbox served
// from the ready pool - the common, fast case - comes back signed. Both
// work identically for running commands and for deleting, because the
// service accepts either. But the workspace LISTING reports plain ids
// only, so matching a signed id against it by string equality finds
// nothing, and `getInfo` then reports a perfectly healthy sandbox as
// stopped. That is what this decode exists to stop.

const SIGNED_VERSION = 1
const HOSTREF_LEN = 4
const MAC_LEN = 12
const PLAIN_BODY_LEN = 12

/**
 * The plain id inside a signed one, or null for anything else.
 *
 * A faithful port of the service's own normaliser, which is a pure
 * structural decode: no secret, no network, and no attempt to verify the
 * signature - verifying is the service's job and this is only trying to
 * learn which sandbox an id refers to. Every unexpected shape returns
 * null rather than a guess, so if the encoding ever changes this degrades
 * to "cannot tell" rather than to a wrong answer.
 */
export function plainSandboxId(id: string): string | null {
  if (!id.startsWith('sbx-')) return null
  const body = id.slice('sbx-'.length)
  // A plain id is already plain, and is deliberately NOT decoded: 12 hex
  // characters are also valid base64url and would decode to nonsense.
  if (body.length === PLAIN_BODY_LEN && /^[0-9a-f]+$/.test(body)) return null
  let raw: Uint8Array
  try {
    const padded = body.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    raw = Uint8Array.from(binary, c => c.charCodeAt(0))
  } catch {
    return null
  }
  if (raw.length < 4 + HOSTREF_LEN + 1 + MAC_LEN || raw[0] !== SIGNED_VERSION) return null
  const lenAt = 2 + HOSTREF_LEN
  const objectLen = raw[lenAt]
  if (objectLen === undefined) return null
  const internalLenAt = lenAt + 1 + objectLen
  const internalLen = raw[internalLenAt]
  if (internalLen === undefined || internalLen === 0) return null
  const internalAt = internalLenAt + 1
  if (raw.length !== internalAt + internalLen + MAC_LEN) return null
  return new TextDecoder().decode(raw.subarray(internalAt, internalAt + internalLen))
}

/** Do these two ids name the same sandbox, in either form? */
export function sameSandbox(a: string, b: string): boolean {
  if (a === b) return true
  const pa = plainSandboxId(a) ?? a
  const pb = plainSandboxId(b) ?? b
  return pa === pb
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
  // first call down the ordinary authentication path.
  await client.prime()

  // Restoring from a snapshot or a template is a different route, and a
  // different response shape, from a create.
  const from = forkableFrom(options)
  if (from) return forkSnapshot(client, from, options, execRetries)
  // A `snapshotId` that is not forkable is a REFUSAL, never a silent
  // fresh sandbox. Dropping it started the default image and handed back
  // a healthy-looking box with none of the caller's state in it - the
  // one outcome a restore must never produce, because whatever runs next
  // scores a sandbox that never had the work.
  //
  // `templateId` is deliberately NOT included: it has three legitimate
  // spellings here - an `env-` id, a container image reference, and a
  // curated image name like "sbx-min" - and the image paths below refuse
  // a malformed one with a message about images. A snapshot id has
  // exactly one spelling.
  if (options?.snapshotId && !options.snapshotId.startsWith('env-')) {
    throw new Error(
      `givemeanode cannot restore from ${options.snapshotId}: a snapshot id starts with ` +
        "'env-' (snapshot.create returns one). Starting a blank sandbox instead would " +
        'lose the state you asked to restore.',
    )
  }

  const ramGib = ramGibFrom(configRamGib, options)
  const egress = options?.egress ?? configEgress
  // Resolved BEFORE the image branch, because the size is fixed at the
  // bake: an image create that computed it after the branch asked for 8
  // vCPUs and silently got one (the caller pays for one core and their
  // build takes eight times as long).
  const explicitSize = typeof options?.size === 'string' ? options.size : undefined
  const vcpus = requestedVcpus(options)
  const derivedSize = explicitSize ?? (vcpus === undefined ? undefined : sizeFor(vcpus, ramGib))

  // A CONTAINER IMAGE is prepared once and then started from, because
  // `create` itself only accepts a curated name. The preparation is
  // cached and single-flighted, so N creates from one reference prepare it
  // once; the id it yields expires on its own, because the caller asked
  // for a sandbox rather than for a template to keep. A caller who wants
  // to keep it calls `prepareImage` (template.create) and passes the id
  // back as `templateId`.
  const named = options?.image ?? options?.templateId
  if (named && isImageReference(named)) {
    const templateId = await prepareImage(
      client,
      named,
      ramGib,
      egress,
      CREATE_IMAGE_EXPIRY,
      derivedSize,
    )
    return forkSnapshot(client, templateId, options, execRetries, { fromImage: named })
  }
  if (named) checkImageReference(named)

  // `size` and `ram_gib` are mutually exclusive at the door, because a named
  // size already fixes both dimensions. An explicit size wins; otherwise a
  // vCPU ask derives one, and a bare memory ask stays on `ram_gib` so a
  // caller who wants 6 GiB on one core still gets exactly that rather than
  // being rounded up into a multi-core shape it would be billed for.
  // (Both resolved above, so the image branch gets them too.)
  const created = await client.request<CreateResponse>(
    'POST',
    '/preview/sandboxes',
    {
      image: named ?? DEFAULT_IMAGE,
      ...(derivedSize === undefined
        ? ramGib === undefined
          ? {}
          : { ram_gib: ramGib }
        : { size: derivedSize }),
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
  // `sameSandbox`, not `===`: the caller may hold a signed id while the
  // listing reports the plain one.
  const found = all.find(handle => sameSandbox(handle.id, sandboxId))
  if (!found) return null
  // Answer with the id the CALLER asked about. It is the one they can use,
  // and handing back a different string for the same sandbox is the kind
  // of surprise that shows up much later as a failed lookup.
  return { ...found, id: sandboxId }
}

/**
 * `getUrl({port})` - a public HTTPS URL that reaches a port inside the
 * sandbox.
 *
 * Never builds the hostname here. The apex is per-deployment and the
 * capability secret is minted server-side, so the URL can only come from
 * the response. Idempotent per (sandbox, port), which is what makes it
 * safe to call every time a caller needs the URL rather than caching one.
 *
 * `protocol` may be `https` (the default) or `wss`, and `wss` only swaps
 * the scheme on the same URL: the edge splices a 101 upgrade through to
 * the port, so one endpoint serves both. Anything else is refused rather
 * than silently answered with an https URL - there is no plaintext door,
 * and a caller who asked for http has to know that.
 */
export async function exposePort(
  sandbox: SandboxHandle,
  options: { port: number; protocol?: string },
): Promise<string> {
  const { port, protocol } = options
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(
      `getUrl: port ${port} is not exposable. Exposable ports are 1024-65535 (a dev server's ` +
        '3000, 5173, 8000), and the server has to be listening on the sandbox\'s 127.0.0.1.',
    )
  }
  const scheme = (protocol ?? 'https').replace(/:$/, '').toLowerCase()
  if (scheme !== 'https' && scheme !== 'wss') {
    throw new Error(
      `getUrl: protocol ${protocol} is not available. The endpoint is TLS-only at the edge, so ` +
        "'https' (the default) and 'wss' are the two schemes it answers on.",
    )
  }
  const body = await sandbox.client.request<{ url?: string }>(
    'POST',
    `/preview/sandboxes/${encodeURIComponent(plainOrSigned(sandbox.id))}/expose`,
    { port },
  )
  if (!body?.url) {
    throw new Error('getUrl: the API returned no url for the exposed port')
  }
  // The same endpoint, addressed as a websocket. Swapped here rather
  // than asked of the API, because it is one endpoint either way and the
  // API should not have to mint two URLs for one door.
  return scheme === 'wss' ? body.url.replace(/^https:/, 'wss:') : body.url
}

/** `unexpose`: close the public door again. */
export async function unexposePort(sandbox: SandboxHandle, port: number): Promise<void> {
  await sandbox.client.request(
    'POST',
    `/preview/sandboxes/${encodeURIComponent(plainOrSigned(sandbox.id))}/unexpose`,
    { port },
  )
}

/**
 * The id to put in a path. Signed ids are base64url and safe in a path
 * segment; this exists so that intent is explicit rather than incidental,
 * and so a future id shape has one place to be handled.
 */
function plainOrSigned(id: string): string {
  return id
}

export async function destroySandbox(client: GmnClient, sandboxId: string): Promise<void> {
  // The array route rather than `DELETE /preview/sandboxes/{id}`: the same
  // effect for one, and it is the shape a teardown of N uses. An
  // already-gone sandbox comes back in the per-item result rather than
  // refusing the call, so destroy is idempotent.
  await client.request('POST', '/preview/sandboxes/deletes', { sandboxes: [sandboxId] })
}

/**
 * The phrase for a command whose delivery did not complete.
 *
 * It is a TRANSPORT failure rather than a command failure: the connection
 * to a sandbox is re-established on demand, so the first command after a
 * quiet stretch can find it closed. The documented answer is to retry,
 * and a retry redials. Matched on the phrase because it arrives in the
 * result's `error` string with no code; anything else with a missing exit
 * code is not retried.
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
    // The command's deadline and the HTTP deadline are different things, and
    // the second must not be the shorter one. `deadline_ms` may be up to ten
    // minutes while the client's default request timeout is two, so without
    // this a command legitimately running longer than the client default is
    // aborted HERE while it carries on in the sandbox - and the caller is
    // told a command failed that in fact succeeded. A caller who set a
    // larger client timeout keeps it.
    const deadlineMs = options?.timeout ?? DEFAULT_TIMEOUT_MS
    const requestTimeoutMs = Math.max(sandbox.client.timeout, deadlineMs + EXEC_DEADLINE_HEADROOM_MS)
    const body = await sandbox.client.request<{ results?: ExecResult[] }>(
      'POST',
      '/preview/sandboxes/execs',
      { execs: [{ sandbox: sandbox.id, cmd, deadline_ms: deadlineMs }] },
      undefined,
      requestTimeoutMs,
    )
    const result = body.results?.[0]
    if (!result) throw new Error(`givemeanode exec returned no result for ${sandbox.id}`)
    // An undelivered command comes back as `{sandbox, error}` with NO
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
    // A command's stdout caps at 1 MiB and past that the door returns a
    // PREFIX with `truncated: true`. Dropping that flag is how a caller
    // parsing structured output reads a clean prefix and concludes the run
    // finished, so it is surfaced on stderr where a human and a log both
    // see it. Measured: the cap is exactly 1048576 bytes.
    const truncationNote = result.truncated
      ? `[givemeanode] stdout was TRUNCATED at ${(result.stdout ?? '').length} bytes ` +
        "(the door's 1 MiB per-command cap). For output this large, redirect it to a " +
        'file in the sandbox and read it back with filesystem.readFile.'
      : undefined
    const stderr = result.stderr ?? ''
    return {
      stdout: result.stdout ?? '',
      stderr: truncationNote === undefined ? stderr : stderr ? `${stderr}\n${truncationNote}` : truncationNote,
      exitCode: result.exit_code,
      durationMs: result.duration_ms ?? Date.now() - started,
      truncated: result.truncated === true,
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
    // The listing is authoritative rather than a cache, so absence means
    // the sandbox is gone, not that the read was stale.
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

/**
 * The workspace's snapshots, newest-first as the door returns them.
 *
 * `limit` is applied here because the door has no limit parameter on
 * this read; honouring it client-side is the difference between a caller
 * asking for ten and getting ten, and asking for ten and getting all of
 * them. `sandboxId` CANNOT be honoured and says so instead of filtering
 * to nothing: a givemeanode snapshot records the snapshot it descends
 * from, never the sandbox that captured it, so there is no field to
 * match. Silently returning everything for that filter would be the
 * worse answer - a caller deleting "this sandbox's snapshots" would
 * delete the workspace's.
 */
export async function listSnapshots(
  client: GmnClient,
  options?: { sandboxId?: string; limit?: number },
): Promise<SnapshotShape[]> {
  if (options?.sandboxId) {
    throw new Error(
      'givemeanode cannot list snapshots by source sandbox: a snapshot records its parent ' +
        'snapshot, not the sandbox that captured it. List them all and match on your own ' +
        'metadata instead.',
    )
  }
  const stats = await client.request<StatsResponse>('GET', '/preview/sandboxes')
  const all = (stats.snapshots ?? []).map(s => ({
    id: s.id,
    provider: 'givemeanode',
    createdAt: s.created_at ? new Date(s.created_at) : new Date(),
    metadata: { ramGib: s.ram_gib, egress: s.egress, durable: s.durable },
  }))
  const limit = options?.limit
  return typeof limit === 'number' && limit >= 0 ? all.slice(0, limit) : all
}

export async function deleteSnapshot(client: GmnClient, snapshotId: string): Promise<void> {
  try {
    await client.request('DELETE', `/preview/sandboxes/snapshots/${encodeURIComponent(snapshotId)}`)
  } catch (err) {
    // Idempotent for the ONE case that means "already the state the
    // caller asked for": the snapshot is not there. Everything else -
    // a rejected credential, a refusal, a 500, a dropped connection -
    // leaves the snapshot stored AND BILLING, so reporting success for
    // it tells the caller their storage meter stopped when it did not.
    // Read the status structurally rather than importing GmnError: this
    // module is loaded by the node test runner with types stripped, so a
    // VALUE import of './client.js' would not resolve there (the type
    // import above is erased). GmnError is the only thing that carries a
    // numeric `status`.
    const status = (err as { status?: unknown } | null | undefined)?.status
    if (status === 404) return
    throw err
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
    // A read that hit the exec channel's 1 MiB output cap is a PREFIX,
    // and returning it as the file is the worst shape of wrong: a caller
    // that reads, edits and writes back would silently truncate the
    // file on disk. The cap is the transport's, so the answer is a
    // different transport (an export), not a bigger buffer.
    if (r.truncated) {
      throw new Error(
        `${path} is larger than the 1 MiB an exec can return, so reading it here would ` +
          'give you a prefix rather than the file. Split it in the sandbox, or move it out ' +
          'with an export instead.',
      )
    }
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

/**
 * `ls -la` output to entries. Exported so a test can feed it real output.
 *
 * THE NAME IS TAKEN BY OFFSET, NOT BY REJOINING COLUMNS. Splitting on
 * whitespace and joining the tail with single spaces rewrites every name
 * that contains two consecutive spaces, so `readdir` handed back a
 * string that addresses a different file - or none. The eight metadata
 * columns are matched with one anchored expression instead, and
 * everything after them is the name verbatim.
 *
 * A symlink's `name -> target` suffix is stripped, because the target is
 * not part of the name either: `link -> /etc/passwd` is not something a
 * caller can pass back to readFile.
 */
export function parseLsLong(stdout: string): FileEntryShape[] {
  // mode links owner group size <date, three fields> then the name.
  const row = /^([bcdlps-][rwxsStT-]{9}[.+]?)\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+\S+\s(.*)$/
  const entries: FileEntryShape[] = []
  for (const line of stdout.split('\n')) {
    if (!line.trim() || line.startsWith('total ')) continue
    const match = row.exec(line)
    if (!match) continue
    const [, mode, size, rest] = match
    // A link row is `name -> target`; the arrow cannot appear in a real
    // name at that position because ls would have escaped nothing and
    // the target follows it.
    const name = mode.startsWith('l') ? rest.replace(/ -> .*$/, '') : rest
    if (!name || name === '.' || name === '..') continue
    entries.push({
      name,
      type: mode.startsWith('d') ? 'directory' : 'file',
      size: Number.parseInt(size, 10) || 0,
    })
  }
  return entries
}
