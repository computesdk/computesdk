import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { CommandRequest, CreateSandboxRequest } from '@boatdev/sdk';
import { boat, readBoatFile, writeBoatFile } from '../index';

const execute = promisify(execFile);
let baseURL: string;
let directory: string;
// Outside /tmp and /home/user, so file transfers take the shell path.
let shellDirectory: string;
let created: CreateSandboxRequest | undefined;
let confirmation: string | string[] | undefined;
let deleted = false;
let nextProcess = 1;
const reconnectJobs = new Set<number>();
const jobs = new Map<number, Promise<{ stdout: string; stderr: string; exitCode: number }>>();
const info = { id: 'bx_local', name: 'test', state: 'ready', createdAt: '2026-01-01T00:00:00Z', ttlSeconds: 600, desktopAvailable: false, snapshotAvailable: false };

function json(response: ServerResponse, data: unknown, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(data));
}

async function handle(request: IncomingMessage, response: ServerResponse) {

  const parts: Buffer[] = [];
  for await (const part of request) parts.push(Buffer.from(part));
  const raw = Buffer.concat(parts).toString();
  const body = request.url?.startsWith('/transfer') ? undefined : raw ? JSON.parse(raw) : undefined;
  const url = new URL(request.url!, baseURL);
  const path = url.pathname;
  if (path === '/transfer') {
    expect(request.headers.authorization).toBeUndefined();
    const file = url.searchParams.get('path')!;
    if (request.method === 'PUT') {
      await writeFile(file, Buffer.concat(parts));
      response.end();
    } else {
      try { response.end(await readFile(file)); }
      catch { response.writeHead(404); response.end(); }
    }
    return;
  }
  expect(request.headers.authorization).toBe('Bearer local-test-key');
  if (path.endsWith('/files/upload-url') || path.endsWith('/files/download-url')) {
    const upload = path.endsWith('/upload-url');
    return json(response, { ok: true, type: upload ? 'file.upload_url' : 'file.download_url', url: `${baseURL}/transfer?path=${encodeURIComponent(body.path)}`, method: upload ? 'PUT' : 'GET', path: body.path, expiresAt: new Date().toISOString() });
  }
  const stream = path.match(/\/commands\/(\d+)\/stream$/);
  if (stream) {
    const processId = Number(stream[1]);
    const result = await jobs.get(processId);
    if (!result) throw new Error('unknown process');
    response.writeHead(200, { 'content-type': 'application/x-ndjson' });
    const offset = Number(url.searchParams.get('stdoutOffset') ?? 0);
    if (reconnectJobs.has(processId) && offset === 0) {
      response.end(JSON.stringify({ type: 'stdout', data: result.stdout.slice(0, 4), nextOffset: 4 }) + '\n');
      return;
    }
    const frames = [ { type: 'attached' }, { type: 'stdout', data: result.stdout.slice(offset), nextOffset: Buffer.byteLength(result.stdout) }, { type: 'stderr', data: result.stderr, nextOffset: Buffer.byteLength(result.stderr) }, { type: 'exit', exitCode: result.exitCode, timedOut: false } ];
    const ndjson = frames.map(frame => JSON.stringify(frame)).join('\n') + '\n';
    response.write(ndjson.slice(0, 17)); response.end(ndjson.slice(17));
    return;
  }
  if (request.method === 'POST' && path === '/sandboxes') {
    created = body; deleted = false;
    return json(response, { ok: true, type: 'sandbox.created', sandbox: info }, 202);
  }
  if (request.method === 'GET' && path === '/sandboxes') {
    return json(response, { ok: true, type: 'sandbox.list', sandboxes: deleted ? [] : [info] });
  }
  if (request.method === 'DELETE') {
    confirmation = request.headers['x-ascii-confirm-delete']; deleted = true;
    return json(response, { ok: true, type: 'sandbox.deleted' });
  }
  if (request.method === 'GET' && path.endsWith('/bx_denied')) {
    return json(response, { error: 'forbidden', message: 'API key lacks sandbox:read' }, 403);
  }
  if (request.method === 'GET' && path.endsWith('/bx_broken')) {
    response.writeHead(502, { 'content-type': 'text/html' });
    return response.end(`<html>${'bad gateway '.repeat(50)}</html>`);
  }
  if (request.method === 'GET') {
    return deleted ? json(response, { error: 'not found' }, 404) : json(response, { ok: true, type: 'sandbox.info', sandbox: info });
  }
  if (path.endsWith('/commands')) {
    const command = body as CommandRequest;
    expect(command.detached).toBe(true);
    const processId = nextProcess++;
    if (command.command === 'printf reconnect') reconnectJobs.add(processId);
    jobs.set(processId, execute('/bin/sh', ['-c', command.command], { cwd: directory })
      .then(result => ({ ...result, exitCode: 0 }))
      .catch((error: { stdout: string; stderr: string; code: number }) => ({ stdout: error.stdout, stderr: error.stderr, exitCode: error.code })));
    return json(response, { ok: true, type: 'command.started', success: true, processId, pid: processId, command: command.command, startedAt: new Date().toISOString() });
  }
  if (path.endsWith('/host')) return json(response, { ok: true, type: 'port.hosted', url: 'https://bx_local-8000.on.boat.dev?_token=local' });
  json(response, { error: `Unexpected request ${request.method} ${path}` }, 400);
}

