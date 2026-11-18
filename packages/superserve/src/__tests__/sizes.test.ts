/**
 * Superserve standard size mapping (mock-only; no sandboxes, no API keys).
 *
 * Ways the mapping could fail, each covered below:
 * 1. Wrong shape: a class boots a template whose vCPU/RAM differ from the
 *    profile (e.g. md -> a 1 vCPU template), or 3xl claims a shape Superserve
 *    does not list (max 16 vCPU / 64 GiB on Pro).
 * 2. Silent default boot: the resolved templateId never reaches
 *    `Sandbox.create` as `fromTemplate`, so Superserve boots its default
 *    `superserve/base` (2 vCPU / 4 GiB) whatever size was asked for.
 * 3. Dropped/overridden field: a caller `fromTemplate`/`fromSnapshot`
 *    passthrough is spread after the size template and replaces it, or
 *    `sizeClass` leaks into the vendor call.
 * 4. Conflict accepted: native vcpu/memoryMib/diskMib (which `Sandbox.create`
 *    drops silently) or core cpu/memory fields combined with sizeClass create
 *    a sandbox instead of failing before any vendor call.
 * 5. Unmapped class guessed: 3xl creates anything instead of 'unsupported'.
 * 6. Disk misreported: the built-in superserve/base fixes 8 GiB disk; team
 *    templates take disk from their build, so no disk is claimed for them.
 * 7. Missing team template surfaces as a generic error with no setup hint.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const { create } = vi.hoisted(() => ({ create: vi.fn(async (..._args: unknown[]) => ({ id: 'sb-1' })) }));
vi.mock('@superserve/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@superserve/sdk')>();
  return { ...actual, Sandbox: { ...actual.Sandbox, create: (...args: unknown[]) => create(...args) } };
});

import { NotFoundError } from '@superserve/sdk';
import { superserve, SUPERSERVE_SIZE_TEMPLATES } from '../index';

const provider = () => superserve({ apiKey: 'ss_test' });

const mapped = [
  ['xs', 1, 1024, 'csdk-node22-1cpu-1gb', undefined],
  ['sm', 1, 2048, 'csdk-node22-1cpu-2gb', undefined],
  ['md', 2, 4096, 'superserve/base', 8192],
  ['lg', 4, 8192, 'csdk-node22-4cpu-8gb', undefined],
  ['xl', 8, 16384, 'csdk-node22-8cpu-16gb', undefined],
  ['2xl', 16, 32768, 'csdk-node22-16cpu-32gb', undefined],
] as const;

describe('Superserve standard size mapping (mock-only)', () => {
  afterEach(() => { create.mockClear(); });

  it('supports xs-2xl and refuses 3xl as unsupported', () => {
    const list = provider().sizes.list();
    expect(list.filter(p => p.status === 'supported').map(p => p.requested.sizeClass)).toEqual(['xs', 'sm', 'md', 'lg', 'xl', '2xl']);
    const xxxl = provider().sizes.resolve('3xl');
    expect(xxxl).toMatchObject({ status: 'unsupported', reason: expect.stringMatching(/16 vCPU \/ 64 GiB/) });
  });

  it.each(mapped)('resolves %s to the exact template shape', (sizeClass, vcpus, memoryMiB, templateId, diskMiB) => {
    expect(SUPERSERVE_SIZE_TEMPLATES[sizeClass]).toBe(templateId);
    expect(provider().sizes.resolve(sizeClass)).toEqual({
      requested: { sizeClass, vcpus, memoryMiB }, provenance: 'adapter-declared', status: 'supported',
      nativeOptions: { templateId },
      resolved: diskMiB === undefined ? { vcpus, memoryMiB } : { vcpus, memoryMiB, diskMiB },
    });
  });

  it.each(mapped)('boots %s from its template via fromTemplate', async (sizeClass, vcpus, memoryMiB, templateId) => {
    const result = await provider().instances.create({ sizeClass, envs: { A: '1' } });
    expect(create).toHaveBeenCalledTimes(1);
    const body = create.mock.calls[0][0] as Record<string, unknown>;
    expect(body).toMatchObject({ fromTemplate: templateId, envVars: { A: '1' } });
    expect(body).not.toHaveProperty('sizeClass');
    expect(body).not.toHaveProperty('templateId');
    expect(result.sizing).toMatchObject({ requested: { sizeClass, vcpus, memoryMiB }, resolved: { vcpus, memoryMiB }, provenance: 'adapter-declared' });
  });

  it('honors per-team template names from config and drops the built-in disk claim', async () => {
    const p = superserve({ apiKey: 'ss_test', sizeTemplates: { md: 'acme/node-2cpu-4gb', '3xl': 'acme/enterprise-32cpu-128gb' } });
    expect(p.sizes.resolve('md')).toMatchObject({ status: 'supported', resolved: { vcpus: 2, memoryMiB: 4096 } });
    expect((p.sizes.resolve('md') as { resolved: object }).resolved).not.toHaveProperty('diskMiB');
    await p.instances.create({ sizeClass: '3xl' });
    expect(create.mock.calls[0][0]).toMatchObject({ fromTemplate: 'acme/enterprise-32cpu-128gb' });
  });

  it.each([
    [{ sizeClass: 'sm', templateId: 'superserve/node-22' }, 'unsupported'],
    [{ sizeClass: 'sm', snapshotId: 'snap' }, 'unsupported'],
    [{ sizeClass: 'sm', sandboxId: 'sb-0' }, 'unsupported'],
    [{ sizeClass: 'sm', fromTemplate: 'superserve/base' }, 'unsupported'],
    [{ sizeClass: 'sm', fromSnapshot: 'snap' }, 'unsupported'],
    [{ sizeClass: 'sm', vcpu: 1 }, 'conflict'],
    [{ sizeClass: 'sm', vcpuCount: 1 }, 'conflict'],
    [{ sizeClass: 'sm', memoryMib: 2048 }, 'conflict'],
    [{ sizeClass: 'sm', memoryMaxMib: 4096 }, 'conflict'],
    [{ sizeClass: 'sm', diskMib: 8192 }, 'conflict'],
    [{ sizeClass: 'sm', cpu: 1 }, 'conflict'],
    [{ sizeClass: 'sm', memoryMiB: 2048 }, 'conflict'],
    [{ sizeClass: '3xl' }, 'unsupported'],
    [{ sizeClass: '4xl' }, 'invalid'],
  ])('rejects without creating: %j', async (options, code) => {
    await expect(provider().instances.create(options as any)).rejects.toMatchObject({ name: 'InstanceSizeError', code, fallback: false });
    expect(create).not.toHaveBeenCalled();
  });

  it('names the setup job when a size template is not built', async () => {
    create.mockRejectedValueOnce(new NotFoundError("template 'csdk-node22-4cpu-8gb' not found"));
    await expect(provider().instances.create({ sizeClass: 'lg' })).rejects.toThrow(/not built on this Superserve team.*provider-setup/);
  });

  it('leaves creates without sizeClass untouched', async () => {
    await provider().instances.create({ templateId: 'superserve/node-22' });
    expect(create.mock.calls[0][0]).toMatchObject({ fromTemplate: 'superserve/node-22' });
  });
});
