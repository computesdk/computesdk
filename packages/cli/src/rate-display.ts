/**
 * Shared display helpers for money and rates.
 *
 * Every human-readable rate the CLI prints shows all three units — per hour
 * first — as `$0.1008/hr · $0.00168/min · $0.000028/s`. Amounts print with up
 * to 4 significant decimals, never scientific notation, trailing zeros
 * trimmed.
 */

export type RatePer = 'second' | 'minute' | 'hour';

/** A rate in the API's input shape: an amount plus the unit it's priced per. */
export interface UsdPer {
  usd: number;
  per: string;
}

/** The same rate normalized to all three units — the API's `rateUsd` shape. */
export interface RateAllUnits {
  perSecond: number;
  perMinute: number;
  perHour: number;
}

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/** `{usd, per}` → `{perSecond, perMinute, perHour}`. */
export function rateAllUnits(rate: UsdPer): RateAllUnits {
  const perSecond =
    rate.per === 'second'
      ? rate.usd
      : rate.per === 'minute'
        ? rate.usd / SECONDS_PER_MINUTE
        : rate.usd / SECONDS_PER_HOUR;
  return {
    perSecond,
    perMinute: perSecond * SECONDS_PER_MINUTE,
    perHour: perSecond * SECONDS_PER_HOUR,
  };
}

/**
 * `$0.1008`, `$14.12`, `$3600`, `$0.000028` — up to 4 significant decimals,
 * trailing zeros trimmed, never scientific notation.
 */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd)) return '$—';
  if (usd === 0) return '$0';
  // Decimals needed for 4 significant digits; Math.log10(1e-9) = -9 still
  // lands on a plain toFixed call, so tiny per-second values never go
  // exponential.
  const decimals = Math.max(0, 3 - Math.floor(Math.log10(Math.abs(usd))));
  const fixed = usd.toFixed(decimals);
  // Trailing zeros only count after a decimal point — "3600" stays "3600".
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
  return `$${trimmed}`;
}

/** `$0.1008/hr · $0.00168/min · $0.000028/s` — per hour first. */
export function formatRateAllUnits(rate: RateAllUnits): string {
  return `${formatUsd(rate.perHour)}/hr · ${formatUsd(rate.perMinute)}/min · ${formatUsd(rate.perSecond)}/s`;
}

/** Convenience for a `{usd, per}` straight off the wire. */
export function formatUsdPer(rate: UsdPer): string {
  return formatRateAllUnits(rateAllUnits(rate));
}
