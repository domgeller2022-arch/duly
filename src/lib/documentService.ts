/**
 * The one place a document is recalculated and saved.
 *
 * Root cause behind a dozen findings (both audits): `calculate()` was called
 * from about a dozen places, each passing a different subset of tax codes,
 * payments and rounding method, and each forgetting a different one — so the
 * stored `totals.paid`/`balance`/`status` went stale, and issued documents
 * silently changed when a tax code was edited.
 *
 * The contract:
 *  - lines and payments come from the caller when it holds fresher state
 *    (the editor), otherwise from storage;
 *  - an issued document calculates on its frozen snapshot codes, so editing
 *    the live table cannot rewrite history; a draft uses the live table;
 *  - the rounding method comes from the settings, not from a default;
 *  - totals and status are applied and saved together, or the caller says
 *    not to save.
 */

import { applyTotals, calculate, type CalculationResult } from '@/core/calc/calculate';
import { deriveDocumentStatus } from '@/core/documents';
import type { Document, DocumentLine, Payment } from '@/core/schemas';
import type { TaxCode } from '@/core/tax/tax';
import { todayIn } from '@/core/validation/dates';
import { storage } from '@/adapters';

/**
 * The codes a document calculates on.
 *
 * An issued document carries a frozen copy of every tax code it used, taken
 * at finalise. Recalculating it — recording a payment, a bulk action, a
 * re-file — must use that copy: deactivating or re-rating GST in settings
 * must not reach into an invoice a client already has.
 */
export function taxCodesFor(document: Document, liveCodes: TaxCode[]): TaxCode[] {
  if (document.status === 'draft' || document.status === 'void' || !document.taxSnapshot) {
    return liveCodes;
  }
  const frozen = Object.entries(document.taxSnapshot.codes).map(([id, code]) => ({
    id,
    name: code.name,
    rate: code.rate,
    type: code.type as TaxCode['type'],
    compound: code.type === 'compound',
    label: code.label,
    includeInBreakdown: true,
    displayOrder: 0,
    active: true,
    builtin: true,
  }));
  // Codes the snapshot never froze (a line added after finalising cannot
  // happen, but a code deleted and re-added can) fall back to the live table.
  return frozen.length > 0 ? frozen : liveCodes;
}

export interface RecalculateArgs {
  document: Document;
  /** Editor state wins; storage is the fallback. */
  lines?: DocumentLine[];
  payments?: Payment[];
  /** Live codes for drafts; the snapshot wins for issued documents anyway. */
  taxCodes?: TaxCode[];
  /** Applied before calculating — a status change, a due-date move. */
  documentPatch?: Partial<Document>;
  /** Status follows the fresh balance unless the caller says otherwise. */
  deriveStatus?: boolean;
  /** Default true. A caller that only needs the numbers can skip the write. */
  save?: boolean;
  today?: string;
}

export async function recalculateDocument(args: RecalculateArgs): Promise<{
  document: Document;
  result: CalculationResult;
  lines: DocumentLine[];
  payments: Payment[];
}> {
  const db = storage();
  const document: Document = args.documentPatch
    ? { ...args.document, ...args.documentPatch }
    : args.document;

  const [lines, payments, liveCodes, settings] = await Promise.all([
    args.lines ?? db.listDocumentLines(document.id),
    args.payments ?? db.listPayments(),
    args.taxCodes ?? db.listTaxCodes(),
    db.getSettings(),
  ]);
  const documentPayments = payments.filter((p) => p.documentId === document.id);

  // Credit notes already issued against this document reduce its balance,
  // and the reduction must survive every later recalculation — the engine
  // derives the balance, so it needs the figure.
  const creditNotes = document.type === 'credit_note' ? [] : await db.listDocuments({ type: 'credit_note' });
  const linkedCreditMinor = creditNotes
    .filter(
      (note) =>
        note.status !== 'draft' &&
        note.status !== 'void' &&
        note.linkedDocumentIds.includes(document.id),
    )
    .reduce((sum, note) => sum + Math.abs(note.totals.total), 0);

  const result = calculate({
    document,
    lines,
    payments: documentPayments,
    taxCodes: taxCodesFor(document, liveCodes),
    roundingMethod: settings?.roundingMethod,
    linkedCreditMinor,
    // The informational AUD equivalent is part of the stored totals, so the
    // service must carry the document's rate — omitting it stored `null` and
    // made a foreign-currency document disagree with itself.
    rateToAud: document.exchangeRateToAud,
  });

  let next: Document = applyTotals({ ...document }, result);
  if (args.deriveStatus !== false) {
    // The business time zone's date, not UTC: a status derived at 9am in Sydney
    // from a UTC date is still yesterday's.
    const today = args.today ?? todayIn(settings?.timeZone ?? 'Australia/Sydney');
    next = {
      ...next,
      status: deriveDocumentStatus({ document: next, balance: result.balance, today }),
    };
  }

  if (args.save !== false) await db.saveDocument(next, lines);

  return { document: next, result, lines, payments: documentPayments };
}
