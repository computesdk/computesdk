/**
 * Minimal HTTP client for the Uno box API.
 *
 * The API is a small JSON surface (`/api/v1/boxes`), so this talks to it with
 * `fetch` and has no dependencies. Everything that touches the network lives
 * here; `./index` only maps ComputeSDK's interface onto these calls.
 *
 * @see https://uno.place/docs/api
 */

export const DEFAULT_BASE_URL = 'https://console.uno4.dev'
/**
 * How long POST /boxes may take: a busy console can hold it well past the 30 s
 * of plain calls, plus up to 30 s more when it is asked to wait for readiness.
 */
const CREATE_TIMEOUT_MS = 120_000
/** The longest readiness wait the API holds a response for (`wait_ready_s`). */
export const MAX_WAIT_READY_S = 30
/** Delete and read retries, see {@link UnoClient.deleteBox} and {@link UnoClient.getBox}. Both normally answer in ~30 ms. */
const DELETE_ATTEMPTS = 4
const DELETE_RETRY_DELAYS_MS = [250, 1_000, 2_000]
const DELETE_TIMEOUT_MS = 15_000
/** Readiness polling cadence, see {@link UnoClient.waitReady}. */
const READY_POLL_FAST_MS = 100
const READY_POLL_FAST_WINDOW_MS = 10_000
const READY_POLL_SLOW_MS = 1_000
/** How often to try again while the API says a box is busy with another command. */
const BUSY_RETRY_MS = 150
/** How long sleep/wake (and a short command) keep trying while the box is busy. */
const BUSY_WAIT_MS = 60_000
/** Upper bound for one file transfer through the native file API. */
const FILE_TIMEOUT_MAX_MS = 15 * 60_000
/** Default for {@link UnoClientOptions.pauseInMemoryS}. */
const DEFAULT_PAUSE_IN_MEMORY_S = 300
/** How long one readiness poll asks the API to hold the answer (`GET /boxes/{id}?wait_ready_s`). */
const READY_POLL_HOLD_S = 5

/** Box JSON as returned by `GET /api/v1/boxes/{id}` (fields this package reads). */
export interface UnoBox {
  id: number
  name: string
  status: string
  provision_state?: string
  provision_error?: string
  vcpu: number
  ram_mb: number
  disk_gb: number
  created_at: string
  hostname?: string
  url?: string
  ssh_command?: string
  network_region?: string
  max_lifetime_s?: number
  comment?: string
  /** The box this one was cloned from (`POST /boxes/{id}/clone`), if any. */
  clone_of?: number | null
  /** How a `wait_ready_s` wait ended; present only when the request asked for one. */
  wait?: { outcome: string; ready: boolean; waited_ms: number }
  [key: string]: unknown
}

export interface UnoCreateBoxRequest {
  template: string
  vcpu: number
  ram_mb: number
  disk_gb: number
  name?: string
  region?: string
  ssh_key?: string
  comment?: string
}

/** A run as returned by `POST /boxes/{id}/run` (200) or `GET /boxes/{id}/runs/{rid}`. */
export interface UnoRun {
  run_id?: string
  id?: string
  status: 'running' | 'finished' | 'error'
  exit_code?: number
  stdout?: string
  stderr?: string
  stdout_truncated?: boolean
  stderr_truncated?: boolean
  duration_ms?: number
  error_code?: string
  command_started?: boolean | null
  retry_safe?: boolean
}

export interface UnoClientOptions {
  /** Account API key or a token with `boxes:read`, `boxes:write` and `infra:purchase`. Falls back to `UNO_API_KEY`. */
  apiKey?: string
  /** API base URL. Falls back to `UNO_API_URL`, then {@link DEFAULT_BASE_URL}. */
  baseUrl?: string
  /** Per-request timeout for plain API calls, in ms. Default 30 000. */
  requestTimeoutMs?: number
  /**
   * How long `pause()` keeps a machine paused in memory before it goes to
   * sleep on disk on its own, in seconds (1–3600). Default 300. A paused
   * machine resumes in milliseconds and counts as running while it waits;
   * `0` pauses straight to disk.
   */
  pauseInMemoryS?: number
}

