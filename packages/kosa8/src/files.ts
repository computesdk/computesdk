/**
 * File content for the kosa8 provider.
 *
 * kosa8's file stream takes and returns a file's raw bytes at any absolute path:
 * `PUT`/`GET …/files?path=`, with `offset=` on a PUT (the rest of the file kept) and `Range` on a
 * GET. It is reached two ways, tried in this order:
 *
 * 1. Straight on the sandbox's host, at the direct token's `files_url`, when the token covers files.
 *    This skips the API's Worker and Cloudflare's 100 MB request limit.
 * 2. Through the API, `/v1/sandboxes/{id}/files`.
 *
 * A file of at most one part (64 MiB) is one request. A larger one is sent in parts to a
 * temporary name beside it — the first part creates it, the rest are written at their offsets in
 * parallel — and renamed over its path once every part landed, so a failed part leaves the file
 * it replaces intact. It is read the same way, with ranges.
 *
 * An older host has the base64 file API instead: /workspace only, 8 MiB at most, no offsets. Its
 * refusals (400 outside /workspace, 413, 501) send the file over exec instead, in base64 chunks.
 */

import { randomBytes } from 'node:crypto';
import { escapeShellArg } from '@computesdk/provider';
import { httpRequest, type HttpResponse } from './transport';

import type { CommandResult, RunCommandOptions } from '@computesdk/provider';
import type { Kosa8Sandbox } from './index';

export type ExecRunner = (sandbox: Kosa8Sandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>;

/** Where file requests go: the host's own files URL with the direct token, or the API with the key. */
export interface FileTarget {
  url: string;
  token: string;
}

/**
 * Bytes per request (under the API's 100 MB request body limit), and parts moved at once: reads
 * four, writes two (four 64 MiB uploads at once on one connection sometimes made the host's HTTP/2
 * server end it with ENHANCE_YOUR_CALM, and two are about as fast). A mutable object so tests can
 * use small parts.
 */
export const fileParts = { bytes: 64 * 1024 * 1024, concurrency: 4, writeConcurrency: 2 };
/**
 * Times a request that failed in transit, or with a server error, is sent again. Cloudflare's
 * 52x (host unreachable) are not retried: from the files URL they send the request to the API.
 */
const FILE_RETRIES = 2;
const RETRY_STATUS = new Set([500, 502, 503, 504]);

/**
 * Statuses from the host's files URL that mean the request was not served there: the token was
 * refused (401), the sandbox is asleep and only the API wakes it (409), the host does not offer it
 * (501), or Cloudflare could not reach the host. The request then goes through the API. 403 and 404
 * are not here: from the files URL they mean permission denied and no such file.
 */
const DIRECT_REFUSED = new Set([401, 409, 501, 521, 522, 523, 530]);

/**
 * Base64 characters per write exec (the fallback for older hosts). The exec API caps each argv
 * entry at 8192 characters, so content travels in an environment variable, which counts only toward
 * the 64 KiB request body.
 */
export const WRITE_CHUNK_CHARS = 48 * 1024;
/** A file this small is read inline by one exec (fallback); its base64 stays under the exec output limit. */
export const INLINE_READ_BYTES = 1024 * 1024;

const NOT_FOUND_EXIT = 44;
const MIB = 1024 * 1024;

const q = (s: string) => `"${escapeShellArg(s)}"`;
const notFound = (path: string) => new Error(`ENOENT: no such file or directory, open '${path}'`);

const apiTarget = (sandbox: Kosa8Sandbox): FileTarget => ({
  url: `${sandbox.baseUrl}/v1/sandboxes/${encodeURIComponent(sandbox.id)}/files`,
  token: sandbox.apiKey,
});

function errorDetail(res: HttpResponse): string {
  const text = res.text || (res.bytes ? Buffer.from(res.bytes).toString('utf8') : '');
  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    if (parsed && (parsed.error || parsed.message)) return [parsed.error, parsed.message].filter(Boolean).join(': ');
  } catch {
    // Not JSON: keep the raw text.
  }
  return text.slice(0, 500);
}

