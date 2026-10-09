/**
 * Tax codes and the ATO rounding rules.
 *
 * Australian GST is modelled the way the ATO describes it: GST 10% is the
 * default, and a sale can be taxable, GST-free, input-taxed or export (all
 * zero-rated but each a different label that has to appear on the document).
 * Custom rates and compound tax exist for overseas clients.
 */

import Big from 'big.js';
import type { Decimalish } from '../money/money';
import { round, toBig } from '../money/money';

export type TaxCodeType = 'gst' | 'gst_free' | 'input_taxed' | 'export' | 'custom' | 'compound' | 'zero';

/** Whether a code with this type generates tax on the sale. */
export const TAXABLE_TYPES: readonly TaxCodeType[] = ['gst', 'custom', 'compound'];

/** Zero-rated codes still need their own printed label and a marker. */
export const ZERO_RATED_TYPES: readonly TaxCodeType[] = ['gst_free', 'input_taxed', 'export', 'zero'];

export interface TaxCode {
  id: string;
  name: string;
  /** Decimal rate as a string: "0.10" for 10%. Zero-rated codes use "0". */
  rate: string;
  type: TaxCodeType;
  /** Compound codes are calculated on the already-taxed amount. */
  compound: boolean;
  /** Printed on the document as a marker (e.g. an asterisk) beside the line. */
  label: string | null;
  /** Shown in the "GST breakdown" table as a separate row. */
  includeInBreakdown: boolean;
  displayOrder: number;
  active: boolean;
  /** Built-in codes cannot be deleted, only renamed/deactivated. */
  builtin: boolean;
  /** Jurisdiction hint shown in the editor. */
  jurisdiction?: string;
}

export type RoundingMethod = 'total_invoice' | 'taxable_sale';

export interface RoundingMethodInfo {
  id: RoundingMethod;
  name: string;
  description: string;
}

export const ROUNDING_METHODS: readonly RoundingMethodInfo[] = [
  {
    id: 'total_invoice',
    name: 'Total invoice rule',
    description:
      'Add up the GST for each tax code on the invoice, then round that total once to the nearest cent (0.5 up). The ATO default.',
  },
  {
    id: 'taxable_sale',
    name: 'Taxable sale rule',
    description:
      'Round the GST on each individual taxable sale to the nearest cent, then add the rounded amounts.',
  },
];

/** Australian Goods and Services Tax rate. */
export const GST_RATE = '0.10';

const seed = (
  id: string,
  name: string,
  rate: string,
  type: TaxCodeType,
  label: string | null,
  displayOrder: number,
  jurisdiction?: string,
): TaxCode => ({
  id,
  name,
  rate,
  type,
  compound: type === 'compound',
  label,
  includeInBreakdown: true,
  displayOrder,
  active: true,
  builtin: true,
  jurisdiction,
});

/** Seed tax codes — Australian defaults plus a compound code for overseas work. */
export const DEFAULT_TAX_CODES: readonly TaxCode[] = [
  seed('tax_gst', 'GST', GST_RATE, 'gst', null, 10, 'AU'),
  seed('tax_gst_free', 'GST-free', '0', 'gst_free', 'GST-free', 20, 'AU'),
  seed('tax_input_taxed', 'Input taxed', '0', 'input_taxed', 'Input taxed', 30, 'AU'),
  seed('tax_export', 'Export (zero rated)', '0', 'export', 'Export', 40, 'AU'),
  seed('tax_zero', 'No tax', '0', 'zero', null, 50),
  seed('tax_compound', 'Compound tax (net)', '0.075', 'compound', null, 60, 'Overseas'),
];

export function getTaxCode(codes: readonly TaxCode[], id: string | null | undefined): TaxCode {
  if (!id) return DEFAULT_TAX_CODES[0];
  return codes.find((c) => c.id === id) ?? DEFAULT_TAX_CODES[0];
}

export function isTaxable(code: TaxCode): boolean {
  return code.active && TAXABLE_TYPES.includes(code.type);
}

export function rateOf(code: TaxCode): Big {
  return toBig(code.rate);
}

export function formatRate(rate: Decimalish): string {
  const b = toBig(rate).mul(100);
  const dp = b.eq(b.round(0)) ? 0 : 2;
  return `${b.toFixed(dp)}%`;
}

/**
 * GST on a single amount.
 *
 * Exclusive pricing: the listed price is net, so tax = price x rate.
 * Inclusive pricing: the listed price already contains GST, so
 * tax = price x rate / (1 + rate). At 10% that is exactly price / 11.
 */
export function taxOnAmount(
  amountMinor: number,
  code: TaxCode,
  mode: 'exclusive' | 'inclusive',
): { tax: Big; net: Big } {
  if (!isTaxable(code)) {
    const gross = new Big(amountMinor);
    return { tax: new Big(0), net: gross };
  }

  const rate = rateOf(code);
  if (mode === 'exclusive') {
    return { tax: new Big(amountMinor).mul(rate), net: new Big(amountMinor) };
  }

  const divisor = new Big(1).plus(rate);
  const tax = new Big(amountMinor).mul(rate).div(divisor);
  return { tax, net: new Big(amountMinor).minus(tax) };
}

/**
 * Round a tax amount to a whole minor unit, half away from zero.
 *
 * The caller decides *when* to round — that choice is the rounding method —
 * but the result is always an integer count of minor units, never a fraction of
 * a cent.
 */
export function roundTax(taxRaw: Big): number {
  return round(taxRaw, 0).toNumber();
}

/** GST as an exact fraction of a gross amount, for the "includes GST" statement. */
export function gstShareOf(gross: Decimalish): Big {
  return toBig(gross).div(new Big(11));
}

/**
 * The ATO allows a tax invoice under $1,000 to say "Total price includes GST"
 * instead of itemising GST, but only when GST is exactly one eleventh of the
 * total (rate = 0.10). Any other rate must be shown as an amount.
 */
export function canUseInclusiveGstStatement(rate: Decimalish): boolean {
  return toBig(rate).eq(toBig(GST_RATE));
}

export const INCLUSIVE_GST_STATEMENT = 'Total price includes GST';
export const NO_GST_STATEMENT = 'No GST has been charged';
