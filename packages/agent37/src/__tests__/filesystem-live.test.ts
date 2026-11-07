import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { escapeShellArg } from '@computesdk/provider';

const packageEntry = resolve(__dirname, '../../dist/index.js');
const { agent37 } = createRequire(__filename)(packageEntry) as typeof import('../index');

const provider = agent37({});

function quoteShellArg(value: string): string {
  return `"${escapeShellArg(value)}"`;
}

describe.skipIf(!process.env.AGENT37_API_KEY)('Agent37 filesystem transfers (live)', () => {
  let sandbox: Awaited<ReturnType<typeof provider.sandbox.create>>;
  const directory = `/tmp/computesdk-agent37-transfer-${randomUUID()}`;
  const stagingDirectory = `${directory}/remote temp "quotes" $dollar`;
  let nonRootGuest = false;
  let pathOverride: string | undefined;
  let hasFlock = false;
  const requestSizes: number[] = [];
  const originalFetch = globalThis.fetch;
  let createdId: string | undefined;
  let creates = 0;
  let deleteStatus: number | undefined;
  let lookupStatus: number | undefined;
  let readResponses = 0;
  let largestReadOutput = 0;

  beforeAll(async () => {
    console.log(JSON.stringify({ event: 'built-package', entry: packageEntry, sha256: createHash('sha256').update(await readFile(packageEntry)).digest('hex'), revision: process.env.GITHUB_SHA }));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/exec') && typeof init?.body === 'string') {
        const body = JSON.parse(init.body) as { command: string };
        body.command = `export TMPDIR=${quoteShellArg(stagingDirectory)}; ${body.command}`;
        if (pathOverride) body.command = `export PATH=${quoteShellArg(pathOverride)}; ${body.command}`;
        if (nonRootGuest) body.command = `runuser -u nobody -- /bin/sh -c ${quoteShellArg(body.command)}`;
        const encoded = JSON.stringify(body);
        init = { ...init, body: encoded };
        requestSizes.push(Buffer.byteLength(encoded));
      }
      const response = await originalFetch(input, init);
      if (String(input).endsWith('/v1/instances') && init?.method === 'POST' && response.ok) {
        creates++;
        createdId = (await response.clone().json() as { id: string }).id;
        console.log(JSON.stringify({ event: 'sandbox-created', id: createdId, httpStatus: response.status }));
      }
      if (createdId && String(input).endsWith(`/v1/instances/${encodeURIComponent(createdId)}`)) {
        if (init?.method === 'DELETE') deleteStatus = response.status;
        if (init?.method === 'GET') lookupStatus = response.status;
      }
      if (typeof init?.body === 'string' && init.body.includes('dd if=')) {
        const data = await response.clone().json() as { stdout?: string };
        readResponses++;
        largestReadOutput = Math.max(largestReadOutput, Buffer.byteLength(data.stdout ?? ''));
      }
      return response;
    });
    sandbox = await provider.sandbox.create({ templateId: 'agent37-base' });
    expect((await sandbox.runCommand(`mkdir -p ${quoteShellArg(stagingDirectory)}`)).exitCode).toBe(0);
    hasFlock = (await sandbox.runCommand('command -v flock')).exitCode === 0;
  }, 120_000);

  afterAll(async () => {
    try {
      if (createdId) {
        console.log(JSON.stringify({ event: 'sandbox-destroying', id: createdId }));
        await provider.sandbox.destroy(createdId);
        expect(await provider.sandbox.getById(createdId)).toBeNull();
        expect(deleteStatus).toBeGreaterThanOrEqual(200);
        expect(deleteStatus).toBeLessThan(300);
        expect(lookupStatus).toBe(404);
        expect(creates).toBe(1);
        console.log(JSON.stringify({ event: 'cleanup-confirmed', id: createdId, deleteStatus, lookupStatus, creates }));
      }
    } finally {
      vi.restoreAllMocks();
    }
  }, 60_000);

  it('reproduces the fidelity concurrent 256 KiB write and verifies every byte by readback and remote hash', async () => {
    const files = [
      ['payload.txt', 'fidelity-content-agent37-transfer'],
      ['large.bin', 'x'.repeat(256 * 1024)],
      ['mutated-target.txt', 'delete-me-agent37-transfer'],
      ['run.sh', '#!/bin/sh\necho exec-ok-agent37-transfer\n'],
    ];
    await Promise.all(files.map(([name, content]) => sandbox.filesystem.writeFile(`${directory}/${name}`, content)));
    for (const [name, content] of files) {
      expect(await sandbox.filesystem.readFile(`${directory}/${name}`)).toBe(content);
    }
    const hash = await sandbox.runCommand(`sha256sum ${directory}/large.bin && wc -c < ${directory}/large.bin`);
    expect(hash.exitCode).toBe(0);
    expect(hash.stdout).toContain(createHash('sha256').update(files[1][1]).digest('hex'));
    expect(hash.stdout.trim().split('\n').at(-1)).toBe('262144');
    expect(Math.max(...requestSizes)).toBeLessThan(128_000);
    console.log(`Agent37 fidelity transfer: 4/4 exact readbacks; large.bin=262144 bytes; SHA-256 verified; largest exec request=${Math.max(...requestSizes)} bytes`);
  }, 120_000);

  it('preserves UTF-8 across chunks, safely quotes paths, overwrites, and writes empty content', async () => {
    const path = `${directory}/nested "quotes" $dollar 'single'/file`;
    const content = 'a'.repeat(48 * 1024 - 1) + '😀漢字é\0\n'.repeat(4000);
    await sandbox.filesystem.writeFile(path, content);
    expect(await sandbox.filesystem.readFile(path)).toBe(content);
    await sandbox.filesystem.writeFile(path, 'short');
    expect(await sandbox.filesystem.readFile(path)).toBe('short');
    await sandbox.filesystem.writeFile(path, '');
    expect(await sandbox.filesystem.readFile(path)).toBe('');
    await sandbox.filesystem.writeFile(`${directory}/new-empty`, '');
    expect(await sandbox.filesystem.readFile(`${directory}/new-empty`)).toBe('');
  }, 120_000);

  it('does not interleave concurrent writes to one destination or leave staging files', async ({ skip }) => {
    if (!hasFlock) skip();
    const path = `${directory}/shared`;
    const contents = ['a'.repeat(256 * 1024), 'b'.repeat(200 * 1024)];
    await Promise.all(contents.map((content) => sandbox.filesystem.writeFile(path, content)));
    expect(contents).toContain(await sandbox.filesystem.readFile(path));
    const leftovers = await sandbox.runCommand(`find ${quoteShellArg(stagingDirectory)} -name '.computesdk-write-*' -print`);
    expect(leftovers.exitCode).toBe(0);
    expect(leftovers.stdout.trim()).toBe('');
  }, 120_000);

  it('overwrites a writable file in a non-writable directory as a non-root guest', async () => {
    const parent = `${directory}/read-only`;
    const path = `${parent}/writable-file`;
    const setup = await sandbox.runCommand(`mkdir -p ${parent} && printf original > ${path} && chmod 755 ${directory} && chmod 777 ${quoteShellArg(stagingDirectory)} && chmod 666 ${path} && chmod 555 ${parent} && id -u`);
    expect(setup.exitCode).toBe(0);
    nonRootGuest = setup.stdout.trim() === '0';
    try {
      const baseline = await sandbox.runCommand(`id -u && if (: > ${parent}/cannot-create) 2>/dev/null; then exit 1; fi; printf old-write > ${path}`);
      expect(baseline.exitCode).toBe(0);
      expect(baseline.stdout.trim()).not.toBe('0');
      expect(await sandbox.filesystem.readFile(path)).toBe('old-write');
      const content = 'x'.repeat(256 * 1024);
      await sandbox.filesystem.writeFile(path, content);
      expect(await sandbox.filesystem.readFile(path)).toBe(content);
      const cleanup = await sandbox.runCommand(`find ${quoteShellArg(stagingDirectory)} -name '.computesdk-write-*' -print`);
      expect(cleanup.exitCode).toBe(0);
      expect(cleanup.stdout.trim()).toBe('');
      console.log(`Agent37 read-only directory compatibility: non-root uid=${baseline.stdout.trim()}, 256 KiB exact readback, remote TMPDIR cleaned`);
    } finally {
      nonRootGuest = false;
    }
  }, 120_000);

  it('writes without flock and propagates real lock failures instead of falling back', async () => {
    const bin = `${directory}/without-flock-bin`;
    const path = `${directory}/without-flock-target`;
    const setup = await sandbox.runCommand(`mkdir -p ${bin} && for tool in mkdir base64 cat rm stat dd; do source=$(command -v "$tool") && ln -s "$source" ${bin}/"$tool" || exit 1; done`);
    expect(setup.exitCode).toBe(0);
    pathOverride = bin;
    try {
      expect((await sandbox.runCommand('command -v flock')).exitCode).not.toBe(0);
      const content = 'a'.repeat(48 * 1024 - 1) + '😀漢字é\0\n'.repeat(4000);
      for (const value of ['x'.repeat(256 * 1024), content, 'short', '']) {
        await sandbox.filesystem.writeFile(path, value);
        expect(await sandbox.filesystem.readFile(path)).toBe(value);
      }
    } finally {
      pathOverride = undefined;
    }
    const inject = await sandbox.runCommand(`printf '%s' ${quoteShellArg('#!/bin/sh\nprintf "injected lock failure" >&2\nexit 73\n')} > ${bin}/flock && chmod 755 ${bin}/flock`);
    expect(inject.exitCode).toBe(0);
    pathOverride = bin;
    try {
      await expect(sandbox.filesystem.writeFile(path, 'must not fall back')).rejects.toThrow('injected lock failure');
      expect(await sandbox.filesystem.readFile(path)).toBe('');
    } finally {
      pathOverride = undefined;
    }
    const cleanup = await sandbox.runCommand(`find ${quoteShellArg(stagingDirectory)} -name '.computesdk-write-*' -print`);
    expect(cleanup.exitCode).toBe(0);
    expect(cleanup.stdout.trim()).toBe('');
    console.log('Agent37 no-flock fallback: new/overwrite/UTF-8/empty exact readbacks; real flock error propagated; remote TMPDIR cleaned');
  }, 120_000);

  it('preserves executable mode, inode and hard links when overwriting through a symlink', async () => {
    const path = `${directory}/executable`;
    const symlink = `${directory}/symlink`;
    const hardlink = `${directory}/hardlink`;
    await sandbox.filesystem.writeFile(path, '#!/bin/sh\necho original\n');
    const setup = await sandbox.runCommand(`chmod 751 ${path} && ln -s executable ${symlink} && ln ${path} ${hardlink} && stat -c '%i %a' ${path}`);
    expect(setup.exitCode).toBe(0);
    const original = setup.stdout.trim();
    expect(original.split(' ').at(-1)).toBe('751');
    const content = '#!/bin/sh\necho updated\n#' + 'x'.repeat(256 * 1024) + '\n';
    await sandbox.filesystem.writeFile(symlink, content);
    for (const name of [path, symlink, hardlink]) expect(await sandbox.filesystem.readFile(name)).toBe(content);
    const result = await sandbox.runCommand(`test -L ${symlink} && test -x ${path} && stat -c '%i %a' ${path} && ${path}`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(`${original}\nupdated`);
    await sandbox.filesystem.writeFile(symlink, '');
    expect(await sandbox.filesystem.readFile(path)).toBe('');
    const empty = await sandbox.runCommand(`test -L ${symlink} && stat -c '%i %a' ${path}`);
    expect(empty.exitCode).toBe(0);
    expect(empty.stdout.trim()).toBe(original);
    console.log('Agent37 overwrite compatibility: executable mode 751, inode, symlink and hard link preserved, including empty writes');
  }, 120_000);

  it('serializes concurrent writes through symlink and hard-link aliases of the destination', async ({ skip }) => {
    if (!hasFlock) skip();
    const path = `${directory}/alias-target`;
    const symlink = `${directory}/alias-symlink`;
    const hardlink = `${directory}/alias-hardlink`;
    await sandbox.filesystem.writeFile(path, 'original');
    const setup = await sandbox.runCommand(`ln -s alias-target ${symlink} && ln ${path} ${hardlink} && stat -c '%i' ${path}`);
    expect(setup.exitCode).toBe(0);
    const paths = [path, symlink, hardlink];
    const contents = ['a'.repeat(256 * 1024), 'b'.repeat(220 * 1024), 'c'.repeat(200 * 1024)];
    await Promise.all(paths.map((name, index) => sandbox.filesystem.writeFile(name, contents[index])));
    const actual = await sandbox.filesystem.readFile(path);
    expect(contents).toContain(actual);
    for (const name of paths) expect(await sandbox.filesystem.readFile(name)).toBe(actual);
    const result = await sandbox.runCommand(`test -L ${symlink} && stat -c '%i' ${path} && find ${quoteShellArg(stagingDirectory)} -name '.computesdk-write-*' -print`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(setup.stdout.trim());
    console.log('Agent37 concurrent alias writes: one complete payload, original inode and symlink preserved, no staging leftovers');
  }, 120_000);

  it('reads 16 MiB exactly from the built package while native whole-file exec truncates', async () => {
    const path = `${directory}/large read "quotes" $dollar 'single'`;
    const size = 16 * 1024 * 1024;
    const unit = '😀漢字é\0\n';
    const block = unit.repeat(4096);
    const blocks = Math.floor(size / Buffer.byteLength(block));
    const remainder = size % Buffer.byteLength(block);
    const tail = unit.repeat(Math.floor(remainder / Buffer.byteLength(unit))) + 'x'.repeat(remainder % Buffer.byteLength(unit));
    const script = `const fs = require('node:fs'); const unit = ${JSON.stringify(unit)}; const data = Buffer.from(unit.repeat(4096)); const fd = fs.openSync(${JSON.stringify(path)}, 'w'); for (let i = 0; i < ${blocks}; i++) fs.writeSync(fd, data); fs.writeSync(fd, unit.repeat(${Math.floor(remainder / Buffer.byteLength(unit))}) + 'x'.repeat(${remainder % Buffer.byteLength(unit)})); fs.closeSync(fd);`;
    console.log(JSON.stringify({ event: 'large-read-starting', id: createdId, utf8Bytes: size }));
    const seed = await sandbox.runCommand(`node -e ${quoteShellArg(script)} && sha256sum ${quoteShellArg(path)} && wc -c < ${quoteShellArg(path)}`);
    expect(seed.exitCode).toBe(0);
    const remoteHash = seed.stdout.trim().split(/\s+/)[0];
    expect(seed.stdout.trim().split('\n').at(-1)).toBe(String(size));
    const native = sandbox.getInstance();
    const response = await originalFetch(`${native.execUrl}/v1/instances/${encodeURIComponent(native.id)}/exec`, {
      method: 'POST',
      headers: { 'X-Agent37-Key': native.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: `base64 -w0 ${quoteShellArg(path)}`, ...(native.runAsRoot ? { user: 'root' } : {}) }),
    });
    expect(response.status).toBe(200);
    const wholeFile = await response.json() as { exit_code: number; stdout: string; truncated: boolean };
    expect(wholeFile.exit_code).toBe(0);
    expect(wholeFile.truncated).toBe(true);
    const initialResponses = readResponses;
    const started = Date.now();
    const actual = await sandbox.filesystem.readFile(path);
    const durationMs = Date.now() - started;
    expect(Buffer.byteLength(actual)).toBe(size);
    const expectedHash = createHash('sha256');
    for (let index = 0; index < blocks; index++) {
      expect(actual.slice(index * block.length, (index + 1) * block.length) === block).toBe(true);
      expectedHash.update(block);
    }
    expect(actual.slice(blocks * block.length)).toBe(tail);
    expectedHash.update(tail);
    const hash = createHash('sha256').update(actual).digest('hex');
    expect(hash).toBe(expectedHash.digest('hex'));
    expect(hash).toBe(remoteHash);
    expect(readResponses - initialResponses).toBe(64);
    expect(largestReadOutput).toBeLessThan(512_000);
    expect(Math.max(...requestSizes)).toBeLessThan(128_000);
    console.log(JSON.stringify({ event: 'large-read-exact', id: createdId, utf8Bytes: size, sha256: hash, exactBlockEquality: true, nativeWholeFileTruncated: wholeFile.truncated, readChunks: readResponses - initialResponses, largestReadOutput, largestExecRequest: Math.max(...requestSizes), durationMs }));
  }, 120_000);
});
