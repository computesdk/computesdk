import { describe, expect, it } from 'vitest';
import { createIdentity } from '../identity';

describe('Tangle idempotent create identity', () => {
  it('keeps the entire identity stable when a caller repeats its key', () => {
    expect(createIdentity({ idempotencyKey: 'same-request' }))
      .toEqual(createIdentity({ idempotencyKey: 'same-request' }));
  });
  it('does not expose the caller key in the default sandbox name', () => {
    expect(createIdentity({ idempotencyKey: 'private-caller-key' }).name)
      .not.toContain('private-caller-key');
  });
  it('preserves an explicitly supplied name and key', () => {
    expect(createIdentity({ name: 'requested-name', idempotencyKey: 'requested-key' }))
      .toEqual({ name: 'requested-name', idempotencyKey: 'requested-key' });
  });
  it('gives independent creates distinct names and idempotency keys', () => {
    const first = createIdentity();
    const second = createIdentity();
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
    expect(first.name).not.toBe(second.name);
  });
});
