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
/** How long POST /boxes may take: a busy console can hold it well past the 30 s of plain calls. */
const CREATE_TIMEOUT_MS = 120_000

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
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? this.requestTimeoutMs)
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        'User-Agent': '@computesdk/uno',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
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
    const text = await res.text()
    let parsed: Record<string, unknown> = {}
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = { raw: text.slice(0, 500) }
      }
    }
    if (!accept.includes(res.status)) {
      const code = typeof parsed.error === 'string' ? parsed.error : undefined
      const detail = [parsed.message, parsed.detail, parsed.error_code].filter(v => typeof v === 'string').join(': ')
      throw new UnoError(
        `Uno API ${method} ${path} → ${res.status}${code ? ` ${code}` : ''}${detail ? ` (${detail})` : ''}`,
        res.status,
        code,
        parsed,
      )
    }
    return { status: res.status, body: parsed as T, headers: res.headers }
  }

  async createBox(req: UnoCreateBoxRequest, signal?: AbortSignal): Promise<UnoBox> {
    return (
      await this.request<UnoBox>('POST', '/api/v1/boxes', req, { accept: [201, 200], signal, timeoutMs: CREATE_TIMEOUT_MS })
    ).body
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

  async getBox(id: string | number): Promise<UnoBox | null> {
    try {
      return (await this.request<UnoBox>('GET', `/api/v1/boxes/${encodeURIComponent(String(id))}`)).body
    } catch (err) {
      if (err instanceof UnoError && (err.status === 404 || err.code === 'INVALID_ID')) return null
      throw err
    }
  }

  async listBoxes(): Promise<UnoBox[]> {
    const { body } = await this.request<{ boxes?: UnoBox[] }>('GET', '/api/v1/boxes')
    return body.boxes ?? []
  }

  /** Delete a box; a box that is already gone is not an error. */
  async deleteBox(id: string | number): Promise<void> {
    await this.request('DELETE', `/api/v1/boxes/${encodeURIComponent(String(id))}?purge=now`, undefined, {
      accept: [200, 202, 204, 404],
    })
  }

  /**
   * Poll until the box is running and provisioned. Create returns at once with
   * `status: "provisioning"`; the machine boots from a warm snapshot in seconds.
   */
  async waitReady(id: string | number, timeoutMs: number, signal?: AbortSignal): Promise<UnoBox> {
    const deadline = Date.now() + timeoutMs
    let delay = 250
    for (;;) {
      signal?.throwIfAborted()
      const box = await this.getBox(id)
      if (!box) throw new UnoError(`Uno box ${id} disappeared while starting`, 404, 'NOT_FOUND')
      if (box.status === 'running' && box.provision_state === 'ready') return box
      if (box.status === 'error' || box.provision_state === 'failed') {
        throw new UnoError(
          `Uno box ${id} failed to start${box.provision_error ? `: ${box.provision_error}` : ''}`,
          500,
          'PROVISION_FAILED',
          box,
        )
      }
      if (Date.now() + delay > deadline) {
        throw new UnoError(`Uno box ${id} not ready after ${timeoutMs} ms (status ${box.status})`, 504, 'READY_TIMEOUT', box)
      }
      await sleep(delay)
      delay = Math.min(delay * 2, 2_000)
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
    const waitS = opts.waitS ?? 50
    const idempotencyKey = opts.idempotencyKey ?? crypto.randomUUID()
    const path = `/api/v1/boxes/${encodeURIComponent(String(id))}/run`
    const body = { ...payload, wait_s: Math.min(waitS, payload.timeout_s), idempotency_key: idempotencyKey }

    let run: UnoRun | undefined
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.request<UnoRun>('POST', path, body, {
          accept: [200, 202],
          timeoutMs: (body.wait_s + 30) * 1000,
        })
        run = res.body
        break
      } catch (err) {
        if (attempt >= 4 || !isRetryableRunError(err)) throw err
        await sleep(retryDelayMs(err, attempt))
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
