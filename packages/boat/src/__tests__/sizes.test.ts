import { describe, expect, it } from 'vitest';
import { boat as make } from '../index';

describe('boat standard sizes', () => {
  it.each([
    ['xs', undefined],
    ['sm', undefined],
    ['md', {"type": "small"}],
    ['lg', {"type": "default"}],
    ['xl', {"type": "large"}],
    ['2xl', {"type": "xlarge"}],
    ['3xl', undefined],
  ] as const)('%s', (sizeClass, nativeOptions) => {
    const r = make({ apiKey: 'k' }).sizes!.resolve(sizeClass);
    if (nativeOptions) expect(r).toMatchObject({ status: 'supported', nativeOptions });
    else expect(r.status).toBe('unsupported');
  });

  it('rejects a native size option alongside sizeClass', () => {
    expect(() => make({ apiKey: 'k' }).sizes!.resolve('md', { type: 'small' } as any)).toThrow(/conflict|cannot combine/);
  });

  it('refuses a sized request that would keep a source shape', () => {
    expect(make({ apiKey: 'k' }).sizes!.resolve('md', { snapshotId: 's' } as any).status).toBe('unsupported');
  });
});
