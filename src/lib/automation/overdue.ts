/**
 * Overdue flagging and quote expiry.
 *
 * An invoice is marked overdue the day *after* its due date, not on the date
 * itself — a client paying on the due date is not late. Overdue is stored on the
 * document so the list can filter on it, but it is always recomputed, never
 * trusted: a document whose due date moves stops being overdue immediately.
 */

import type { Document } from '@/core/schemas/document';
import { storage } from '@/adapters';
import { deriveDocumentStatus, isOpenDocument } from '@/core/documents';
import { daysOverdue, isAfter, isQuoteExpired } from '@/core/validation/dates';

export interface OverdueOutcome {
  flagged: Document[];
  cleared: Document[];
  daysOverdue: number;
}

/**
 * Recompute the overdue flag for every outstanding invoice.
 *
 * `today` is passed in, so the whole thing is deterministic and testable.
 */
export async function runOverdueFlagging(today: string): Promise<OverdueOutcome> {
  const db = storage();
  const documents = await db.listDocuments();
  const flagged: Document[] = [];
  const cleared: Document[] = [];
  let maxDaysOverdue = 0;

  for (const doc of documents) {
    // Quotes have their own expiry rule; only invoices and their credit notes go
    // through this path.
    if (doc.type !== 'invoice' && doc.type !== 'proforma') continue;
    if (!isOpenDocument(doc)) continue;

    const outstanding = doc.totals.balance;

    // A fully paid invoice is never overdue, however old its due date is — and a
    // settled invoice is `paid` whatever it used to be.
    if (outstanding <= 0) {
      if (doc.status !== 'paid') {
        const paid: Document = { ...doc, status: 'paid' };
        await db.saveDocument(paid);
        cleared.push(paid);
      }
      continue;
    }

    if (!doc.dueDate) continue;

    const days = daysOverdue(doc.dueDate, today);
    const shouldBeOverdue = isAfter(today, doc.dueDate);

    if (shouldBeOverdue && doc.status !== 'overdue') {
      await db.saveDocument({ ...doc, status: 'overdue' });
      flagged.push({ ...doc, status: 'overdue' });
      maxDaysOverdue = Math.max(maxDaysOverdue, days);
    } else if (!shouldBeOverdue && doc.status === 'overdue') {
      // The due date moved or a payment brought it current. `deriveDocumentStatus`
      // decides what it is now — `partially_paid` if money has come in, otherwise
      // the state it was issued in. Writing `sent` here claimed an invoice had been
      // emailed when nothing had sent it.
      const restored: Document = {
        ...doc,
        status: deriveDocumentStatus({ document: doc, balance: outstanding, today }),
      };
      await db.saveDocument(restored);
      cleared.push(restored);
    }
  }

  return { flagged, cleared, daysOverdue: maxDaysOverdue };
}

export interface QuoteExpiryOutcome {
  expired: Document[];
}

/** Mark quotes past their validity date, and say so in the automation log. */
export async function runQuoteExpiry(today: string): Promise<QuoteExpiryOutcome> {
  const db = storage();
  const documents = await db.listDocuments({ type: 'quote' });
  const expired: Document[] = [];

  for (const doc of documents) {
    if (doc.status === 'void' || doc.status === 'accepted' || doc.status === 'declined') continue;
    if (doc.status === 'draft' || doc.status === 'expired') continue;
    if (!doc.quoteValidUntil) continue;
    if (!isQuoteExpired(doc.quoteValidUntil, today)) continue;

    await db.saveDocument({ ...doc, status: 'expired' });
    expired.push({ ...doc, status: 'expired' });
  }

  return { expired };
}

/** Bucket an invoice into the aged receivables report. */
export type AgeBucket = 'current' | '1-30' | '31-60' | '61-90' | '90+';

/**
 * Which bucket an outstanding balance falls in.
 *
 * Buckets are by days past the due date, which is how an accountant reads an aged
 * receivables report: "current" means not yet due, and the buckets after that are
 * how far past due.
 */
export function ageBucket(dueDate: string | null, today: string): AgeBucket {
  if (!dueDate) return 'current';
  const days = daysOverdue(dueDate, today);
  if (days === 0) return 'current';
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

export const AGE_BUCKETS: readonly { key: AgeBucket; label: string }[] = [
  { key: 'current', label: 'Not yet due' },
  { key: '1-30', label: '1–30 days' },
  { key: '31-60', label: '31–60 days' },
  { key: '61-90', label: '61–90 days' },
  { key: '90+', label: '90 days and over' },
];
