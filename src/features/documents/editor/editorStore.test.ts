/**
 * The editor must show what is stored.
 *
 * Three re-audit findings share one root: the editor's `load` called
 * `calculate()` on the live tax table and without the document's linked credit
 * notes, so an issued document with a deactivated tax code or a credit note
 * displayed — and pre-filled, exported and emailed — figures that disagreed
 * with the stored record. `load` now goes through the same service as every
 * other writer. These tests drive it through the storage layer.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWebPlatform, setPlatform } from '@/adapters';
import { storage } from '@/adapters/types';
import { useEditorStore } from './editorStore';
import { newBusinessProfile, newClient } from '@/core/schemas/crm';
import { documentLineSchema, documentSchema } from '@/core/schemas';
import { newEntity } from '@/core/schemas/common';

let close: (() => Promise<void>) | null = null;

async function freshStorage() {
  const platform = createWebPlatform(`duly-test-editor-${Math.random().toString(36).slice(2)}`);
  setPlatform(platform);
  await platform.storage.init();
  close = () => platform.storage.close();
  return platform.storage;
}

beforeEach(() => useEditorStore.getState().reset());

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
    dueDate: '2027-11-05',
    taxSnapshot: {
      gstRegistered: true,
      heading: 'Tax Invoice',
      codes: { tax_gst: { name: 'GST', rate: '0.10', type: 'gst', label: 'A' } },
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
    unitPrice: (total * 10) / 11,
    taxCodeId: 'tax_gst',
  });
  await db.saveDocument(document, [line]);
  return { document, line, profile, client };
}

describe("the editor's load", () => {
  it('an issued invoice keeps its total after the tax code is deactivated', async () => {
    const db = await freshStorage();
    const { document } = await seedFinalisedInvoice(db);

    const codes = await db.listTaxCodes();
    const gst = codes.find((c) => c.id === 'tax_gst')!;
    await db.saveTaxCode({ ...gst, active: false });

    await useEditorStore.getState().load(document.id);

    const result = useEditorStore.getState().result;
    expect(result?.total).toBe(110000);
    expect(result?.balance).toBe(110000);
  });

  it('an issued invoice shows the balance its linked credit note left', async () => {
    const db = await freshStorage();
    const { document } = await seedFinalisedInvoice(db);

    const note = documentSchema.parse({
      ...newEntity({}),
      type: 'credit_note',
      profileId: document.profileId,
      clientId: document.clientId,
      status: 'finalised',
      number: 'CN-2026-0001',
      currency: 'AUD',
      taxMode: 'exclusive',
      taxCodeId: 'tax_gst',
      issueDate: '2026-10-07',
      dueDate: '2026-10-07',
      linkedDocumentIds: [document.id],
      totals: { total: 110000, paid: 0, balance: 110000 },
    });
    await db.saveDocument(note, []);

    await useEditorStore.getState().load(document.id);

    const result = useEditorStore.getState().result;
    expect(result?.balance).toBe(0);
  });
});
