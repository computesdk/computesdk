import { describe, expect, it } from 'vitest';
import { neevcloud as make } from '../index';

describe('neevcloud standard sizes', () => {
  it.each([
    ['xs', {"cpu": 1, "memory": 1024}],
    ['sm', {"cpu": 1, "memory": 2048}],
    ['md', {"cpu": 2, "memory": 4096}],
    ['lg', {"cpu": 4, "memory": 8192}],
    ['xl', {"cpu": 8, "memory": 16384}],
    ['2xl', {"cpu": 16, "memory": 32768}],
    ['3xl', {"cpu": 32, "memory": 65536}],
  ] as const)('%s', (sizeClass, nativeOptions) => {
    const r = make({ apiKey: 'k' } as any).sizes!.resolve(sizeClass);
    if (nativeOptions) expect(r).toMatchObject({ status: 'supported', nativeOptions });
    else expect(r.status).toBe('unsupported');
  });

  it('rejects a native size option alongside sizeClass', () => {
    expect(() => make({ apiKey: 'k' } as any).sizes!.resolve('md', { cpu: 2 } as any)).toThrow(/conflict|cannot combine/);
  });

  it('refuses a sized request that would keep a source shape', () => {
    expect(make({ apiKey: 'k' } as any).sizes!.resolve('md', { snapshotId: 's' } as any).status).toBe('unsupported');
  });
});
