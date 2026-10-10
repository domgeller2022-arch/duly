/**
 * Accountant exports: Xero and MYOB CSV import layouts.
 *
 * The plan's item 5: contacts, invoices and payments in the CSV layouts those
 * systems import, plus the GST summary per BAS period. The layouts are the
 * documented import formats — Xero's column names with the leading asterisks
 * it requires, MYOB's AccountRight equivalents. They are plain CSV, built with
 * the same writer as every other export.
 *
 * Whether they import cleanly into a Xero demo company is a manual check —
 * the unit test asserts the column layout and the row shape instead.
 */

import { writeCsv } from '@/core/csv';
import { toBig, toMajorNumber } from '@/core/money/money';
import { minorUnitFactor } from '@/core/money/currencies';
import type { Client, Document, DocumentLine, Payment } from '@/core/schemas';
import type { CalculationResult } from '@/core/calc/calculate';
import type { TaxCode } from '@/core/tax/tax';

/** A document ready for the accountant layouts, with its calculated result. */
export interface AccountantDocument {
  document: Document;
  lines: DocumentLine[];
  result: CalculationResult;
}

/** The tax type Xero expects, from the line's own tax code. */
function xeroTaxType(taxCodeId: string | null, taxCodes: TaxCode[]): string {
  const code = taxCodes.find((c) => c.id === taxCodeId);
  return code && ['gst', 'custom', 'compound'].includes(code.type) ? 'GST on Income' : 'GST Free Income';
}

/**
 * The tax code a line is actually taxed under. A line left on "Document
 * default" has no code of its own, and exports under the document's — without
 * this fallback such a line was written as GST Free even though GST applied.
 */
function effectiveTaxCodeId(line: DocumentLine, document: Document): string | null {
  return line.taxCodeId ?? document.taxCodeId;
}

/** The per-unit tax-exclusive price, after every discount. */
function exclusiveUnitPrice(
  line: DocumentLine,
  result: CalculationResult,
  currency: string,
): number {
  const computed = result.lines.get(line.id);
  const qty = Number.parseFloat(line.quantity) || 0;
  // An expense line prices by its amount override; everything else per unit.
  const net = computed?.net ?? 0;
  if (line.type === 'expense' && line.amountOverride !== null) {
    return toMajorNumber(net, currency);
  }
  if (qty <= 0) return 0;
  // Four decimals, not whole cents: rounding a per-unit price to the cent made
  // a 3 x $3.33 line come to $9.99 instead of $10.00 in the accountant's system.
  return toBig(net).div(minorUnitFactor(currency)).div(qty).round(4).toNumber();
}

export type AccountingSystem = 'xero' | 'myob';

/* ------------------------------------------------------------------ */
/* Xero                                                                */
/* ------------------------------------------------------------------ */

/**
 * Xero contact import. Only *ContactName is required; the rest is what the
 * demo company accepts without complaint.
 */
export function xeroContactsCsv(clients: Client[]): string {
  return writeCsv(
    [
      '*ContactName',
      'ContactFirstName',
      'ContactLastName',
      'EmailAddress',
      'BankAccountDetails',
      'TaxNumber',
    ],
    clients.map((client) => [client.displayName, client.legalName ?? '', '', client.email, '', client.taxId]),
  );
}

/**
 * Xero invoice import: one row per line item, the invoice fields repeated.
 * UnitAmount is tax-exclusive dollars; Total is on the last row of each
 * invoice, as Xero's importer expects it.
 */
export function xeroInvoicesCsv(documents: AccountantDocument[], clients: Client[], taxCodes: TaxCode[]): string {
  const nameFor = (clientId: string | null) =>
    clients.find((c) => c.id === clientId)?.displayName ?? 'Unknown client';
  const rows: (string | number | null)[][] = [];

  for (const { document, lines, result } of documents) {
    const currency = document.currency;
    for (const line of lines) {
      if (line.type === 'section' || line.type === 'note' || line.type === 'discount') continue;
      rows.push([
        nameFor(document.clientId),
        document.number || document.draftNumber || '',
        document.issueDate,
        document.dueDate ?? '',
        '',
        line.description,
        Number.parseFloat(line.quantity) || (line.type === 'expense' ? 1 : 0),
        exclusiveUnitPrice(line, result, currency),
        '200',
        xeroTaxType(effectiveTaxCodeId(line, document), taxCodes),
      ]);
    }
  }
  return writeCsv(
    [
      '*ContactName',
      '*InvoiceNumber',
      '*InvoiceDate',
      'DueDate',
      'InventoryItemCode',
      'Description',
      '*Quantity',
      '*UnitAmount',
      'AccountCode',
      '*TaxType',
    ],
    rows,
  );
}

