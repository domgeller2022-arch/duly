/**
 * Bank statement import: CSV, OFX and QIF.
 *
 * The plan's item 6: import a statement, auto-match payments to invoices by
 * amount and reference, then confirm, split or ignore each line. All three
 * formats parse without a dependency — OFX is bracketed SGML text, QIF is a
 * line-per-field format — and they all land in the same shape.
 *
 * Splitting: confirming a line with a smaller amount than the balance IS the
 * split (a part payment), so the amount is editable on the review row rather
 * than there being a separate split dialog.
 */

import { parseCsv, sniffDelimiter } from '@/core/csv';
import { parseAmountToMinor } from '@/core/money/money';
import type { Document, Payment } from '@/core/schemas';

export interface BankTransaction {
  /** ISO date. */
  date: string;
  /** Minor units. Positive for money in. */
  amountMinor: number;
  description: string;
  reference: string;
  /** The statement's own transaction id, when the format has one (OFX FITID). */
  externalId: string;
  /** Which format it came from, shown in the review. */
  source: 'csv' | 'ofx' | 'qif';
}

export type MatchStatus = 'duplicate' | 'payment' | 'unmatched';

export interface MatchResult {
  transaction: BankTransaction;
  status: MatchStatus;
  /** The invoice a payment would settle, when one matched. */
  invoiceId: string | null;
  /**
   * When one line settles several of a client's invoices, their ids. Set only
   * for a split; `invoiceId` is null in that case.
   */
  splitInvoiceIds?: string[];
  confidence: 'high' | 'medium';
}

/* ------------------------------------------------------------------ */
/* Parsers                                                             */
/* ------------------------------------------------------------------ */

/** ISO date from whatever the format uses. */
function toIsoDate(raw: string, preferDayFirst = false): string {
  const value = raw.trim();
  // OFX: YYYYMMDD or YYYYMMDDHHMMSS.
  if (/^\d{8}/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  // QIF: MM/DD/YYYY, DD/MM/YYYY or MM/DD'YYYY.
  const qif = value.match(/^(\d{1,2})[/'-](\d{1,2})[/'-](\d{4})/);
  if (qif) {
    const first = Number(qif[1]);
    const second = Number(qif[2]);
    const day = preferDayFirst ? first : second;
    const month = preferDayFirst ? second : first;
    return `${qif[3]}-${String(Math.min(12, month)).padStart(2, '0')}-${String(Math.min(31, day)).padStart(2, '0')}`;
  }
  // Already ISO.
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return value;
}

function toMinor(raw: string): number {
  // The canonical parser: a bank statement's "1870.00" must become 187000
  // minor units exactly, whatever the float rounding feels like doing.
  return parseAmountToMinor(raw.replace(/[$\s]/g, ''), 'AUD');
}

/** Parse an OFX statement: STMTTRN blocks with DTPOSTED, TRNAMT, NAME, MEMO, FITID. */
export function parseOfx(text: string): BankTransaction[] {
  const transactions: BankTransaction[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const block of blocks) {
    const tag = (name: string): string => {
      const match = block.match(new RegExp(`<${name}>\\s*([^<\\r\\n]*)`, 'i'));
      return match ? match[1].trim() : '';
    };
    transactions.push({
      date: toIsoDate(tag('DTPOSTED')),
      amountMinor: toMinor(tag('TRNAMT')),
      description: tag('NAME') || tag('PAYEE'),
      reference: tag('MEMO') || tag('REFNUM'),
      externalId: tag('FITID'),
      source: 'ofx',
    });
  }
  return transactions;
}

/** Parse a QIF statement: D (date), T (amount), P (payee), M (memo), N (ref), ^ terminator. */
export function parseQif(text: string): BankTransaction[] {
  const transactions: BankTransaction[] = [];
  let current: Partial<BankTransaction> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('^')) {
      if (current.date !== undefined && current.amountMinor !== undefined) {
        transactions.push({
          date: current.date,
          amountMinor: current.amountMinor,
          description: current.description ?? '',
          reference: current.reference ?? '',
          externalId: current.externalId ?? '',
          source: 'qif',
        });
      }
      current = {};
      continue;
    }
    const code = trimmed[0].toUpperCase();
    const value = trimmed.slice(1);
    // Australian QIF files are usually day-first; ambiguous dates resolve D/M.
    if (code === 'D') current.date = toIsoDate(value, true);
    else if (code === 'T') current.amountMinor = toMinor(value);
    else if (code === 'P') current.description = value;
    else if (code === 'M') current.reference = value;
    else if (code === 'N') current.externalId = value;
  }
  return transactions;
}

const DATE_HEADERS = ['date', 'transaction date', 'posted', 'value date'];
const AMOUNT_HEADERS = ['amount', 'amount aud', 'value', 'transaction amount'];
const DEBIT_HEADERS = ['debit', 'withdrawal', 'money out'];
const CREDIT_HEADERS = ['credit', 'deposit', 'money in'];
const DESCRIPTION_HEADERS = [
  'description',
  'narrative',
  'details',
  'transaction',
  'payee',
  'name',
  'particulars',
];
const REFERENCE_HEADERS = ['reference', 'memo', 'code', 'analysis'];

function findColumn(headers: string[], candidates: string[]): number {
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const candidate of candidates) {
    const index = lower.findIndex((h) => h === candidate);
    if (index >= 0) return index;
  }
  for (const candidate of candidates) {
    const index = lower.findIndex((h) => h.includes(candidate));
    if (index >= 0) return index;
  }
  return -1;
}

