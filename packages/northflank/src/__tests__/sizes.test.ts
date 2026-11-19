import { describe, expect, it } from 'vitest';
import { northflank as make } from '../index';

describe('northflank standard sizes', () => {
  it.each([
    ['xs', {"deploymentPlan": "nf-compute-100-1"}],
    ['sm', {"deploymentPlan": "nf-compute-100-2"}],
    ['md', {"deploymentPlan": "nf-compute-200-4"}],
    ['lg', {"deploymentPlan": "nf-compute-400"}],
    ['xl', {"deploymentPlan": "nf-compute-800-16"}],
    ['2xl', {"deploymentPlan": "nf-compute-1600-32"}],
    ['3xl', undefined],
  ] as const)('%s', (sizeClass, nativeOptions) => {
    const r = make({ apiToken: 't', projectId: 'p' } as any).sizes!.resolve(sizeClass);
    if (nativeOptions) expect(r).toMatchObject({ status: 'supported', nativeOptions });
    else expect(r.status).toBe('unsupported');
  });

  it('rejects a native size option alongside sizeClass', () => {
    expect(() => make({ apiToken: 't', projectId: 'p' } as any).sizes!.resolve('md', { deploymentPlan: 'nf-compute-20' } as any)).toThrow(/conflict|cannot combine/);
  });

  it('refuses a sized request that would keep a source shape', () => {
    expect(make({ apiToken: 't', projectId: 'p' } as any).sizes!.resolve('md', { templateId: 't' } as any).status).toBe('unsupported');
  });
});
