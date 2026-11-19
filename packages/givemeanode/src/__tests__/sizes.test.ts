/**
 * Standard sizes on givemeanode, against a stub `fetch` (no account, no boot).
 *
 * Ways this mapping could fail, each pinned below:
 * - Wrong shape: a class sent to a type that does not meet it (md -> sandbox-sm, 1 vCPU),
 *   or to a bigger type than the smallest that does (lg -> sandbox-lg), or a bigger type
 *   reported as the profile instead of its real shape in `resolved`.
 * - Silent default boot: a class givemeanode has no type for (md, 3xl) creates the
 *   default 1 vCPU / 2 GiB sandbox instead of refusing; a refusal that still sends a request.
 * - Dropped field: `size` never reaches POST /preview/sandboxes, or reaches it beside
 *   `ram_gib` (the door takes one or the other), or is lost on the container-image path,
 *   where the size is fixed at the bake (POST /preview/sandboxes/envs).
 * - Fork path: snapshotId / an `env-` templateId forks with the snapshot's own size,
 *   so accepting a class there would boot the wrong shape silently.
 * - Conflict accepted: native ramGib / ram_gib / size / cpus beside sizeClass is not refused.
 * - Config leak: `ramGib` in provider config overrides the size the class chose.
 */
import { describe, expect, it } from 'vitest'

import { givemeanode, GIVEMEANODE_SIZE_TYPES, resetFastTokenCache, resetPreparedImageCache } from '../index'

const IMAGE = 'ghcr.io/acme/task@sha256:' + 'a'.repeat(64)

function door() {
  const sent: Array<{ method: string; path: string; body: any }> = []
  const fetchImpl = (async (url: any, init: any) => {
    const path = new URL(String(url)).pathname
    sent.push({ method: init?.method ?? 'GET', path, body: init?.body ? JSON.parse(init.body) : undefined })
    const body = path.endsWith('/envs') ? { snapshot: 'env-baked' }
      : path.endsWith('/forks') ? { sandboxes: ['sbx-fork'] } : { sandbox: 'sbx-1' }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { sent, fetchImpl }
}

function provider(extra: Record<string, unknown> = {}) {
  resetFastTokenCache()
  resetPreparedImageCache()
  const stub = door()
  const compute = givemeanode({ apiKey: 'gmnt_test', baseUrl: 'https://door.test', fastToken: 'off', warm: 'off', fetch: stub.fetchImpl, ...extra })
  return { compute, sent: stub.sent }
}

const mapped = [
  ['xs', 'sandbox-sm', 1, 2048],
  ['sm', 'sandbox-sm', 1, 2048],
  ['lg', 'sandbox-md', 4, 8192],
  ['xl', 'sandbox-lg', 8, 32768],
  ['2xl', 'sandbox-xl', 16, 65536],
] as const

describe('givemeanode standard sizes (mock-only)', () => {
  it('lists xs, sm, lg, xl and 2xl and refuses md and 3xl as unsupported', () => {
    const list = provider().compute.sizes.list()
    expect(list.filter(r => r.status === 'supported').map(r => r.requested.sizeClass)).toEqual(['xs', 'sm', 'lg', 'xl', '2xl'])
    for (const sizeClass of ['md', '3xl'] as const) {
      const r = list.find(x => x.requested.sizeClass === sizeClass)!
      expect(r.status).toBe('unsupported')
      expect(r).toHaveProperty('reason', expect.stringMatching(/givemeanode/))
    }
  })

  it.each(mapped)('maps %s to %s and declares its %i vCPU / %i MiB shape', (sizeClass, size, vcpus, memoryMiB) => {
    const r = provider().compute.sizes.resolve(sizeClass)
    expect(r).toMatchObject({ status: 'supported', nativeOptions: { size }, resolved: { vcpus, memoryMiB } })
    expect((r as any).resolved.diskMiB).toBeUndefined()
    expect(GIVEMEANODE_SIZE_TYPES[sizeClass]?.size).toBe(size)
  })

  it.each(mapped)('creates %s with size %s and no ram_gib', async (sizeClass, size, vcpus, memoryMiB) => {
    const { compute, sent } = provider()
    const sandbox = await compute.instances.create({ sizeClass })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ method: 'POST', path: '/preview/sandboxes', body: { image: 'sbx-base', size } })
    expect(sent[0].body).not.toHaveProperty('ram_gib')
    expect(sent[0].body).not.toHaveProperty('sizeClass')
    expect(sandbox.sizing).toMatchObject({ requested: { sizeClass }, resolved: { vcpus, memoryMiB }, provenance: 'adapter-declared' })
  })

  it('keeps the size when config sets ramGib', async () => {
    const { compute, sent } = provider({ ramGib: 2 })
    await compute.instances.create({ sizeClass: 'xl' })
    expect(sent[0].body).toMatchObject({ size: 'sandbox-lg' })
    expect(sent[0].body).not.toHaveProperty('ram_gib')
  })

  it('bakes a container image at the class size, then forks it', async () => {
    const { compute, sent } = provider()
    await compute.instances.create({ sizeClass: '2xl', image: IMAGE })
    expect(sent.map(s => s.path)).toEqual(['/preview/sandboxes/envs', '/preview/sandboxes/forks'])
    expect(sent[0].body).toMatchObject({ from_image: IMAGE, size: 'sandbox-xl' })
    expect(sent[0].body).not.toHaveProperty('ram_gib')
  })

  it('sizes a curated templateId on the create path', async () => {
    const { compute, sent } = provider()
    await compute.instances.create({ sizeClass: 'lg', templateId: 'sbx-min' })
    expect(sent[0]).toMatchObject({ path: '/preview/sandboxes', body: { image: 'sbx-min', size: 'sandbox-md' } })
  })

  it.each([
    [{ sizeClass: 'md' }, 'unsupported'],
    [{ sizeClass: '3xl' }, 'unsupported'],
    [{ sizeClass: 'sm', snapshotId: 'env-snap' }, 'unsupported'],
    [{ sizeClass: 'sm', templateId: 'env-snap' }, 'unsupported'],
    [{ sizeClass: 'sm', ramGib: 2 }, 'conflict'],
    [{ sizeClass: 'sm', ram_gib: 2 }, 'conflict'],
    [{ sizeClass: 'sm', size: 'sandbox-sm' }, 'conflict'],
    [{ sizeClass: 'sm', cpus: 1 }, 'conflict'],
    [{ sizeClass: 'sm', vcpus: 1 }, 'conflict'],
    [{ sizeClass: 'sm', memoryMiB: 2048 }, 'conflict'],
    [{ sizeClass: 'sm', resources: { vcpus: 1 } }, 'conflict'],
  ])('refuses without a request: %j', async (options, code) => {
    const { compute, sent } = provider()
    await expect(compute.instances.create(options as any)).rejects.toMatchObject({ name: 'InstanceSizeError', code, fallback: false })
    expect(sent).toHaveLength(0)
  })

  it('leaves native sizing untouched without sizeClass', async () => {
    const { compute, sent } = provider()
    await compute.instances.create({ cpus: 4 } as any)
    expect(sent[0].body).toMatchObject({ size: 'sandbox-md' })
  })
})
