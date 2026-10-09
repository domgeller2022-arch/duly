/**
 * Money primitives.
 *
 * These are the foundation everything else stands on: if integer minor units
 * and half-away-from-zero rounding are wrong, every total in the app is wrong
 * and none of it is visible until a client pays the wrong amount.
 */

import { describe, expect, it } from 'vitest';
import {
  absolute,
  add,
  allocateProRata,
  applyPercentOff,
  applyPercentOn,
  clampNonNegative,
  convertMoney,
  divide,
  formatMoney,
  formatMoneyWithCode,
  formatNumber,
  isNegative,
  isPositive,
  isZero,
  maxMoney,
  minMoney,
  money,
  multiply,
  negate,
  parseAmountToMinor,
  subtract,
  subtractClamped,
  sum,
  toBig,
  toMajorNumber,
  toMajorString,
  toMinor,
  zero,
} from '@/core/money/money';
import {
  CURRENCIES,
  currencyDecimals,
  getCurrency,
  isKnownCurrency,
  isZeroDecimalCurrency,
} from '@/core/money/currencies';

describe('currency table', () => {
  it('covers the currencies an Australian business meets', () => {
    expect(CURRENCIES.length).toBeGreaterThan(150);
    for (const code of ['AUD', 'NZD', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'SGD', 'CHF', 'HKD']) {
      expect(isKnownCurrency(code)).toBe(true);
    }
  });

  it('has no duplicate codes', () => {
    const codes = CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('gives every currency a name and a sane exponent', () => {
    for (const c of CURRENCIES) {
      expect(c.code).toMatch(/^[A-Z]{3}$/);
      expect(c.name.length).toBeGreaterThan(0);
      expect([0, 2, 3, 4]).toContain(c.decimals);
    }
  });

  it('has the right minor units for the awkward ones', () => {
    expect(currencyDecimals('JPY')).toBe(0);
    expect(currencyDecimals('KRW')).toBe(0);
    expect(currencyDecimals('VND')).toBe(0);
    expect(currencyDecimals('ISK')).toBe(0);
    expect(currencyDecimals('AUD')).toBe(2);
    expect(currencyDecimals('USD')).toBe(2);
    expect(currencyDecimals('EUR')).toBe(2);
    expect(currencyDecimals('KWD')).toBe(3);
    expect(currencyDecimals('BHD')).toBe(3);
    expect(currencyDecimals('IQD')).toBe(3);
    expect(currencyDecimals('OMR')).toBe(3);
    expect(currencyDecimals('TND')).toBe(3);
    expect(currencyDecimals('CLF')).toBe(4);
  });

  it('treats JPY as zero-decimal and KWD as three', () => {
    expect(isZeroDecimalCurrency('JPY')).toBe(true);
    expect(isZeroDecimalCurrency('AUD')).toBe(false);
    expect(isZeroDecimalCurrency('KWD')).toBe(false);
  });

  it('falls back rather than throwing on an unknown code', () => {
    expect(getCurrency('ZZZ').code).toBe('ZZZ');
    expect(getCurrency('ZZZ').decimals).toBe(2);
    expect(isKnownCurrency('ZZZ')).toBe(false);
    expect(() => getCurrency('')).not.toThrow();
  });

  it('is case insensitive on lookup', () => {
    expect(getCurrency('aud').code).toBe('AUD');
    expect(getCurrency('jpy').decimals).toBe(0);
  });
});

describe('minor-unit conversion', () => {
  it('scales by the currency exponent', () => {
    expect(toMinor('1.00', 'AUD')).toBe(100);
    expect(toMinor('1', 'AUD')).toBe(100);
    expect(toMinor('1.005', 'AUD')).toBe(101);
    expect(toMinor('1', 'JPY')).toBe(1);
    expect(toMinor('1.2345', 'KWD')).toBe(1235);
    expect(toMinor('0.0001', 'KWD')).toBe(0);
  });

  it('rounds half away from zero', () => {
    expect(toMinor('1.005', 'AUD')).toBe(101);
    expect(toMinor('1.004', 'AUD')).toBe(100);
    expect(toMinor('-1.005', 'AUD')).toBe(-101);
    expect(toMinor('-1.004', 'AUD')).toBe(-100);
    expect(toMinor('0.005', 'AUD')).toBe(1);
    expect(toMinor('2.675', 'AUD')).toBe(268); // the classic float trap: 267.5 -> 268
  });

  it('converts back to an exact decimal string', () => {
    expect(toMajorString(100, 'AUD')).toBe('1.00');
    expect(toMajorString(1, 'JPY')).toBe('1');
    expect(toMajorString(1234, 'KWD')).toBe('1.234');
    expect(toMajorString(-100, 'AUD')).toBe('-1.00');
    expect(toMajorString(0, 'AUD')).toBe('0.00');
  });

  it('converts to a JS number for charts and APIs', () => {
    expect(toMajorNumber(132000, 'AUD')).toBe(1320);
    expect(toMajorNumber(1234, 'KWD')).toBeCloseTo(1.234, 10);
    expect(toMajorNumber(4500, 'JPY')).toBe(4500);
  });

  it('accepts numbers, strings and Big values', () => {
    expect(toMinor(1.5, 'AUD')).toBe(150);
    expect(toMinor('1.5', 'AUD')).toBe(150);
    expect(toMinor(toBig('1.5'), 'AUD')).toBe(150);
  });
});

describe('arithmetic', () => {
  it('adds and subtracts', () => {
    expect(add(money(100, 'AUD'), money(250, 'AUD')).minor).toBe(350);
    expect(subtract(money(100, 'AUD'), money(250, 'AUD')).minor).toBe(-150);
  });

  it('refuses to mix currencies', () => {
    expect(() => add(money(100, 'AUD'), money(100, 'USD'))).toThrow(/Currency mismatch/);
    expect(() => sum([money(100, 'AUD'), money(100, 'NZD')])).toThrow(/Currency mismatch/);
  });

  it('sums a list, including an empty one', () => {
    expect(sum([money(100, 'AUD'), money(200, 'AUD'), money(300, 'AUD')]).minor).toBe(600);
    expect(sum([], 'AUD').minor).toBe(0);
    expect(sum([]).currency).toBe('AUD');
  });

  it('multiplies by a decimal quantity exactly', () => {
    expect(multiply(money(12000, 'AUD'), '7.25').minor).toBe(87000);
    expect(multiply(money(100, 'AUD'), '0.335').minor).toBe(34); // 33.5 rounds away
    expect(multiply(money(100, 'AUD'), '3').minor).toBe(300);
  });

  it('divides without throwing on zero', () => {
    expect(divide(money(1000, 'AUD'), '4').minor).toBe(250);
    expect(divide(money(1000, 'AUD'), '0').minor).toBe(0);
  });

  it('negates, absolutes and clamps', () => {
    expect(negate(money(100, 'AUD')).minor).toBe(-100);
    expect(negate(negate(money(100, 'AUD'))).minor).toBe(100);
    expect(absolute(money(-100, 'AUD')).minor).toBe(100);
    expect(clampNonNegative(money(-1, 'AUD')).minor).toBe(0);
    expect(subtractClamped(money(100, 'AUD'), 500).minor).toBe(0);
    expect(subtractClamped(money(100, 'AUD'), 40).minor).toBe(60);
  });

  it('treats a percent as a whole percentage', () => {
    expect(applyPercentOff(money(10000, 'AUD'), '10').minor).toBe(9000);
    expect(applyPercentOff(money(10000, 'AUD'), '100').minor).toBe(0);
    // A discount larger than the amount must clamp, not flip the sign.
    expect(applyPercentOff(money(10000, 'AUD'), '150').minor).toBe(0);
    expect(applyPercentOn(money(10000, 'AUD'), '10').minor).toBe(11000);
    expect(applyPercentOn(money(333, 'AUD'), '20').minor).toBe(400); // 399.6 -> 400
  });

  it('compares', () => {
    expect(isZero(zero('AUD'))).toBe(true);
    expect(isPositive(money(1, 'AUD'))).toBe(true);
    expect(isNegative(money(-1, 'AUD'))).toBe(true);
    expect(maxMoney(money(100, 'AUD'), money(200, 'AUD')).minor).toBe(200);
    expect(minMoney(money(100, 'AUD'), money(200, 'AUD')).minor).toBe(100);
  });

  it('converts between currencies once, in the target minor unit', () => {
    expect(convertMoney(money(10000, 'USD'), '1.5', 'AUD').minor).toBe(15000);
    expect(convertMoney(money(10000, 'AUD'), '110', 'JPY').minor).toBe(1100000);
    expect(convertMoney(money(100, 'AUD'), '1.2345', 'KWD').minor).toBe(123); // 123.45 -> 123
  });
});

describe('pro-rata allocation', () => {
  it('always sums back to the total', () => {
    const cases: [number, number[]][] = [
      [100, [1, 1, 1]],
      [100, [1, 1, 1, 1, 1, 1, 1]],
      [1000, [333, 333, 334]],
      [1, [1, 1, 1, 1, 1, 1, 1]],
      [7, [3, 3, 3]],
      [-20000, [100000, 100000]],
      [999999, [1, 2, 3, 7, 11, 13]],
      [5000, [0, 0, 5000]],
    ];
    for (const [total, weights] of cases) {
      const shares = allocateProRata(total, weights);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
      expect(shares).toHaveLength(weights.length);
    }
  });

  it('gives the rounding remainder to the largest fractional part', () => {
    expect(allocateProRata(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateProRata(10, [3, 3, 3])).toEqual([4, 3, 3]);
  });

  it('is deterministic for equal weights', () => {
    expect(allocateProRata(100, [1, 1, 1, 1])).toEqual(allocateProRata(100, [1, 1, 1, 1]));
  });

  it('never loses the total when every weight is zero', () => {
    expect(allocateProRata(500, [0, 0, 0])).toEqual([500, 0, 0]);
    expect(allocateProRata(-500, [0, 0])).toEqual([-500, 0]);
  });

  it('handles an empty weight list', () => {
    expect(allocateProRata(100, [])).toEqual([]);
  });

  it('is the exact negation of the positive allocation', () => {
    const pos = allocateProRata(100, [1, 1, 1]);
    const neg = allocateProRata(-100, [1, 1, 1]);
    expect(neg).toEqual(pos.map((v) => -v));
  });
});

describe('parsing what a person typed', () => {
  it('reads plain and grouped Australian amounts', () => {
    expect(parseAmountToMinor('1', 'AUD')).toBe(100);
    expect(parseAmountToMinor('1.5', 'AUD')).toBe(150);
    expect(parseAmountToMinor('1,234.50', 'AUD')).toBe(123450);
    expect(parseAmountToMinor('1234.5', 'AUD')).toBe(123450);
    expect(parseAmountToMinor('$1,234.50', 'AUD')).toBe(123450);
    expect(parseAmountToMinor('  42  ', 'AUD')).toBe(4200);
  });

  it('reads European grouping', () => {
    expect(parseAmountToMinor('1.234,50', 'AUD')).toBe(123450);
    // A lone dot is the decimal mark in en-AU, so "1.234" means $1.23.
    expect(parseAmountToMinor('1.234', 'AUD')).toBe(123);
    expect(parseAmountToMinor('12,5', 'AUD')).toBe(1250); // 1 trailing digit = decimal
  });

  it('handles a partially typed field', () => {
    expect(parseAmountToMinor('', 'AUD')).toBe(0);
    expect(parseAmountToMinor('.', 'AUD')).toBe(0);
    expect(parseAmountToMinor('-', 'AUD')).toBe(0);
    expect(parseAmountToMinor('12.', 'AUD')).toBe(1200);
    expect(parseAmountToMinor('abc', 'AUD')).toBe(0);
  });

  it('respects the currency exponent', () => {
    expect(parseAmountToMinor('1000', 'JPY')).toBe(1000);
    expect(parseAmountToMinor('1000', 'KWD')).toBe(1000000); // 1000.000 KWD
  });

  it('reads negatives', () => {
    expect(parseAmountToMinor('-50.25', 'AUD')).toBe(-5025);
  });
});

describe('formatting', () => {
  it('formats in the en-AU style by default', () => {
    expect(formatMoney(money(123450, 'AUD'))).toBe('$1,234.50');
    expect(formatMoney(money(5, 'AUD'))).toBe('$0.05');
    expect(formatMoney(money(100000000, 'AUD'))).toBe('$1,000,000.00');
  });

  it('uses accounting brackets for negatives by default', () => {
    expect(formatMoney(money(-123450, 'AUD'))).toBe('($1,234.50)');
    expect(formatMoney(money(-123450, 'AUD'), { accounting: false })).toBe('-$1,234.50');
    expect(formatMoney(money(123450, 'AUD'), { showSign: true })).toBe('+$1,234.50');
  });

  it('honours each currency exponent', () => {
    expect(formatMoney(money(4500, 'JPY'))).toBe('¥4,500');
    expect(formatMoney(money(1, 'JPY'))).toBe('¥1');
    expect(formatMoney(money(1234, 'KWD'), { locale: 'en-AU' })).toBe('د.ك1.234');
  });

  it('can omit the symbol or swap the code in', () => {
    expect(formatMoney(money(1000, 'AUD'), { symbol: false })).toBe('10.00');
    expect(formatMoney(money(1000, 'AUD'), { code: 'NZD' })).toBe('$10.00');
    expect(formatMoneyWithCode(money(1000, 'AUD'))).toBe('10.00 AUD');
  });

  it('can render zero as a dash', () => {
    expect(formatMoney(zero('AUD'), { dashWhenZero: true })).toBe('—');
    expect(formatMoney(zero('AUD'))).toBe('$0.00');
  });

  it('formats a bare number for table columns', () => {
    expect(formatNumber(money(123450, 'AUD'))).toBe('1,234.50');
    expect(formatNumber(money(-5025, 'AUD'))).toBe('-50.25');
  });

  it('survives a locale the runtime does not know', () => {
    expect(() => formatMoney(money(1000, 'AUD'), { locale: 'zz-ZZ-nonsense' })).not.toThrow();
  });
});
