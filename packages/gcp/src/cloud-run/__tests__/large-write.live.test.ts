import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { describe, expect, it, vi } from 'vitest'
import { cloudRun } from '../index'

const sandboxUrl = process.env.CLOUD_RUN_SANDBOX_URL?.replace(/\/$/, '')
const sandboxSecret = process.env.CLOUD_RUN_SANDBOX_SECRET
const gatewayAuthToken = process.env.CLOUD_RUN_AUTH_TOKEN
const credentialed = !!(sandboxUrl && sandboxSecret)
if (process.env.COMPUTESDK_REQUIRE_INTEGRATION === '1' && !credentialed) {
  throw new Error('Cloud Run large-write verification requires gateway credentials')
}

describe.runIf(credentialed)('Cloud Run bounded large-write verification', () => {
  it('writes and reads 64/128-MiB base64 payloads with SDK/native hashes and exact-ID cleanup', async () => {
    const id = `upload-${randomUUID()}`
    const directory = `/app/${id}`
    const realFetch = globalThis.fetch
    let affinity = ''
    let maxRequestBytes = 0
    let partRequests = 0
    let ioSignal: AbortSignal | undefined
    const io = async <T>(operation: () => Promise<T>) => {
      const controller = new AbortController()
      ioSignal = controller.signal
      const start = performance.now()
      const timer = setTimeout(() => controller.abort(new Error('I/O exceeded the 300-second limit')), 300_000)
      try {
        const value = await operation()
        const ms = Math.round(performance.now() - start)
        expect(ms).toBeLessThanOrEqual(300_000)
        return { value, ms }
      } finally {
        clearTimeout(timer)
        ioSignal = undefined
      }
    }
    vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(input).startsWith(`${sandboxUrl}/`) && typeof init?.body === 'string') {
        maxRequestBytes = Math.max(maxRequestBytes, Buffer.byteLength(init.body, 'utf8'))
        if (String(input).endsWith('/v1/sandbox/writeFile')) partRequests++
      }
      const signals = [...(init?.signal ? [init.signal] : []), ...(ioSignal ? [ioSignal] : [])]
      const response = await realFetch(input, { ...init, ...(signals.length ? { signal: AbortSignal.any(signals) } : {}) })
      const cookies = response.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ')
      if (cookies) affinity = cookies
      return response
    })
    const status = async (route: string) => {
      console.log('EXACT_ID_BEFORE', route, id)
      const response = await realFetch(`${sandboxUrl}${route}`, {
        method: 'POST', headers: {
          'Content-Type': 'application/json', 'X-ComputeSDK-Cloud-Run-Secret': sandboxSecret!,
          ...(gatewayAuthToken ? { Authorization: `Bearer ${gatewayAuthToken}` } : {}), Cookie: affinity,
        },
        body: JSON.stringify({ sandboxId: id }), signal: AbortSignal.timeout(35_000),
      })
      await response.arrayBuffer()
      console.log('EXACT_ID_STATUS', route, id, response.status)
      return response.status
    }
    const provider = cloudRun({ sandboxUrl, sandboxSecret, gatewayAuthToken, executionMode: 'stateful', allowEgress: true })
    let sandbox: Awaited<ReturnType<typeof provider.sandbox.create>> | undefined
    try {
      const health = await realFetch(`${sandboxUrl}/v1/health`, {
        headers: gatewayAuthToken ? { Authorization: `Bearer ${gatewayAuthToken}` } : {}, signal: AbortSignal.timeout(10_000),
      }).then(response => response.json())
      console.log('GATEWAY_VERSION', health.version)
      console.log('EXACT_ID_BEFORE_CREATE', id)
      sandbox = await provider.sandbox.create({ name: id, timeout: 30_000 })
      expect(affinity, 'Creator affinity must be available for exact-ID cleanup').not.toBe('')
      expect(await status('/v1/sandbox/info')).toBe(200)
      await sandbox.filesystem.mkdir(directory)
      for (const sizeMiB of [64, 128]) {
        const rawBytes = sizeMiB * 1024 * 1024
        const content = randomBytes(rawBytes).toString('base64')
        const bytes = Buffer.byteLength(content, 'utf8')
        const expectedHash = createHash('sha256').update(content, 'utf8').digest('hex')
        const path = `${directory}/${sizeMiB}.txt`
        console.log('LARGE_IO_BEGIN', JSON.stringify({ id, rawBytes, bytes, sha256: expectedHash }))
        const { ms: writeMs } = await io(() => sandbox!.filesystem.writeFile(path, content))
        const verified = await sandbox.runCommand(`wc -c < '${path}' && sha256sum -- '${path}' && find '${directory}' -maxdepth 1 -name '.computesdk-upload-*' -print`, { timeout: 30_000 })
        expect(verified.exitCode).toBe(0)
        const lines = verified.stdout.trim().split('\n')
        expect(lines).toHaveLength(2)
        expect(Number(lines[0].trim())).toBe(bytes)
        expect(lines[1].split(/\s+/)[0]).toBe(expectedHash)
        console.log('NATIVE_WRITE_VERIFIED', JSON.stringify({ id, rawBytes, bytes, sha256: expectedHash, writeMs }))
        const { value: back, ms: readMs } = await io(() => sandbox!.filesystem.readFile(path))
        expect(back.length).toBe(content.length)
        expect(Buffer.byteLength(back, 'utf8')).toBe(bytes)
        expect(createHash('sha256').update(back, 'utf8').digest('hex')).toBe(expectedHash)
        const { ms: deleteMs } = await io(() => sandbox!.filesystem.remove(path))
        console.log('LARGE_IO_PASS', JSON.stringify({ id, rawBytes, bytes, sha256: expectedHash, writeMs, readMs, deleteMs, maxRequestBytes, partRequests }))
        expect(maxRequestBytes).toBeLessThanOrEqual(24 * 1024 * 1024)
      }
    } finally {
      try {
        if (sandbox) {
          console.log('EXACT_ID_BEFORE_SDK_DESTROY', id)
          await sandbox.destroy()
          expect(await status('/v1/sandbox/info')).toBe(404)
        }
      } finally {
        vi.unstubAllGlobals()
      }
    }
  }, 1_950_000)
})