/** The error for a refused file request, with Node's codes for the common ones. */
function fileError(res: HttpResponse, op: 'open' | 'write', path: string): Error {
  const detail = errorDetail(res);
  if (res.status === 404) return notFound(path);
  if (res.status === 403) return new Error(`EACCES: permission denied, ${op} '${path}'${detail ? `: ${detail}` : ''}`);
  if (res.status === 507) return new Error(`ENOSPC: no space left on device, ${op} '${path}'${detail ? `: ${detail}` : ''}`);
  return new Error(`kosa8 file ${op} '${path}' failed (${res.status})${detail ? `: ${detail}` : ''}`);
}

/**
 * A refusal from the older base64 file API (or a host without any): a path outside /workspace,
 * a file over its 8 MiB, or offsets and streams it does not have. Exec reaches those.
 */
function olderFileApi(res: HttpResponse): boolean {
  return res.status === 413 || res.status === 501 || (res.status === 400 && /workspace/i.test(errorDetail(res)));
}

async function send(
  t: FileTarget,
  method: 'GET' | 'PUT',
  path: string,
  { body, offset, range }: { body?: Uint8Array; offset?: number; range?: [number, number] } = {},
): Promise<HttpResponse> {
  const url = `${t.url}?path=${encodeURIComponent(path)}${offset ? `&offset=${offset}` : ''}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${t.token}` };
  if (body) headers['Content-Type'] = 'application/octet-stream';
  if (range) headers.Range = `bytes=${range[0]}-${range[1]}`;
  // Every request here is idempotent (a whole file, a part at its offset, or a read), so one that
  // failed in transit or with a server error is sent again.
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await httpRequest(url, { method, headers, body, binary: true });
      if (!RETRY_STATUS.has(res.status) || attempt >= FILE_RETRIES) return res;
    } catch (err) {
      if (attempt >= FILE_RETRIES) throw err;
    }
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
  }
}

/**
 * Runs task over items, at most `limit` at once. After a task fails no more are started, and the
 * first failure is returned (or thrown) once the ones in progress have finished.
 */
