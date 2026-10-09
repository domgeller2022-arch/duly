/**
 * Importing and exporting records as CSV.
 *
 * Both directions live together because they are the same mapping seen from two
 * sides: an export writes a column per field, an import reads one. Keeping them
 * adjacent is what stops the two drifting so that an export can no longer be
 * re-imported by the same version of Duly that wrote it — which is the whole reason
 * the JSON backup exists separately.
 */

import type { Client, CurrencyRate, Item } from '@/core/schemas';
import { clientSchema, itemSchema } from '@/core/schemas/crm';
import { newEntity } from '@/core/schemas/common';
import { writeCsv } from '@/core/csv';
import { parseAmountToMinor } from '@/core/money/money';
import { storage } from '@/adapters';
import { currencyDecimals } from '@/core/money/currencies';

/* ------------------------------------------------------------------ */
/* Clients                                                             */
/* ------------------------------------------------------------------ */

export const CLIENT_CSV_HEADERS = [
  'Name',
  'Legal name',
  'ABN',
  'Email',
  'Phone',
  'Street address',
  'City',
  'State',
  'Postcode',
  'Country',
  'Tags',
  'Notes',
  'Currency',
  'Terms',
  'Discount %',
];

const TERMS_BY_NAME: Record<string, string> = {
  'due on receipt': 'due_on_receipt',
  'net 7': 'net_7',
  'net 14': 'net_14',
  'net 30': 'net_30',
  'net 60': 'net_60',
  'end of next month': 'end_next_month',
};

export function clientsToCsv(clients: readonly Client[]): string {
  return writeCsv(
    CLIENT_CSV_HEADERS,
    clients.map((client) => [
      client.displayName,
      client.legalName,
      client.taxId,
      client.email,
      client.phone,
      client.billingAddress.line1,
      client.billingAddress.city,
      client.billingAddress.state,
      client.billingAddress.postcode,
      client.billingAddress.country,
      client.tags.join(', '),
      client.notes,
      client.defaultCurrency,
      client.defaultTermsId,
      client.defaultDiscountPercent,
    ]),
  );
}

/**
 * Turn previewed rows into saved clients.
 *
 * Each record goes through its schema before it is written, so a malformed row is
 * rejected by the same validation the app uses everywhere else rather than landing
 * in the database half-built. Returns how many were saved and how many were not.
 */
export async function importClients(
  records: Record<string, unknown>[],
): Promise<{ saved: number; failed: number }> {
  const db = storage();
  const valid: Client[] = [];
  let failed = 0;

  for (const record of records) {
    const candidate = clientSchema.safeParse(
      newEntity({
        displayName: String(record.displayName ?? ''),
        legalName: String(record.legalName ?? ''),
        taxId: String(record.taxId ?? ''),
        email: String(record.email ?? ''),
        phone: String(record.phone ?? ''),
        billingAddress: {
          line1: String(record.line1 ?? ''),
          line2: '',
          city: String(record.city ?? ''),
          state: String(record.state ?? ''),
          postcode: String(record.postcode ?? ''),
          country: String(record.country ?? ''),
          formatted: null,
        },
        tags: Array.isArray(record.tags) ? (record.tags as string[]) : [],
        notes: String(record.notes ?? ''),
      }),
    );

    if (!candidate.success) {
      failed += 1;
      continue;
    }

    valid.push(candidate.data);
  }

  // One write for the batch. Row-at-a-time would mean 500 database transactions for
  // a 500-row file, which is the difference between an import and an apparent hang.
  if (valid.length > 0) await db.saveClients(valid);

  return { saved: valid.length, failed };
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

export const ITEM_CSV_HEADERS = [
  'Name',
  'Code',
  'Description',
  'Unit',
  'Price',
  'Category',
  'Tax code',
  'Currency',
];

/**
 * Write the catalogue out.
 *
 * Prices are written as human amounts, not minor units: a spreadsheet of
 * "1,200.00" is a spreadsheet, and "120000" would be read back as a hundred and
 * twenty thousand dollars.
 */
export function itemsToCsv(items: readonly Item[], currency: string): string {
  const decimals = currencyDecimals(currency);

  return writeCsv(
    ITEM_CSV_HEADERS,
    items.map((item) => [
      item.name,
      item.code,
      item.description,
      item.unit,
      item.prices[currency] === undefined
        ? ''
        : (item.prices[currency] / Math.pow(10, decimals)).toFixed(decimals),
      item.category,
      item.taxCodeId ?? '',
      currency,
    ]),
  );
}

export async function importItems(
  records: Record<string, unknown>[],
): Promise<{ saved: number; failed: number }> {
  const db = storage();
  const valid: Item[] = [];
  let failed = 0;

  for (const record of records) {
    const currency = typeof record.currency === 'string' && record.currency ? record.currency : 'AUD';
    const minor =
      typeof record.price === 'number'
        ? record.price
        : parseAmountToMinor(String(record.price ?? ''), currency);

    const candidate = itemSchema.safeParse(
      newEntity({
        name: String(record.name ?? ''),
        code: String(record.code ?? ''),
        description: String(record.description ?? ''),
        unit: String(record.unit ?? 'each'),
        prices: minor > 0 ? { [currency]: minor } : {},
        // A tax code name from a spreadsheet is not an id; leave it unset rather
        // than point an item at a code that does not exist.
        taxCodeId: null,
        category: String(record.category ?? ''),
        cost: 0,
        active: true,
        customFields: {},
      }),
    );

    if (!candidate.success) {
      failed += 1;
      continue;
    }

    valid.push(candidate.data);
  }

  if (valid.length > 0) await db.saveItems(valid);

  return { saved: valid.length, failed };
}

/* ------------------------------------------------------------------ */
/* Exchange rates                                                      */
/* ------------------------------------------------------------------ */

export function ratesToCsv(rates: readonly CurrencyRate[]): string {
  return writeCsv(
    ['Currency', 'Rate', 'Effective', 'Source'],
    rates.map((rate) => [rate.from, rate.rate, rate.effectiveDate, rate.source]),
  );
}

/** Dispatch for the import dialog, which serves two record types. */
export async function importRecords(
  entity: 'client' | 'item',
  records: Record<string, unknown>[],
): Promise<number> {
  const result = entity === 'client' ? await importClients(records) : await importItems(records);
  return result.saved;
}

/** Look a terms name from a spreadsheet up to a terms id. */
export function termsIdFromName(name: string): string {
  return TERMS_BY_NAME[name.trim().toLowerCase()] ?? name.trim();
}
