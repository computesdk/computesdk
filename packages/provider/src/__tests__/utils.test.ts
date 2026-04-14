/**
 * Tests for utility functions
 */

import { describe, it, expect } from 'vitest';
import { calculateBackoff } from '../utils';

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
