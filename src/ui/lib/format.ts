/**
 * Display formatting for the app interface.
 *
 * Two rules hold throughout:
 *
 *  1. Money is never assembled by hand. It always goes through `formatMoney`, so
 *     a negative is shown in accounting brackets and a JPY amount has no decimals
 *     because the currency says so, not because someone remembered.
 *  2. A date is never assembled by hand either. Stored as `YYYY-MM-DD`, printed in
 *     the user's chosen format, so an Australian business sees 06/10/2026 and the
 *     stored value never moves.
 */

import type { Document, DocumentStatus, Settings } from '@/core/schemas';
import { formatMoney, formatNumber, toMajorNumber } from '@/core/money/money';
import type { Money } from '@/core/money/money';
import { formatDate, relativeDays } from '@/core/validation/dates';
import { type Tone } from '@/ui/components/base';

export function money(minor: number, currency: string, options?: Parameters<typeof formatMoney>[1]): string {
  return formatMoney({ minor, currency }, options);
}

export function moneyNumber(minor: number, currency: string): string {
  return formatNumber({ minor, currency });
}

/** "1,320.00 AUD" — for totals that need the currency spelled out. */
export function moneyWithCode(minor: number, currency: string): string {
  return `${formatNumber({ minor, currency })} ${currency}`;
}

