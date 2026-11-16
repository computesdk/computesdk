import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { cloudRun } from '../index'

const sandboxUrl = process.env.CLOUD_RUN_SANDBOX_URL?.replace(/\/$/, '')
const sandboxSecret = process.env.CLOUD_RUN_SANDBOX_SECRET
const gatewayAuthToken = process.env.CLOUD_RUN_AUTH_TOKEN
const credentialed = !!(sandboxUrl && sandboxSecret)
if (process.env.COMPUTESDK_REQUIRE_INTEGRATION === '1' && !credentialed) {
  throw new Error('Cloud Run repair probes require CLOUD_RUN_SANDBOX_URL and CLOUD_RUN_SANDBOX_SECRET')
}

describe.runIf(credentialed)('Cloud Run focused persistence regressions', () => {
  const provider = cloudRun({ sandboxUrl, sandboxSecret, gatewayAuthToken, executionMode: 'stateful', allowEgress: true })
  const prefix = `repair-${randomUUID().slice(0, 12)}`
  const affinity = new Map<string, string>()
  const realFetch = globalThis.fetch

  beforeAll(async () => {
    const health = await realFetch(`${sandboxUrl}/v1/health`, {
      signal: AbortSignal.timeout(10_000),
      headers: gatewayAuthToken ? { Authorization: `Bearer ${gatewayAuthToken}` } : {},
    })
    console.log('GATEWAY', await health.json())
    vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const response = await realFetch(input, init)
      if (String(input).startsWith(`${sandboxUrl}/`) && typeof init?.body === 'string') {
        let { sandboxId } = JSON.parse(init.body)
        if (!sandboxId && String(input).endsWith('/v1/sandbox/create') && response.ok) {
          sandboxId = (await response.clone().json()).sandboxId
        }
        const cookies = response.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ')
        if (sandboxId && cookies) affinity.set(sandboxId, cookies)
      }
      return response
    })
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  async function raw(sandboxId: string, route: string) {
    console.log('EXACT ID BEFORE', route, sandboxId)
    return realFetch(`${sandboxUrl}${route}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ComputeSDK-Cloud-Run-Secret': sandboxSecret!,
        ...(gatewayAuthToken ? { Authorization: `Bearer ${gatewayAuthToken}` } : {}),
        ...(affinity.has(sandboxId) ? { Cookie: affinity.get(sandboxId)! } : {}),
      },
      body: JSON.stringify({ sandboxId }), signal: AbortSignal.timeout(35_000),
    })
  }

  async function cleanup(sandboxId: string) {
    expect(affinity.has(sandboxId), 'Cleanup must target the creator instance via affinity').toBe(true)
    expect((await raw(sandboxId, '/v1/sandbox/destroy')).status).toBe(200)
    const status = (await raw(sandboxId, '/v1/sandbox/info')).status
    console.log('EXACT ID AFTER CLEANUP', sandboxId, status)
    expect(status).toBe(404)
  }

  it('adopts the gateway-generated default ID and destroys that exact native sandbox', async () => {
    console.log('SDK AUTO-ID CREATE BEFORE REQUEST', 'allowEgress=true executionMode=stateful')
    const sandbox = await provider.sandbox.create({ timeout: 30_000 })
    const id = sandbox.sandboxId
    console.log('GATEWAY ALLOCATED SDK ID', id)
    try {
      expect(id).toMatch(/^cloud-run-/)
      expect(affinity.has(id), 'Default-ID sandbox must retain creator affinity').toBe(true)
      expect((await raw(id, '/v1/sandbox/info')).status).toBe(200)
    } finally {
      console.log('EXACT ID BEFORE SDK DESTROY', id)
      await sandbox.destroy()
      const status = (await raw(id, '/v1/sandbox/info')).status
      console.log('EXACT DEFAULT ID AFTER SDK CLEANUP', id, status)
      expect(status).toBe(404)
    }
  }, 120_000)

  it('persists separate mkdir/write calls, chunked files, rootfs writes and pause markers with egress enabled', async () => {
    const id = `${prefix}-fs`
    console.log('SANDBOX ID BEFORE SDK CREATE', id, 'allowEgress=true executionMode=stateful')
    try {
      const sandbox = await provider.sandbox.create({ name: id, timeout: 30_000 })
      const content = 'x'.repeat(40 * 1024)
      await sandbox.filesystem.mkdir('bench/fs-cloud-run')
      await sandbox.filesystem.writeFile('bench/fs-cloud-run/.probe', content)
      expect(await sandbox.filesystem.readFile('bench/fs-cloud-run/.probe')).toBe(content)
      expect((await sandbox.runCommand('mkdir -p bench-rootfs')).exitCode).toBe(0)
      expect((await sandbox.runCommand('printf rootfs > bench-rootfs/seq.bin')).exitCode).toBe(0)
      expect(await sandbox.filesystem.readFile('bench-rootfs/seq.bin')).toBe('rootfs')
      const pauseDir = `/app/bench-pause-resume-${prefix}`
      await sandbox.filesystem.mkdir(pauseDir)
      await sandbox.filesystem.writeFile(`${pauseDir}/marker.txt`, prefix)
      expect(await sandbox.filesystem.readFile(`${pauseDir}/marker.txt`)).toBe(prefix)
      console.log('SDK FS/ROOTFS/MARKER PASS', id)
    } finally {
      await cleanup(id)
    }
  }, 120_000)
})
