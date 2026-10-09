import { afterEach, describe, expect, it } from 'vitest';
import { createWebPlatform, setPlatform } from '@/adapters';
import { storage } from '@/adapters/types';
import { newBusinessProfile, newClient } from '@/core/schemas/crm';
import { documentLineSchema, documentSchema, clientCreditSchema } from '@/core/schemas';
import { newEntity } from '@/core/schemas/common';
import { DEFAULT_TAX_CODES } from '@/core/tax/tax';
import { calculate } from '@/core/calc/calculate';
import { finaliseDocument } from './finalise';

/**
 * The credit half of the billing loop, driven end to end through storage:
 * a credit note must actually reduce the invoice it credits (the first one
 * never did — the sum excluded the note being finalised), and credit a
 * client applied to an invoice must be spent once finalised (it never was,
 * so $50 of credit reduced every future invoice by $50).
 */

let close: (() => Promise<void>) | null = null;

async function freshStorage() {
  const platform = createWebPlatform(`duly-test-fin-${Math.random().toString(36).slice(2)}`);
  setPlatform(platform);
  await platform.storage.init();
  close = () => platform.storage.close();
  return platform.storage;
}

afterEach(async () => {
  await close?.();
  close = null;
});

function settings() {
  return {
    ...newEntity({}),
    id: 'settings',
    autoFileOnSubmit: false,
    outputFolderName: '',
    cloudSyncOnSubmit: false,
    cloudClientId: '',
    financialYearStartMonth: 7,
    roundingMethod: 'total_invoice' as const,
  };
}

function line(documentId: string, unitPrice: number) {
  return documentLineSchema.parse({
    ...newEntity({}),
    documentId,
    type: 'item',
    description: 'Consulting',
    quantity: '1',
    unitPrice,
    taxCodeId: 'tax_gst',
  });
}

async function seedIssuedInvoice(db: ReturnType<typeof storage>, totalMinor = 110000) {
  const profile = newBusinessProfile({ name: 'Acme', gstRegistered: true });
  const client = newClient({ displayName: 'Client Co' });
  await db.saveBusinessProfile(profile);
  await db.saveClient(client);
  const document = documentSchema.parse({
    ...newEntity({}),
    type: 'invoice',
    profileId: profile.id,
    clientId: client.id,
    status: 'finalised',
    number: 'INV-2026-0001',
    currency: 'AUD',
    taxMode: 'exclusive',
    taxCodeId: 'tax_gst',
    issueDate: '2026-10-06',
    dueDate: '2027-11-05',
    taxSnapshot: {
      gstRegistered: true,
      heading: 'Tax Invoice',
      codes: { tax_gst: { name: 'GST', rate: '0.10', type: 'gst', label: 'A' } },
      inclusiveGstStatementAllowed: false,
      buyerIdentityRequired: true,
      takenAt: '2026-10-06T00:00:00.000Z',
      financialYear: '2026-27',
    },
  });
  const lines = [line(document.id, Math.round(totalMinor / 1.1))];
  await db.saveDocument(document, lines);
  return { profile, client, document, lines };
}

describe('finalising a credit note', () => {
  it('the first credit note reduces the invoice it credits', async () => {
    const db = await freshStorage();
    const { profile, client, document: invoice } = await seedIssuedInvoice(db);

    const note = documentSchema.parse({
      ...newEntity({}),
      type: 'credit_note',
      profileId: profile.id,
      clientId: client.id,
      status: 'draft',
      currency: 'AUD',
      taxMode: 'exclusive',
      taxCodeId: 'tax_gst',
      issueDate: '2026-10-08',
      linkedDocumentIds: [invoice.id],
    });
    const noteLines = [line(note.id, -100000)];
    await db.saveDocument(note, noteLines);

    const result = calculate({
      document: note,
      lines: noteLines,
      payments: [],
      taxCodes: [...DEFAULT_TAX_CODES],
    });

    await finaliseDocument({
      document: note,
      lines: noteLines,
      payments: [],
      result,
      profile,
      client,
      taxCodes: [...DEFAULT_TAX_CODES],
      template: null,
      settings: settings() as any,
    });

    const updated = await db.getDocument(invoice.id);
    expect(updated?.totals.balance).toBe(0);
    expect(updated?.status).toBe('paid');
  });

  it('keeps the snapshot the note inherited from its invoice', async () => {
    const db = await freshStorage();
    const { profile, client, document: invoice } = await seedIssuedInvoice(db);

    const note = documentSchema.parse({
      ...newEntity({}),
      type: 'credit_note',
      profileId: profile.id,
      clientId: client.id,
      status: 'draft',
      currency: 'AUD',
      taxMode: 'exclusive',
      taxCodeId: 'tax_gst',
      issueDate: '2026-10-08',
      linkedDocumentIds: [invoice.id],
      // Inherited at creation — finalise must not overwrite it.
      taxSnapshot: invoice.taxSnapshot,
    });
    const noteLines = [line(note.id, -100000)];
    await db.saveDocument(note, noteLines);
    const result = calculate({ document: note, lines: noteLines, payments: [], taxCodes: [...DEFAULT_TAX_CODES] });

    await finaliseDocument({
      document: note,
      lines: noteLines,
      payments: [],
      result,
      profile,
      client,
      taxCodes: [...DEFAULT_TAX_CODES],
      template: null,
      settings: settings() as any,
    });

    const issued = await db.getDocument(note.id);
    expect(issued?.taxSnapshot?.heading).toBe('Tax Invoice');
    expect(issued?.taxSnapshot?.codes.tax_gst?.rate).toBe('0.10');
  });
});

describe('client credit is spent when the invoice is finalised', () => {
  it('marks the ledger row applied, so the credit cannot apply twice', async () => {
    const db = await freshStorage();
    const profile = newBusinessProfile({ name: 'Acme', gstRegistered: true });
    const client = newClient({ displayName: 'Client Co' });
    await db.saveBusinessProfile(profile);
    await db.saveClient(client);
    await db.saveClientCredit(
      clientCreditSchema.parse(
        newEntity({
          clientId: client.id,
          amount: 5000,
          currency: 'AUD',
          source: 'payment',
          date: '2026-10-01',
        }),
      ),
    );

    const invoice = documentSchema.parse({
      ...newEntity({}),
      type: 'invoice',
      profileId: profile.id,
      clientId: client.id,
      status: 'draft',
      currency: 'AUD',
      taxMode: 'exclusive',
      taxCodeId: 'tax_gst',
      issueDate: '2026-10-06',
      clientCreditApplied: 5000,
    });
    const lines = [line(invoice.id, 100000)];
    await db.saveDocument(invoice, lines);
    const result = calculate({ document: invoice, lines, payments: [], taxCodes: [...DEFAULT_TAX_CODES] });

    await finaliseDocument({
      document: invoice,
      lines,
      payments: [],
      result,
      profile,
      client,
      taxCodes: [...DEFAULT_TAX_CODES],
      template: null,
      settings: settings() as any,
    });

    const credits = await db.listClientCredits(client.id);
    expect(credits[0]?.appliedToDocumentId).toBe(invoice.id);
    expect(credits[0]?.appliedAmount).toBe(5000);

    // The stored balance carries the applied credit.
    const stored = await db.getDocument(invoice.id);
    expect(stored?.totals.balance).toBe(105000);
  });
});
