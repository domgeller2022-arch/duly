/**
 * Late payment fees.
 *
 * Off by default. Adding money to someone's invoice without being asked is not
 * something an invoicing app should do quietly, so a policy has to be switched on
 * deliberately, and every fee it applies is logged and flagged for attention.
 *
 * A fee is never applied twice to the same invoice: the invoice carries a
 * `lateFeeApplied` flag, which is checked before anything is written.
 */

import type { Document, DocumentLine } from '@/core/schemas/document';
import { documentLineSchema, documentSchema } from '@/core/schemas/document';
import { newEntity } from '@/core/schemas/common';
import { storage } from '@/adapters';
import { calculate } from '@/core/calc/calculate';
import { daysOverdue } from '@/core/validation/dates';
import { percentToFraction } from '@/core/money/money';

export interface LateFeeOutcome {
  documentId: string;
  profileId: string;
  message: string;
  detail: string;
  amount: number;
}

/**
 * Apply late fees where a policy allows it.
 *
 * A policy applies only to documents that are unpaid, past the policy's grace
 * period, and not already carrying a fee.
 */
export async function runLateFeeEngine(today: string): Promise<LateFeeOutcome[]> {
  const db = storage();
  const policies = (await db.listLateFeePolicies()).filter((p) => p.enabled && !p.deletedAt);
  if (policies.length === 0) return [];

  const taxCodes = await db.listTaxCodes();
  const documents = await db.listDocuments();
  const applied: LateFeeOutcome[] = [];

  for (const policy of policies) {
    for (const doc of documents) {
      if (doc.type !== 'invoice') continue;
      if (!['finalised', 'sent', 'overdue', 'partially_paid'].includes(doc.status)) continue;
      if (doc.totals.balance <= 0) continue;
      if (doc.lateFeeApplied) continue;
      if (!doc.dueDate) continue;

      const lateBy = daysOverdue(doc.dueDate, today);
      if (lateBy <= policy.daysAfterDue) continue;

      const lines = await db.listDocumentLines(doc.id);
      const outstanding = doc.totals.balance;

      const fee = computeFeeAmount(policy.kind, policy.value, outstanding, policy.capMinor);
      if (fee <= 0) continue;

      if (policy.applyAs === 'invoice') {
        applied.push(await createFeeInvoice(doc, lines, policy, fee, taxCodes, lateBy));
        continue;
      }

      const next = [...lines, buildFeeLine(doc, policy, fee)];
      const recalculated = calculate({ document: doc, lines: next, taxCodes });

      await db.saveDocument({
        ...doc,
        lines: undefined as never,
        totals: { ...doc.totals, ...toTotals(recalculated) },
        lateFeeApplied: true,
      } as Document);
      // Rewrite the whole line set so the new fee line is persisted with it.
      await db.saveDocument(
        { ...doc, lateFeeApplied: true, totals: { ...doc.totals, ...toTotals(recalculated) } },
        next,
      );

      applied.push({
        documentId: doc.id,
        profileId: doc.profileId,
        message: `Added a late payment fee of ${fee} minor units to ${doc.number || doc.draftNumber}.`,
        detail: `${policy.name}: ${lateBy} days past due, ${policy.daysAfterDue}-day grace period exceeded.`,
        amount: fee,
      });
    }
  }

  return applied;
}

/** The fee amount in minor units, capped if the policy caps it. */
export function computeFeeAmount(
  kind: 'percent' | 'fixed',
  value: string,
  outstanding: number,
  capMinor: number,
): number {
  const base = Math.max(0, outstanding);
  let fee: number;

  if (kind === 'percent') {
    fee = Math.round(base * Number(percentToFraction(value).toString()));
  } else {
    fee = Math.max(0, Math.round(Number(value) || 0));
  }

  if (capMinor > 0) fee = Math.min(fee, capMinor);
  return fee;
}

function buildFeeLine(
  doc: Document,
  policy: import('@/core/schemas/automation').LateFeePolicy,
  amount: number,
): DocumentLine {
  return documentLineSchema.parse(
    newEntity({
      documentId: doc.id,
      position: 9999,
      type: 'item',
      description: policy.description,
      quantity: '1',
      unit: 'each',
      unitPrice: amount,
      taxCodeId: policy.taxCodeId ?? doc.taxCodeId,
    }),
  );
}

async function createFeeInvoice(
  source: Document,
  sourceLines: DocumentLine[],
  policy: import('@/core/schemas/automation').LateFeePolicy,
  amount: number,
  taxCodes: Awaited<ReturnType<ReturnType<typeof storage>['listTaxCodes']>>,
  lateBy: number,
): Promise<LateFeeOutcome> {
  const db = storage();
  const documentId = newEntity({}).id;
  const lines = [
    ...sourceLines.map((line, index) => ({ ...line, id: newEntity({}).id, documentId, position: index })),
    buildFeeLine({ ...source, id: documentId }, policy, amount),
  ];

  const invoice = documentSchema.parse(
    newEntity({
      id: documentId,
      profileId: source.profileId,
      clientId: source.clientId,
      type: 'invoice',
      issueDate: source.issueDate,
      dueDate: source.dueDate,
      termsId: source.termsId,
      currency: source.currency,
      taxCodeId: source.taxCodeId,
      designTemplateId: source.designTemplateId,
      notes: `Late payment fee for ${source.number}.`,
      reference: source.number,
      tags: ['late-fee'],
      linkedDocumentIds: [source.id],
    }),
  );

  const recalculated = calculate({ document: invoice, lines, taxCodes });
  await db.saveDocument({ ...invoice, totals: { ...invoice.totals, ...toTotals(recalculated) } }, lines);
  await db.saveDocument({ ...source, lateFeeApplied: true });

  return {
    documentId: invoice.id,
    profileId: source.profileId,
    message: `Created a separate late-fee invoice for ${source.number}.`,
    detail: `${policy.name}: ${lateBy} days past due. Amount ${amount} minor units.`,
    amount,
  };
}

function toTotals(result: ReturnType<typeof calculate>) {
  return {
    subtotal: result.subtotal,
    discount: result.discount,
    tax: result.tax,
    total: result.total,
    paid: result.paid,
    balance: result.balance,
    creditApplied: result.creditApplied,
    currency: result.currency,
    audEquivalent: result.audEquivalent,
    gstPayable: result.gstPayable,
  };
}
