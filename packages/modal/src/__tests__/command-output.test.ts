import { beforeEach, describe, expect, it, vi } from 'vitest';

const { exec } = vi.hoisted(() => ({ exec: vi.fn() }));

// Mock only Modal's native transport; run the actual adapter and provider factory.
vi.mock('modal', () => ({
  SandboxFilesystemNotFoundError: class extends Error {},
  ModalClient: class {
    apps = { fromName: async () => ({}) };
    images = { fromRegistry: () => ({ build: async () => ({}) }) };
    sandboxes = {
      create: async () => ({ sandboxId: 'sb-output', exec }),
    };
  },
}));

import { modal } from '../index';

type CaptureFile = 'out' | 'err' | 'outlen' | 'errlen' | 'code';
type NativeCat = {
  text?: unknown;
  status?: unknown;
  readText?: () => Promise<unknown>;
  wait?: () => Promise<unknown>;
};

type Capture = {
  stdout?: string[];
  stderr?: string[];
  stdoutLength?: string;
  stderrLength?: string;
  code?: string;
  missingCode?: boolean;
  outerCode?: number;
  cat?: Partial<Record<CaptureFile, NativeCat>>;
};

function capture({
  stdout = [''],
  stderr = [''],
  stdoutLength = String(Buffer.byteLength(stdout[stdout.length - 1])),
  stderrLength = String(Buffer.byteLength(stderr[stderr.length - 1])),
  code = '0',
  missingCode = false,
  outerCode = 0,
  cat = {},
}: Capture = {}) {
  const reads = { stdout: 0, stderr: 0 };
  const process = (text: string, exitCode = 0, native: NativeCat = {}) => ({
    stdout: { readText: native.readText ?? (async () => 'text' in native ? native.text : text) },
    stderr: { readText: async () => '' },
    wait: native.wait ?? (async () => 'status' in native ? native.status : exitCode),
  });
  exec.mockImplementation(async (argv: string[]) => {
    if (argv[0] === 'sh') return process('', outerCode);
    if (argv[0] === 'rm') return process('');
    if (argv[0] !== 'cat') throw new Error('Unexpected native exec');
    const path = argv[1];
    if (path.endsWith('.outlen')) return process(stdoutLength, 0, cat.outlen);
    if (path.endsWith('.errlen')) return process(stderrLength, 0, cat.errlen);
    if (path.endsWith('.code')) return process(missingCode ? '' : code, missingCode ? 1 : 0, cat.code);
    if (path.endsWith('.out')) {
      const index = Math.min(reads.stdout++, stdout.length - 1);
      return process(stdout[index], 0, cat.out);
    }
    if (path.endsWith('.err')) {
      const index = Math.min(reads.stderr++, stderr.length - 1);
      return process(stderr[index], 0, cat.err);
    }
    throw new Error('Unexpected capture path');
  });
  return reads;
}

async function run() {
  const sandbox = await modal({ tokenId: 'mock', tokenSecret: 'mock' }).sandbox.create();
  return sandbox.runCommand('printf output');
}

