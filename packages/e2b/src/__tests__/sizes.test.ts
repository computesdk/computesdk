import { afterEach, describe, expect, it, vi } from 'vitest';
import { e2b, E2B_SIZE_TEMPLATES } from '../index';

const { create } = vi.hoisted(() => ({ create: vi.fn(async (..._args: unknown[]) => ({ sandboxId: 'sbx-1' })) }));
vi.mock('e2b', async (importOriginal) => {
  const actual = await importOriginal<typeof import('e2b')>();
  return { ...actual, Sandbox: { ...actual.Sandbox, create: (...args: unknown[]) => create(...args) } };
});

const profiles = [['sm', 1, 2048], ['md', 2, 4096], ['lg', 4, 8192], ['xl', 8, 16384]] as const;

describe('E2B standard size mapping (mock-only)', () => {
  afterEach(() => { create.mockClear(); });

  it('supports sm-xl through size templates and leaves xs/2xl unknown', () => {
    const sizes = e2b({ apiKey: 'e2b_test' }).sizes;
    expect(sizes.list().filter(p => p.status === 'supported').map(p => p.requested.sizeClass)).toEqual(['sm', 'md', 'lg', 'xl']);
    expect(sizes.resolve('xs').status).toBe('unknown');
    expect(sizes.resolve('2xl').status).toBe('unknown');
  });

  it.each(profiles)('boots %s from its size template', async (sizeClass, vcpus, memoryMiB) => {
    const result = await e2b({ apiKey: 'e2b_test' }).instances.create({ sizeClass });
    expect(create).toHaveBeenCalledWith(E2B_SIZE_TEMPLATES[sizeClass], expect.not.objectContaining({ sizeClass }));
    expect(result.sizing).toMatchObject({ requested: { sizeClass, vcpus, memoryMiB }, resolved: { vcpus, memoryMiB }, provenance: 'adapter-declared' });
  });

  it('honors per-team template names from config', async () => {
    await e2b({ apiKey: 'e2b_test', sizeTemplates: { xl: 'base-8cpu-16gb' } }).instances.create({ sizeClass: 'xl' });
    expect(create).toHaveBeenCalledWith('base-8cpu-16gb', expect.anything());
  });

  it.each([
    { sizeClass: 'sm', templateId: 'base' }, { sizeClass: 'sm', snapshotId: 'snap' },
    { sizeClass: 'sm', cpuCount: 1 }, { sizeClass: 'sm', memoryMB: 2048 }, { sizeClass: 'xs' }, { sizeClass: '2xl' },
  ])('rejects without creating: %j', async (options) => {
    await expect(e2b({ apiKey: 'e2b_test' }).instances.create(options as any)).rejects.toMatchObject({ name: 'InstanceSizeError', fallback: false });
    expect(create).not.toHaveBeenCalled();
  });

  it('names the setup job when a size template is not built', async () => {
    create.mockRejectedValueOnce(new Error("404: template 'csdk-node22-1cpu-2gb' not found"));
    await expect(e2b({ apiKey: 'e2b_test' }).instances.create({ sizeClass: 'sm' })).rejects.toThrow(/not built on this E2B team.*provider-setup/);
  });
});
