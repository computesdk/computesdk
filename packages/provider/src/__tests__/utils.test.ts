/**
 * Tests for utility functions
 */

import { describe, it, expect } from 'vitest';
import { calculateBackoff, escapeShellArg, buildShellCommand } from '../utils';

describe('calculateBackoff', () => {
  it('should calculate exponential backoff for attempt 0', () => {
    const delay = calculateBackoff(0, 1000, 0); // No jitter for deterministic test
    expect(delay).toBe(1000); // 1000 * 2^0 = 1000
  });

  it('should calculate exponential backoff for attempt 1', () => {
    const delay = calculateBackoff(1, 1000, 0);
    expect(delay).toBe(2000); // 1000 * 2^1 = 2000
  });

  it('should calculate exponential backoff for attempt 2', () => {
    const delay = calculateBackoff(2, 1000, 0);
    expect(delay).toBe(4000); // 1000 * 2^2 = 4000
  });

  it('should calculate exponential backoff for attempt 3', () => {
    const delay = calculateBackoff(3, 1000, 0);
    expect(delay).toBe(8000); // 1000 * 2^3 = 8000
  });

  it('should use default base delay of 1000ms', () => {
    const delay = calculateBackoff(0, undefined, 0);
    expect(delay).toBe(1000);
  });

  it('should use default jitter of 100ms', () => {
    const delay = calculateBackoff(0);
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThan(1100);
  });

  it('should add jitter within specified range', () => {
    // Run multiple times to ensure jitter is random
    for (let i = 0; i < 10; i++) {
      const delay = calculateBackoff(0, 1000, 100);
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThan(1100);
    }
  });

  it('should work with custom base delay', () => {
    const delay = calculateBackoff(1, 500, 0);
    expect(delay).toBe(1000); // 500 * 2^1 = 1000
  });

  it('should work with custom jitter', () => {
    for (let i = 0; i < 10; i++) {
      const delay = calculateBackoff(0, 1000, 50);
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThan(1050);
    }
  });

  it('should scale exponentially with attempt number', () => {
    const delay0 = calculateBackoff(0, 1000, 0);
    const delay1 = calculateBackoff(1, 1000, 0);
    const delay2 = calculateBackoff(2, 1000, 0);

    expect(delay1).toBe(delay0 * 2);
    expect(delay2).toBe(delay1 * 2);
  });
});

describe('escapeShellArg', () => {
  it('should escape backslashes', () => {
    expect(escapeShellArg('a\\b')).toBe('a\\\\b');
  });

  it('should escape double quotes', () => {
    expect(escapeShellArg('a"b')).toBe('a\\"b');
  });

  it('should escape dollar signs', () => {
    expect(escapeShellArg('$VAR')).toBe('\\$VAR');
  });

  it('should escape backticks', () => {
    expect(escapeShellArg('a`b`c')).toBe('a\\`b\\`c');
  });
});

describe('buildShellCommand', () => {
  it('should return command unchanged when no options', () => {
    expect(buildShellCommand('echo hello')).toBe('echo hello');
  });

  it('should wrap cwd with cd', () => {
    expect(buildShellCommand('ls', { cwd: '/tmp' })).toBe('cd "/tmp" && ls');
  });

  it('should escape special chars in cwd', () => {
    expect(buildShellCommand('ls', { cwd: '/path with $VAR' })).toBe('cd "/path with \\$VAR" && ls');
  });

  it('should export env vars', () => {
    expect(buildShellCommand('npm run build', { env: { NODE_ENV: 'production' } }))
      .toBe('export NODE_ENV="production" && npm run build');
  });

  it('should export multiple env vars with &&', () => {
    const result = buildShellCommand('cmd', { env: { A: '1', B: '2' } });
    expect(result).toBe('export A="1" && export B="2" && cmd');
  });

  it('should apply cd before env', () => {
    const result = buildShellCommand('cmd', { cwd: '/dir', env: { KEY: 'val' } });
    expect(result).toBe('cd "/dir" && export KEY="val" && cmd');
  });

  it('should escape env values', () => {
    expect(buildShellCommand('cmd', { env: { FOO: '$BAR' } }))
      .toBe('export FOO="\\$BAR" && cmd');
  });

  it('should throw on invalid env key', () => {
    expect(() => buildShellCommand('cmd', { env: { 'FOO; rm -rf /': 'bad' } }))
      .toThrow('Invalid environment variable name');
    expect(() => buildShellCommand('cmd', { env: { '1INVALID': 'bad' } }))
      .toThrow('Invalid environment variable name');
  });

  it('should accept valid env keys', () => {
    expect(() => buildShellCommand('cmd', { env: { MY_VAR: 'ok', _private: 'ok', A1: 'ok' } }))
      .not.toThrow();
  });

  it('should use custom escape function', () => {
    const noOp = (s: string) => s;
    const result = buildShellCommand('cmd', { env: { KEY: 'raw' } }, noOp);
    expect(result).toBe('export KEY="raw" && cmd');
  });

  it('should handle empty env object', () => {
    expect(buildShellCommand('cmd', { env: {} })).toBe('cmd');
  });
});
