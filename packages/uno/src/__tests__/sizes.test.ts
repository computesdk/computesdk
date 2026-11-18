/**
 * Uno standard sizes (mock-only: no API key, no machine is booted).
 *
 * POST /api/v1/boxes takes `vcpu`, `ram_mb` and `disk_gb` as plain integers,
 * so each standard size is its exact profile. sm-xl also carry the disk the
 * benchmarks platform gives those sizes (10/20/40/80 GiB).
 *
 * Ways this mapping could fail, each covered below:
 * 1. Wrong shape: a class reaches the API with other vcpu/ram_mb than its profile
 *    (e.g. memory rounded, or the adapter's 2 vCPU / 2048 MiB default used instead).
 * 2. Silent default boot: a size is resolved but nativeOptions are dropped, so the
 *    create body has the config/default vcpu, ram_mb or disk_gb.
 * 3. Dropped field: the disk the platform sets for sm-xl is not sent as disk_gb,
 *    or `resolved.diskMiB` does not match what is sent.
 * 4. Conflict accepted: sizeClass together with a native CPU/RAM/disk field
 *    (vcpus, cpus, memoryMiB, memoryMb, vcpu, ram_mb, ramMb, diskMiB, diskMb on
 *    sized disks) is sent instead of refused with InstanceSizeError('conflict').
 * 5. Snapshot branch: `snapshotId` clones the source's shape (the clone call has no
 *    shape fields), so a sized request there must be refused before any request.
 * 6. A refused size makes a request anyway (fallback to a default box).
 * 7. Config defaults (vcpu/ramMb/diskGb) override the standard size.
 * 8. A plain create without sizeClass changes behaviour.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { uno } from '../index'

type Call = { method: string; url: string; body?: any }

function mockFetch() {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method: init.method ?? 'GET', url, body })
      return new Response(
        JSON.stringify({
          id: 42, name: 'b', status: 'running', provision_state: 'ready',
          vcpu: body?.vcpu ?? 2, ram_mb: body?.ram_mb ?? 2048, disk_gb: body?.disk_gb ?? 10,
          created_at: '2026-11-18T00:00:00Z',
        }),
        { status: 201 },
      )
    }),
  )
  return calls
}

const api = 'https://api.test'
const make = (config: Record<string, unknown> = {}) => uno({ apiKey: 'k', baseUrl: api, ...config })

afterEach(() => {
  vi.unstubAllGlobals()
})

// [class, vcpu, ram_mb, disk_gb sent, resolved.diskMiB]
const shapes = [
  ['xs', 1, 1024, 10, undefined],
  ['sm', 1, 2048, 10, 10240],
  ['md', 2, 4096, 20, 20480],
  ['lg', 4, 8192, 40, 40960],
  ['xl', 8, 16384, 80, 81920],
  ['2xl', 16, 32768, 10, undefined],
  ['3xl', 32, 131072, 10, undefined],
] as const

describe('Uno standard sizes', () => {
  it('lists every standard size as supported with its exact profile', () => {
    const list = make().sizes.list()
    expect(list.map(r => [r.requested.sizeClass, r.status])).toEqual(shapes.map(([c]) => [c, 'supported']))
    for (const [sizeClass, vcpus, memoryMiB, , diskMiB] of shapes) {
      const r = make().sizes.resolve(sizeClass)
      expect(r).toMatchObject({ status: 'supported', resolved: { vcpus, memoryMiB } })
      if (r.status !== 'supported') throw new Error('unreachable')
      expect(r.resolved.diskMiB).toBe(diskMiB)
      expect(r.belowStandard).toBeUndefined()
    }
  })

  it.each(shapes)('creates %s with vcpu %i, ram_mb %i, disk_gb %i', async (sizeClass, vcpu, ram_mb, disk_gb, diskMiB) => {
    const calls = mockFetch()
    const sandbox = await make().instances.create({ sizeClass })
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toMatch(/\/api\/v1\/boxes(\?|$)/)
    expect(calls[0].body).toMatchObject({ vcpu, ram_mb, disk_gb })
    expect(calls[0].body).not.toHaveProperty('sizeClass')
    expect(sandbox.sizing).toMatchObject({
      requested: { sizeClass }, resolved: { vcpus: vcpu, memoryMiB: ram_mb, ...(diskMiB ? { diskMiB } : {}) },
      provenance: 'adapter-declared',
    })
  })

  it('wins over config defaults for vcpu, ramMb and the platform disk', async () => {
    const calls = mockFetch()
    await make({ vcpu: 3, ramMb: 3072, diskGb: 7 }).instances.create({ sizeClass: 'md' })
    expect(calls[0].body).toMatchObject({ vcpu: 2, ram_mb: 4096, disk_gb: 20 })
  })

  it('keeps an OS template choice', async () => {
    const calls = mockFetch()
    await make().instances.create({ sizeClass: 'lg', templateId: 'debian-12' })
    expect(calls[0].body).toMatchObject({ template: 'debian-12', vcpu: 4, ram_mb: 8192, disk_gb: 40 })
  })

  it.each([
    { vcpus: 2 }, { cpus: 2 }, { cpu: 2 }, { memoryMiB: 4096 }, { memoryMb: 4096 }, { memMiB: 4096 }, { memory: 4096 },
    { vcpu: 2 }, { ram_mb: 4096 }, { ramMb: 4096 }, { diskMiB: 20480 }, { diskMb: 20480 }, { disk_gb: 20 }, { diskGb: 20 },
  ])('refuses sizeClass with native %j as a conflict, without a request', async (native) => {
    const calls = mockFetch()
    await expect(make().instances.create({ sizeClass: 'md', ...native } as any))
      .rejects.toMatchObject({ name: 'InstanceSizeError', code: 'conflict', fallback: false })
    expect(calls).toHaveLength(0)
  })

  it('refuses sizeClass with snapshotId (a clone keeps the source shape), without a request', async () => {
    const calls = mockFetch()
    expect(make().sizes.resolve('md', { snapshotId: '7' })).toMatchObject({ status: 'unsupported' })
    await expect(make().instances.create({ sizeClass: 'md', snapshotId: '7' }))
      .rejects.toMatchObject({ name: 'InstanceSizeError', code: 'unsupported', fallback: false })
    expect(calls).toHaveLength(0)
  })

  it('leaves a create without sizeClass unchanged', async () => {
    const calls = mockFetch()
    const sandbox = await make().instances.create({ vcpus: 3, memoryMiB: 3000 })
    expect(calls[0].body).toMatchObject({ vcpu: 3, ram_mb: 3072, disk_gb: 10 })
    expect(sandbox.sizing).toBeUndefined()
  })
})