export class UnoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly body?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'UnoError'
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export class UnoClient {
  readonly baseUrl: string
  private readonly apiKey: string
  private readonly requestTimeoutMs: number
  private readonly pauseInMemoryS: number

  constructor(options: UnoClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.UNO_API_KEY
    if (!apiKey) {
      throw new Error(
        'Missing Uno API key.\n\n' +
          'Create one in the Uno console (Settings → API keys),\n' +
          'then pass it: uno({ apiKey: "..." }) or set UNO_API_KEY in your environment.',
      )
    }
    const baseUrl = (options.baseUrl ?? process.env.UNO_API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl)) {
      throw new Error(`Uno base URL must be https:// (got ${baseUrl})`)
    }
    this.apiKey = apiKey
    this.baseUrl = baseUrl
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000
    const ramS = options.pauseInMemoryS ?? DEFAULT_PAUSE_IN_MEMORY_S
    this.pauseInMemoryS = Number.isFinite(ramS) ? Math.min(3600, Math.max(0, Math.floor(ramS))) : DEFAULT_PAUSE_IN_MEMORY_S
  }

  /**
   * Send one HTTP request and return the raw response (redirects refused).
   * `body` is sent as JSON unless it is a Uint8Array, which goes as raw bytes.
   */
  private async send(
    method: string,
    path: string,
    body: unknown,
    opts: { timeoutMs?: number; signal?: AbortSignal; contentType?: string },
  ): Promise<Response> {
    // Let the previous response's socket go back to the pool first. A fetch
    // started in the same tick as the last `res.text()` resolved opens a new
    // connection, and a new connection can reach the API through a different
    // edge server with a cold link to the origin (+0.2 s). Costs ~1 ms.
    await sleep(0)
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? this.requestTimeoutMs)
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
    const raw = body instanceof Uint8Array
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: opts.contentType ?? 'application/json',
        ...(body !== undefined ? { 'Content-Type': raw ? 'application/octet-stream' : 'application/json' } : {}),
        'User-Agent': '@computesdk/uno',
      },
      body: body === undefined ? undefined : raw ? (body as Uint8Array as unknown as BodyInit) : JSON.stringify(body),
      signal,
      // Never follow a redirect: fetch would resend the bearer token to wherever it points.
      redirect: 'manual',
    })
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      throw new UnoError(
        `Uno API ${method} ${path} → ${res.status} redirect; not following it with your API key (check the base URL)`,
        res.status,
        'REDIRECT',
      )
    }
    return res
  }

  /**
   * One HTTP call. Returns status + parsed JSON body; throws {@link UnoError}
   * for any status not listed in `accept`.
   */
  async request<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    opts: { accept?: number[]; timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<{ status: number; body: T; headers: Headers }> {
    const accept = opts.accept ?? [200, 201]
    const res = await this.send(method, path, body, { timeoutMs: opts.timeoutMs, signal: opts.signal })
    const parsed = parseJsonBody(await res.text())
    if (!accept.includes(res.status)) throw apiError(method, path, res.status, parsed)
    return { status: res.status, body: parsed as T, headers: res.headers }
  }

  /**
   * Create a box. With `waitReadyS` the server holds the answer until the box
   * is running and provisioned, its start fails, or that many seconds pass
   * (at most {@link MAX_WAIT_READY_S}), and says how the wait ended in `wait`.
   * A server that does not know the parameter answers at once, as without it.
   */
  async createBox(req: UnoCreateBoxRequest, signal?: AbortSignal, opts: { waitReadyS?: number } = {}): Promise<UnoBox> {
    const waitS = Math.min(MAX_WAIT_READY_S, Math.max(0, Math.floor(opts.waitReadyS ?? 0)))
    const path = waitS > 0 ? `/api/v1/boxes?wait_ready_s=${waitS}` : '/api/v1/boxes'
    return (await this.request<UnoBox>('POST', path, req, { accept: [201, 200], signal, timeoutMs: CREATE_TIMEOUT_MS })).body
  }

  /**
   * The box whose `comment` is exactly `marker` (a per-request UUID), created
   * at or after `since` (ms epoch). Looks up to `attempts` times, 2 s apart: a
   * create the connection lost may show up in the list a moment later.
   */
  async findBoxByMarker(marker: string, since: number, attempts = 1): Promise<UnoBox | null> {
    for (let i = 0; ; i++) {
      const found = (await this.listBoxes()).find(b => b.comment === marker && Date.parse(b.created_at) >= since)
      if (found || i + 1 >= attempts) return found ?? null
      await sleep(2_000)
    }
  }

  /**
   * Fetch one box, or `null` if it does not exist. A read is safe to repeat,
   * so a GET lost on the way (dropped connection, timeout, 429, 5xx) is tried
   * again like a delete: up to {@link DELETE_ATTEMPTS} times over ~3 s. Without
   * this, one dropped readiness poll right after create failed the whole create
   * and threw away a machine that was booting fine.
   */
  async getBox(id: string | number, opts: { waitReadyS?: number } = {}): Promise<UnoBox | null> {
    const waitS = Math.min(MAX_WAIT_READY_S, Math.max(0, Math.floor(opts.waitReadyS ?? 0)))
    const path = `/api/v1/boxes/${encodeURIComponent(String(id))}` + (waitS > 0 ? `?wait_ready_s=${waitS}` : '')
    for (let attempt = 0; ; attempt++) {
      try {
        return (await this.request<UnoBox>('GET', path, undefined, waitS > 0 ? { timeoutMs: this.requestTimeoutMs + waitS * 1000 } : {})).body
      } catch (err) {
        if (err instanceof UnoError && (err.status === 404 || err.code === 'INVALID_ID')) return null
        if (attempt + 1 >= DELETE_ATTEMPTS || !isTransient(err)) throw err
        await sleep(DELETE_RETRY_DELAYS_MS[attempt] ?? 2_000)
      }
    }
  }

  async listBoxes(): Promise<UnoBox[]> {
    const { body } = await this.request<{ boxes?: UnoBox[] }>('GET', '/api/v1/boxes')
    return body.boxes ?? []
  }

  /**
   * Delete a box; a box that is already gone is not an error.
   *
   * A delete lost on the way (dropped connection, timeout, 429, a 5xx from the
   * edge) would leave the machine running and fail the caller's cleanup, so it
   * is tried again: up to {@link DELETE_ATTEMPTS} times over ~3 s. DELETE is
   * idempotent, and a repeat of a delete that did land answers 404 — done.
   */
  async deleteBox(id: string | number): Promise<void> {
    const path = `/api/v1/boxes/${encodeURIComponent(String(id))}?purge=now`
    for (let attempt = 0; ; attempt++) {
      try {
        await this.request('DELETE', path, undefined, { accept: [200, 202, 204, 404], timeoutMs: DELETE_TIMEOUT_MS })
        return
      } catch (err) {
        if (attempt + 1 >= DELETE_ATTEMPTS || !isTransient(err)) throw err
        await sleep(DELETE_RETRY_DELAYS_MS[attempt] ?? 2_000)
      }
    }
  }

  /**
   * Copy a box into a new one (`POST /boxes/{id}/clone`). The API pauses a
   * running source for a copy-on-write copy of its disk (milliseconds), resumes
   * it, and boots the copy from that disk; memory is not copied. Returns the
   * new box, still `provisioning`: wait for it with {@link waitReady}.
   *
   * With `start: false` the API copies the disk only and answers once the
   * copy is on the server, already `stopped` (see {@link isStoppedCopy}). An
   * API without that option ignores it and boots the copy as usual.
   */
  async cloneBox(id: string | number, opts: { name?: string; signal?: AbortSignal; start?: boolean } = {}): Promise<UnoBox> {
    const { body } = await this.request<{ boxes?: UnoBox[] }>(
      'POST',
      `/api/v1/boxes/${encodeURIComponent(String(id))}/clone`,
      { count: 1, ...(opts.name ? { name: opts.name } : {}), ...(opts.start === false ? { start: false } : {}) },
      { accept: [201, 200], signal: opts.signal, timeoutMs: CREATE_TIMEOUT_MS },
    )
    const created = body.boxes?.[0]
    if (!created) throw new UnoError(`Uno API cloned no box from ${id}`, 502, 'BAD_RESPONSE', body as Record<string, unknown>)
    return created
  }

  /** The box named exactly `name`, created at or after `since` (ms epoch), if any. */
  async findBoxByName(name: string, since: number): Promise<UnoBox | null> {
    return (await this.listBoxes()).find(b => b.name === name && Date.parse(b.created_at) >= since) ?? null
  }

  /**
   * Put a box to sleep: its memory and disk are saved on the node and the
   * machine stops using CPU and RAM. Sleeping an already sleeping box is a
   * no-op. Retries briefly while the box is busy (a command or a start is
   * still finishing).
   */
  async sleepBox(id: string | number): Promise<void> {
    await this.lifecycle(id, 'sleep')
  }

  /** Wake a sleeping box with its memory as it was: processes keep running. */
  async wakeBox(id: string | number): Promise<void> {
    await this.lifecycle(id, 'wake')
  }

  /**
   * Pause a box in memory (`POST /boxes/{id}/sleep?mode=ram`): it stops where
   * it runs and keeps its memory on the server, so {@link wakeBox} resumes it
   * in milliseconds. After {@link UnoClientOptions.pauseInMemoryS} seconds it
   * goes to sleep on disk on its own. An API without the option sleeps the
   * box on disk instead (it ignores `mode`); one that refuses it gets a plain
   * {@link sleepBox}. Returns the state the API reports: `paused_ram` or
   * `sleeping`.
   */
  async pauseBox(id: string | number): Promise<string> {
    if (this.pauseInMemoryS <= 0) {
      await this.sleepBox(id)
      return 'sleeping'
    }
    try {
      const body = await this.lifecycle(id, 'sleep', `?mode=ram&ram_s=${this.pauseInMemoryS}`)
      return typeof body.status === 'string' ? body.status : 'sleeping'
    } catch (err) {
      if (!(err instanceof UnoError) || !refusesOption(err, 'INVALID_SLEEP_MODE')) throw err
      await this.sleepBox(id)
      return 'sleeping'
    }
  }

  private async lifecycle(id: string | number, action: 'sleep' | 'wake', query = ''): Promise<Record<string, unknown>> {
    const path = `/api/v1/boxes/${encodeURIComponent(String(id))}/${action}${query}`
    const deadline = Date.now() + BUSY_WAIT_MS
    for (let failures = 0; ; ) {
      try {
        return (await this.withBoxTurn(id, () => this.request('POST', path, undefined, { timeoutMs: 120_000 }))).body
      } catch (err) {
        // BOX_BUSY: a command's tail or a start is still finishing; it frees up in well under a second.
        if (isBusy(err) && Date.now() < deadline) {
          await sleep(BUSY_RETRY_MS)
          continue
        }
        // Both calls are idempotent (sleeping a sleeping box, waking a running one are no-ops),
        // so a dropped connection or an edge 5xx is safe to repeat; a 500 from the API is a real failure.
        if (++failures > 3 || !isRetryableRunError(err)) throw err
        await sleep(retryDelayMs(err, failures - 1))
      }
    }
  }

  /**
   * Whether the API serves the native file endpoints (`/boxes/{id}/files`).
   * `undefined` until a file call finds out; `false` means every file
   * operation goes through commands, as before the endpoints existed.
   */
  nativeFiles: boolean | undefined

  /**
   * Machines that answered 501 (an older node, a Work trial): the file API
   * is on for the account but not for them. Asked once; each probe would
   * leave a failed "[files] …" line in the machine's run history.
   */
  private readonly noFilesOn = new Set<string>()

  /**
   * Read a whole file through the native file API. Returns `null` when the
   * API has no file endpoint (an older server, or not enabled for this
   * account); the caller then reads through commands. Throws `FILE_NOT_FOUND`
   * for a missing file and `IS_A_DIRECTORY` for a directory.
   */
  async readFileNative(id: string | number, path: string): Promise<Buffer | null> {
    if (this.nativeFiles === false || this.noFilesOn.has(String(id))) return null
    const url = filesUrl(id, path)
    const busyDeadline = Date.now() + BUSY_WAIT_MS
    for (let attempt = 0; ; ) {
      try {
        const res = await this.send('GET', url, undefined, { contentType: 'application/octet-stream', timeoutMs: FILE_TIMEOUT_MAX_MS })
        if (res.status === 200 && (res.headers.get('content-type') ?? '').startsWith('application/octet-stream')) {
          this.nativeFiles = true
          return Buffer.from(await res.arrayBuffer())
        }
        const text = await res.text()
        // A 200 that is not file bytes is the console's web app answering an unknown path.
        const missing = res.status === 200 ? 'off' : noNativeFiles(res.status, text)
        if (missing) {
          if (missing === 'off') this.nativeFiles = false
          else this.noFilesOn.add(String(id))
          return null
        }
        throw apiError('GET', url, res.status, parseJsonBody(text))
      } catch (err) {
        if (isBusy(err) && Date.now() < busyDeadline) {
          await sleep(BUSY_RETRY_MS)
          continue
        }
        if (attempt >= 4 || !isRetryableFileError(err)) throw err
        await sleep(retryDelayMs(err, attempt++))
      }
    }
  }

  /**
   * Write `data` to `path` through the native file API: parent directories
   * are created and the file is replaced atomically (`append: true` adds to
   * the end instead, not atomically). Returns `false` when the API has no file
   * endpoint; the caller then writes through commands.
   */
  async writeFileNative(id: string | number, path: string, data: Uint8Array, opts: { append?: boolean } = {}): Promise<boolean> {
    if (this.nativeFiles === false || this.noFilesOn.has(String(id))) return false
    const url = filesUrl(id, path) + (opts.append ? '&append=1' : '')
    // ~1 s per MiB on top of a minute: a slow link must not abort a large file half-way.
    const timeoutMs = Math.min(FILE_TIMEOUT_MAX_MS, 60_000 + Math.ceil(data.length / (1024 * 1024)) * 1_000)
    const busyDeadline = Date.now() + BUSY_WAIT_MS
    for (let attempt = 0; ; ) {
      try {
        const res = await this.send('PUT', url, data, { timeoutMs })
        const text = await res.text()
        const parsed = parseJsonBody(text)
        if (res.status === 200 && typeof parsed.size === 'number') {
          this.nativeFiles = true
          if (parsed.size !== data.length) {
            throw new UnoError(`Uno wrote ${parsed.size} of ${data.length} bytes to ${path}`, 502, 'SHORT_WRITE', parsed)
          }
          return true
        }
        const missing = res.status === 200 ? 'off' : noNativeFiles(res.status, text)
        if (missing) {
          if (missing === 'off') this.nativeFiles = false
          else this.noFilesOn.add(String(id))
          return false
        }
        throw apiError('PUT', url, res.status, parsed)
      } catch (err) {
        // BOX_BUSY is an answer before anything was written, so even an append may try again.
        if (isBusy(err) && Date.now() < busyDeadline) {
          await sleep(BUSY_RETRY_MS)
          continue
        }
        // A whole-file write replaces the file atomically, so repeating it is harmless; an append is not.
        if (opts.append || attempt >= 4 || !isRetryableFileError(err)) throw err
        await sleep(retryDelayMs(err, attempt++))
      }
    }
  }

  /** Commands in flight per box, see {@link withBoxTurn}. */
  private readonly boxTurns = new Map<string, Promise<unknown>>()

  /**
   * Run `fn` when this client's previous command on the same box has
   * finished. The API runs one command per box at a time and answers a second
   * one with `BOX_BUSY`; queueing here, instead of retrying with backoff,
   * starts each command the moment the previous one is done.
   */
  private async withBoxTurn<T>(id: string | number, fn: () => Promise<T>): Promise<T> {
    const key = String(id)
    const previous = this.boxTurns.get(key) ?? Promise.resolve()
    const mine = previous.then(fn, fn)
    const settled = mine.then(
      () => {},
      () => {},
    )
    this.boxTurns.set(key, settled)
    try {
      return await mine
    } finally {
      if (this.boxTurns.get(key) === settled) this.boxTurns.delete(key)
    }
  }

  /**
   * Poll until the box is running and provisioned. Create without a wait
   * returns at once with `status: "provisioning"`; the machine is usually
   * ready a second or two later. The box is checked every 100 ms for the
   * first 10 s, then once a second. The interval counts from the start of
   * each request, so the round trip does not add to it and a box is never
   * polled more than 10 times a second.
   *
   * `waitedMs` is time already spent waiting for this box (by the server,
   * while it held create) and counts against `timeoutMs`.
   */
  async waitReady(id: string | number, timeoutMs: number, signal?: AbortSignal, waitedMs = 0): Promise<UnoBox> {
    const started = Date.now()
    const deadline = started + timeoutMs - waitedMs
    for (;;) {
      signal?.throwIfAborted()
      const polledAt = Date.now()
      // The API holds this answer until the box is ready (up to a few seconds),
      // so a ready box is seen the moment it is, not on the next 100 ms tick.
      // An API without the parameter answers at once, and polling goes on as before.
      const left = Math.floor((deadline - Date.now()) / 1000)
      const box = await this.getBox(id, { waitReadyS: Math.min(READY_POLL_HOLD_S, left) })
      if (!box) throw new UnoError(`Uno box ${id} disappeared while starting`, 404, 'NOT_FOUND')
      if (isReadyOrThrow(box)) return box
      const interval = polledAt - started < READY_POLL_FAST_WINDOW_MS ? READY_POLL_FAST_MS : READY_POLL_SLOW_MS
      const delay = Math.max(0, polledAt + interval - Date.now())
      if (Date.now() + delay > deadline) {
        throw new UnoError(`Uno box ${id} not ready after ${timeoutMs} ms (status ${box.status})`, 504, 'READY_TIMEOUT', box)
      }
      if (delay > 0) await sleep(delay)
    }
  }

  /**
   * Run a command and wait for its result.
   *
   * The server holds the request for up to `waitS` seconds; longer commands
   * come back as 202 + run id and are long-polled, so no single HTTP response
   * outlives proxy idle limits (~100 s). Every attempt carries the same
   * idempotency key, so a retry after a dropped connection returns the run
   * already recorded instead of starting the command twice.
   */
  async run(
    id: string | number,
    payload: { cmd: string; env?: Record<string, string>; timeout_s: number },
    opts: { waitS?: number; idempotencyKey?: string } = {},
  ): Promise<UnoRun> {
    // One command per box at a time on the API side: queue this client's commands
    // for the same box here rather than have them bounce off BOX_BUSY.
    return this.withBoxTurn(id, () => this.runNow(id, payload, opts))
  }

  private async runNow(
    id: string | number,
    payload: { cmd: string; env?: Record<string, string>; timeout_s: number },
    opts: { waitS?: number; idempotencyKey?: string },
  ): Promise<UnoRun> {
    const waitS = opts.waitS ?? 50
    const idempotencyKey = opts.idempotencyKey ?? crypto.randomUUID()
    const path = `/api/v1/boxes/${encodeURIComponent(String(id))}/run`
    const body = { ...payload, wait_s: Math.min(waitS, payload.timeout_s), idempotency_key: idempotencyKey }

    let run: UnoRun | undefined
    // BOX_BUSY here means another client (or process) has a command on this box:
    // keep trying at a short, steady interval for as long as this command may take.
    const busyDeadline = Date.now() + Math.max(BUSY_WAIT_MS, payload.timeout_s * 1000)
    for (let attempt = 0; ; ) {
      try {
        const res = await this.request<UnoRun>('POST', path, body, {
          accept: [200, 202],
          timeoutMs: (body.wait_s + 30) * 1000,
        })
        run = res.body
        break
      } catch (err) {
        if (isBusy(err) && Date.now() < busyDeadline) {
          await sleep(BUSY_RETRY_MS)
          continue
        }
        if (attempt >= 4 || !isRetryableRunError(err)) throw err
        await sleep(retryDelayMs(err, attempt++))
      }
    }

    const runId = run.run_id ?? run.id
    const deadline = Date.now() + (payload.timeout_s + 60) * 1000
    while (run.status === 'running') {
      if (!runId) throw new UnoError('Uno API returned a running run without run_id', 502, 'BAD_RESPONSE')
      if (Date.now() > deadline) throw new UnoError(`Uno run ${runId} still running past its timeout`, 504, 'EXEC_TIMEOUT')
      try {
        run = (
          await this.request<UnoRun>(
            'GET',
            `/api/v1/boxes/${encodeURIComponent(String(id))}/runs/${encodeURIComponent(runId)}?wait_s=${waitS}`,
            undefined,
            { timeoutMs: (waitS + 30) * 1000 },
          )
        ).body
      } catch (err) {
        if (!isTransient(err)) throw err
        await sleep(1_000)
      }
    }

    if (run.status === 'error') {
      throw new UnoError(
        `Uno run ${runId ?? ''} failed: ${run.error_code ?? 'unknown error'}` +
          (run.command_started ? ' (the command had started)' : ''),
        503,
        run.error_code,
        run as unknown as Record<string, unknown>,
      )
    }
    return run
  }
}

