const createFailureCodes = new Set([
  'SANDBOX_CREATE_READINESS_FAILED',
  'SANDBOX_ISOLATION_UNVERIFIED',
  'NATIVE_CAPTURE_UNVERIFIED',
]);

/** Return only an allocation the failed POST authoritatively created for this call. */
export function createdAllocationId(error: unknown, idempotencyKey: string): string | undefined {
  if (!(error instanceof Error) || error.name !== 'PartialFailureError') return undefined;
  const failure = error as Error & Record<string, unknown>;
  const receipt = failure.createReceipt;
  if (typeof failure.code !== 'string' || !createFailureCodes.has(failure.code)
      || failure.idempotencyKey !== idempotencyKey
      || typeof failure.allocationId !== 'string' || !failure.allocationId
      || failure.allocationId.trim() !== failure.allocationId
      || receipt === null || typeof receipt !== 'object'
      || !('outcome' in receipt) || receipt.outcome !== 'created'
      || !('idempotencyKeyApplied' in receipt) || receipt.idempotencyKeyApplied !== true) {
    return undefined;
  }
  return failure.allocationId;
}
