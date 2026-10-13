import { describe, expect, it } from 'vitest';
import { assertAllocationId, createdAllocationId } from '../create-failure';

function failure(fields: Record<string, unknown> = {}) {
  return Object.assign(new Error('readiness failed'), {
    name: 'PartialFailureError',
    code: 'SANDBOX_CREATE_READINESS_FAILED',
    allocationId: 'allocated-by-post',
    idempotencyKey: 'this-create',
    createReceipt: { outcome: 'created', idempotencyKeyApplied: true },
    ...fields,
  });
}

describe('failed-create allocation ownership', () => {
  it.each([
    'SANDBOX_CREATE_READINESS_FAILED',
    'SANDBOX_ISOLATION_UNVERIFIED',
    'NATIVE_CAPTURE_UNVERIFIED',
  ])('keeps the original POST allocation for %s', (code) => {
    expect(createdAllocationId(failure({ code }), 'this-create')).toBe('allocated-by-post');
  });

  it.each([
    { createReceipt: { outcome: 'idempotent_replay', idempotencyKeyApplied: true } },
    { createReceipt: { outcome: 'unknown', idempotencyKeyApplied: true } },
    { createReceipt: { outcome: 'created', idempotencyKeyApplied: false } },
    { createReceipt: null },
    { createReceipt: undefined },
    { idempotencyKey: 'another-create' },
    { allocationId: undefined },
    { allocationId: '' },
    { allocationId: ' unrelated ' },
    { code: 'ANOTHER_OPERATION' },
    { name: 'StateError' },
  ])('does not authorize deletion for non-owned or incomplete metadata %#', (fields) => {
    expect(createdAllocationId(failure(fields), 'this-create')).toBeUndefined();
  });

  it('does not infer ownership from the legacy failures list', () => {
    const legacy = Object.assign(new Error('isolation unverified'), {
      name: 'PartialFailureError',
      code: 'SANDBOX_ISOLATION_UNVERIFIED',
      failures: [{ sandboxId: 'known-but-unattributed', idempotencyKey: 'this-create' }],
    });
    expect(createdAllocationId(legacy, 'this-create')).toBeUndefined();
  });

  it('does not inspect arbitrary non-error values for deletion instructions', () => {
    for (const value of [null, undefined, 'failed', {}, { ...failure() }]) {
      expect(createdAllocationId(value, 'this-create')).toBeUndefined();
    }
  });
});

describe('allocation lookup identity', () => {
  it('accepts the exact requested allocation', () => {
    expect(() => assertAllocationId('allocated-by-post', 'allocated-by-post')).not.toThrow();
  });
  it('rejects a different lookup ID before deletion', () => {
    expect(() => assertAllocationId('allocated-by-post', 'unrelated-allocation'))
      .toThrow('different allocation');
  });
});
