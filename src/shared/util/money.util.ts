import Decimal from 'decimal.js';
import { ValueTransformer } from 'typeorm';
import { MONEY_SCALE, RATE_SCALE } from '../global/constants';

/**
 * The only numeric type allowed on money paths. 40 significant digits is far
 * beyond NUMERIC(30,6) amounts and NUMERIC(36,18) rates, and ROUND_DOWN is the
 * default so that any implicit rounding never creates value.
 */
export const Money = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_DOWN,
  toExpNeg: -40,
  toExpPos: 40,
});
export type Money = Decimal;

/** Positive, at most 18 integer digits and at most 6 decimal places. */
export const AMOUNT_PATTERN = /^(?!0+(?:\.0+)?$)\d{1,18}(?:\.\d{1,6})?$/;

export const ZERO: Money = new Money(0);
export const ONE: Money = new Money(1);

export function toMoney(value: Decimal.Value): Money {
  return new Money(value);
}

/** Parses a validated decimal string. Never rounds: callers validate scale first. */
export function parseAmount(value: string): Money {
  if (!AMOUNT_PATTERN.test(value)) {
    throw new RangeError(`Invalid amount: ${value}`);
  }
  return new Money(value);
}

/** Wire format: exact ledger value, trailing zeros trimmed ("10.500000" → "10.5"). */
export function formatAmount(value: Money): string {
  const quantised = value.toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_DOWN);
  return quantised.isZero() ? '0' : quantised.toFixed();
}

export function formatRate(value: Money): string {
  return value.toDecimalPlaces(RATE_SCALE, Decimal.ROUND_DOWN).toFixed();
}

/** Rounds an amount down to the money scale; the remainder stays with the platform. */
export function roundDownToScale(value: Money): Money {
  return value.toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_DOWN);
}

function assertPositiveRates(fromUsdRate: Money, toUsdRate: Money): void {
  if (fromUsdRate.lte(0) || toUsdRate.lte(0)) {
    throw new RangeError('USD rates must be positive');
  }
}

/**
 * Cross rate A→B from USD-based quotes (units of X per 1 USD), quantised to
 * RATE_SCALE for display and storage.
 */
export function crossRate(fromUsdRate: Money, toUsdRate: Money): Money {
  assertPositiveRates(fromUsdRate, toUsdRate);
  return toUsdRate
    .div(fromUsdRate)
    .toDecimalPlaces(RATE_SCALE, Decimal.ROUND_DOWN);
}

/**
 * destination = floor6(amount × toUsd / fromUsd), evaluated as one expression
 * so the only rounding is the final one. Applying a pre-quantised rate would
 * turn 15300 cNGN at 1500/USD into 10.199999 instead of 10.2. The inputs are
 * stored (fx_snapshot_id), so every conversion can be recomputed exactly.
 */
export function convertViaUsd(
  amount: Money,
  fromUsdRate: Money,
  toUsdRate: Money,
): Money {
  assertPositiveRates(fromUsdRate, toUsdRate);
  return roundDownToScale(amount.mul(toUsdRate).div(fromUsdRate));
}

/** Maps NUMERIC columns to Money and back without ever touching a JS number. */
export function decimalTransformer(scale: number): ValueTransformer {
  return {
    to: (value: Money | null | undefined): string | null | undefined =>
      value === null || value === undefined ? value : value.toFixed(scale),
    from: (value: string | null): Money | null =>
      value === null ? null : new Money(value),
  };
}

export const moneyTransformer = decimalTransformer(MONEY_SCALE);
export const rateTransformer = decimalTransformer(RATE_SCALE);