/** Parse a CSV statement: Date, Description, Amount columns — or Debit/Credit columns. */
export function parseBankCsv(text: string): BankTransaction[] {
  const table = parseCsv(text, sniffDelimiter(text));
  if (table.length < 2) return [];
  const headers = table[0];
  const dateCol = findColumn(headers, DATE_HEADERS);
  const amountCol = findColumn(headers, AMOUNT_HEADERS);
  const debitCol = findColumn(headers, DEBIT_HEADERS);
  const creditCol = findColumn(headers, CREDIT_HEADERS);
  const descriptionCol = findColumn(headers, DESCRIPTION_HEADERS);
  const referenceCol = findColumn(headers, REFERENCE_HEADERS);

  // No date column means this is not a statement.
  if (dateCol < 0) return [];

  return table.slice(1).flatMap((row) => {
    const date = toIsoDate(row[dateCol] ?? '');
    let amountMinor = amountCol >= 0 ? toMinor(row[amountCol] ?? '') : 0;
    if (amountCol < 0 && debitCol >= 0 && creditCol >= 0) {
      const debit = toMinor(row[debitCol] ?? '');
      const credit = toMinor(row[creditCol] ?? '');
      amountMinor = credit - debit;
    }
    if (!date || amountMinor === 0) return [];
    return [
      {
        date,
        amountMinor,
        description: (row[descriptionCol] ?? '').trim(),
        reference: (row[referenceCol] ?? '').trim(),
        externalId: '',
        source: 'csv' as const,
      },
    ];
  });
}

/** Parse whichever format the text turns out to be. */
export function parseStatement(text: string): BankTransaction[] {
  if (/<STMTTRN>/i.test(text)) return parseOfx(text);
  if (/^!Type:(Bank|Cash)/im.test(text)) return parseQif(text);
  return parseBankCsv(text);
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

/** Match transactions to invoices by reference and amount, and skip dupes. */
export function matchTransactions(
  transactions: BankTransaction[],
  documents: Document[],
  payments: Payment[],
): MatchResult[] {
  const knownIds = new Set(payments.map((p) => p.bankTransactionId).filter(Boolean) as string[]);
  const openInvoices = documents.filter(
    (d) => d.type === 'invoice' && d.status !== 'draft' && d.status !== 'void' && d.totals.balance > 0,
  );

  return transactions.map((transaction) => {
    if (transaction.externalId && knownIds.has(transaction.externalId)) {
      return { transaction, status: 'duplicate' as const, invoiceId: null, confidence: 'high' as const };
    }

    // Money out cannot settle an invoice.
    if (transaction.amountMinor <= 0) {
      return { transaction, status: 'unmatched' as const, invoiceId: null, confidence: 'high' as const };
    }

    const haystack = `${transaction.reference} ${transaction.description}`.toLowerCase();

    // Reference match: an invoice number in the description, amount equal to the balance.
    const byReference = openInvoices.find(
      (doc) =>
        doc.number &&
        haystack.includes(doc.number.toLowerCase()) &&
        doc.totals.balance === transaction.amountMinor,
    );
    if (byReference) {
      return {
        transaction,
        status: 'payment' as const,
        invoiceId: byReference.id,
        confidence: 'high' as const,
      };
    }

    // Amount match: exactly one open invoice with this balance.
    const byAmount = openInvoices.filter((doc) => doc.totals.balance === transaction.amountMinor);
    if (byAmount.length === 1) {
      return {
        transaction,
        status: 'payment' as const,
        invoiceId: byAmount[0].id,
        confidence: 'medium' as const,
      };
    }

    // Split: one transfer settling several of a client's invoices.
    const splitInvoiceIds = findSplit(openInvoices, transaction.amountMinor);
    if (splitInvoiceIds.length > 1) {
      return {
        transaction,
        status: 'payment' as const,
        invoiceId: null,
        splitInvoiceIds,
        confidence: 'medium' as const,
      };
    }

    return { transaction, status: 'unmatched' as const, invoiceId: null, confidence: 'high' as const };
  });
}

/**
 * A single bank line that settles several of one client's invoices.
 *
 * A client paying three invoices in one transfer is one line whose amount
 * equals the sum of their balances. Only invoices for the same client are
 * combined, and only up to four of them, so a coincidence across unrelated
 * invoices is not read as a payment. The smallest matching set wins, and the
 * order is stable.
 */
function findSplit(invoices: Document[], amountMinor: number): string[] {
  const byClient = new Map<string, Document[]>();
  for (const invoice of invoices) {
    if (!invoice.clientId || invoice.totals.balance <= 0 || invoice.totals.balance > amountMinor) continue;
    const list = byClient.get(invoice.clientId) ?? [];
    list.push(invoice);
    byClient.set(invoice.clientId, list);
  }
  for (const list of byClient.values()) {
    for (let size = 2; size <= Math.min(4, list.length); size++) {
      const found = subsetSum(list, amountMinor, size);
      if (found) return found.map((invoice) => invoice.id);
    }
  }
  return [];
}

/** An exact-size subset of `invoices` whose balances sum to `target`, or null. */
function subsetSum(invoices: Document[], target: number, size: number): Document[] | null {
  const chosen: Document[] = [];
  const search = (start: number, remaining: number): Document[] | null => {
    if (chosen.length === size) return remaining === 0 ? [...chosen] : null;
    for (let i = start; i < invoices.length; i++) {
      const next = remaining - invoices[i].totals.balance;
      if (next < 0) continue;
      chosen.push(invoices[i]);
      const found = search(i + 1, next);
      if (found) return found;
      chosen.pop();
    }
    return null;
  };
  return search(0, target);
}
