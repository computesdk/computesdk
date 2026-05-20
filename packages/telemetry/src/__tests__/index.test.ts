import { describe, expect, it } from 'vitest';
import { createTelemetryId, toErrorCode } from '../index';

describe('@computesdk/telemetry', () => {
  it('creates non-empty telemetry IDs', () => {
    expect(createTelemetryId().length).toBeGreaterThan(0);
  });

  it('maps unknown errors to default code', () => {
    expect(toErrorCode(new Error('boom'))).toBe('Error');
    expect(toErrorCode('boom')).toBe('ERROR');
  });
});