/**
 * Xero payment import: one row per payment, referencing the invoice number
 * it settled.
 */
export function xeroPaymentsCsv(payments: Payment[], invoices: Document[]): string {
  const numberFor = (documentId: string) => invoices.find((d) => d.id === documentId)?.number ?? '';
  // Payments are in the invoice's currency, not always AUD.
  const currencyFor = (documentId: string) => invoices.find((d) => d.id === documentId)?.currency ?? 'AUD';
  return writeCsv(
    ['*InvoiceNumber', '*AccountCode', '*Date', '*Amount', 'Reference'],
    payments.map((payment) => [
      numberFor(payment.documentId),
      '970',
      payment.date,
      toMajorNumber(payment.amount, currencyFor(payment.documentId)),
      payment.reference,
    ]),
  );
}

/* ------------------------------------------------------------------ */
/* MYOB                                                                */
/* ------------------------------------------------------------------ */

/** MYOB AccountRight contact import. */
export function myobContactsCsv(clients: Client[]): string {
  return writeCsv(
    ['Co./Last Name', 'First Name', 'Card ID', 'Addr 1 - Line 1', 'Email', 'ABN'],
    clients.map((client) => [
      client.displayName,
      '',
      client.displayName,
      client.billingAddress?.formatted ?? '',
      client.email,
      client.taxId,
    ]),
  );
}

/**
 * MYOB AccountRight sales import: one row per line, invoice fields repeated.
 * Unit price is tax-exclusive dollars.
 */
export function myobInvoicesCsv(documents: AccountantDocument[], clients: Client[], taxCodes: TaxCode[]): string {
  const nameFor = (clientId: string | null) =>
    clients.find((c) => c.id === clientId)?.displayName ?? 'Unknown client';
  const rows: (string | number | null)[][] = [];

  for (const { document, lines, result } of documents) {
    const currency = document.currency;
    for (const line of lines) {
      if (line.type === 'section' || line.type === 'note' || line.type === 'discount') continue;
      rows.push([
        nameFor(document.clientId),
        document.number || document.draftNumber || '',
        document.issueDate,
        line.description,
        Number.parseFloat(line.quantity) || (line.type === 'expense' ? 1 : 0),
        exclusiveUnitPrice(line, result, currency),
        xeroTaxType(effectiveTaxCodeId(line, document), taxCodes) === 'GST on Income' ? 'GST' : 'GST Free',
      ]);
    }
  }
  return writeCsv(
    ['*Co./Last Name', '*Invoice No.', '*Date', 'Description', '*Quantity', '*Unit Price', 'Tax Code'],
    rows,
  );
}

/** MYOB payment import. */
export function myobPaymentsCsv(payments: Payment[], invoices: Document[]): string {
  const numberFor = (documentId: string) => invoices.find((d) => d.id === documentId)?.number ?? '';
  // Payments are in the invoice's currency, not always AUD.
  const currencyFor = (documentId: string) => invoices.find((d) => d.id === documentId)?.currency ?? 'AUD';
  return writeCsv(
    ['*Invoice No.', '*Date', '*Amount Received', 'Method', 'Reference'],
    payments.map((payment) => [
      numberFor(payment.documentId),
      payment.date,
      toMajorNumber(payment.amount, currencyFor(payment.documentId)),
      payment.method.replace(/_/g, ' '),
      payment.reference,
    ]),
  );
}

/* ------------------------------------------------------------------ */
/* GST per BAS period                                                  */
/* ------------------------------------------------------------------ */

/**
 * The GST summary a BAS period needs: GST collected on sales per quarter,
 * with the invoiced total it came from. The Reports screen shows the same
 * numbers; this is the CSV an accountant files from.
 */
export function gstBasPeriodsCsv(invoices: Document[]): string {
  const quarters = new Map<string, { gst: number; invoiced: number; count: number }>();
  for (const invoice of invoices) {
    if (invoice.type !== 'invoice' || invoice.status === 'draft' || invoice.status === 'void') continue;
    const [year, month] = invoice.issueDate.split('-').map(Number);
    const quarter = Math.floor((month - 1) / 3) + 1;
    const key = `${year}-Q${quarter}`;
    const entry = quarters.get(key) ?? { gst: 0, invoiced: 0, count: 0 };
    entry.gst += invoice.totals.gstPayable;
    entry.invoiced += invoice.totals.total;
    entry.count += 1;
    quarters.set(key, entry);
  }
  return writeCsv(
    ['BAS period', 'Invoices', 'GST collected', 'Total invoiced'],
    [...quarters.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, entry]) => [key, entry.count, toMajorNumber(entry.gst, 'AUD'), toMajorNumber(entry.invoiced, 'AUD')]),
  );
}
