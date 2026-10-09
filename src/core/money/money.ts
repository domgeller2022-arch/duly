/**
 * Money primitives.
 *
 * Every amount inside Duly is an **integer count of minor units** (cents for
 * AUD, whole yen for JPY, fils for KWD). Floating point never touches a stored
 * amount: the only place a decimal appears is at the edge — parsing user input,
 * and multiplications by a quantity or a rate — and both go through big.js.
 *
 * Rounding is half-away-from-zero. That is deliberate. A credit note must be the
 * exact arithmetic negation of the invoice it credits, including the tax, and
 * only symmetric rounding guarantees that: 5.555 -> 5.56 and -5.555 -> -5.56.
 * (The ATO wording is "round to the nearest cent, 0.5 up"; for negative amounts
 * that convention breaks the symmetry credit notes depend on.)
 */

import Big from 'big.js';
import { currencyDecimals, getCurrency, minorUnitFactor } from './currencies';

Big.DP = 20; // decimal places for intermediate results
Big.RM = Big.roundHalfUp; // half away from zero

/** An exact decimal string, e.g. "7.25". Quantities and rates live here. */
export type Decimalish = string | number | Big;

export interface Money {
  /** Integer count of minor units. */
  readonly minor: number;
  readonly currency: string;
}

export const ZERO_AUD: Money = Object.freeze({ minor: 0, currency: 'AUD' });

export function money(minor: number, currency: string): Money {
  return { minor: Math.round(minor), currency: currency.toUpperCase() };
}

export function zero(currency: string): Money {
  return { minor: 0, currency: currency.toUpperCase() };
}

export function toBig(value: Decimalish): Big {
  if (value instanceof Big) return value;
  return new Big(value ?? 0);
}

/* ------------------------------------------------------------------ */
/* Rounding                                                            */
/* ------------------------------------------------------------------ */

/** Round a decimal to `dp` places, half away from zero. */
export function round(value: Decimalish, dp: number): Big {
  return toBig(value).round(dp, Big.roundHalfUp);
}

/**
 * Scale a major-unit decimal to integer minor units for `currency`.
 * `1.005` in AUD -> 101 (rounds up, not to 100).
 */
export function toMinor(value: Decimalish, currency: string): number {
  return round(toBig(value).mul(minorUnitFactor(currency)), 0).toNumber();
}

/** Integer minor units back to an exact decimal string. */
export function toMajorString(minor: number, currency: string): string {
  const dp = currencyDecimals(currency);
  return new Big(minor).div(minorUnitFactor(currency)).toFixed(dp);
}

/** Integer minor units to a JS number, for charts and API payloads. */
export function toMajorNumber(minor: number, currency: string): number {
  return new Big(minor).div(minorUnitFactor(currency)).toNumber();
}

/* ------------------------------------------------------------------ */
/* Arithmetic                                                          */
/* ------------------------------------------------------------------ */

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor + b.minor, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor - b.minor, currency: a.currency };
}

export function sum(amounts: readonly Money[], currency?: string): Money {
  const code = currency ?? amounts[0]?.currency ?? 'AUD';
  assertSameCurrencyForAll(amounts, code);
  return { minor: amounts.reduce((acc, m) => acc + m.minor, 0), currency: code };
}

export function negate(m: Money): Money {
  return { minor: -m.minor, currency: m.currency };
}

export function absolute(m: Money): Money {
  return { minor: Math.abs(m.minor), currency: m.currency };
}

/**
 * Scale minor units by an exact decimal factor, e.g. 7.25 h x $120.00 = $870.00.
 *
 * Both operands are already in minor units, so the product is rounded straight
 * to a whole minor unit. Routing this through `toMinor` would scale by the
 * currency exponent a second time and inflate every line by 100.
 */
export function multiply(m: Money, factor: Decimalish): Money {
  return { minor: round(toBig(m.minor).mul(toBig(factor)), 0).toNumber(), currency: m.currency };
}

export function divide(a: Money, divisor: Decimalish): Money {
  const d = toBig(divisor);
  if (d.eq(0)) return zero(a.currency);
  return { minor: round(toBig(a.minor).div(d), 0).toNumber(), currency: a.currency };
}

