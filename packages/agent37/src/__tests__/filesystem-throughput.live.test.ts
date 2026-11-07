import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { escapeShellArg } from '@computesdk/provider';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const packageEntry = resolve(__dirname, '../../dist/index.js');
const { agent37 } = createRequire(__filename)(packageEntry) as typeof import('../index');
const provider = agent37({});
const quote = (value: string) => `"${escapeShellArg(value)}"`;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe.skipIf(!process.env.AGENT37_API_KEY)('Agent37 large-write throughput (live built package)', () => {
  let sandbox: Awaited<ReturnType<typeof provider.sandbox.create>>;
  let createdId: string | undefined;
  let creates = 0;
  let deleteStatus: number | undefined;
  let lookupStatus: number | undefined;
  let phase = 'setup';
  let operationSignal: AbortSignal | undefined;
  const measurements: { phase: string; kind: string; requestBytes: number; outputBytes: number; elapsedMs: number }[] = [];
  const directory = `/tmp/computesdk-agent37-write-${randomUUID()}`;
  const originalFetch = globalThis.fetch;

  function log(event: string, details: Record<string, unknown> = {}) {
    console.log(JSON.stringify({ event, id: createdId, ...details }));
  }

  async function bounded<T>(name: string, timeoutMs: number, operation: () => Promise<T>): Promise<T> {
    phase = name;
    log('operation-starting', { phase, timeoutMs });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`${name} timed out`)), timeoutMs);
    operationSignal = controller.signal;
    try {
      return await operation();
    } finally {
      clearTimeout(timer);
      operationSignal = undefined;
    }
  }

  beforeAll(async () => {
    const artifact = await readFile(packageEntry);
    log('built-package', { revision: process.env.GITHUB_SHA, sha256: createHash('sha256').update(artifact).digest('hex') });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const started = performance.now();
      const currentPhase = phase;
      if (operationSignal) {
        init = { ...init, signal: init?.signal ? AbortSignal.any([init.signal, operationSignal]) : operationSignal };
      }
      const response = await originalFetch(input, init);
      const url = String(input);
      if (url.endsWith('/v1/instances') && init?.method === 'POST' && response.ok) {
        createdId = (await response.clone().json() as { id: string }).id;
        creates++;
        log('sandbox-created', { httpStatus: response.status });
      }
      if (createdId && url.endsWith(`/v1/instances/${encodeURIComponent(createdId)}`)) {
        if (init?.method === 'DELETE') deleteStatus = response.status;
        if (init?.method === 'GET') lookupStatus = response.status;
      }
      if (url.endsWith('/exec') && typeof init?.body === 'string') {
        const { command } = JSON.parse(init.body) as { command: string };
        const result = await response.clone().json() as { stdout?: string };
        measurements.push({ phase: currentPhase, kind: command.includes('base64 -d >>') ? 'upload' : command.includes('dd if=') ? 'read' : 'other', requestBytes: Buffer.byteLength(init.body), outputBytes: Buffer.byteLength(result.stdout ?? ''), elapsedMs: performance.now() - started });
      }
      return response;
    });
    sandbox = await provider.sandbox.create({ templateId: 'agent37-base' });
  }, 120_000);

  afterAll(async () => {
    operationSignal = undefined;
    phase = 'cleanup';
    try {
      if (createdId) {
        log('sandbox-destroying');
        await provider.sandbox.destroy(createdId);
        expect(await provider.sandbox.getById(createdId)).toBeNull();
        expect(deleteStatus).toBeGreaterThanOrEqual(200);
        expect(deleteStatus).toBeLessThan(300);
        expect(lookupStatus).toBe(404);
        expect(creates).toBe(1);
        log('cleanup-confirmed', { deleteStatus, lookupStatus, creates });
      }
    } finally {
      log('request-measurements', { phases: [...new Set(measurements.map(m => m.phase))].map(name => {
        const rows = measurements.filter(m => m.phase === name);
        return { phase: name, requests: rows.length, uploads: rows.filter(m => m.kind === 'upload').length, reads: rows.filter(m => m.kind === 'read').length, requestBytes: rows.reduce((sum, m) => sum + m.requestBytes, 0), largestRequest: Math.max(...rows.map(m => m.requestBytes)), largestOutput: Math.max(...rows.map(m => m.outputBytes)), totalFetchMs: Math.round(rows.reduce((sum, m) => sum + m.elapsedMs, 0)) };
      }) });
      vi.restoreAllMocks();
    }
  }, 60_000);

  it('writes and reads the full base64 text from 128 MiB random input within unchanged 300 s limits', async () => {
    const inputBytes = 128 * 1024 * 1024;
    const content = randomBytes(inputBytes).toString('base64');
    const payloadBytes = Buffer.byteLength(content);
    const hash = sha256(content);
    expect(payloadBytes).toBe(178_956_972);
    const path = `${directory}/payload "quotes" $dollar 'single'`;
    log('payload-ready', { inputBytes, payloadBytes, sha256: hash });
    const native = sandbox.getInstance();
    const nativeExec = async (command: string) => {
      const response = await fetch(`${native.execUrl}/v1/instances/${encodeURIComponent(native.id)}/exec`, {
        method: 'POST',
        headers: { 'X-Agent37-Key': native.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, ...(native.runAsRoot ? { user: 'root' } : {}) }),
      });
      expect(response.status).toBe(200);
      const result = await response.json() as { exit_code: number; stdout: string; truncated?: boolean };
      expect(result.exit_code).toBe(0);
      expect(result.truncated).not.toBe(true);
      return result.stdout;
    };

    // Raw exec control uses identical prefix bytes and the previous 48 KiB transfer shape.
    const prefix = content.slice(0, 4 * Math.ceil(4 * 1024 * 1024 / 3));
    const nativePath = `${directory}/native-prefix`;
    const nativeStart = performance.now();
    await bounded('native-prefix-transfer', 60_000, async () => {
      await nativeExec(`mkdir -p ${quote(directory)} && : > ${quote(nativePath)}`);
      for (let offset = 0; offset < prefix.length; offset += 48 * 1024) {
        const encoded = Buffer.from(prefix.slice(offset, offset + 48 * 1024)).toString('base64');
        await nativeExec(`printf '%s' '${encoded}' | base64 -d >> ${quote(nativePath)}`);
      }
      const verified = await nativeExec(`sha256sum ${quote(nativePath)} && wc -c < ${quote(nativePath)}`);
      expect(verified.split(/\s+/)[0]).toBe(sha256(prefix));
      expect(verified.trim().split('\n').at(-1)).toBe(String(Buffer.byteLength(prefix)));
    });
    log('native-prefix-exact', { payloadBytes: Buffer.byteLength(prefix), sha256: sha256(prefix), durationMs: Math.round(performance.now() - nativeStart), fullSizeTransferEquivalent: false });

    const writeStart = performance.now();
    await bounded('sdk-write', 300_000, () => sandbox.filesystem.writeFile(path, content));
    const writeMs = Math.round(performance.now() - writeStart);
    expect(writeMs).toBeLessThan(300_000);
    const uploads = measurements.filter(m => m.phase === 'sdk-write' && m.kind === 'upload');
    expect(uploads).toHaveLength(1942);
    expect(Math.max(...uploads.map(m => m.requestBytes))).toBeLessThan(128_000);
    log('large-write-complete', { payloadBytes, writeMs, uploads: uploads.length, largestRequest: Math.max(...uploads.map(m => m.requestBytes)) });

    // Guest-only copy/hash isolates disk work, not end-to-end client transfer throughput.
    const copyScript = `const fs=require('node:fs'),crypto=require('node:crypto'); const start=performance.now(); fs.copyFileSync(${JSON.stringify(path)},${JSON.stringify(`${directory}/native-copy`)}); const hash=crypto.createHash('sha256'); fs.createReadStream(${JSON.stringify(`${directory}/native-copy`)}).on('data',data=>hash.update(data)).on('end',()=>console.log(JSON.stringify({bytes:fs.statSync(${JSON.stringify(path)}).size,sha256:hash.digest('hex'),durationMs:Math.round(performance.now()-start)})));`;
    await bounded('native-guest-copy-hash', 60_000, async () => {
      const result = await nativeExec(`node -e ${quote(copyScript)}`);
      const data = JSON.parse(result) as { bytes: number; sha256: string; durationMs: number };
      expect(data.bytes).toBe(payloadBytes);
      expect(data.sha256).toBe(hash);
      log('native-guest-copy-exact', { ...data, clientTransferIncluded: false });
    });

    const readStart = performance.now();
    const actual = await bounded('sdk-read', 300_000, () => sandbox.filesystem.readFile(path));
    const readMs = Math.round(performance.now() - readStart);
    expect(readMs).toBeLessThan(300_000);
    expect(Buffer.byteLength(actual)).toBe(payloadBytes);
    expect(actual === content).toBe(true);
    expect(sha256(actual)).toBe(hash);
    const reads = measurements.filter(m => m.phase === 'sdk-read' && m.kind === 'read');
    expect(reads).toHaveLength(683);
    expect(Math.max(...reads.map(m => m.outputBytes))).toBeLessThan(512_000);
    log('large-read-exact', { inputBytes, payloadBytes, sha256: hash, writeMs, readMs, readChunks: reads.length, exactEquality: true });

    await bounded('staging-cleanup-check', 30_000, async () => {
      const result = await sandbox.runCommand('find "${TMPDIR:-/tmp}" -maxdepth 1 -name ".computesdk-write-*" -print');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('');
    });
  }, 780_000);
});
