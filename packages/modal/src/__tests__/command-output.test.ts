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

type Capture = {
  stdout?: string[];
  stderr?: string[];
  stdoutLength?: string;
  stderrLength?: string;
  code?: string;
  missingCode?: boolean;
  outerCode?: number;
};

function capture({
  stdout = [''],
  stderr = [''],
  stdoutLength = String(Buffer.byteLength(stdout[stdout.length - 1])),
  stderrLength = String(Buffer.byteLength(stderr[stderr.length - 1])),
  code = '0',
  missingCode = false,
  outerCode = 0,
}: Capture = {}) {
  const reads = { stdout: 0, stderr: 0 };
  const process = (text: string, exitCode = 0) => ({
    stdout: { readText: async () => text },
    stderr: { readText: async () => '' },
    wait: async () => exitCode,
  });
  exec.mockImplementation(async (argv: string[]) => {
    if (argv[0] === 'sh') return process('', outerCode);
    if (argv[0] === 'rm') return process('');
    if (argv[0] !== 'cat') throw new Error('Unexpected native exec');
    const path = argv[1];
    if (path.endsWith('.outlen')) return process(stdoutLength);
    if (path.endsWith('.errlen')) return process(stderrLength);
    if (path.endsWith('.code')) return process(missingCode ? '' : code, missingCode ? 1 : 0);
    if (path.endsWith('.out')) {
      const index = Math.min(reads.stdout++, stdout.length - 1);
      return process(stdout[index]);
    }
    if (path.endsWith('.err')) {
      const index = Math.min(reads.stderr++, stderr.length - 1);
      return process(stderr[index]);
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