/** Compact form for dashboard tiles: $1.3k, $1.2M. */
export function compactMoney(minor: number, currency: string, symbol: string): string {
  const value = toMajorNumber(minor, currency);
  const abs = Math.abs(value);
  if (abs >= 1_000_000)
    return `${value < 0 ? '-' : ''}${symbol}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1000) return `${value < 0 ? '-' : ''}${symbol}${(abs / 1000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return formatMoney({ minor, currency });
}

export function date(iso: string | null | undefined, settings: Settings | null): string {
  if (!iso) return '—';
  return formatDate(iso, settings?.dateFormat ?? 'DMY');
}

export function dateLong(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return `${Number(d)} ${months[Number(m) - 1]} ${y}`;
}

export function relative(iso: string | null | undefined, today: string): string {
  if (!iso) return '';
  return relativeDays(today, iso);
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

export interface StatusDescriptor {
  label: string;
  tone: Tone;
  /** A short description for a tooltip. */
  hint?: string;
}

/**
 * Status labels and colours.
 *
 * Status colours are used sparingly, as the design asks: green paid, amber due
 * soon, red overdue, and quiet grey for everything administrative.
 */
export const STATUS_DESCRIPTORS: Record<DocumentStatus, StatusDescriptor> = {
  draft: { label: 'Draft', tone: 'muted', hint: 'Not yet submitted, so the number is a placeholder' },
  finalised: { label: 'Final', tone: 'accent', hint: 'Submitted and locked, but not yet sent' },
  sent: { label: 'Sent', tone: 'accent', hint: 'Emailed to the client' },
  partially_paid: {
    label: 'Part paid',
    tone: 'due',
    hint: 'A payment has been recorded, with a balance remaining',
  },
  paid: { label: 'Paid', tone: 'paid', hint: 'Settled in full' },
  overdue: { label: 'Overdue', tone: 'overdue', hint: 'Past the due date with a balance outstanding' },
  void: { label: 'Void', tone: 'muted', hint: 'Cancelled. Kept for the audit trail rather than deleted' },
  accepted: { label: 'Accepted', tone: 'paid', hint: 'The quote was accepted and converted' },
  declined: { label: 'Declined', tone: 'muted' },
  expired: { label: 'Expired', tone: 'muted', hint: 'Past its validity date' },
};

export function statusDescriptor(status: DocumentStatus): StatusDescriptor {
  return STATUS_DESCRIPTORS[status] ?? { label: status, tone: 'neutral' };
}

/** The status a document should show, given its date. */
export function effectiveStatus(
  doc: Pick<Document, 'status' | 'dueDate' | 'totals'>,
  today: string,
): DocumentStatus {
  if (doc.status === 'void' || doc.status === 'paid') return doc.status;
  if (doc.status === 'draft') return 'draft';
  if (doc.totals.balance <= 0) return 'paid';
  if (doc.dueDate && today > doc.dueDate) return 'overdue';
  return doc.status;
}

/** Days until a due date, or null. Negative when overdue. */
export function daysUntil(dueDate: string | null | undefined, today: string): number | null {
  if (!dueDate) return null;
  const [y1, m1, d1] = today.split('-').map(Number);
  const [y2, m2, d2] = dueDate.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** "Due in 3 days" or "5 days overdue", for the list and the dashboard. */
export function dueDescription(
  doc: Pick<Document, 'dueDate' | 'status' | 'totals'>,
  today: string,
): string | null {
  if (doc.status === 'paid' || doc.status === 'void' || doc.status === 'draft') return null;
  if (!doc.dueDate) return null;
  const days = daysUntil(doc.dueDate, today);
  if (days === null) return null;
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
  if (days === 0) return 'Due today';
  if (days <= 7) return `Due in ${days} day${days === 1 ? '' : 's'}`;
  return null;
}

/** Tone for a due-date badge: amber when soon, red when late. */
export function dueTone(doc: Pick<Document, 'dueDate' | 'status' | 'totals'>, today: string): Tone | null {
  const desc = dueDescription(doc, today);
  if (!desc) return null;
  return desc.includes('overdue') ? 'overdue' : 'due';
}

/* ------------------------------------------------------------------ */
/* Counts                                                              */
/* ------------------------------------------------------------------ */

export function countBy<T extends Document>(documents: T[], predicate: (doc: T) => boolean): number {
  return documents.reduce((acc, d) => acc + (predicate(d) ? 1 : 0), 0);
}

/** Sum a money field across documents, refusing to mix currencies silently. */
export function sumMoney<T extends Document>(
  documents: T[],
  field: (doc: T) => number,
  currency: string,
): number {
  const matching = documents.filter((d) => d.currency === currency);
  return matching.reduce((acc, d) => acc + field(d), 0);
}

/** Sum, converting where a rate is available. */
export function sumMoneyMixed<T extends Document>(
  documents: T[],
  field: (doc: T) => number,
  ratesToHome: (from: string) => number,
  homeCurrency: string,
): { total: number; mixed: boolean } {
  let total = 0;
  let mixed = false;

  for (const doc of documents) {
    if (doc.currency === homeCurrency) {
      total += field(doc);
      continue;
    }
    mixed = true;
    const rate = ratesToHome(doc.currency);
    total += Math.round(field(doc) * rate);
  }

  return { total, mixed };
}

/* ------------------------------------------------------------------ */
/* Truncation                                                          */
/* ------------------------------------------------------------------ */

/** Shorten a name for a narrow column, with a title attribute for the full one. */
export function truncate(text: string, max = 32): string {
  const value = String(text ?? '');
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function pluralise(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}

/** "3 invoices" / "1 invoice" / "no invoices". */
export function countLabel(count: number, noun: string, plural?: string): string {
  if (count === 0) return `No ${plural ?? `${noun}s`}`;
  return `${count} ${count === 1 ? noun : (plural ?? `${noun}s`)}`;
}

/* ------------------------------------------------------------------ */
/* Payment method labels                                               */
/* ------------------------------------------------------------------ */

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  bank_transfer: 'Bank transfer',
  card: 'Card',
  cash: 'Cash',
  cheque: 'Cheque',
  paypal: 'PayPal',
  other: 'Other',
  credit_note: 'Credit note',
  deposit: 'Deposit',
};

/* ------------------------------------------------------------------ */
/* File name patterns                                                  */
/* ------------------------------------------------------------------ */

/**
 * Expand the output folder and file-name patterns.
 *
 * `{year}`, `{month}`, `{client}`, `{number}`, `{date}` and a few more. Unknown
 * tokens are dropped rather than left in a file name, because a literal
 * `{client}` in a file name is worse than a slightly generic one.
 */
export function expandPattern(
  pattern: string,
  values: {
    number: string;
    client: string;
    date: string;
    year?: string;
    yearFolderMode?: 'calendar' | 'financial' | 'none';
    financialYear?: string;
    financialYearStartMonth?: number;
    documentType?: string;
    profile?: string;
    terms?: string;
    status?: string;
    dueDate?: string;
    currency?: string;
    total?: string;
  },
): string {
  const [y, m, d] = (values.date ?? '').split('-');

  const map: Record<string, string> = {
    number: values.number,
    client: values.client,
    date: values.date,
    day: d ?? '',
    month: m ?? '',
    year: y ?? '',
    financial_year: values.financialYear ?? '',
    fy: (values.financialYear ?? '').split('-')[1] ?? '',
    type: values.documentType ?? '',
    profile: values.profile ?? '',
    terms: values.terms ?? '',
    status: values.status ?? '',
    due_date: values.dueDate ?? '',
    currency: values.currency ?? '',
    total: values.total ?? '',
  };

  return pattern.replace(/\{([a-z_]+)\}/gi, (_match, key: string) => {
    const value = map[key.toLowerCase()];
    return value === undefined ? '' : value;
  });
}

/**
 * Build the relative output path for a document.
 *
 * The default is `{year}/{client}/{number} - {client} - {date}.pdf`, which sorts
 * by year, then by client, and is readable in any file manager.
 */
export function buildOutputPath(args: {
  fileNamePattern: string;
  number: string;
  client: string;
  date: string;
  yearFolderMode: 'calendar' | 'financial' | 'none';
  businessSubFolder?: string;
  financialYear?: string;
  documentType?: string;
  profileCode?: string;
  terms?: string;
  status?: string;
  dueDate?: string;
  currency?: string;
  total?: string;
}): string {
  const segments: string[] = [];

  if (args.businessSubFolder?.trim()) segments.push(args.businessSubFolder.trim());

  if (args.yearFolderMode === 'calendar') {
    segments.push(args.date.slice(0, 4));
  } else if (args.yearFolderMode === 'financial') {
    if (args.financialYear) segments.push(args.financialYear);
  }

  if (args.client.trim()) segments.push(args.client.trim());

  const fileName = expandPattern(args.fileNamePattern, args);
  segments.push(fileName);

  return segments.filter(Boolean).join('/');
}

export type { Money };