/**
 * Whole percentage (10 = 10%) as an exact decimal fraction (0.1).
 *
 * Duly writes percentages the way a person does — `10`, not `0.10` — while tax
 * *rates* are stored as fractions (`"0.10"`). One named helper keeps the two
 * conventions from bleeding into each other.
 */
export function percentToFraction(percent: Decimalish): Big {
  return toBig(percent).div(100);
}

/**
 * Take `percent` off `m`. `10` means 10%. The result is never below zero —
 * a discount larger than the amount would otherwise flip the sign of the
 * invoice, which is a surcharge, not a discount.
 */
export function applyPercentOff(m: Money, percent: Decimalish): Money {
  const factor = new Big(1).minus(percentToFraction(percent));
  const discounted = round(toBig(m.minor).mul(factor.lt(0) ? new Big(0) : factor), 0);
  return { minor: Math.max(0, discounted.toNumber()), currency: m.currency };
}

/** Add `percent` to `m`, e.g. an expense line markup. */
export function applyPercentOn(m: Money, percent: Decimalish): Money {
  return {
    minor: round(toBig(m.minor).mul(new Big(1).plus(percentToFraction(percent))), 0).toNumber(),
    currency: m.currency,
  };
}

export function clampNonNegative(m: Money): Money {
  return m.minor < 0 ? zero(m.currency) : m;
}

/** Subtract a fixed amount without going below zero. */
export function subtractClamped(m: Money, amountMinor: number): Money {
  return { minor: Math.max(0, m.minor - amountMinor), currency: m.currency };
}

/**
 * Apportion `totalMinor` across `weights` so the parts sum **exactly** to
 * `totalMinor`. Uses the largest-remainder method, which keeps rounding error
 * to a single minor unit and puts it on the largest fractional parts. This is
 * how a document-level discount is spread across tax codes without disturbing
 * the GST calculation.
 */
