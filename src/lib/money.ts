/**
 * A small money hook.
 *
 * Formatting is a formatting concern, so it lives with the formatter rather than
 * in the components. Money values are always integer minor units — this module
 * never takes a float.
 */

import { useMemo } from 'react';
import { formatMoney, formatNumber, toMajorNumber } from '@/core/money/money';
import { getCurrency } from '@/core/money/currencies';

export interface MoneyFormatter {
  /** "$1,234.50" */
  (minor: number, options?: Parameters<typeof formatMoney>[1]): string;
  /** "1,234.50", no symbol — for a table with a currency header. */
  number: (minor: number) => string;
  /** "1,234.50 USD" */
  withCode: (minor: number) => string;
  /** A compact form for dashboard tiles. */
  compact: (minor: number) => string;
  /** The currency's minor-unit exponent. */
  decimals: number;
  symbol: string;
  /** Major-unit value, for charts. */
  major: (minor: number) => number;
}

export function useMoney(currency: string): MoneyFormatter {
  return useMemo(() => {
    const meta = getCurrency(currency);

    const format = ((minor: number, options?: Parameters<typeof formatMoney>[1]) =>
      formatMoney({ minor, currency }, options)) as MoneyFormatter;

    format.number = (minor: number) => formatNumber({ minor, currency });
    format.withCode = (minor: number) => `${formatNumber({ minor, currency })} ${currency}`;
    format.decimals = meta.decimals;
    format.symbol = meta.symbol || currency;
    format.major = (minor: number) => toMajorNumber(minor, currency);

    format.compact = (minor: number) => {
      const value = toMajorNumber(minor, currency);
      const abs = Math.abs(value);
      const sign = value < 0 ? '-' : '';
      if (abs >= 1_000_000)
        return `${sign}${format.symbol}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
      if (abs >= 1000) return `${sign}${format.symbol}${(abs / 1000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
      return formatMoney({ minor, currency });
    };

    return format;
  }, [currency]);
}
