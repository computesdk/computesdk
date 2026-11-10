/**
 * Node's fetch rejects a refused or unresolvable connection with a bare
 * `TypeError: fetch failed` (the socket error is only on `cause`), which
 * `@benchsdk/cli` prints as-is. These helpers name the URL and the cause.
 */

export function isFetchFailure(error: unknown): error is TypeError {
  return error instanceof TypeError && /fetch failed/i.test(error.message);
}

export function describeFetchFailure(error: TypeError, url: string): TypeError {
  let target = url;
  try {
    const parsed = new URL(url);
    target = `${parsed.origin}${parsed.pathname}`;
  } catch {
    // keep the raw string
  }
  const cause = (error as { cause?: unknown }).cause;
  const described = new TypeError(`fetch failed (${target})${cause instanceof Error ? `: ${cause.message}` : ''}`);
  (described as { cause?: unknown }).cause = cause;
  return described;
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function withFetchFailureContext(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    try {
      return await fetchImpl(input, init);
    } catch (error) {
      if (isFetchFailure(error)) throw describeFetchFailure(error, requestUrl(input));
      throw error;
    }
  };
}
