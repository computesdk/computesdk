import { describe, it, expect } from 'vitest';
import {
  formatRateAllUnits,
  formatUsd,
  formatUsdPer,
  rateAllUnits,
} from '../rate-display.js';

describe('rateAllUnits', () => {
  it('normalizes a per-second rate', () => {
    expect(rateAllUnits({ usd: 0.000028, per: 'second' })).toEqual({
      perSecond: 0.000028,
      perMinute: 0.00168,
      perHour: 0.1008,
    });
  });

  it('normalizes a per-minute rate', () => {
    expect(rateAllUnits({ usd: 0.6, per: 'minute' })).toEqual({
      perSecond: 0.01,
      perMinute: 0.6,
      perHour: 36,
    });
  });

  it('normalizes a per-hour rate', () => {
    expect(rateAllUnits({ usd: 3.6, per: 'hour' })).toEqual({
      perSecond: 0.001,
      perMinute: 0.06,
      perHour: 3.6,
    });
  });
});

describe('formatUsd', () => {
  it('keeps up to 4 significant decimals and trims zeros', () => {
    expect(formatUsd(0.1008)).toBe('$0.1008');
    expect(formatUsd(0.00168)).toBe('$0.00168');
    expect(formatUsd(0.000028)).toBe('$0.000028');
    expect(formatUsd(14.123456)).toBe('$14.12');
    expect(formatUsd(0.1)).toBe('$0.1');
  });

  it('prints round numbers bare', () => {
    expect(formatUsd(3600)).toBe('$3600');
    expect(formatUsd(5)).toBe('$5');
    expect(formatUsd(0)).toBe('$0');
  });

  it('trims zeros after rounding', () => {
    expect(formatUsd(9.9999)).toBe('$10');
    expect(formatUsd(0.5000)).toBe('$0.5');
  });

  it('never uses scientific notation for tiny per-second values', () => {
    expect(formatUsd(0.00000001)).toBe('$0.00000001');
    expect(formatUsd(1.2345e-7)).toBe('$0.0000001235');
    for (const tiny of [1e-9, 2.5e-12, 7e-20]) {
      expect(formatUsd(tiny)).not.toMatch(/e/i);
    }
  });
});

describe('formatRateAllUnits', () => {
  it('prints all three units, per hour first', () => {
    expect(
      formatRateAllUnits({ perSecond: 0.000028, perMinute: 0.00168, perHour: 0.1008 }),
    ).toBe('$0.1008/hr · $0.00168/min · $0.000028/s');
  });

  it('handles a round hourly rate', () => {
    expect(
      formatRateAllUnits({ perSecond: 1, perMinute: 60, perHour: 3600 }),
    ).toBe('$3600/hr · $60/min · $1/s');
  });
});

describe('formatUsdPer', () => {
  it('formats a {usd, per} rate in all units', () => {
    expect(formatUsdPer({ usd: 0.12, per: 'second' })).toBe(
      '$432/hr · $7.2/min · $0.12/s',
    );
    expect(formatUsdPer({ usd: 0.1, per: 'hour' })).toBe(
      '$0.1/hr · $0.001667/min · $0.00002778/s',
    );
  });
});
