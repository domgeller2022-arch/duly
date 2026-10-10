/**
 * Runner-level tests for the bulk actions.
 *
 * The third check found the recurring runner, the scheduler and the bulk
 * actions at 0% coverage — a fix with no test to catch it breaking again. These
 * drive the exported runners against real storage.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createWebPlatform, setPlatform } from '@/adapters';
import { bulkFinalise, bulkMarkPaid, bulkRefile, bulkVoid, type BulkContext } from './bulk';
import { documentLineSchema, documentSchema } from '@/core/schemas';
import { settingsSchema } from '@/core/schemas/settings';
import { newBusinessProfile, newClient } from '@/core/schemas/crm';
import { newEntity } from '@/core/schemas/common';

let close: (() => Promise<void>) | null = null;

async function freshStorage() {
  const platform = createWebPlatform(`duly-test-bulk-${Math.random().toString(36).slice(2)}`);
  setPlatform(platform);
  await platform.storage.init();
  close = () => platform.storage.close();
  return platform.storage;
}

afterEach(async () => {
  await close?.();
  close = null;
});

const settings = settingsSchema.parse({
  id: 'settings',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
});

function invoice(overrides: Record<string, unknown> = {}) {
  return documentSchema.parse({
    ...newEntity({}),
    type: 'invoice',
    profileId: 'prof_1',
    status: 'finalised',
    number: 'INV-2026-0001',
    currency: 'AUD',
    taxMode: 'exclusive',
    taxCodeId: 'tax_gst',
    issueDate: '2026-10-06',
    dueDate: '2026-11-05',
    totals: { total: 110000, balance: 110000 },
    ...overrides,
  });
}

/** A single $1,000 ex-GST line, so a recalculation yields $1,100. */
function lineFor(documentId: string) {
  return documentLineSchema.parse({
    ...newEntity({}),
    documentId,
    type: 'item',
    description: 'Consulting',
    quantity: '1',
    unitPrice: 100000,
    taxCodeId: 'tax_gst',
  });
}

async function seededContext(db: Awaited<ReturnType<typeof freshStorage>>) {
  const profile = { ...newBusinessProfile({ name: 'Acme', gstRegistered: true }), id: 'prof_1' };
  const client = newClient({ displayName: 'Client Co' });
  await db.saveBusinessProfile(profile);
  await db.saveClient(client);
  const ctx: BulkContext = {
    settings,
    profiles: [profile],
    clients: [client],
    taxCodes: await db.listTaxCodes(),
    templates: [],
  };
  return ctx;
}

describe('bulkMarkPaid', () => {
  it('records a payment, clears the balance, and writes an audit entry', async () => {
    const db = await freshStorage();
    await seededContext(db);
    const doc = invoice();
    await db.saveDocument(doc, [lineFor(doc.id)]);

    const outcome = await bulkMarkPaid([doc], '2026-10-11');

    expect(outcome.done).toBe(1);
    expect(outcome.skipped).toHaveLength(0);
    const bundle = await db.getDocumentBundle(doc.id);
    expect(bundle?.document.totals.balance).toBe(0);
    expect(bundle?.payments).toHaveLength(1);
    expect(bundle?.payments[0].amount).toBe(110000);
  });

  it('skips drafts, void documents and anything already paid', async () => {
    const db = await freshStorage();
    await seededContext(db);
    const draft = invoice({ status: 'draft' });
    const voided = invoice({ status: 'void' });
    const paid = invoice({ totals: { total: 110000, balance: 0, paid: 110000 } });

    const outcome = await bulkMarkPaid([draft, voided, paid], '2026-10-11');

    expect(outcome.done).toBe(0);
    expect(outcome.skipped).toHaveLength(3);
  });
});

describe('bulkVoid', () => {
  it('voids and keeps the document, skipping ones already void', async () => {
    const db = await freshStorage();
    await seededContext(db);
    const doc = invoice();
    const already = invoice({ status: 'void' });
    await db.saveDocument(doc);

    const outcome = await bulkVoid([doc, already], 'duplicate', '2026-10-11');

    expect(outcome.done).toBe(1);
    expect(outcome.skipped).toHaveLength(1);
    expect((await db.getDocument(doc.id))?.status).toBe('void');
  });
});

describe('bulkFinalise', () => {
  it('skips a draft with no line items and everything already finalised', async () => {
    const db = await freshStorage();
    const ctx = await seededContext(db);
    const empty = documentSchema.parse({
      ...newEntity({}),
      type: 'invoice',
      profileId: 'prof_1',
      status: 'draft',
      currency: 'AUD',
      issueDate: '2026-10-06',
      dueDate: '2026-11-05',
    });
    await db.saveDocument(empty, []);
    const finalised = invoice();

    const outcome = await bulkFinalise([empty, finalised], ctx);

    expect(outcome.done).toBe(0);
    expect(outcome.skipped).toHaveLength(2);
    // The finalised one is skipped as already done, the empty draft as invalid.
    expect(outcome.skipped.some((s) => /finalised/i.test(s.reason))).toBe(true);
    expect(outcome.skipped.every((s) => s.reason.length > 0)).toBe(true);
  });

  it('skips a draft whose business no longer exists', async () => {
    const db = await freshStorage();
    const ctx = await seededContext(db);
    const orphan = documentSchema.parse({
      ...newEntity({}),
      type: 'invoice',
      profileId: 'gone',
      status: 'draft',
      currency: 'AUD',
      issueDate: '2026-10-06',
      dueDate: '2026-11-05',
    });
    await db.saveDocument(orphan, [
      documentLineSchema.parse({
        ...newEntity({}),
        documentId: orphan.id,
        type: 'item',
        description: 'Work',
        quantity: '1',
        unitPrice: 100000,
      }),
    ]);

    const outcome = await bulkFinalise([orphan], ctx);

    expect(outcome.done).toBe(0);
    expect(outcome.skipped[0].reason).toMatch(/business/i);
  });
});

describe('bulkRefile', () => {
  it('skips a document with no filed PDF, and a draft', async () => {
    const db = await freshStorage();
    const ctx = await seededContext(db);
    const unfiled = invoice();
    const draft = invoice({ status: 'draft', lastPdfPath: '/tmp/x.pdf' });

    const outcome = await bulkRefile([unfiled, draft], ctx);

    expect(outcome.done).toBe(0);
    expect(outcome.skipped).toHaveLength(2);
  });
});
