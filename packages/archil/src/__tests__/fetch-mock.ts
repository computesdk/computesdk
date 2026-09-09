export function adaptFetchMock(
  fetchMock: typeof fetch,
): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const body = request.body ? await request.clone().text() : undefined;
    const dispatcher = (init as RequestInit & { dispatcher?: unknown })
      ?.dispatcher;
    return fetchMock(request.url, {
      method: request.method,
      headers: request.headers,
      body,
      ...(dispatcher ? { dispatcher } : {}),
    } as RequestInit);
  };
}
