import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  type Call = { method: string; args: unknown[] }

  const state = {
    calls: [] as Call[],
    createError: null as Error | null,
  }

  const record = (method: string, ...args: unknown[]) => state.calls.push({ method, args })

  const makeSandbox = (id: string) => ({
    runtimeId: id,
    get status() {
      return 'running'
    },
    get info() {
      return {
        runtimeId: id,
        status: 'running',
        startedAt: '2026-09-25T00:00:00.000Z',
        timeoutAt: '2026-09-25T00:30:00.000Z',
        metadata: {},
        template: '',
      }
    },
  })

  class GravixLayer {
    runtime = {
      create: async (body: Record<string, unknown>) => {
        record('runtime.create', body)
        if (state.createError) throw state.createError
        return makeSandbox('3f2c8a1e-5b7d-4e9f-8a6c-1d2e3f4a5b6c')
      },
    }

    constructor(_options: Record<string, unknown>) {}
  }

  return { GravixLayer, state }
})

vi.mock('gravixlayer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('gravixlayer')>()
  return {
    GravixLayer: h.GravixLayer,
    TemplateBuilder: actual.TemplateBuilder,
    Runtime: actual.Runtime,
  }
})

import { GRAVIXLAYER_SIZE_TEMPLATES, gravixlayer } from '../index'

const profiles = [
  ['xs', 1, 1024],
  ['sm', 1, 2048],
  ['md', 2, 4096],
  ['lg', 4, 8192],
  ['xl', 8, 16384],
  ['2xl', 16, 32768],
] as const

const calls = (method: string) => h.state.calls.filter((call) => call.method === method)

describe('GravixLayer standard size mapping (mock-only)', () => {
  beforeEach(() => {
    h.state.calls.length = 0
    h.state.createError = null
  })

  it('supports all six standard tiers through size templates', () => {
    const sizes = gravixlayer({ apiKey: 'gk_test' }).sizes
    expect(sizes.list().filter((p) => p.status === 'supported').map((p) => p.requested.sizeClass)).toEqual([
      'xs',
      'sm',
      'md',
      'lg',
      'xl',
      '2xl',
    ])
  })

  it.each(profiles)('boots %s from its size template', async (sizeClass, vcpus, memoryMiB) => {
    const result = await gravixlayer({ apiKey: 'gk_test' }).sandbox.create({ sizeClass })
    expect(calls('runtime.create')[0].args[0]).toMatchObject({ template: GRAVIXLAYER_SIZE_TEMPLATES[sizeClass] })
    expect(result.sizing).toMatchObject({
      requested: { sizeClass, vcpus, memoryMiB },
      resolved: { vcpus, memoryMiB },
      provenance: 'adapter-declared',
    })
  })

  it('honors per-project template names from config', async () => {
    await gravixlayer({ apiKey: 'gk_test', sizeTemplates: { xl: 'base-8cpu-16gb' } }).sandbox.create({
      sizeClass: 'xl',
    })
    expect(calls('runtime.create')[0].args[0]).toMatchObject({ template: 'base-8cpu-16gb' })
  })

  it.each([
    { sizeClass: 'sm', templateId: 'base-small' },
    { sizeClass: 'sm', image: 'node:22' },
    { sizeClass: 'sm', snapshotId: 'snap_1' },
    { sizeClass: 'sm', sandboxId: 'rt_1' },
  ])('rejects without creating: %j', async (options) => {
    await expect(gravixlayer({ apiKey: 'gk_test' }).sandbox.create(options as never)).rejects.toMatchObject({
      name: 'InstanceSizeError',
      fallback: false,
    })
    expect(calls('runtime.create')).toHaveLength(0)
  })

  it('names remediation when a size template is not available', async () => {
    const notFound = Object.assign(new Error("404: template 'base-small' not found"), { status: 404 })
    h.state.createError = notFound
    await expect(gravixlayer({ apiKey: 'gk_test' }).sandbox.create({ sizeClass: 'sm' })).rejects.toThrow(
      /size template 'base-small' \(sizeClass sm\) is not available on this project/,
    )
  })

  it('names remediation when an image template is not available', async () => {
    h.state.createError = Object.assign(new Error("404: template 'node:22' not found"), { status: 404 })
    await expect(gravixlayer({ apiKey: 'gk_test' }).sandbox.create({ image: 'node:22' })).rejects.toThrow(
      /template 'node:22' is not available on this project.*template\.create/,
    )
  })
})
