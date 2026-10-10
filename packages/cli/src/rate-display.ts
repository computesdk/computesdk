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
  // toFixed accepts at most 100 decimals; a rate smaller than 1e-100 would
  // ask for more, so cap it (the string rounds to $0 rather than throwing).
  const decimals = Math.min(100, Math.max(0, 3 - Math.floor(Math.log10(Math.abs(usd)))));
  const fixed = usd.toFixed(decimals);
  // Trailing zeros only count after a decimal point — "3600" stays "3600".
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
  return `$${trimmed}`;
}

/**
 * `$1,234.56`, `$20.00`, `$0.10` — money *amounts* (balances, costs, holds,
 * credits, settlements): always 2 decimals with thousands separators.
 * Non-zero amounts under $0.01 keep up to 4 significant digits (`$0.0042`),
 * negatives render `-$0.50`. Rates use `formatUsd`, not this.
 */
export function formatMoney(usd: number): string {
  if (!Number.isFinite(usd)) return '$—';
  const sign = usd < 0 ? '-' : '';
  const abs = Math.abs(usd);
  if (abs !== 0 && abs < 0.01) {
    return `${sign}${formatUsd(abs)}`;
  }
  const s = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}$${s}`;
}

/** `$0.1008/hr · $0.00168/min · $0.000028/s` — per hour first. */
export function formatRateAllUnits(rate: RateAllUnits): string {
  return `${formatUsd(rate.perHour)}/hr · ${formatUsd(rate.perMinute)}/min · ${formatUsd(rate.perSecond)}/s`;
}

/** Convenience for a `{usd, per}` straight off the wire. */
export function formatUsdPer(rate: UsdPer): string {
  return formatRateAllUnits(rateAllUnits(rate));
}