export function allocateProRata(totalMinor: number, weights: readonly number[]): number[] {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (totalWeight === 0) {
    // Nothing to weight by: put everything on the first slot so it is never lost.
    const result = new Array<number>(weights.length).fill(0);
    result[0] = totalMinor;
    return result;
  }

  const total = new Big(totalMinor);
  const denom = new Big(totalWeight);
  const exact = weights.map((w) => new Big(w).div(denom).mul(total));
  const floors = exact.map((e) => e.round(0, Big.roundDown));

  let remainder = total.minus(floors.reduce((acc, f) => acc.plus(f), new Big(0)));
  const fractionOrder = exact
    .map((e, i) => ({ i, frac: e.minus(floors[i]) }))
    .sort((a, b) => b.frac.cmp(a.frac) || a.i - b.i);

  const out = floors.map((f) => f.toNumber());
  let idx = 0;
  while (!remainder.eq(0) && fractionOrder.length > 0) {
    const step = remainder.gt(0) ? 1 : -1;
    out[fractionOrder[idx % fractionOrder.length].i] += step;
    remainder = remainder.minus(step);
    idx++;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Comparison                                                          */
/* ------------------------------------------------------------------ */

export function isZero(m: Money): boolean {
  return m.minor === 0;
}
export function isPositive(m: Money): boolean {
  return m.minor > 0;
}
export function isNegative(m: Money): boolean {
  return m.minor < 0;
}
export function equals(a: Money, b: Money): boolean {
  return a.minor === b.minor && a.currency === b.currency;
}
export function maxMoney(a: Money, b: Money): Money {
  return a.minor >= b.minor ? a : b;
}
export function minMoney(a: Money, b: Money): Money {
  return a.minor <= b.minor ? a : b;
}

/* ------------------------------------------------------------------ */
/* Parsing user input                                                  */
/* ------------------------------------------------------------------ */

const NON_NUMERIC = /[^0-9.,\-+]/g;

/**
 * Parse what a person typed into a currency field.
 *
 * Tolerates grouping separators and both decimal marks: "1,234.50", "1.234,50",
 * "1234,5", "1234". A trailing separator mid-typing ("12.") is read as 12
 * because the currency input calls this on every keystroke.
 */
export function parseAmountToMinor(input: string | number, currency: string): number {
  if (typeof input === 'number') return toMinor(input, currency);
  const cleaned = String(input).replace(NON_NUMERIC, '');
  if (!cleaned || cleaned === '-' || cleaned === '+') return 0;

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let normalised = cleaned;

  if (lastDot >= 0 && lastComma >= 0) {
    // Whichever appears last is the decimal mark; the other is grouping.
    if (lastDot > lastComma) normalised = cleaned.replace(/,/g, '');
    else normalised = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastComma >= 0) {
    // A lone comma is grouping when followed by exactly three digits.
    const tail = cleaned.length - lastComma - 1;
    normalised = tail === 3 ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.');
  }

  // More than one separator of the chosen kind: treat all but the last as grouping.
  normalised = normalised.replace(/(\.)(?=[^.]*\.)/g, '');

  if (normalised === '' || normalised === '-' || normalised === '.') return 0;
  try {
    return toMinor(normalised, currency);
  } catch {
    return 0;
  }
}

/** Same as `parseAmountToMinor` but keeps the value if it can't be parsed (live fields). */
export function parseAmountToMinorLoose(input: string, currency: string, fallback: number): number {
  const cleaned = input.replace(NON_NUMERIC, '');
  if (!cleaned || cleaned === '-' || cleaned === '+') return fallback;
  const parsed = parseAmountToMinor(input, currency);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/* ------------------------------------------------------------------ */
/* Display                                                             */
/* ------------------------------------------------------------------ */

export interface FormatOptions {
  /** BCP-47 locale used for grouping and decimal marks. */
  locale?: string;
  /** Prefix with the currency symbol. Default true. */
  symbol?: boolean;
  /** Render negative amounts in accounting brackets: (1,234.50). Default true. */
  accounting?: boolean;
  /** Force a sign on positive values: +1,234.50. */
  showSign?: boolean;
  /** Override the currency code, e.g. to show an AUD equivalent. */
  code?: string;
  /** Placeholder for zero, e.g. "—". */
  dashWhenZero?: boolean;
}

const DEFAULT_LOCALE = 'en-AU';

export function formatMoney(m: Money, opts: FormatOptions = {}): string {
  const {
    locale = DEFAULT_LOCALE,
    symbol = true,
    accounting = true,
    showSign = false,
    code,
    dashWhenZero = false,
  } = opts;

  if (dashWhenZero && m.minor === 0) return '—';

  const currency = getCurrency(code ?? m.currency);
  const value = toMajorNumber(m.minor, m.currency);
  const negative = m.minor < 0;

  let body: string;
  try {
    body = new Intl.NumberFormat(locale, {
      minimumFractionDigits: currency.decimals,
      maximumFractionDigits: currency.decimals,
    }).format(Math.abs(value));
  } catch {
    body = Math.abs(value).toFixed(currency.decimals);
  }

  let out = '';
  if (symbol) out += currency.symbol ? `${currency.symbol}` : `${m.currency} `;
  out += body;

  if (negative) out = accounting ? `(${out})` : `-${out}`;
  else if (showSign) out = `+${out}`;
  return out;
}

/** Bare number, no symbol — for table columns that carry the currency in a header. */
export function formatNumber(m: Money, locale = DEFAULT_LOCALE): string {
  const currency = getCurrency(m.currency);
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: currency.decimals,
      maximumFractionDigits: currency.decimals,
      signDisplay: 'auto',
    }).format(toMajorNumber(m.minor, m.currency));
  } catch {
    return (m.minor / minorUnitFactor(m.currency)).toFixed(currency.decimals);
  }
}

/** "1,234.50" with the currency code appended: used in totals and headings. */
export function formatMoneyWithCode(m: Money, opts: FormatOptions = {}): string {
  return `${formatMoney(m, { ...opts, symbol: false })} ${m.currency}`;
}

/**
 * Convert an amount between currencies using an exact decimal rate.
 *
 * The rate is major-to-major, so the product stays in minor units and is
 * rounded once. Converting $100.00 USD at 1.5 gives $150.00 AUD — not $15,000.
 */
export function convertMoney(m: Money, rate: Decimalish, targetCurrency: string): Money {
  return {
    minor: round(toBig(m.minor).mul(toBig(rate)), 0).toNumber(),
    currency: targetCurrency.toUpperCase(),
  };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: cannot combine ${a.currency} with ${b.currency}`);
  }
}

function assertSameCurrencyForAll(amounts: readonly Money[], currency: string): void {
  for (const m of amounts) {
    if (m.currency !== currency)
      throw new Error(`Currency mismatch: expected ${currency}, got ${m.currency}`);
  }
}
