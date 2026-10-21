import type { SandboxInstance } from '@tangle-network/sandbox';
import { sdk } from './http2';
import type { RunCommandOptions } from '@computesdk/provider';
import { createSdkClient, normalizeSandboxCreateReceipt, type TangleClient } from './client';
import { http2Request, openConnections, type BufferedReply } from './http2';
import { parseErrorResponse } from './api-errors';

// Defaults and bounds mirror the pinned SDK's create and exec protocol.
const CREATE_TIMEOUT_MS = 120_000;
const EXEC_TIMEOUT_MS = 30_000;
const EXEC_TRANSPORT_MARGIN_MS = 15_000;

type WireObject = Record<string, any>;
export type Api = ReturnType<typeof createApi>;

export function createApi(apiKey: string, baseUrl: string) {
  const authorization = new Headers({ authorization: 'Bearer ' + apiKey }).get('authorization')!;
  const base = baseUrl.replace(/\/+$/, '');
  const endpoint = new URL(base);
  openConnections(endpoint);
  const address = { origin: endpoint.origin, pathname: endpoint.pathname, search: endpoint.search };
  const simpleBase = !endpoint.search && !endpoint.hash;
  const prefix = endpoint.pathname === '/' ? '' : endpoint.pathname;
  let client: TangleClient | undefined;
  return {
    sdk: () => client ??= createSdkClient(apiKey, base),
    async request(path: string, method: string, body?: WireObject, timeoutMs = 30_000,
      signal?: AbortSignal, idempotencyKey?: string): Promise<BufferedReply> {
      try {
        const url = simpleBase ? address : new URL(base + path);
        return await http2Request(url, {
          ':method': method, authorization, 'content-type': 'application/json',
          ...(idempotencyKey !== undefined ? { 'idempotency-key': idempotencyKey } : {}),
        }, body === undefined ? undefined : JSON.stringify(body), signal, timeoutMs,
          url === address ? prefix + path : undefined);
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (error instanceof sdk().TimeoutError) throw error;
        throw new (sdk().NetworkError)('Failed to connect to Tangle Sandbox API', error instanceof Error ? error : undefined);
      }
    },
  };
}

function checkedJson(response: BufferedReply, path: string, method: string): WireObject {
  if (response.status < 200 || response.status >= 300) {
    const headers = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      if (!name.startsWith(':') && value !== undefined) headers.set(name, String(value));
    }
    headers.set('x-tangle-request-path', path);
    headers.set('x-tangle-request-method', method);
    throw parseErrorResponse(response.status, response.body.toString(),
      { allPreviousCreateAttemptsRefused: true }, headers);
  }
  return JSON.parse(response.body.toString());
}

export async function createIsolated(api: Api, body: WireObject, timeoutMs = CREATE_TIMEOUT_MS,
  signal?: AbortSignal): Promise<SandboxInstance> {
  timeoutMs = timeoutMs ?? CREATE_TIMEOUT_MS;
  // Preserve the SDK's native timeout argument errors without allocating a
  // second timer for valid requests; the transport owns their deadline.
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 0xFFFF_FFFF) AbortSignal.timeout(timeoutMs);
  const path = '/v1/sandboxes';
  const data = checkedJson(await api.request(path, 'POST', {
    ...body, ownerContext: 'isolated', secrets: [], sshEnabled: false,
  }, timeoutMs, signal, body.idempotencyKey), path, 'POST');
  if (!data || typeof data !== 'object') throw new (sdk().ServerError)('Sandbox create response was malformed', 502);
  const receipt = data.createReceipt;
  const fail = (message: string, code: string): never => {
    throw new (sdk().PartialFailureError)(message, code, 502, { origin: 'sandbox-api', endpoint: path },
      [{ sandboxId: data.id, idempotencyKey: body.idempotencyKey }], undefined, {
        allocationId: data.id, idempotencyKey: body.idempotencyKey, createReceipt: normalizeSandboxCreateReceipt(receipt),
      });
  };
  if (receipt?.ownerContext !== 'isolated' || typeof receipt.idempotencyKeyApplied !== 'boolean'
      || !Array.isArray(data.createReceipt.injectedSecrets)
      || data.createReceipt.injectedSecrets.length !== 0) {
    fail('The host did not confirm isolated owner context. No post-create work was started. Inspect the recorded sandbox and retry identity before allocating a replacement.',
      'SANDBOX_ISOLATION_UNVERIFIED');
  }
  if (typeof data.id !== 'string' || !data.id || data.id.trim() !== data.id
      || data.status !== 'running' || typeof data.filesystemIncarnationId !== 'string' || !data.filesystemIncarnationId
      || (data.filesystemIncarnationProvenance !== 'fresh' && data.filesystemIncarnationProvenance !== 'restored'
        && data.filesystemIncarnationProvenance !== 'unknown')
      || data.filesystemIncarnationReadiness !== 'ready') {
    fail('Sandbox create did not return a running allocation with a ready filesystem incarnation.',
      'SANDBOX_CREATE_READINESS_FAILED');
  }
  return attachInstance(api, data);
}

