/**
 * Small numeric helpers shared by the calculation engine.
 *
 * Kept separate from `money.ts` so the engine can import them without creating
 * a cycle, and so the rounding rules stay in one readable place.
 */

import Big from 'big.js';
import { currencyDecimals } from '../money/currencies';

export { currencyDecimals };

/** Minor-unit exponent for a currency code. */
export function currencyDecimalsOf(code: string): number {
  return currencyDecimals(code);
}

/**
 * Round to a whole minor unit — the atomic unit of every amount in Duly.
 *
 * This is deliberately zero-decimal. A quantity times a price produces something
 * like 41.0922, but that is 4110 minor units with a fraction left over, and the
 * fraction has nowhere to go. Rounding to the currency's decimal places instead
 * (2 for AUD) would leave an amount in cents with two decimal places, quietly
 * breaking the integer invariant every total depends on.
 */
export function roundMinor(value: Big | number | string): number {
  const b = value instanceof Big ? value : new Big(value);
  return b.round(0, Big.roundHalfUp).toNumber();
}

/** Round a decimal to `dp` places. Only for values already in major units. */
export function roundDecimal(value: Big | number | string, dp: number): number {
  const b = value instanceof Big ? value : new Big(value);
  return b.round(dp, Big.roundHalfUp).toNumber();
}

/**
 * Split `total` across `weights` so the parts sum **exactly** to `total`.
 *
 * Largest-remainder method: floor every share, then hand the leftover minor
 * units to the largest fractional parts. Ties break towards the earlier slot so
 * the result is deterministic — the same document always renders the same way.
 *
 * This is the mechanism behind rule 5 of the calculation rules: a document-level
 * discount is spread across tax codes by value, which keeps GST correct instead
 * of charging tax on an amount the client no longer owes.
 */
export function allocateProRata(total: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];

  const absWeights = weights.map((w) => (Number.isFinite(w) ? Math.abs(w) : 0));
  const totalWeight = absWeights.reduce((a, b) => a + b, 0);

  if (totalWeight === 0) {
    // Nothing to weight by: put everything on the first slot so it is never lost.
    const out = new Array<number>(weights.length).fill(0);
    out[0] = Math.round(total);
    return out;
  }

  const totalBig = new Big(total);
  const denom = new Big(totalWeight);
  const exact = absWeights.map((w) => new Big(w).div(denom).mul(totalBig));
  const floors = exact.map((e) => e.round(0, Big.roundDown));

  let remainder = totalBig.minus(floors.reduce((acc, f) => acc.plus(f), new Big(0)));

  const order = exact
    .map((e, i) => ({ i, frac: e.minus(floors[i]) }))
    .sort((a, b) => b.frac.cmp(a.frac) || a.i - b.i);

  const out = floors.map((f) => f.toNumber());
  let cursor = 0;
  while (!remainder.eq(0) && order.length > 0) {
    const step = remainder.gt(0) ? 1 : -1;
    out[order[cursor % order.length].i] += step;
    remainder = remainder.minus(step);
    cursor++;
  }
  return out;
}

/** Coerce anything to a finite number, with a fallback. */
export function safeNumber(value: string | number | null | undefined, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Coerce to an exact Big, with a fallback. */
export function safeBig(value: string | number | null | undefined, fallback = '0'): Big {
  if (value === null || value === undefined || value === '') return new Big(fallback);
  try {
    return new Big(value);
  } catch {
    return new Big(fallback);
  }
}