describe('Modal command output integrity (native SDK mocks)', () => {
  beforeEach(() => { exec.mockReset(); });

  it('rejects 100 expected bytes when reads return 40 then 60 instead of returning partial success', async () => {
    const reads = capture({ stdoutLength: '100', stdout: ['x'.repeat(40), 'x'.repeat(60)] });
    await expect(run()).rejects.toMatchObject({
      code: 'COMMAND_OUTPUT_INTEGRITY',
      stream: 'stdout',
      expectedBytes: 100,
      actualBytes: 60,
      attempts: 2,
    });
    expect(reads.stdout).toBe(2);
    expect(exec.mock.calls.some(([argv]) => argv[0] === 'rm')).toBe(true);
  });

  it('accepts a retry only when all 100 expected bytes arrive', async () => {
    const reads = capture({ stdoutLength: '100', stdout: ['x'.repeat(40), 'x'.repeat(100)] });
    await expect(run()).resolves.toMatchObject({ stdout: 'x'.repeat(100), stderr: '', exitCode: 0 });
    expect(reads).toEqual({ stdout: 2, stderr: 1 });
  });

  it('accepts exact first reads, preserving Unicode, whitespace and ordinary nonzero child status', async () => {
    const reads = capture({ stdout: ['  🙂漢\n'], stderr: ['\té\n'], code: '23', outerCode: 0 });
    await expect(run()).resolves.toMatchObject({ stdout: '  🙂漢\n', stderr: '\té\n', exitCode: 23 });
    expect(reads).toEqual({ stdout: 1, stderr: 1 });
  });

  it('accepts verified empty streams', async () => {
    capture();
    await expect(run()).resolves.toMatchObject({ stdout: '', stderr: '', exitCode: 0 });
  });

  describe.each([
    { file: 'out' as const, stream: 'stdout' as const },
    { file: 'err' as const, stream: 'stderr' as const },
  ])('native cat status validation for $stream', ({ file, stream }) => {
    it.each(['', 'plausible output'])('rejects failed cat even when its output %j matches the expected byte count', async (text) => {
      capture({ [stream]: [text], cat: { [file]: { status: 1 } } });
      await expect(run()).rejects.toMatchObject({
        code: 'COMMAND_OUTPUT_INTEGRITY', reason: 'output-read-failed', stream,
        expectedBytes: Buffer.byteLength(text), attempts: 1,
      });
      expect(exec.mock.calls.filter(([argv]) => argv[0] === 'sh')).toHaveLength(1);
      expect(exec.mock.calls.some(([argv]) => argv[0] === 'rm')).toBe(true);
    });

    it.each([undefined, null, '0', NaN, 0.5, -1, 256])('rejects missing or invalid native wait status %j', async (status) => {
      capture({ cat: { [file]: { status } } });
      await expect(run()).rejects.toMatchObject({
        code: 'COMMAND_OUTPUT_INTEGRITY', reason: 'output-read-failed', stream, expectedBytes: 0, attempts: 1,
      });
    });

    it.each([undefined, null])('does not coerce missing native readText value %j into valid empty output', async (text) => {
      capture({ cat: { [file]: { text } } });
      await expect(run()).rejects.toMatchObject({
        code: 'COMMAND_OUTPUT_INTEGRITY', reason: 'output-read-failed', stream, expectedBytes: 0, attempts: 1,
      });
    });
  });

  it.each([
    { file: 'outlen' as const, stream: 'stdout' },
    { file: 'errlen' as const, stream: 'stderr' },
  ])('rejects failed native length-file cat for $stream even with a plausible length', async ({ file, stream }) => {
    capture({ cat: { [file]: { status: 1, text: '0' } } });
    await expect(run()).rejects.toMatchObject({
      code: 'COMMAND_OUTPUT_INTEGRITY', reason: 'length-read-failed', stream, attempts: 0,
    });
  });

  it.each([undefined, null])('rejects missing length-file readText %j as metadata transport failure', async (text) => {
    capture({ cat: { outlen: { text } } });
    await expect(run()).rejects.toMatchObject({
      code: 'COMMAND_OUTPUT_INTEGRITY', reason: 'length-read-failed', stream: 'stdout', attempts: 0,
    });
  });

  it('rejects failed native code-file cat instead of trusting plausible child status text', async () => {
    capture({ cat: { code: { status: 1, text: '0' } } });
    await expect(run()).rejects.toMatchObject({
      code: 'COMMAND_OUTPUT_INTEGRITY', reason: 'invalid-exit-code',
    });
  });

  it.each([undefined, null])('rejects missing code-file readText %j instead of child success', async (text) => {
    capture({ cat: { code: { text } } });
    await expect(run()).rejects.toMatchObject({
      code: 'COMMAND_OUTPUT_INTEGRITY', reason: 'invalid-exit-code',
    });
  });

  it('drains readText and awaits cat completion concurrently, preserving Unicode and a completed nonzero child status', async () => {
    let reading = false;
    let waiting = false;
    const text = '  🙂漢é\n';
    capture({
      stdout: [text], stderr: ['warning\n'], code: '23',
      cat: {
        out: {
          readText: async () => {
            reading = true;
            await Promise.resolve();
            if (!waiting) throw new Error('Native read must overlap wait');
            return text;
          },
          wait: async () => {
            waiting = true;
            await Promise.resolve();
            if (!reading) throw new Error('Native wait must overlap read');
            return 0;
          },
        },
      },
    });
    await expect(run()).resolves.toMatchObject({ stdout: text, stderr: 'warning\n', exitCode: 23 });
    expect(reading && waiting).toBe(true);
    expect(exec.mock.calls.filter(([argv]) => argv[0] === 'sh')).toHaveLength(1);
  });

  it.each([
    { file: 'out' as const, reason: 'output-read-failed', stream: 'stdout', attempts: 1 },
    { file: 'err' as const, reason: 'output-read-failed', stream: 'stderr', attempts: 1 },
    { file: 'outlen' as const, reason: 'length-read-failed', stream: 'stdout', attempts: 0 },
    { file: 'errlen' as const, reason: 'length-read-failed', stream: 'stderr', attempts: 0 },
    { file: 'code' as const, reason: 'invalid-exit-code' },
  ])('safely reports native cat wait rejection for $file without output or secrets', async ({ file, reason, stream, attempts }) => {
    const secret = 'native-wait-secret-token';
    const captured = 'captured-private-output';
    capture({
      stdout: [captured], stderr: [captured],
      cat: { [file]: { wait: async () => { throw new Error(secret); } } },
    });
    const failure = await run().catch((error) => error);
    expect(failure).toMatchObject({ code: 'COMMAND_OUTPUT_INTEGRITY', reason, stream, attempts });
    expect(String(failure)).not.toContain(secret);
    expect(JSON.stringify(failure)).not.toContain(secret);
    expect(failure.stack).not.toContain(secret);
    expect(String(failure)).not.toContain(captured);
    expect(JSON.stringify(failure)).not.toContain(captured);
    expect(failure.stack).not.toContain(captured);
    expect(failure).not.toHaveProperty('cause');
  });

  it.each(['out', 'outlen', 'code'] as const)('safely reports native cat readText rejection for %s', async (file) => {
    const secret = 'native-read-secret-output';
    capture({ cat: { [file]: { readText: async () => { throw new Error(secret); } } } });
    const failure = await run().catch((error) => error);
    expect(failure).toMatchObject({ code: 'COMMAND_OUTPUT_INTEGRITY' });
    expect(String(failure)).not.toContain(secret);
    expect(JSON.stringify(failure)).not.toContain(secret);
    expect(failure).not.toHaveProperty('cause');
  });

  it.each(['', 'not-a-length', '10junk', '-1', '9007199254740992', '1.5'])(
    'rejects invalid stdout length %j instead of accepting output',
    async (stdoutLength) => {
      capture({ stdoutLength, stdout: ['data'] });
      await expect(run()).rejects.toMatchObject({ code: 'COMMAND_OUTPUT_INTEGRITY', stream: 'stdout' });
    },
  );

  it('verifies stderr independently even when stdout is complete', async () => {
    capture({ stdout: ['ok'], stderrLength: '100', stderr: ['e'.repeat(40), 'e'.repeat(60)] });
    await expect(run()).rejects.toMatchObject({
      code: 'COMMAND_OUTPUT_INTEGRITY', stream: 'stderr', expectedBytes: 100, actualBytes: 60, attempts: 2,
    });
  });

  it('never substitutes successful outer wrapper status for a missing child status file', async () => {
    capture({ missingCode: true, outerCode: 0 });
    await expect(run()).rejects.toMatchObject({ code: 'COMMAND_OUTPUT_INTEGRITY' });
  });

  it.each(['oops', '0junk', '-1', '1.5', '256', '9007199254740992'])(
    'rejects malformed child status %j rather than outer success',
    async (code) => {
      capture({ code, outerCode: 0 });
      await expect(run()).rejects.toMatchObject({ code: 'COMMAND_OUTPUT_INTEGRITY' });
    },
  );

  it('documents the byte-count limitation: same-length mutation is not detectable without a checksum', async () => {
    // The guest file was conceptually "good"; the wire changed it to "evil".
    // Byte counts are still equal, so length verification cannot detect this.
    capture({ stdoutLength: '4', stdout: ['evil'] });
    await expect(run()).resolves.toMatchObject({ stdout: 'evil', exitCode: 0 });
  });
});