/**
 * True once a box is running and provisioned, false while it is still
 * starting; throws `PROVISION_FAILED` if its start failed.
 */
export function isReadyOrThrow(box: UnoBox): boolean {
  if (box.status === 'running' && box.provision_state === 'ready') return true
  if (box.status === 'error' || box.provision_state === 'failed') {
    throw new UnoError(
      `Uno box ${box.id} failed to start${box.provision_error ? `: ${box.provision_error}` : ''}`,
      500,
      'PROVISION_FAILED',
      box,
    )
  }
  return false
}

/**
 * A box the API copied without starting it (`clone` with `start: false`):
 * already `stopped` and provisioned. Throws `PROVISION_FAILED` if the copy failed.
 */
export function isStoppedCopy(box: UnoBox): boolean {
  if (box.status === 'stopped' && box.provision_state === 'ready') return true
  isReadyOrThrow(box)
  return false
}

/**
 * The API refused an option it does not offer: the given error code, or an
 * unknown route (a 404 without a JSON error code, or 405).
 */
function refusesOption(err: UnoError, code: string): boolean {
  if (err.code === code) return true
  if (err.status === 405) return true
  return err.status === 404 && err.code === undefined
}

/** Network failures and 5xx/524 from the edge, where trying again is harmless for reads. */
export function isTransient(err: unknown): boolean {
  if (err instanceof UnoError) return err.status >= 500 || err.status === 429
  return err instanceof TypeError || (err instanceof Error && err.name === 'TimeoutError')
}

