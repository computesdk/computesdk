/**
 * CodeSandbox standard size mapping (mock-only; no API key, no sandbox booted).
 *
 * Ways the mapping could fail, each covered below:
 * - Wrong shape: a class mapped to the wrong VM tier (e.g. sm → Nano, 2xl → Large,
 *   3xl → Large, whose 64 GiB is below the 128 GiB profile), or `resolved` not
 *   reporting XLarge's 64 vCPU for 3xl.
 * - Silent default boot: an unsupported class (xs) or a refused combination creating a
 *   sandbox on the workspace default tier instead of throwing InstanceSizeError.
 * - Dropped field: `vmTier` not reaching `sdk.sandboxes.create` (on the default
 *   template, explicit templateId or snapshotId restore branch), or the 2xl/3xl size
 *   template id not reaching it as `id`, or `config.templateId` overriding the size template.
 * - Leaked field: SDK-only `sizeClass` forwarded to the vendor, or a `vmTier` injected
 *   when no `sizeClass` was asked for.
 * - Conflict accepted: `sizeClass` combined with a native `vmTier` or generic CPU/RAM
 *   fields, or 2xl/3xl combined with a caller templateId/snapshotId that cannot carry
 *   that tier's memory.
 * - Missing size template: a 2xl/3xl create failing without saying how to build it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { codesandbox, CODESANDBOX_SIZE_TEMPLATES } from '../index';

const { create } = vi.hoisted(() => ({
  create: vi.fn(async (..._args: unknown[]) => ({ id: 'sbx-1', cluster: 'test', bootupType: 'FORK', isUpToDate: true })),
}));
vi.mock('@codesandbox/sdk', () => ({
  CodeSandbox: class { sandboxes = { create: (...args: unknown[]) => create(...args) }; },
}));

const provider = (config = {}) => codesandbox({ apiKey: 'csb_test', ...config });
const lastCreate = () => create.mock.calls.at(-1)![0] as Record<string, unknown>;

const tiers = [
  ['sm', 1, 2048, 'Pico', 1, 2048],
  ['md', 2, 4096, 'Nano', 2, 4096],
  ['lg', 4, 8192, 'Micro', 4, 8192],
  ['xl', 8, 16384, 'Small', 8, 16384],
  ['2xl', 16, 32768, 'Medium', 16, 32768],
  ['3xl', 32, 131072, 'XLarge', 64, 131072],
] as const;

describe('CodeSandbox standard size mapping (mock-only)', () => {
  afterEach(() => { create.mockClear(); });

  it('lists sm-3xl as supported and xs as unsupported', () => {
    const list = provider().sizes.list();
    expect(list.map(r => [r.requested.sizeClass, r.status])).toEqual([
      ['xs', 'unsupported'], ['sm', 'supported'], ['md', 'supported'], ['lg', 'supported'],
      ['xl', 'supported'], ['2xl', 'supported'], ['3xl', 'supported'],
    ]);
    const xs = provider().sizes.resolve('xs');
    expect(xs.status === 'unsupported' && xs.reason).toMatch(/Pico/);
  });

  it.each(tiers)('resolves %s to the %s-sized tier', (sizeClass, vcpus, memoryMiB, tier, rv, rm) => {
    const resolution = provider().sizes.resolve(sizeClass);
    expect(resolution).toMatchObject({
      status: 'supported', requested: { sizeClass, vcpus, memoryMiB }, resolved: { vcpus: rv, memoryMiB: rm },
      nativeOptions: { vmTier: { name: tier } },
    });
    expect(resolution.status === 'supported' && resolution.resolved.diskMiB).toBeUndefined();
  });

  it.each(tiers)('boots %s with its vmTier forwarded to sandboxes.create', async (sizeClass, vcpus, memoryMiB, tier, rv, rm) => {
    const instance = await provider().instances.create({ sizeClass });
    const sent = lastCreate();
    expect(sent.vmTier).toEqual({ name: tier });
    expect(sent).not.toHaveProperty('sizeClass');
    expect(instance.sizing).toMatchObject({
      requested: { sizeClass, vcpus, memoryMiB }, resolved: { vcpus: rv, memoryMiB: rm }, provenance: 'adapter-declared',
    });
  });

  it('boots sm-xl from the default template (no id) and 2xl/3xl from their size templates', async () => {
    await provider().instances.create({ sizeClass: 'xl' });
    expect(lastCreate()).not.toHaveProperty('id');
    await provider().instances.create({ sizeClass: '2xl' });
    expect(lastCreate()).toMatchObject({ id: CODESANDBOX_SIZE_TEMPLATES['2xl'], vmTier: { name: 'Medium' } });
    await provider().instances.create({ sizeClass: '3xl' });
    expect(lastCreate()).toMatchObject({ id: CODESANDBOX_SIZE_TEMPLATES['3xl'], vmTier: { name: 'XLarge' } });
    expect(CODESANDBOX_SIZE_TEMPLATES).toEqual({ '2xl': 'csdk@csdk-node22-16cpu-32gb', '3xl': 'csdk@csdk-node22-64cpu-128gb' });
  });

  it('honors sizeTemplates and keeps the size template over config.templateId', async () => {
    await provider({ templateId: 'my-template', sizeTemplates: { '3xl': 'team@big' } }).instances.create({ sizeClass: '3xl' });
    expect(lastCreate()).toMatchObject({ id: 'team@big', vmTier: { name: 'XLarge' } });
    await provider({ templateId: 'my-template' }).instances.create({ sizeClass: '2xl' });
    expect(lastCreate()).toMatchObject({ id: CODESANDBOX_SIZE_TEMPLATES['2xl'] });
  });

  it('forwards vmTier on template and snapshot-restore forks for sm-xl', async () => {
    await provider().instances.create({ sizeClass: 'md', templateId: 'tpl-1' });
    expect(lastCreate()).toMatchObject({ id: 'tpl-1', vmTier: { name: 'Nano' } });
    await provider().instances.create({ sizeClass: 'lg', snapshotId: 'snap-1' });
    expect(lastCreate()).toMatchObject({ id: 'snap-1', vmTier: { name: 'Micro' } });
    await provider({ templateId: 'cfg-tpl' }).instances.create({ sizeClass: 'sm' });
    expect(lastCreate()).toMatchObject({ id: 'cfg-tpl', vmTier: { name: 'Pico' } });
  });

  it('leaves creates without sizeClass untouched', async () => {
    await provider().instances.create();
    expect(lastCreate()).not.toHaveProperty('vmTier');
    await provider().instances.create({ vmTier: { name: 'Small' } } as any);
    expect(lastCreate().vmTier).toEqual({ name: 'Small' });
  });

  it.each([
    [{ sizeClass: 'xs' }, 'unsupported'],
    [{ sizeClass: 'sm', vmTier: { name: 'Small' } }, 'conflict'],
    [{ sizeClass: 'md', cpu: 2 }, 'conflict'],
    [{ sizeClass: 'md', memoryMiB: 4096 }, 'conflict'],
    [{ sizeClass: '2xl', templateId: 'tpl-1' }, 'unsupported'],
    [{ sizeClass: '3xl', snapshotId: 'snap-1' }, 'unsupported'],
    [{ sizeClass: '4xl' }, 'invalid'],
  ])('rejects %j with %s and creates nothing', async (options, code) => {
    await expect(provider().instances.create(options as any)).rejects.toMatchObject({ name: 'InstanceSizeError', code, fallback: false });
    expect(create).not.toHaveBeenCalled();
  });

  it('explains how to build a missing size template', async () => {
    create.mockRejectedValueOnce(new Error('Failed to fork sandbox csdk@csdk-node22-16cpu-32gb: 404 Not Found'));
    await expect(provider().instances.create({ sizeClass: '2xl' })).rejects.toThrow(/csb build .*--vm-tier Medium --alias csdk@csdk-node22-16cpu-32gb/);
  });
});