const server = createServer((request, response) => {
  handle(request, response).catch(error => json(response, { error: String(error) }, 500));
});

beforeAll(async () => {
  directory = await mkdtemp(join('/tmp', 'computesdk-boat-'));
  shellDirectory = await mkdtemp(join(process.cwd(), '.computesdk-boat-'));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  baseURL = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await rm(directory, { recursive: true, force: true });
  await rm(shellDirectory, { recursive: true, force: true });
});

it('uses the real Boat SDK over HTTP for lifecycle, commands, streaming, files, and previews', async () => {
  const provider = boat({ apiKey: 'local-test-key', baseURL });
  const sandbox = await provider.instances.create({ timeout: 1001, envs: { HELLO: 'world' }, snapshotId: 'saved' });
  try {
    expect(created).toMatchObject({ ttlSeconds: 2, env: { HELLO: 'world' }, from: 'saved' });
    expect((await provider.instances.getById('bx_local'))?.getInstance().id).toBe('bx_local');
    expect((await provider.instances.list()).map(instance => instance.getInstance().name)).toEqual(['test']);
    expect(await sandbox.getInfo()).toMatchObject({ createdAt: new Date(info.createdAt), timeout: 600000 });
    const value = "quote ' dollar $(exit 9) backtick `exit 8`\n世界";
    expect(await sandbox.runCommand('printf %s "$VALUE" | cat', { cwd: directory, env: { VALUE: value } })).toMatchObject({ stdout: value, exitCode: 0 });
    expect((await sandbox.runCommand('printf failure >&2; exit 7')).exitCode).toBe(7);
    // The wrapper shell must start even when the caller's PATH has no shell in it.
    expect(await sandbox.runCommand('printf ok', { env: { PATH: '/nonexistent' } })).toMatchObject({ stdout: 'ok', exitCode: 0 });
    let output = '';
    expect(await sandbox.runCommand('printf streamed', { onStdout: chunk => { output += chunk; } })).toMatchObject({ stdout: 'streamed', exitCode: 0 });
    expect(output).toBe('streamed');
    expect(await sandbox.runCommand('printf reconnect', { timeout: 900000 })).toMatchObject({ stdout: 'reconnect', exitCode: 0 });
    const dir = join(directory, "files ' $ `"); const path = join(dir, '世界\n.txt');
    await sandbox.filesystem.mkdir(dir);
    await sandbox.filesystem.writeFile(path, value);
    expect(await sandbox.filesystem.readFile(path)).toBe(value);
    expect(await sandbox.filesystem.exists(path)).toBe(true);
    expect(await sandbox.filesystem.readdir(dir)).toEqual([expect.objectContaining({ name: '世界\n.txt', type: 'file', modified: expect.any(Date) })]);
    await sandbox.filesystem.remove(dir);
    expect(await sandbox.filesystem.exists(dir)).toBe(false);
    await expect(sandbox.filesystem.readFile(path)).rejects.toThrow();
    const large = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 31) % 256);
    const shellPath = join(shellDirectory, 'large.bin');
    await writeBoatFile(sandbox.getInstance(), shellPath, large);
    expect(new Uint8Array(await readFile(shellPath))).toEqual(large);
    expect(await readBoatFile(sandbox.getInstance(), shellPath)).toEqual(large);
    expect((await sandbox.runCommand('pwd; printf after', { cwd: '/missing' })).stdout).not.toContain('after');
    // A trailing backslash must not swallow the cwd guard's line break. bash drops it; dash prints it.
    const trailing = await sandbox.runCommand('printf "%s" trailing \\', { cwd: directory });
    expect(trailing.exitCode).toBe(0);
    expect(trailing.stdout).toMatch(/^trailing\\?$/);
    expect((await sandbox.runCommand('unused', { background: true })).exitCode).toBe(0);
    expect(await sandbox.getUrl({ port: 8000 })).toBe('https://bx_local-8000.on.boat.dev?_token=local');
  } finally { await sandbox.destroy(); }
  expect(confirmation).toBe('bx_local');
  const denied = await provider.instances.getById('bx_denied').catch(error => error);
  expect(denied.message).toBe('Boat API error: 403 Forbidden: forbidden: API key lacks sandbox:read');
  expect(denied.response.status).toBe(403);
  expect(await denied.response.json()).toEqual({ error: 'forbidden', message: 'API key lacks sandbox:read' });
  const broken = await provider.instances.getById('bx_broken').catch(error => error);
  expect(broken.message).toMatch(/^Boat API error: 502 Bad Gateway: <html>bad gateway/);
  expect(broken.message.length).toBeLessThan(340);
  expect(await provider.instances.getById('bx_local')).toBeNull();
}, 30_000);