/**
 * When a POST /run may be repeated. The idempotency key makes a repeat of an
 * accepted run return the same run, so network errors are safe; 503 only when
 * the server says the command never started; 409 BOX_BUSY while the previous
 * run on this box is still cleaning up.
 */
function isRetryableRunError(err: unknown): boolean {
  if (!(err instanceof UnoError)) return isTransient(err)
  if (err.code === 'BOX_BUSY') return true
  if (err.status === 503) return err.body?.retry_safe === true
  return err.status === 502 || err.status === 504 || err.status === 524
}

function retryDelayMs(err: unknown, attempt: number): number {
  if (err instanceof UnoError && err.code === 'EXEC_CHANNEL_UNAVAILABLE') return 2_000
  return Math.min(500 * 2 ** attempt, 4_000)
}

/** The box (or its file channel: `FILES_BUSY`, more than 6 transfers at once) is busy for a moment. */
function isBusy(err: unknown): boolean {
  return err instanceof UnoError && (err.code === 'BOX_BUSY' || err.code === 'FILES_BUSY')
}

function parseJsonBody(text: string): Record<string, unknown> {
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : { raw: text.slice(0, 500) }
  } catch {
    return { raw: text.slice(0, 500) }
  }
}

function apiError(method: string, path: string, status: number, parsed: Record<string, unknown>): UnoError {
  const code = typeof parsed.error === 'string' ? parsed.error : undefined
  const detail = [parsed.message, parsed.detail, parsed.error_code].filter(v => typeof v === 'string').join(': ')
  return new UnoError(`Uno API ${method} ${path} → ${status}${code ? ` ${code}` : ''}${detail ? ` (${detail})` : ''}`, status, code, parsed)
}

function filesUrl(id: string | number, path: string): string {
  return `/api/v1/boxes/${encodeURIComponent(String(id))}/files?path=${encodeURIComponent(path)}`
}

/**
 * Why a file call got no native answer. `off`: the server has no file
 * endpoints, or they are off for the account — it answers like an unknown
 * route (a 404 without a JSON error code, or 405); stop asking. `unavailable`:
 * 501, this machine cannot use them (an older node, a Work trial) — use
 * commands for this machine. `false`: a real answer (`FILE_NOT_FOUND`, the
 * box is gone, …).
 */
function noNativeFiles(status: number, text: string): 'off' | 'unavailable' | false {
  if (status === 501) return 'unavailable'
  if (status === 405) return 'off'
  return status === 404 && typeof parseJsonBody(text).error !== 'string' ? 'off' : false
}

/** Like {@link isRetryableRunError}: busy, a channel the server says is safe to retry, edge 5xx, network. */
function isRetryableFileError(err: unknown): boolean {
  if (!(err instanceof UnoError)) return isTransient(err)
  if (err.code === 'BOX_BUSY') return true
  if (err.status === 503) return err.body?.retry_safe === true
  return err.status === 502 || err.status === 504 || err.status === 524
}
