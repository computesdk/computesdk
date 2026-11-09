import { describe, it, expect, vi } from 'vitest'
import { defineProvider } from '../factory.js'
import { TemplateError } from '../index.js'
import type { TemplateCapabilities } from '../types/index.js'

function mockProvider(capabilities?: TemplateCapabilities, createResult: unknown = { id: 'tpl-1' }) {
  const instanceCreate = vi.fn().mockResolvedValue({ sandbox: {}, sandboxId: 'sb-1' })
  const templateCreate = vi.fn().mockResolvedValue(createResult)
  const provider = defineProvider({
    name: 'mock',
    methods: {
      instances: {
        create: instanceCreate,
        getById: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
        destroy: vi.fn().mockResolvedValue(undefined),
        runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 }),
        getInfo: vi.fn(),
        getUrl: vi.fn(),
      },
      template: {
        capabilities,
        create: templateCreate,
        list: vi.fn().mockResolvedValue([{ id: 'tpl-1', name: 'a' }]),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    },
  })({})
  return { provider, instanceCreate, templateCreate }
}

const builds: TemplateCapabilities = { externalImages: false, sources: ['image', 'dockerfile'] }

describe('templates', () => {
  it('exposes declared capabilities on provider.template', () => {
    const { provider } = mockProvider(builds)
    expect(provider.template?.capabilities).toEqual(builds)
  })

  it('normalizes create and list results to TemplateInfo', async () => {
    const { provider, templateCreate } = mockProvider(builds, { id: 'tpl-1', digest: 'sha256:abc' })
    const info = await provider.template!.create({ name: 'base', image: 'ubuntu:24.04' })
    expect(templateCreate).toHaveBeenCalledWith({}, { name: 'base', image: 'ubuntu:24.04' })
    expect(info).toEqual({ id: 'tpl-1', name: 'base', provider: 'mock', digest: 'sha256:abc' })
    expect(await provider.template!.list()).toEqual([{ id: 'tpl-1', name: 'a', provider: 'mock' }])
  })

  it('coerces adapter createdAt strings to Date', async () => {
    const { provider } = mockProvider(builds, { id: 'tpl-1', createdAt: '2026-11-05T00:00:00Z' })
    const info = await provider.template!.create({ name: 'base', image: 'ubuntu:24.04' })
    expect(info.createdAt).toBeInstanceOf(Date)
    expect(info.createdAt.toISOString()).toBe('2026-11-05T00:00:00.000Z')
  })

  it('rejects both sources, unsupported sources and missing ids', async () => {
    const both = mockProvider(builds).provider
    await expect(both.template!.create({ name: 'x', image: 'a', dockerfile: 'FROM a' }))
      .rejects.toMatchObject({ name: 'TemplateError', code: 'invalid' })

    const imageOnly = mockProvider({ externalImages: true, sources: ['image'] }).provider
    await expect(imageOnly.template!.create({ name: 'x', dockerfile: 'FROM a' }))
      .rejects.toMatchObject({ name: 'TemplateError', code: 'unsupported' })

    const noId = mockProvider(builds, { templateId: 'oops' }).provider
    await expect(noId.template!.create({ name: 'x', image: 'a' })).rejects.toBeInstanceOf(TemplateError)
  })

  it('rejects create({ image }) when the provider does not boot external images', async () => {
    const { provider, instanceCreate } = mockProvider(builds)
    await expect(provider.instances.create({ image: 'ubuntu:24.04' }))
      .rejects.toMatchObject({ name: 'TemplateError', code: 'unsupported' })
    expect(instanceCreate).not.toHaveBeenCalled()
    await provider.instances.create({ templateId: 'tpl-1' })
    expect(instanceCreate).toHaveBeenCalledWith({}, { templateId: 'tpl-1' })
  })

  it('passes create({ image }) through on external-image providers', async () => {
    const { provider, instanceCreate } = mockProvider({ externalImages: true, sources: ['image'] })
    await provider.instances.create({ image: 'ubuntu:24.04' })
    expect(instanceCreate).toHaveBeenCalledWith({}, { image: 'ubuntu:24.04' })
    await expect(provider.instances.create({ image: 'a', templateId: 'b' }))
      .rejects.toMatchObject({ code: 'invalid' })
  })

  it('leaves providers without declared capabilities unchanged', async () => {
    const { provider, instanceCreate, templateCreate } = mockProvider(undefined, { native: true })
    expect(provider.template?.capabilities).toBeUndefined()
    expect(await provider.template!.create({ name: 'x', image: 'a', dockerfile: 'b' })).toEqual({ native: true })
    expect(templateCreate).toHaveBeenCalled()
    await provider.instances.create({ image: 'a', templateId: 'b' })
    expect(instanceCreate).toHaveBeenCalled()
  })
})
