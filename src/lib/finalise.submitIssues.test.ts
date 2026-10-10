/**
 * "Submit with issues": the document is numbered and finalised as usual, and
 * stores the checks it was submitted with — but it is not auto-filed, not
 * uploaded to Drive, and Duly will not email it. Manual export still works.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createWebPlatform, setPlatform } from '@/adapters';
import { finaliseDocument } from './finalise';
import { recalculateDocument } from './documentService';
import { documentLineSchema, documentSchema } from '@/core/schemas';
import { settingsSchema } from '@/core/schemas/settings';
import { newBusinessProfile, newClient } from '@/core/schemas/crm';
import { newEntity } from '@/core/schemas/common';
import { emailBlockedReason } from '@/core/documents';

let close: (() => Promise<void>) | null = null;

async function freshStorage() {
  const platform = createWebPlatform(`duly-test-submitissues-${Math.random().toString(36).slice(2)}`);
  setPlatform(platform);
  await platform.storage.init();
  close = () => platform.storage.close();
  return platform.storage;
}

afterEach(async () => {
  await close?.();
  close = null;
});

describe('finaliseDocument with issues', () => {
  it('stores the issues, numbers the document, and skips auto-filing', async () => {
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
      status: 'draft',
      draftNumber: 'DRAFT-1',
      currency: 'AUD',
      taxMode: 'exclusive',
      taxCodeId: 'tax_gst',
      issueDate: '2026-10-06',
      dueDate: '2026-11-05',
    });
    const lines = [
      documentLineSchema.parse({
        ...newEntity({}),
        documentId: document.id,
        type: 'item',
        description: 'Consulting',
        quantity: '1',
        unitPrice: 100000,
        taxCodeId: 'tax_gst',
      }),
    ];
    await db.saveDocument(document, lines);

    const settings = settingsSchema.parse({
      id: 'settings',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
      // Auto-file is on, with a folder — so without the issues it *would* write.
      autoFileOnSubmit: true,
      outputFolderName: 'Invoices',
    });

    const { result } = await recalculateDocument({ document, lines, save: false, deriveStatus: false });

    const outcome = await finaliseDocument({
      document,
      lines,
      payments: [],
      result,
      profile,
      client,
      taxCodes: await db.listTaxCodes(),
      template: null,
      settings,
      issues: [{ id: 'heading', title: 'Heading must say "Tax Invoice"' }],
    });

    // Numbered and finalised as normal.
    expect(outcome.number).toBeTruthy();
    const stored = await db.getDocument(document.id);
    expect(stored?.status).toBe('finalised');
    expect(stored?.number).toBe(outcome.number);
    // The checks are stored, not just a flag.
    expect(stored?.submissionIssues).toEqual([{ id: 'heading', title: 'Heading must say "Tax Invoice"' }]);
    // Not auto-filed — no PDF path, and no attempt (so no error either).
    expect(outcome.pdfPath).toBeNull();
    expect(outcome.pdfError).toBeNull();
  });
});

describe('emailBlockedReason', () => {
  it('refuses a document submitted with issues, and allows a normal one', () => {
    const base = documentSchema.parse({
      ...newEntity({}),
      type: 'invoice',
      profileId: '00000000-0000-4000-8000-000000000000',
      issueDate: '2026-10-06',
      dueDate: '2026-11-05',
    });
    expect(emailBlockedReason(base)).toBeNull();
    const withIssues = documentSchema.parse({
      ...newEntity({}),
      type: 'invoice',
      profileId: '00000000-0000-4000-8000-000000000000',
      issueDate: '2026-10-06',
      dueDate: '2026-11-05',
      submissionIssues: [{ id: 'no-lines', title: 'The document has no line items' }],
    });
    expect(emailBlockedReason(withIssues)).toMatch(/valid tax invoice/i);
  });
});
