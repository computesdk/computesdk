import { describe, expect, it } from 'vitest';
import { microsandbox as make } from '../index';

describe('microsandbox standard sizes', () => {
  it.each([
    ['xs', {"cpus": 1, "memoryMiB": 1024}],
    ['sm', {"cpus": 1, "memoryMiB": 2048}],
    ['md', {"cpus": 2, "memoryMiB": 4096}],
    ['lg', {"cpus": 4, "memoryMiB": 8192}],
    ['xl', {"cpus": 8, "memoryMiB": 16384}],
    ['2xl', {"cpus": 16, "memoryMiB": 32768}],
    ['3xl', {"cpus": 32, "memoryMiB": 65536}],
  ] as const)('%s', (sizeClass, nativeOptions) => {
    const r = make({}).sizes!.resolve(sizeClass);
    if (nativeOptions) expect(r).toMatchObject({ status: 'supported', nativeOptions });
    else expect(r.status).toBe('unsupported');
  });

  it('rejects a native size option alongside sizeClass', () => {
    expect(() => make({}).sizes!.resolve('md', { memoryMib: 2048 } as any)).toThrow(/conflict|cannot combine/);
  });

  it('refuses a sized request that would keep a source shape', () => {
    expect(make({}).sizes!.resolve('md', { snapshotId: 's' } as any).status).toBe('unsupported');
  });
});
