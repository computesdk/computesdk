/**
 * File content for the kosa8 provider.
 *
 * kosa8's file API (`PUT`/`GET /v1/sandboxes/{id}/files?path=`) moves a file's bytes in one request,
 * but only under /workspace and at most 8 MiB per request. Everything else is built on it:
 *
 * - A small file (one exec's worth) is written with one shell command over exec, which goes straight
 *   to the sandbox's host and is quicker than the API for a few KiB.
 * - A larger file under /workspace, up to 8 MiB, is one PUT (write) or one GET (read).
 * - Any other file is staged: its bytes go up as 4 MiB parts, PUT in parallel into a directory under
 *   /workspace, and one command puts them together at the path and removes them. A read is the
 *   reverse: one command prints a small file inline, or splits a large one into parts there, which
 *   are fetched in parallel and removed.
 * - A host without the file API (501) gets the exec path for everything: base64 chunks over exec,
 *   each read chunk well under the exec output limit.
 */

import { randomBytes } from 'node:crypto';
import { posix } from 'node:path';
import { escapeShellArg } from '@computesdk/provider';
import { httpRequest, type HttpResponse } from './transport';

import type { CommandResult, RunCommandOptions } from '@computesdk/provider';
import type { Kosa8Sandbox } from './index';

export type ExecRunner = (sandbox: Kosa8Sandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>;

/** The directory the file API reaches. */
export const WORKSPACE = '/workspace';
/** The file API's limit on one file, each way. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
/** Bytes per part of a staged file, and how many parts are moved at once. */
export const PART_BYTES = 4 * 1024 * 1024;
export const PART_CONCURRENCY = 4;

/**
 * Base64 characters per write exec. The exec API caps each argv entry at 8192 characters, too small
 * for the shell filesystem's inline chunks, so file content travels in an environment variable,
 * which counts only toward the 64 KiB request body.
 */
export const WRITE_CHUNK_CHARS = 48 * 1024;
/** A file this small is written with one exec (one chunk). */
export const INLINE_WRITE_BYTES = (WRITE_CHUNK_CHARS / 4) * 3;
/**
 * A file this small is read inline by one exec. Its base64 (about 1.4 MB) stays under the ~2 MiB
 * the exec API returns of a command's output; a larger one is read in parts.
 */
export const INLINE_READ_BYTES = 1024 * 1024;

const NOT_FOUND_EXIT = 44;
const MIB = 1024 * 1024;

const q = (s: string) => `"${escapeShellArg(s)}"`;
const notFound = (path: string) => new Error(`ENOENT: no such file or directory, open '${path}'`);

/** The normalized path when it is a file under /workspace (where the file API reaches), else null. */
export function workspacePath(path: string): string | null {
  if (!path.startsWith('/')) return null;
  const p = posix.normalize(path);
  return p.startsWith(`${WORKSPACE}/`) && p.length > WORKSPACE.length + 1 && !p.endsWith('/') ? p : null;
}

/** A directory under /workspace for one staged transfer. */
const stagingDir = () => `${WORKSPACE}/.computesdk-${randomBytes(6).toString('hex')}`;
const partName = (i: number) => String(i).padStart(6, '0');

function filesRequest(sandbox: Kosa8Sandbox, method: 'GET' | 'PUT', path: string, body?: Uint8Array): Promise<HttpResponse> {
  return httpRequest(`${sandbox.baseUrl}/v1/sandboxes/${encodeURIComponent(sandbox.id)}/files?path=${encodeURIComponent(path)}`, {
    method,
    headers: {
      Authorization: `Bearer ${sandbox.apiKey}`,
      ...(body ? { 'Content-Type': 'application/octet-stream' } : {}),
    },
    body,
    binary: method === 'GET',
  });
}

function apiError(res: HttpResponse, what: string): Error {
  let detail = res.text;
  try {
    const parsed = JSON.parse(res.text) as { error?: string; message?: string };
    if (parsed && (parsed.error || parsed.message)) detail = [parsed.error, parsed.message].filter(Boolean).join(': ');
  } catch {
    // Not JSON: keep the raw text.
  }
  return new Error(`kosa8 API error (${res.status}) on ${what}${detail ? `: ${detail}` : ''}`);
}

/** Notes a host without the file API, so this sandbox's files go over exec from now on. */
function noFileApi(sandbox: Kosa8Sandbox, res: HttpResponse): boolean {
  if (res.status !== 501) return false;
  sandbox.files = false;
  return true;
}

/** Runs task over items, at most `limit` at once, keeping the order of the results. */
async function inParallel<T, R>(items: T[], limit: number, task: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await task(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function mustSucceed(run: ExecRunner, sandbox: Kosa8Sandbox, command: string, what: string, path: string, env?: Record<string, string>) {
  const result = await run(sandbox, command, env ? { env } : undefined);
  if (result.exitCode === NOT_FOUND_EXIT) throw notFound(path);
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(`${what} '${path}' failed (exit ${result.exitCode})${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

// --- write -------------------------------------------------------------------

/**
 * Writes a file through exec: base64 chunks into a temporary file beside it, then an atomic rename.
 * One chunk (the usual small file) is a single command.
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

/** Writes a file: one exec when small, one PUT under /workspace, else parts staged through the file API. */
export async function writeFileNative(sandbox: Kosa8Sandbox, path: string, content: string, run: ExecRunner): Promise<void> {
  const bytes = Buffer.from(content, 'utf8');
  if (bytes.length <= INLINE_WRITE_BYTES || sandbox.files === false) return writeFileViaExec(sandbox, path, bytes, run);

  const ws = workspacePath(path);
  if (ws && bytes.length <= MAX_FILE_BYTES) {
    const res = await filesRequest(sandbox, 'PUT', ws, bytes);
    if (res.ok) return;
    noFileApi(sandbox, res);
    // A path the file API will not write (a directory, a link out of /workspace): exec says why.
    return writeFileViaExec(sandbox, path, bytes, run);
  }

  const dir = stagingDir();
  const parts: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += PART_BYTES) parts.push(bytes.subarray(i, i + PART_BYTES));
  let refused: HttpResponse | undefined;
  await inParallel(parts, PART_CONCURRENCY, async (part, i) => {
    if (refused) return;
    const res = await filesRequest(sandbox, 'PUT', `${dir}/${partName(i)}`, part);
    if (!res.ok) refused ??= res;
  });
  if (refused) {
    await run(sandbox, `rm -rf ${q(dir)}`).catch(() => {});
    if (noFileApi(sandbox, refused)) return writeFileViaExec(sandbox, path, bytes, run);
    throw apiError(refused, `write '${path}'`);
  }
  // Put together beside the target, renamed into place, and the parts removed, in one command.
  const target = q(path);
  const tmp = q(`${path}.computesdk-${randomBytes(6).toString('hex')}`);
  await mustSucceed(
    run,
    sandbox,
    `{ d=$(dirname ${target}) && mkdir -p "$d" && cat ${q(dir)}/* > ${tmp} && mv -f ${tmp} ${target}; }; ` +
      `s=$?; rm -rf ${q(dir)}; [ $s -eq 0 ] || rm -f ${tmp}; exit $s`,
    'write',
    path,
  );
}

// --- read --------------------------------------------------------------------

const decode = (chunks: Uint8Array[]) => Buffer.concat(chunks).toString('utf8');
const fromBase64 = (s: string) => Buffer.from(s.replace(/\s+/g, ''), 'base64');

/**
 * Reads a file: one GET under /workspace (up to 8 MiB); otherwise one command that prints a small
 * file inline, or splits a large one into parts under /workspace, which are fetched in parallel.
 */
export async function readFileNative(sandbox: Kosa8Sandbox, path: string, run: ExecRunner): Promise<string> {
  const ws = sandbox.files === false ? null : workspacePath(path);
  if (ws) {
    const res = await filesRequest(sandbox, 'GET', ws);
    if (res.ok) return decode([res.bytes ?? new Uint8Array()]);
    if (res.status === 404) throw notFound(path);
    noFileApi(sandbox, res);
    // 413 (over 8 MiB), or a path the file API will not read: read below.
  }

  const staged = sandbox.files !== false;
  const dir = stagingDir();
  const p = q(path);
  const partMiB = PART_BYTES / MIB;
  const split = staged
    ? `else mkdir -p ${q(dir)} && n=$(( (s + ${PART_BYTES - 1}) / ${PART_BYTES} )) && i=0 && ` +
      `while [ $i -lt $n ]; do dd if=${p} of=${q(dir)}/$(printf '%06d' $i) bs=${MIB} skip=$((i * ${partMiB})) count=${partMiB} 2>/dev/null || exit 1; i=$((i + 1)); done; `
    : '';
  const out = await mustSucceed(
    run,
    sandbox,
    `[ -f ${p} ] || exit ${NOT_FOUND_EXIT}; s=$(wc -c < ${p} | tr -d ' '); echo "$s"; ` +
      `if [ "$s" -le ${INLINE_READ_BYTES} ]; then base64 < ${p}; ${split}fi`,
    'open',
    path,
  );
  const nl = out.indexOf('\n');
  const size = Number(out.slice(0, nl < 0 ? undefined : nl).trim());
  if (!Number.isInteger(size) || size < 0) throw new Error(`open '${path}' failed: unexpected answer from the sandbox`);
  if (size <= INLINE_READ_BYTES) return decode([fromBase64(nl < 0 ? '' : out.slice(nl + 1))]);

  let chunks: Uint8Array[];
  if (staged) {
    const n = Math.ceil(size / PART_BYTES);
    try {
      chunks = await inParallel(Array.from({ length: n }, (_, i) => i), PART_CONCURRENCY, async (i) => {
        const res = await filesRequest(sandbox, 'GET', `${dir}/${partName(i)}`);
        if (!res.ok) throw apiError(res, `read '${path}'`);
        return res.bytes ?? new Uint8Array();
      });
    } finally {
      await run(sandbox, `rm -rf ${q(dir)}`).catch(() => {});
    }
  } else {
    // No file API: 1 MiB per exec, each answer under the exec output limit.
    const n = Math.ceil(size / INLINE_READ_BYTES);
    chunks = await inParallel(Array.from({ length: n }, (_, i) => i), PART_CONCURRENCY, async (i) =>
      fromBase64(
        await mustSucceed(run, sandbox, `[ -f ${p} ] || exit ${NOT_FOUND_EXIT}; dd if=${p} bs=${MIB} skip=${i} count=1 2>/dev/null | base64`, 'open', path),
      ),
    );
  }
  const got = chunks.reduce((sum, c) => sum + c.length, 0);
  if (got !== size) throw new Error(`open '${path}' failed: read ${got} of ${size} bytes (the file changed while it was read?)`);
  return decode(chunks);
}
