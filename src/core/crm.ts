/**
 * Client figures.
 *
 * "Lifetime billed, outstanding, average days to pay" — the three numbers the plan
 * asks for on a client. They were declared on the clients list and never computed,
 * and the client detail screen needs them too, so they live here once rather than
 * twice.
 *
 * Pure over documents and payments: no store, no clock, no database. `today` is a
 * parameter.
 */

import type { Client, Contact, Document, Payment } from './schemas';

export interface ClientStats {
  /** Everything ever invoiced to them, excluding void and draft. */
  lifetimeBilled: number;
  /** What they still owe. */
  outstanding: number;
  /** Paid to date, against issued invoices. */
  paidToDate: number;
  invoiceCount: number;
  quoteCount: number;
  creditNoteCount: number;
  /** Date of their most recent invoice, or null. */
  lastInvoicedAt: string | null;
  /**
   * Average days from issue to payment, over settled invoices only.
   *
   * Null when nothing has been paid yet. Measured to the *last* payment on the
   * invoice rather than the first, because an invoice paid in two instalments was
   * settled on the later date.
   */
  averageDaysToPay: number | null;
  /** Count of settled invoices the average is based on. */
  settledCount: number;
  /** Issued invoices still carrying a balance. */
  overdueCount: number;
}

/** Document statuses that mean the document counts as issued. */
const ISSUED = new Set(['finalised', 'sent', 'partially_paid', 'paid', 'overdue']);

/**
 * Figures for one client, from the documents and payments already loaded.
 *
 * Only the given profile is counted, so a second business's invoices never inflate
 * the first's totals. Credit notes subtract, because a credit note is money back.
 */
export function clientStats(args: {
  clientId: string;
  documents: readonly Document[];
  payments: readonly Payment[];
  profileId?: string | null;
  today?: string;
}): ClientStats {
  const { clientId, documents, payments, profileId } = args;

  const stats: ClientStats = {
    lifetimeBilled: 0,
    outstanding: 0,
    paidToDate: 0,
    invoiceCount: 0,
    quoteCount: 0,
    creditNoteCount: 0,
    lastInvoicedAt: null,
    averageDaysToPay: null,
    settledCount: 0,
    overdueCount: 0,
  };

  const issued = documents.filter(
    (doc) =>
      doc.clientId === clientId &&
      !doc.deletedAt &&
      doc.status !== 'void' &&
      doc.status !== 'declined' &&
      doc.status !== 'expired' &&
      (!profileId || doc.profileId === profileId),
  );

  const paymentDates = new Map<string, string[]>();
  for (const payment of payments) {
    const dates = paymentDates.get(payment.documentId);
    if (dates) dates.push(payment.date);
    else paymentDates.set(payment.documentId, [payment.date]);
  }

  let daysTotal = 0;

  for (const doc of issued) {
    switch (doc.type) {
      case 'invoice':
      case 'proforma':
        stats.invoiceCount += 1;
        break;
      case 'quote':
        stats.quoteCount += 1;
        break;
      case 'credit_note':
        stats.creditNoteCount += 1;
        break;
      default:
        break;
    }

    // A draft has not been billed for, so it contributes nothing.
    if (doc.status === 'draft') continue;

    // A credit note carries negative totals already, so it subtracts on its own.
    stats.lifetimeBilled += doc.totals.total;
    stats.paidToDate += doc.totals.paid;

    if (doc.totals.balance > 0) {
      stats.outstanding += doc.totals.balance;
      if (args.today && doc.dueDate && doc.dueDate < args.today) stats.overdueCount += 1;
    }

    if (!stats.lastInvoicedAt || doc.issueDate > stats.lastInvoicedAt) {
      stats.lastInvoicedAt = doc.issueDate;
    }

    // Only a settled invoice can tell us how long they take to pay.
    if (doc.type !== 'invoice' || doc.totals.balance > 0 || !ISSUED.has(doc.status)) continue;

    const dates = paymentDates.get(doc.id);
    if (!dates || dates.length === 0) continue;

    const lastPayment = dates.reduce((latest, d) => (d > latest ? d : latest), dates[0]);
    const days = Math.round((Date.parse(lastPayment) - Date.parse(doc.issueDate)) / 86_400_000);
    if (Number.isFinite(days) && days >= 0) {
      daysTotal += days;
      stats.settledCount += 1;
    }
  }

  if (stats.settledCount > 0) stats.averageDaysToPay = Math.round(daysTotal / stats.settledCount);

  return stats;
}

/** Figures for every client at once, for the list screen. */
export function clientStatsById(args: {
  documents: readonly Document[];
  payments: readonly Payment[];
  profileId?: string | null;
  today?: string;
}): Map<string, ClientStats> {
  const out = new Map<string, ClientStats>();
  for (const doc of args.documents) {
    if (!doc.clientId) continue;
    if (!out.has(doc.clientId)) {
      out.set(doc.clientId, clientStats({ ...args, clientId: doc.clientId }));
    }
  }
  return out;
}

/** Days to pay, phrased for a table cell. */
export function daysToPayLabel(days: number | null): string {
  if (days === null) return '—';
  if (days === 0) return 'Same day';
  return `${days} day${days === 1 ? '' : 's'}`;
}

/**
 * The primary contact for a client.
 *
 * The explicit `invoiceContactId` wins; otherwise the primary contact who receives
 * invoices; otherwise the first one who does. Anything less would send an invoice
 * to nobody when a client has contacts but has not marked one as primary.
 */
export function primaryContact(client: Client, contacts: readonly Contact[]): Contact | null {
  const theirs = contacts.filter((c) => c.clientId === client.id);

  if (client.invoiceContactId) {
    const chosen = theirs.find((c) => c.id === client.invoiceContactId);
    if (chosen) return chosen;
  }

  return (
    theirs.find((c) => c.isPrimary && c.receivesInvoices) ??
    theirs.find((c) => c.receivesInvoices) ??
    theirs.find((c) => c.isPrimary) ??
    null
  );
}

/** Every address a client can invoice to, in the order the plan lists them. */
export function clientAddresses(client: Client): { label: string; lines: string[] }[] {
  const out: { label: string; lines: string[] }[] = [];

  const lines = (a: typeof client.billingAddress | null): string[] =>
    a ? [a.line1, a.line2, a.city, a.state, a.postcode, a.country].filter((part) => part.trim()) : [];

  out.push({ label: 'Billing', lines: lines(client.billingAddress) });
  if (client.shippingAddress) {
    out.push({ label: 'Shipping', lines: lines(client.shippingAddress) });
  }

  return out.filter((entry) => entry.lines.length > 0);
}
