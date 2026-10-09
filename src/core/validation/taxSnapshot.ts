/**
 * The tax snapshot.
 *
 * Frozen at finalise so a finalised document can never be changed by what the
 * business does afterwards: switching GST registration off next month must not
 * retroactively remove GST from an invoice that was correctly issued in June.
 *
 * The snapshot holds the GST status, the printed heading, and a copy of every tax
 * code the document used — because a credit note against that invoice has to
 * reverse exactly those rates, not today's.
 */

import type { Document, DocumentType } from '@/core/schemas/document';
import type { TaxSnapshot } from '@/core/schemas/document';
import type { TaxCode } from '@/core/tax/tax';
import { headingFor } from '@/core/engines/numbering';
import { canUseInclusiveGstStatement, GST_RATE } from '../tax/tax';
import { financialYearKey } from './dates';
import type { CalculationResult } from '../calc/calculate';

/** The heading a document prints, given the business's GST status. */
export function taxTypeSnapshot(
  gstRegistered: boolean,
  type: DocumentType,
): { heading: string; gstRegistered: boolean } {
  return { heading: headingFor(gstRegistered, type), gstRegistered };
}

/**
 * Copy the tax codes a document used into the snapshot.
 *
 * Only the codes actually used, so the snapshot stays small and a rename in
 * Settings cannot change what was charged.
 */
export function buildSnapshotCodes(result: CalculationResult, taxCodes: TaxCode[]): TaxSnapshot['codes'] {
  const codes: TaxSnapshot['codes'] = {};

  for (const group of result.taxGroups) {
    const source = taxCodes.find((c) => c.id === group.taxCodeId);
    if (!source) continue;
    codes[group.taxCodeId] = {
      name: source.name,
      rate: source.rate,
      type: source.type,
      label: source.label,
    };
  }

  return codes;
}

/**
 * Build the whole snapshot for a document about to be finalised.
 *
 * `inclusiveGstStatementAllowed` is the ATO's narrow permission: a tax invoice
 * under $1,000 may say "Total price includes GST" instead of itemising the amount,
 * but only when the rate is exactly one eleventh. Anything else must be shown as
 * an amount, so the flag follows the rate rather than the pricing mode.
 */
export function buildTaxSnapshot(args: {
  document: Document;
  gstRegistered: boolean;
  result: CalculationResult;
  taxCodes: TaxCode[];
  now: string;
  financialYearStartMonth?: number;
}): TaxSnapshot {
  const { document, gstRegistered, result, taxCodes, now } = args;
  const codes = buildSnapshotCodes(result, taxCodes);

  // The rate that actually applies: the GST code's, or the default.
  const gstRate = codes['tax_gst']?.rate ?? GST_RATE;

  return {
    gstRegistered,
    heading: headingFor(gstRegistered, document.type),
    codes,
    inclusiveGstStatementAllowed: document.taxMode === 'inclusive' && canUseInclusiveGstStatement(gstRate),
    buyerIdentityRequired: gstRegistered,
    takenAt: now,
    financialYear: financialYearKey(document.issueDate, args.financialYearStartMonth ?? 7),
  };
}

/**
 * The heading a document prints.
 *
 * The snapshot wins when there is one, because a finalised document keeps the
 * heading it was issued with. Only a draft follows the live business setting.
 */
export function headingForDocument(document: Document, gstRegistered: boolean): string {
  return document.taxSnapshot?.heading ?? headingFor(gstRegistered, document.type);
}

/** Was GST charged on this document, at the time it was issued? */
export function wasGstCharged(document: Document): boolean {
  if (!document.taxSnapshot) return false;
  const rate = document.taxSnapshot.codes['tax_gst']?.rate ?? '0';
  return Number(rate) > 0;
}

/**
 * The GST rate a document was issued at, for a credit note to reverse.
 * Falls back to the current GST rate for a document with no snapshot, which is
 * correct for anything never issued.
 */
export function snapshotGstRate(document: Document): string {
  return document.taxSnapshot?.codes['tax_gst']?.rate ?? GST_RATE;
}

/** Whether the "Total price includes GST" statement is legal on this document. */
export function mayUseInclusiveStatement(document: Document): boolean {
  if (!document.taxSnapshot) return false;
  return (
    document.taxSnapshot.inclusiveGstStatementAllowed &&
    canUseInclusiveGstStatement(snapshotGstRate(document))
  );
}
