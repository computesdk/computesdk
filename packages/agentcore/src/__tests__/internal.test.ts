/**
 * Unit tests for the pure helpers — run unconditionally, no AWS credentials
 * needed. These cover the trickiest logic (shell escaping, command assembly,
 * marker parsing, error classification, timeout clamping) in isolation.
 */
import { describe, it, expect } from 'vitest';
import {
  sq,
  buildCommand,
  wrapForCapture,
  parseWrappedResult,
  friendlyError,
  clampSessionTimeout,
  MIN_SESSION_TIMEOUT_SECONDS,
  MAX_SESSION_TIMEOUT_SECONDS,
} from '../internal';

describe('sq (POSIX single-quote)', () => {
  it('wraps a plain string in single quotes', () => {
    expect(sq('hello')).toBe("'hello'");
  });

  it('neutralizes expansion characters by quoting them literally', () => {
    expect(sq('$HOME `id` ${x}')).toBe("'$HOME `id` ${x}'");
  });

  it('escapes embedded single quotes with the close-escape-reopen idiom', () => {
    expect(sq("it's")).toBe("'it'\\''s'");
  });

  it('handles an empty string', () => {
    expect(sq('')).toBe("''");
  });

  it('handles a string that is only a single quote', () => {
    expect(sq("'")).toBe("''\\'''");
  });
});

describe('clampSessionTimeout', () => {
  it('passes through in-range values (rounding up)', () => {
    expect(clampSessionTimeout(900)).toBe(900);
    expect(clampSessionTimeout(0.4)).toBe(MIN_SESSION_TIMEOUT_SECONDS);
  });

  it('clamps above the maximum', () => {
    expect(clampSessionTimeout(99999)).toBe(MAX_SESSION_TIMEOUT_SECONDS);
  });

  it('clamps below the minimum', () => {
    expect(clampSessionTimeout(0)).toBe(MIN_SESSION_TIMEOUT_SECONDS);
    expect(clampSessionTimeout(-5)).toBe(MIN_SESSION_TIMEOUT_SECONDS);
  });

  it('defaults non-finite input to the maximum', () => {
    expect(clampSessionTimeout(NaN)).toBe(MAX_SESSION_TIMEOUT_SECONDS);
    expect(clampSessionTimeout(Infinity)).toBe(MAX_SESSION_TIMEOUT_SECONDS);
  });
});

describe('buildCommand', () => {
  it('returns the command unchanged with no options', () => {
    expect(buildCommand('echo hi')).toBe('echo hi');
  });

  it('prefixes env vars (single-quoted) before the command', () => {
    expect(buildCommand('printenv X', { env: { X: 'a b' } })).toBe("X='a b' printenv X");
  });

  it('applies env before wrapping in cwd so vars bind to the real command', () => {
    const out = buildCommand('run', { env: { A: '1' }, cwd: '/tmp' });
    expect(out).toBe("cd '/tmp' && A='1' run");
  });

  it('throws on an invalid env var name', () => {
    expect(() => buildCommand('x', { env: { 'BAD-KEY': '1' } })).toThrow(/Invalid environment variable name/);
    expect(() => buildCommand('x', { env: { 'A\nB': '1' } })).toThrow(/Invalid environment variable name/);
  });

  it('wraps background commands in sh -c so nohup covers the whole command', () => {
    expect(buildCommand('server', { background: true })).toBe("nohup sh -c 'server' > /dev/null 2>&1 &");
  });

  it('keeps cwd inside the backgrounded unit (nohup must not split on &&)', () => {
    // Regression: `nohup cd X && cmd &` runs cmd in the wrong dir / not at all.
    expect(buildCommand('run', { cwd: '/app', background: true })).toBe(
      "nohup sh -c 'cd '\\''/app'\\'' && run' > /dev/null 2>&1 &",
    );
  });

  it('bounds runtime with the timeout coreutil (ms -> seconds, rounded up)', () => {
    expect(buildCommand('slow', { timeout: 5000 })).toBe("timeout 5 sh -c 'slow'");
    expect(buildCommand('slow', { timeout: 1500 })).toBe("timeout 2 sh -c 'slow'");
  });
});

describe('wrapForCapture + parseWrappedResult round-trip', () => {
  const tag = 'abc123';

  it('wraps into a subshell with markers and cleanup', () => {
    const w = wrapForCapture('echo hi', tag);
    expect(w).toContain('( echo hi )');
    expect(w).toContain(`CSDKrc${tag}=`);
    expect(w).toContain(`CSDKsep${tag}`);
    expect(w).toContain(`rm -f /tmp/.csdk-${tag}.out /tmp/.csdk-${tag}.err`);
  });

  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

  it('parses stdout, stderr, and exit code from wrapper output', () => {
    const raw = `CSDKrc${tag}=7\n${b64('out data')}\nCSDKsep${tag}\n${b64('err data')}\n`;
    expect(parseWrappedResult(raw, tag)).toEqual({ stdout: 'out data', stderr: 'err data', exitCode: 7 });
  });

  it('is byte-exact for content with newlines and special characters', () => {
    const stdout = 'line1\nline2\t"q" $x\n';
    const raw = `CSDKrc${tag}=0\n${b64(stdout)}\nCSDKsep${tag}\n`;
    expect(parseWrappedResult(raw, tag).stdout).toBe(stdout);
  });

  it('tolerates CRLF around the markers', () => {
    const raw = `CSDKrc${tag}=3\r\n${b64('x')}\r\nCSDKsep${tag}\r\n${b64('y')}\r\n`;
    expect(parseWrappedResult(raw, tag)).toEqual({ stdout: 'x', stderr: 'y', exitCode: 3 });
  });

  it('does not mis-parse command output that resembles markers (base64 envelope protects it)', () => {
    const stdout = `CSDKsep${tag}\nCSDKrc${tag}=99\n`; // command literally prints marker-like text
    const raw = `CSDKrc${tag}=0\n${b64(stdout)}\nCSDKsep${tag}\n`;
    const parsed = parseWrappedResult(raw, tag);
    expect(parsed.exitCode).toBe(0);
    expect(parsed.stdout).toBe(stdout);
  });

  it('falls back to raw text when markers are absent', () => {
    expect(parseWrappedResult('unexpected shell error', tag)).toEqual({
      stdout: 'unexpected shell error',
      stderr: '',
      exitCode: 1,
    });
    expect(parseWrappedResult('', tag)).toEqual({ stdout: '', stderr: '', exitCode: 0 });
  });
});

describe('friendlyError', () => {
  it('maps a missing-region error', () => {
    const e = friendlyError('starting a session', new Error('Region is missing'));
    expect(e.message).toMatch(/Missing AWS region/);
  });

  it('maps credential errors by name', () => {
    const err = Object.assign(new Error('whatever'), { name: 'CredentialsProviderError' });
    expect(friendlyError('x', err).message).toMatch(/authentication failed/i);
  });

  it('maps expired-token errors', () => {
    const err = Object.assign(new Error('The security token included in the request is expired'), {
      name: 'ExpiredTokenException',
    });
    expect(friendlyError('x', err).message).toMatch(/authentication failed/i);
  });

  it('maps access-denied errors by name', () => {
    const err = Object.assign(new Error('nope'), { name: 'AccessDeniedException' });
    expect(friendlyError('starting a session', err).message).toMatch(/Access denied/);
  });

  it('falls back to a generic wrapped message', () => {
    expect(friendlyError('doing a thing', new Error('boom')).message).toBe('Failed doing a thing: boom');
  });
});
