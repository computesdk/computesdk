import { BriqOperationError, fail } from '@briq-cloud/sdk';
/** Upstream factory parse failures may contain guest output or daemon tokens. Never retain causes. */
export function sanitized(error: unknown): BriqOperationError {
  if (error instanceof BriqOperationError) return error;
  if (error instanceof Error && error.name === 'AbortError')
    return fail('aborted', 'Compute operation aborted; cleanup must be confirmed separately');
  return fail('provider', 'Compute operation failed');
}
export function protect<Args extends unknown[], Result>(
  operation: (...args: Args) => Promise<Result>,
) {
  return async (...args: Args): Promise<Result> => {
    try {
      return await operation(...args);
    } catch (error) {
      throw sanitized(error);
    }
  };
}