const instances = new WeakMap<SandboxInstance, { api: Api; data?: WireObject; native?: SandboxInstance }>();

/** A native handle is materialized only when a consumer asks for SDK features. */
function attachInstance(api: Api, data: WireObject): SandboxInstance {
  // This identity stays inside the provider. Its getInstance hook materializes
  // the native handle only when a consumer asks for SDK features.
  const handle = { id: data.id } as SandboxInstance;
  instances.set(handle, { api, data });
  return handle;
}

export function trackInstance(api: Api, instance: SandboxInstance): SandboxInstance {
  instances.set(instance, { api, native: instance });
  return instance;
}

export function nativeInstance(instance: SandboxInstance): SandboxInstance {
  const state = instances.get(instance)!;
  // Native-only normalization follows the pinned SDK's wire contract.
  return state.native ??= state.api.sdk().fromCreateResponse(state.data!);
}

export async function runCommand(instance: SandboxInstance, command: string, options?: RunCommandOptions) {
  const state = instances.get(instance)!;
  const native = state.native;
  const info = native ?? state.data!;
  if (info.status !== 'running' || info.filesystemIncarnationReadiness !== 'ready') {
    throw new (sdk().StateError)('Sandbox is not running with a ready filesystem incarnation', info.status, 'running with a ready filesystem incarnation');
  }
  const background = options?.background === true;
  const timeoutMs = options?.timeout ?? EXEC_TIMEOUT_MS;
  if (!background && (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 600_000)) {
    throw new (sdk().ValidationError)('exec timeoutMs must be an integer between 100 and 600000');
  }
  const path = '/v1/sandboxes/' + encodeURIComponent(instance.id) + '/runtime/process/spawn';
  let response: BufferedReply;
  try {
    response = await state.api.request(path, 'POST', {
      executable: '/bin/sh', args: ['-c', command], cwd: options?.cwd, env: options?.env,
      timeoutMs: background ? options?.timeout : timeoutMs, blocking: !background,
    }, background ? 30_000 : timeoutMs + EXEC_TRANSPORT_MARGIN_MS);
  } catch (error) {
    // Match SandboxInstance.runtimeFetch's transport error boundary.
    if (error instanceof sdk().StateError) throw error;
    throw new (sdk().NetworkError)(`Failed to connect to sandbox: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error : undefined, { origin: 'runtime', endpoint: '/process/spawn' });
  }
  const result = checkedJson(response, path, 'POST')?.data;
  if (background) {
    if (!Number.isSafeInteger(result?.pid) || result.pid <= 0) throw new Error('Tangle did not acknowledge a background process.');
    return { stdout: '', stderr: '', exitCode: 0 };
  }
  if (!result || typeof result.exitCode !== 'number' || typeof result.stdout !== 'string' || typeof result.stderr !== 'string') {
    throw new (sdk().ServerError)('Sandbox process response was malformed', 502);
  }
  return { stdout: result.stdout as string, stderr: result.stderr as string, exitCode: result.exitCode as number };
}

export async function removeInstance(api: Api, instanceId: string): Promise<void> {
  const response = await api.request('/v1/sandboxes/' + encodeURIComponent(instanceId), 'DELETE');
  if ((response.status >= 200 && response.status < 300) || response.status === 404) return;
  throw new (sdk().SandboxError)('Tangle deletion failed: ' + response.body.toString(), 'SANDBOX_DELETE_FAILED', response.status);
}