async function inParallel<T, R>(items: T[], limit: number, task: (item: T) => Promise<R | null>): Promise<R | null> {
  let next = 0;
  let failed: R | null = null;
  let thrown: { err: unknown } | undefined;
  const worker = async () => {
    while (!failed && !thrown && next < items.length) {
      try {
        const r = await task(items[next++]);
        if (r) failed ??= r;
      } catch (err) {
        thrown ??= { err };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (thrown) throw thrown.err;
  return failed;
}

/** Writes bytes at path through t: null when written, else the refusal. */
async function writeTo(t: FileTarget, path: string, bytes: Uint8Array): Promise<HttpResponse | null> {
  // The first part replaces the file (creating its directories); the rest are written at their offsets.
  const first = await send(t, 'PUT', path, { body: bytes.subarray(0, fileParts.bytes) });
  if (!first.ok) return first;
  const offsets: number[] = [];
  for (let at = fileParts.bytes; at < bytes.length; at += fileParts.bytes) offsets.push(at);
  return inParallel(offsets, fileParts.writeConcurrency, async (at) => {
    const res = await send(t, 'PUT', path, { body: bytes.subarray(at, at + fileParts.bytes), offset: at });
    return res.ok ? null : res;
  });
}

/** Reads path through t: its bytes, or the refusal. */
async function readFrom(t: FileTarget, path: string): Promise<Uint8Array | HttpResponse> {
  const first = await send(t, 'GET', path, { range: [0, fileParts.bytes - 1] });
  // 416: the first byte is past the end, so the file is empty.
  if (first.status === 416) return new Uint8Array();
  // 200: the whole file (a server that ignores Range).
  if (first.status === 200) return first.bytes ?? new Uint8Array();
  if (first.status !== 206) return first;
  const head = first.bytes ?? new Uint8Array();
  const total = Number(/\/(\d+)\s*$/.exec(first.headers['content-range'] ?? '')?.[1] ?? head.length);
  if (total <= head.length) return head;
  const starts: number[] = [];
  for (let at = head.length; at < total; at += fileParts.bytes) starts.push(at);
  const parts = new Map<number, Uint8Array>();
  const failed = await inParallel(starts, fileParts.concurrency, async (at) => {
    const res = await send(t, 'GET', path, { range: [at, Math.min(total, at + fileParts.bytes) - 1] });
    if (res.status !== 206 && res.status !== 200) return res;
    parts.set(at, res.bytes ?? new Uint8Array());
    return null;
  });
  if (failed) return failed;
  const all = Buffer.concat([head, ...starts.map((at) => parts.get(at)!)]);
  if (all.length !== total) {
    throw new Error(`open '${path}' failed: read ${all.length} of ${total} bytes (the file changed while it was read?)`);
  }
  return all;
}

// --- write -------------------------------------------------------------------

/**
 * Writes a file: straight to the host when the direct token covers files, else through the API's
 * file stream, else (an older host) over exec.
 */
export async function writeFileNative(
  sandbox: Kosa8Sandbox,
  path: string,
  content: string,
  run: ExecRunner,
  direct: FileTarget | null = null,
): Promise<void> {
  const bytes = Buffer.from(content, 'utf8');
  const staged = bytes.length > fileParts.bytes ? `${path}.computesdk-${randomBytes(6).toString('hex')}` : null;
  const dest = staged ?? path;
  const commit = async () => {
    if (staged) await mustSucceed(run, sandbox, `mv -f ${q(staged)} ${q(path)}`, 'write', path);
  };
  try {
    if (direct) {
      // A connection to the host that failed in transit (after retries) leaves the API to try.
      const res = await writeTo(direct, dest, bytes).catch(() => undefined);
      if (res === null) {
        await commit();
        return;
      }
      if (res && !DIRECT_REFUSED.has(res.status)) throw fileError(res, 'write', path);
      if (res && (res.status === 401 || res.status === 501)) sandbox.directFiles = false;
    }
    if (sandbox.files !== false) {
      const res = await writeTo(apiTarget(sandbox), dest, bytes);
      if (!res) {
        await commit();
        return;
      }
      if (!olderFileApi(res)) throw fileError(res, 'write', path);
      if (res.status === 501) sandbox.files = false;
    }
    return writeFileViaExec(sandbox, path, bytes, run);
  } finally {
    if (staged) await run(sandbox, `rm -f ${q(staged)}`).catch(() => {});
  }
}

async function mustSucceed(run: ExecRunner, sandbox: Kosa8Sandbox, command: string, what: string, path: string, env?: Record<string, string>) {
  const result = await run(sandbox, command, env ? { env } : undefined);
  if (result.exitCode === NOT_FOUND_EXIT) throw notFound(path);
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(`${what} '${path}' failed (exit ${result.exitCode})${detail ? `: ${detail}` : ''}`);
  }
  if ((result as { stdoutTruncated?: boolean }).stdoutTruncated) {
    throw new Error(`${what} '${path}' failed: the command's output was cut off at the exec API's limit`);
  }
  return result.stdout;
}

/**
 * Writes a file through exec (older hosts): base64 chunks into a temporary file beside it, then an
 * atomic rename. One chunk is a single command.
 */
export async function writeFileViaExec(sandbox: Kosa8Sandbox, path: string, content: string | Uint8Array, run: ExecRunner): Promise<void> {
  const target = q(path);
  const tmp = q(`${path}.computesdk-${randomBytes(6).toString('hex')}`);
  const encoded = Buffer.from(content).toString('base64');
  const mkParent = `d=$(dirname ${target}) && mkdir -p "$d"`;
  if (encoded.length <= WRITE_CHUNK_CHARS) {
    const cmd = `${mkParent} && printf '%s' "$KOSA8_CHUNK" | base64 -d > ${tmp} && mv -f ${tmp} ${target} || { s=$?; rm -f ${tmp}; exit $s; }`;
    await mustSucceed(run, sandbox, cmd, 'write', path, { KOSA8_CHUNK: encoded });
    return;
  }
  try {
    await mustSucceed(run, sandbox, `${mkParent} && : > ${tmp}`, 'write', path);
    for (let i = 0; i < encoded.length; i += WRITE_CHUNK_CHARS) {
      await mustSucceed(run, sandbox, `printf '%s' "$KOSA8_CHUNK" | base64 -d >> ${tmp}`, 'write', path, {
        KOSA8_CHUNK: encoded.slice(i, i + WRITE_CHUNK_CHARS),
      });
    }
    await mustSucceed(run, sandbox, `mv -f ${tmp} ${target}`, 'write', path);
  } catch (err) {
    await run(sandbox, `rm -f ${tmp}`).catch(() => {});
    throw err;
  }
}

// --- read --------------------------------------------------------------------

const fromBase64 = (s: string) => Buffer.from(s.replace(/\s+/g, ''), 'base64');

/**
 * Reads a file: straight from the host when the direct token covers files, else through the API's
 * file stream, else (an older host) over exec.
 */
export async function readFileNative(sandbox: Kosa8Sandbox, path: string, run: ExecRunner, direct: FileTarget | null = null): Promise<string> {
  if (direct) {
    // A connection to the host that failed in transit (after retries) leaves the API to try.
    const got = await readFrom(direct, path).catch(() => undefined);
    if (got instanceof Uint8Array) return Buffer.from(got).toString('utf8');
    if (got && !DIRECT_REFUSED.has(got.status)) throw fileError(got, 'open', path);
    if (got && (got.status === 401 || got.status === 501)) sandbox.directFiles = false;
  }
  if (sandbox.files !== false) {
    const got = await readFrom(apiTarget(sandbox), path);
    if (got instanceof Uint8Array) return Buffer.from(got).toString('utf8');
    if (!olderFileApi(got)) throw fileError(got, 'open', path);
    if (got.status === 501) sandbox.files = false;
  }
  return readFileViaExec(sandbox, path, run);
}

/** Reads a file through exec (older hosts): inline when small, else 1 MiB per command. */
async function readFileViaExec(sandbox: Kosa8Sandbox, path: string, run: ExecRunner): Promise<string> {
  const p = q(path);
  const out = await mustSucceed(
    run,
    sandbox,
    `[ -f ${p} ] || exit ${NOT_FOUND_EXIT}; s=$(wc -c < ${p} | tr -d ' ') || exit $?; echo "$s"; if [ "$s" -le ${INLINE_READ_BYTES} ]; then base64 < ${p}; fi`,
    'open',
    path,
  );
  const nl = out.indexOf('\n');
  const size = Number(out.slice(0, nl < 0 ? undefined : nl).trim());
  if (!Number.isInteger(size) || size < 0) throw new Error(`open '${path}' failed: unexpected answer from the sandbox`);
  if (size <= INLINE_READ_BYTES) return fromBase64(nl < 0 ? '' : out.slice(nl + 1)).toString('utf8');
  const chunks: Buffer[] = new Array(Math.ceil(size / INLINE_READ_BYTES));
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      chunks[i] = fromBase64(
        await mustSucceed(run, sandbox, `[ -f ${p} ] || exit ${NOT_FOUND_EXIT}; dd if=${p} bs=${MIB} skip=${i} count=1 2>/dev/null | base64`, 'open', path),
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(fileParts.concurrency, chunks.length) }, worker));
  const all = Buffer.concat(chunks);
  if (all.length !== size) throw new Error(`open '${path}' failed: read ${all.length} of ${size} bytes (the file changed while it was read?)`);
  return all.toString('utf8');
}
