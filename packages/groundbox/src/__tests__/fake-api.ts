import { vi } from 'vitest';

export interface FakeCall {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
}

type Answer = unknown | ((call: FakeCall) => unknown);

/** An API error body, as every non-2xx Groundbox response has it. */
export class ApiError {
  constructor(readonly status: number, readonly code: string, readonly message: string) {}
}

export const sandbox = (fields: Record<string, unknown> = {}) => ({
  id: 'sbx_test0000000000',
  status: 'running',
  cpus: 2,
  memory_gb: 4,
  disk_gb: 20,
  booted: { cpus: 2, memory_mb: 3920 },
  timeout_minutes: 60,
  metadata: {},
  allow_hosts: null,
  flex: false,
  shared_cpu: false,
  forked_from: null,
  cost_micros: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  started_at: '2026-01-01T00:00:01.000Z',
  expires_at: '2026-01-01T01:00:00.000Z',
  paused_at: null,
  stopped_at: null,
  stop_reason: null,
  ...fields,
});

/**
 * A `fetch` that answers from a table of `METHOD /path` routes (`:id` matches one
 * segment) and records every call. An unknown route answers 404.
 */
export function fakeApi(routes: Record<string, Answer>) {
  const calls: FakeCall[] = [];
  const table = Object.entries(routes).map(([route, answer]) => {
    const [method, path] = route.split(' ') as [string, string];
    return { method, pattern: new RegExp(`^${path.replace(/:[a-z]+/g, '[^/]+')}$`), answer };
  });
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const raw = init.body;
    const call: FakeCall = {
      method: init.method ?? 'GET',
      path: url.pathname.replace(/^\/v1/, ''),
      query: Object.fromEntries(url.searchParams),
      body: typeof raw === 'string' ? JSON.parse(raw) : raw instanceof Uint8Array ? new TextDecoder().decode(raw) : undefined,
      headers: init.headers as Record<string, string>,
    };
    calls.push(call);
    const route = table.find((entry) => entry.method === call.method && entry.pattern.test(call.path));
    let answer: unknown = new ApiError(404, 'not_found', `No route ${call.method} ${call.path}`);
    if (route) answer = typeof route.answer === 'function' ? (route.answer as (call: FakeCall) => unknown)(call) : route.answer;
    if (answer instanceof ApiError) {
      return new Response(JSON.stringify({ error: { code: answer.code, message: answer.message } }), { status: answer.status });
    }
    if (typeof answer === 'string') return new Response(answer, { status: 200 });
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls, last: () => calls[calls.length - 1]! };
}
