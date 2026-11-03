import { describe, expect, it, vi } from 'vitest';
import {
  CommandOutputIntegrityError,
  parseCommandExitCode,
  readVerifiedCommandOutput,
} from '../command-output';

describe('readVerifiedCommandOutput', () => {
  it('rejects a longer but still incomplete retry (100 expected, 40 then 60)', async () => {
    const read = vi.fn().mockResolvedValueOnce('a'.repeat(40)).mockResolvedValueOnce('b'.repeat(60));
    await expect(readVerifiedCommandOutput({
      readLength: async () => '100', read, stream: 'stdout',
    })).rejects.toMatchObject({
      name: 'CommandOutputIntegrityError', code: 'COMMAND_OUTPUT_INTEGRITY',
      reason: 'byte-length-mismatch', stream: 'stdout', expectedBytes: 100, actualBytes: 60, attempts: 2,
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('accepts an exact retry without concatenating the partial first read', async () => {
    const read = vi.fn().mockResolvedValueOnce('a'.repeat(40)).mockResolvedValueOnce('b'.repeat(100));
    await expect(readVerifiedCommandOutput({
      readLength: async () => '100', read, stream: 'stdout',
    })).resolves.toBe('b'.repeat(100));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('supports a dedicated reread callback, invoked once only', async () => {
    const read = vi.fn(async () => 'x');
    const reread = vi.fn(async () => 'done');
    await expect(readVerifiedCommandOutput({
      readLength: async () => '4', read, reread, stream: 'stderr',
    })).resolves.toBe('done');
    expect(read).toHaveBeenCalledTimes(1);
    expect(reread).toHaveBeenCalledTimes(1);
  });

  it('accepts an exact first read and whitespace-padded wc length without a retry', async () => {
    const readLength = vi.fn(async () => '  5\n');
    const read = vi.fn(async () => ' ok \n');
    const reread = vi.fn();
    await expect(readVerifiedCommandOutput({ readLength, read, reread, stream: 'stdout' })).resolves.toBe(' ok \n');
    expect(readLength).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(reread).not.toHaveBeenCalled();
  });

  it('accepts zero bytes only when the read is empty', async () => {
    await expect(readVerifiedCommandOutput({
      readLength: async () => '0', read: async () => '', stream: 'stdout',
    })).resolves.toBe('');
    await expect(readVerifiedCommandOutput({
      readLength: async () => '0', read: async () => 'x', stream: 'stderr',
    })).rejects.toMatchObject({ expectedBytes: 0, actualBytes: 1, attempts: 2 });
  });

  it.each(['', ' ', 'missing', '-1', '+1', '1.5', '1e2', '0x10', '12junk', 'Infinity', 'NaN', '9007199254740992'])(
    'rejects missing or malformed byte lengths %j before reading output',
    async (text) => {
      const read = vi.fn(async () => 'secret output');
      await expect(readVerifiedCommandOutput({
        readLength: async () => text, read, stream: 'stderr',
      })).rejects.toMatchObject({
        code: 'COMMAND_OUTPUT_INTEGRITY', reason: 'invalid-byte-length', stream: 'stderr', attempts: 0,
      });
      expect(read).not.toHaveBeenCalled();
    },
  );

  it('rejects oversized retries even when longer than the first read', async () => {
    const read = vi.fn().mockResolvedValueOnce('x').mockResolvedValueOnce('xxxxx');
    await expect(readVerifiedCommandOutput({
      readLength: async () => '4', read, stream: 'stdout',
    })).rejects.toMatchObject({ expectedBytes: 4, actualBytes: 5, attempts: 2 });
  });

  it.each([undefined, null])('rejects runtime-missing length metadata %j with a typed error', async (missing) => {
    await expect(readVerifiedCommandOutput({
      readLength: async () => missing as unknown as string,
      read: async () => '',
      stream: 'stdout',
    })).rejects.toMatchObject({ code: 'COMMAND_OUTPUT_INTEGRITY', reason: 'invalid-byte-length' });
  });

  it.each([
    { missing: undefined, attempts: 1 }, { missing: null, attempts: 1 },
    { missing: undefined, attempts: 2 }, { missing: null, attempts: 2 },
  ])('rejects runtime-missing output $missing on attempt $attempts with safe typed diagnostics', async ({ missing, attempts }) => {
    await expect(readVerifiedCommandOutput({
      readLength: async () => '100',
      read: async () => attempts === 1 ? missing as unknown as string : 'short',
      reread: async () => missing as unknown as string,
      stream: 'stderr',
    })).rejects.toMatchObject({
      code: 'COMMAND_OUTPUT_INTEGRITY', reason: 'output-read-failed', stream: 'stderr', expectedBytes: 100, attempts,
    });
  });

  it('uses UTF-8 bytes, not JavaScript character count', async () => {
    const text = '🙂é漢\n';
    await expect(readVerifiedCommandOutput({
      readLength: async () => String(Buffer.byteLength(text, 'utf8')), read: async () => text, stream: 'stdout',
    })).resolves.toBe(text);
    await expect(readVerifiedCommandOutput({
      readLength: async () => String(text.length), read: async () => text, stream: 'stderr',
    })).rejects.toBeInstanceOf(CommandOutputIntegrityError);
  });

  it('reports streams independently', async () => {
    await expect(readVerifiedCommandOutput({
      readLength: async () => '2', read: async () => 'ok', stream: 'stdout',
    })).resolves.toBe('ok');
    await expect(readVerifiedCommandOutput({
      readLength: async () => '2', read: async () => 'e', stream: 'stderr',
    })).rejects.toMatchObject({ stream: 'stderr', expectedBytes: 2, actualBytes: 1 });
  });

  it('does not retain captured output or transport secrets in error diagnostics', async () => {
    const secret = 'sensitive-test-payload';
    let failure: unknown;
    try {
      await readVerifiedCommandOutput({
        readLength: async () => '100', read: async () => secret, stream: 'stdout',
      });
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(CommandOutputIntegrityError);
    expect(JSON.stringify(failure)).not.toContain(secret);
    expect(String(failure)).not.toContain(secret);
    expect((failure as Error).stack).not.toContain(secret);
    expect(failure).not.toHaveProperty('cause');
  });

  it.each(['length', 'read', 'reread'] as const)('wraps %s transport failure with safe diagnostics', async (stage) => {
    const secret = 'secret-native-error';
    const fail = async (): Promise<string> => { throw new Error(secret); };
    const operation = readVerifiedCommandOutput({
      readLength: stage === 'length' ? fail : async () => '100',
      read: stage === 'read' ? fail : async () => 'short',
      reread: stage === 'reread' ? fail : undefined,
      stream: 'stdout',
    });
    const error = await operation.catch((failure) => failure);
    expect(error).toBeInstanceOf(CommandOutputIntegrityError);
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  it('documents that same-length mutation is outside byte-length verification', async () => {
    // Original content "good" and mutated content "evil" have equal UTF-8 sizes.
    await expect(readVerifiedCommandOutput({
      readLength: async () => '4', read: async () => 'evil', stream: 'stdout',
    })).resolves.toBe('evil');
  });
});

describe('parseCommandExitCode', () => {
  it.each([0, 1, 23, 127, 255])('preserves valid child exit code %i', (code) => {
    expect(parseCommandExitCode(` ${code}\n`)).toBe(code);
  });

  it.each([undefined, null])('rejects runtime-missing child status %j with a typed error', (missing) => {
    expect(() => parseCommandExitCode(missing as unknown as string)).toThrow(CommandOutputIntegrityError);
  });

  it.each(['', ' ', 'missing', '0junk', '1.5', '-1', '+1', '1e2', '256', 'Infinity', '9007199254740992'])(
    'rejects missing or malformed child status %j',
    (text) => {
      expect(() => parseCommandExitCode(text)).toThrow(CommandOutputIntegrityError);
      try { parseCommandExitCode(text); } catch (error) {
        expect(error).toMatchObject({ code: 'COMMAND_OUTPUT_INTEGRITY', reason: 'invalid-exit-code' });
        if (text.trim()) expect(JSON.stringify(error)).not.toContain(`"${text}"`);
      }
    },
  );
});
