import { Buffer } from 'node:buffer';

type OutputStream = 'stdout' | 'stderr';
type IntegrityReason =
  | 'invalid-byte-length'
  | 'length-read-failed'
  | 'output-read-failed'
  | 'byte-length-mismatch'
  | 'invalid-exit-code';

interface IntegrityDetails {
  reason: IntegrityReason;
  stream?: OutputStream;
  expectedBytes?: number;
  actualBytes?: number;
  attempts?: number;
}

/**
 * Captured output could not be verified. Diagnostics deliberately contain only
 * fixed reason/stream identifiers and numeric counts, never output or a native
 * error/cause which might contain commands, credentials, or captured content.
 */
export class CommandOutputIntegrityError extends Error {
  readonly code = 'COMMAND_OUTPUT_INTEGRITY';
  readonly reason: IntegrityReason;
  readonly stream?: OutputStream;
  readonly expectedBytes?: number;
  readonly actualBytes?: number;
  readonly attempts?: number;

  constructor(details: IntegrityDetails) {
    const { reason, stream, expectedBytes, actualBytes, attempts } = details;
    super(`Command output integrity verification failed: ${reason}${stream ? ` (${stream})` : ''}`);
    this.name = 'CommandOutputIntegrityError';
    this.reason = reason;
    this.stream = stream;
    this.expectedBytes = expectedBytes;
    this.actualBytes = actualBytes;
    this.attempts = attempts;
  }
}

/** Full decimal tokens only; parseInt/Number alone accept partial or empty text. */
function nonnegativeSafeInteger(text: string): number | undefined {
  // Native transports may violate their string type at runtime when a file is
  // absent. Treat that as missing metadata, not an unrelated TypeError.
  if (typeof text !== 'string') return undefined;
  const token = text.trim();
  if (!/^[0-9]+$/.test(token)) return undefined;
  const value = Number(token);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Read a guest capture only when its UTF-8 byte count matches the recorded
 * length. A mismatch permits exactly one fresh read, never partial concatenation
 * or a "longest response wins" fallback. Byte counts cannot detect same-length
 * content mutation; this is intentionally not a checksum guarantee.
 */
export async function readVerifiedCommandOutput({
  readLength,
  read,
  reread = read,
  stream,
}: {
  readLength: () => Promise<string>;
  read: () => Promise<string>;
  reread?: () => Promise<string>;
  stream: 'stdout' | 'stderr';
}): Promise<string> {
  let lengthText: string;
  try {
    lengthText = await readLength();
  } catch {
    throw new CommandOutputIntegrityError({ reason: 'length-read-failed', stream, attempts: 0 });
  }
  const expectedBytes = nonnegativeSafeInteger(lengthText);
  if (expectedBytes === undefined) {
    throw new CommandOutputIntegrityError({ reason: 'invalid-byte-length', stream, attempts: 0 });
  }

  for (let attempts = 1; attempts <= 2; attempts++) {
    let output: string;
    try {
      output = await (attempts === 1 ? read() : reread());
    } catch {
      throw new CommandOutputIntegrityError({ reason: 'output-read-failed', stream, expectedBytes, attempts });
    }
    if (typeof output !== 'string') {
      throw new CommandOutputIntegrityError({ reason: 'output-read-failed', stream, expectedBytes, attempts });
    }
    const actualBytes = Buffer.byteLength(output, 'utf8');
    if (actualBytes === expectedBytes) return output;
    if (attempts === 2) {
      throw new CommandOutputIntegrityError({
        reason: 'byte-length-mismatch', stream, expectedBytes, actualBytes, attempts,
      });
    }
  }
  // Both attempts either return a verified capture or throw above.
  throw new CommandOutputIntegrityError({ reason: 'byte-length-mismatch', stream, expectedBytes, attempts: 2 });
}

/** Parse a recorded child status, never a native wrapper's successful status. */
export function parseCommandExitCode(text: string): number {
  const code = nonnegativeSafeInteger(text);
  if (code === undefined || code > 255) {
    throw new CommandOutputIntegrityError({ reason: 'invalid-exit-code' });
  }
  return code;
}
