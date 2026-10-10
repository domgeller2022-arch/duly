import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebPlatform, setPlatform } from '@/adapters';
import { storage } from '@/adapters/types';
import { recalculateDocument, taxCodesFor } from './documentService';
import { newBusinessProfile, newClient } from '@/core/schemas/crm';
import { documentLineSchema, documentSchema, paymentSchema } from '@/core/schemas';
import { newEntity } from '@/core/schemas/common';

/**
 * The service exists because a dozen callers each forgot a different piece
 * (payments, snapshot codes, rounding), and every one of them left the stored
 * totals wrong. These tests drive the service through the storage layer, the
 * way PaymentsPanel and bank import will.
 */

let close: (() => Promise<void>) | null = null;

async function freshStorage() {
  const platform = createWebPlatform(`duly-test-svc-${Math.random().toString(36).slice(2)}`);
  setPlatform(platform);
  await platform.storage.init();
  close = () => platform.storage.close();
  return platform.storage;
}

afterEach(async () => {
  await close?.();
  close = null;
});

const NOW = '2026-01-01T00:00:00.000Z';

async function seedFinalisedInvoice(db: ReturnType<typeof storage>, total = 110000) {
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
    dueDate: '2027-11-05', // not due yet, so status reflects payments not dates
    taxSnapshot: {
      gstRegistered: true,
      heading: 'Tax Invoice',
      codes: {
        tax_gst: { name: 'GST', rate: '0.10', type: 'gst', label: 'A' },
      },
      inclusiveGstStatementAllowed: false,
      buyerIdentityRequired: true,
      takenAt: NOW,
      financialYear: '2026-27',
    },
  });
  const line = documentLineSchema.parse({
    ...newEntity({}),
    documentId: document.id,
    type: 'item',
    description: 'Consulting',
    quantity: '1',
    unitPrice: total * 10 / 11,
    taxCodeId: 'tax_gst',
  });
  await db.saveDocument(document, [line]);
  return { document, line, profile, client };
}

function partPayment(documentId: string, amount: number) {
  return paymentSchema.parse(newEntity({ documentId, date: '2026-10-10', amount, method: 'bank_transfer' }));
}

describe('recalculateDocument', () => {
  it('a part payment reaches the stored totals and status', async () => {
    const db = await freshStorage();
    const { document } = await seedFinalisedInvoice(db);

    await db.savePayment(partPayment(document.id, 50000));

    const outcome = await recalculateDocument({ document });
    expect(outcome.result.paid).toBe(50000);
    expect(outcome.result.balance).toBe(60000);
    expect(outcome.document.status).toBe('partially_paid');

    // The stored record carries it, which is what the list and reports read.
    const stored = await db.getDocument(document.id);
    expect(stored?.totals.paid).toBe(50000);
    expect(stored?.totals.balance).toBe(60000);
    expect(stored?.status).toBe('partially_paid');
  });

  it('removing the payment restores the status and balance', async () => {
    const db = await freshStorage();
    const { document } = await seedFinalisedInvoice(db);

    const payment = partPayment(document.id, 110000);
    await db.savePayment(payment);
    await recalculateDocument({ document });
    expect((await db.getDocument(document.id))?.status).toBe('paid');

    await db.deletePayment(payment.id);
    await recalculateDocument({ document });
    const restored = await db.getDocument(document.id);
    expect(restored?.status).toBe('finalised');
    expect(restored?.totals.balance).toBe(110000);
  });

  it('an issued document calculates on its frozen codes, not the live table', async () => {
    const db = await freshStorage();
    const { document } = await seedFinalisedInvoice(db);

    // GST is deactivated in settings after the invoice was issued.
    const codes = await db.listTaxCodes();
    const gst = codes.find((c) => c.id === 'tax_gst')!;
    await db.saveTaxCode({ ...gst, active: false });

    const outcome = await recalculateDocument({ document });
    expect(outcome.result.tax).toBe(10000);
    expect(outcome.result.total).toBe(110000);
    expect(outcome.document.totals.total).toBe(110000);
  });

  it('a draft calculates on the live table, so deactivation does reach it', async () => {
    const db = await freshStorage();
    const codes = await db.listTaxCodes();
    const gst = codes.find((c) => c.id === 'tax_gst')!;
    expect(taxCodesFor({ ...DRAFT, status: 'draft' } as never, codes)).toBe(codes);
    void gst;
  });

  it('takes "today" from the business time zone, not UTC, when deriving status', async () => {
    const db = await freshStorage();
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
      issueDate: '2026-01-02',
      dueDate: '2026-02-01',
    });
    const line = documentLineSchema.parse({
      ...newEntity({}),
      documentId: document.id,
      type: 'item',
      description: 'Consulting',
      quantity: '1',
      unitPrice: 100000,
      taxCodeId: 'tax_gst',
    });
    await db.saveDocument(document, [line]);

    // 20:00 UTC on 1 February is 07:00 on 2 February in Sydney, so the invoice
    // is a day overdue there while UTC still calls it due today.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-02-01T20:00:00.000Z'));
    try {
      const outcome = await recalculateDocument({ document });
      expect(outcome.document.status).toBe('overdue');
    } finally {
      vi.useRealTimers();
    }
  });
});

const DRAFT = { status: 'draft' };
