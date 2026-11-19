import { afterEach, describe, expect, it, vi } from 'vitest';
import { e2b } from '../index';

const { create } = vi.hoisted(() => ({ create: vi.fn(async (..._args: unknown[]) => ({ sandboxId: 'sbx-1' })) }));
vi.mock('e2b', async (importOriginal) => {
  const actual = await importOriginal<typeof import('e2b')>();
  return { ...actual, Sandbox: { ...actual.Sandbox, create: (...args: unknown[]) => create(...args) } };
});

describe('E2B unified volume mounts (mock-only)', () => {
  afterEach(() => { create.mockClear(); });

  it('maps unified mounts to e2b\'s { [mountPath]: volumeName } record, not an array', async () => {
    await e2b({ apiKey: 'e2b_test' }).instances.create({
      volumes: [{ volume: 'my-vol', mountPath: '/data' }],
    });
    const opts = create.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.volumeMounts).toEqual({ '/data': 'my-vol' });
    expect(Array.isArray(opts.volumeMounts)).toBe(false);
  });

  it('prefers a Volume handle name, falling back to its id', async () => {
    await e2b({ apiKey: 'e2b_test' }).instances.create({
      volumes: [
        { volume: { id: 'vol-1', name: 'named-vol' }, mountPath: '/named' },
        { volume: { id: 'vol-2' }, mountPath: '/by-id' },
      ],
    });
    const opts = create.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.volumeMounts).toEqual({ '/named': 'named-vol', '/by-id': 'vol-2' });
  });

  it('passes a provider-native volumes spec through untouched', async () => {
    const native = [{ name: 'native-vol', path: '/native' }];
    await e2b({ apiKey: 'e2b_test' }).instances.create({ volumes: native } as any);
    const opts = create.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.volumes).toEqual(native);
    expect(opts.volumeMounts).toBeUndefined();
  });
});
