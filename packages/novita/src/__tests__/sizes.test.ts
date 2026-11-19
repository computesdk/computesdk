/**
 * Novita standard sizes (mock-only). Ways the mapping could fail:
 * - Wrong shape: a size boots a template built for another CPU/RAM (e.g. sm → 1cpu-1gb).
 * - Silent default boot: sizeClass reaches the SDK but the create still boots `base`.
 * - Dropped field: the resolved templateId never reaches `sandbox.create`, or
 *   sizeClass leaks into the native SandboxOpts.
 * - Over-claiming: xl/2xl/3xl resolve even though Novita caps a sandbox at
 *   8 vCPU / 8 GiB, or a config override for them sneaks a template through.
 * - Below-standard shape: an 8cpu-8gb template is passed off as xl.
 * - Conflict accepted: sizeClass combined with native cpuCount/memoryMB/build,
 *   or with templateId/snapshotId/sandboxId, still creates a sandbox.
 * - Missing disk: the fixed 20 GB disk is not reported in resolved.diskMiB.
 * - Unhelpful failure: an unbuilt size template surfaces as a bare 404.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateInstanceOptions } from '@computesdk/provider';
import { novita, NOVITA_SIZE_TEMPLATES } from '../index';

const { create } = vi.hoisted(() => ({ create: vi.fn(async (..._args: unknown[]) => ({ sandboxId: 'sbx-1' })) }));
vi.mock('novita-sandbox', async () => {
  const actual = await vi.importActual<typeof import('novita-sandbox')>('novita-sandbox');
  return { ...actual, Novita: vi.fn(() => ({ sandbox: { create: (...args: unknown[]) => create(...args) } })) };
});

const profiles = [
  ['xs', 1, 1024, 'csdk-node22-1cpu-1gb'], ['sm', 1, 2048, 'csdk-node22-1cpu-2gb'],
  ['md', 2, 4096, 'csdk-node22-2cpu-4gb'], ['lg', 4, 8192, 'csdk-node22-4cpu-8gb'],
] as const;

describe('Novita standard size mapping (mock-only)', () => {
  afterEach(() => { create.mockClear(); });

  it('supports xs-lg and refuses xl/2xl/3xl as unsupported', () => {
    const sizes = novita({ apiKey: 'sk_test' }).sizes;
    expect(sizes.list().filter(p => p.status === 'supported').map(p => p.requested.sizeClass)).toEqual(['xs', 'sm', 'md', 'lg']);
    for (const sizeClass of ['xl', '2xl', '3xl'] as const) {
      expect(sizes.resolve(sizeClass)).toMatchObject({ status: 'unsupported', reason: expect.stringMatching(/8 vCPU and 8 GiB/) });
    }
  });

  it.each(profiles)('resolves %s to the %i vCPU / %i MiB template with the fixed 20 GB disk', (sizeClass, vcpus, memoryMiB, template) => {
    expect(NOVITA_SIZE_TEMPLATES[sizeClass]).toBe(template);
    expect(novita({ apiKey: 'sk_test' }).sizes.resolve(sizeClass)).toMatchObject({
      status: 'supported', nativeOptions: { templateId: template }, resolved: { vcpus, memoryMiB, diskMiB: 20480 },
    });
  });

  it.each(profiles)('boots %s from its size template', async (sizeClass, vcpus, memoryMiB, template) => {
    const result = await novita({ apiKey: 'sk_test' }).instances.create({ sizeClass, envs: { A: '1' } });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toBe(template);
    expect(create.mock.calls[0][1]).toMatchObject({ envs: { A: '1' } });
    expect(create.mock.calls[0][1]).not.toHaveProperty('sizeClass');
    expect(result.sizing).toMatchObject({
      requested: { sizeClass, vcpus, memoryMiB }, resolved: { vcpus, memoryMiB, diskMiB: 20480 }, provenance: 'adapter-declared',
    });
  });

  it('honors per-account template names for offered sizes only', async () => {
    const provider = novita({ apiKey: 'sk_test', sizeTemplates: { md: 'team-2cpu-4gb', xl: 'team-8cpu-16gb' } });
    await provider.instances.create({ sizeClass: 'md' });
    expect(create.mock.calls[0][0]).toBe('team-2cpu-4gb');
    expect(provider.sizes.resolve('xl').status).toBe('unsupported');
  });

  it('reports an empty override as unconfigured', () => {
    expect(novita({ apiKey: 'sk_test', sizeTemplates: { sm: ' ' } }).sizes.resolve('sm').status).toBe('unconfigured');
  });

  it.each([
    [{ sizeClass: 'sm', cpuCount: 1 }, 'conflict'], [{ sizeClass: 'sm', memoryMB: 2048 }, 'conflict'],
    [{ sizeClass: 'sm', build: { cpuCount: 1, memoryMB: 2048 } }, 'conflict'], [{ sizeClass: 'sm', cpus: 1 }, 'conflict'],
    [{ sizeClass: 'sm', templateId: 'base' }, 'unsupported'], [{ sizeClass: 'sm', snapshotId: 'snap' }, 'unsupported'],
    [{ sizeClass: 'sm', sandboxId: 'sbx-0' }, 'unsupported'],
    [{ sizeClass: 'xl' }, 'unsupported'], [{ sizeClass: '2xl' }, 'unsupported'], [{ sizeClass: '3xl' }, 'unsupported'],
  ])('rejects without creating: %j', async (options, code) => {
    await expect(novita({ apiKey: 'sk_test' }).instances.create(options as CreateInstanceOptions))
      .rejects.toMatchObject({ name: 'InstanceSizeError', code, fallback: false });
    expect(create).not.toHaveBeenCalled();
  });

  it('names the setup job when a size template is not built', async () => {
    create.mockRejectedValueOnce(new Error("404: template 'csdk-node22-1cpu-2gb' not found"));
    await expect(novita({ apiKey: 'sk_test' }).instances.create({ sizeClass: 'sm' }))
      .rejects.toThrow(/not built on this Novita account.*provider-setup/);
  });

  it('leaves creates without sizeClass on the base template', async () => {
    await novita({ apiKey: 'sk_test' }).instances.create();
    expect(create.mock.calls[0][0]).toBe('base');
  });
});
