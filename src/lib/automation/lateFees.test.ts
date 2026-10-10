/**
 * A late-fee invoice must be stored with its totals.
 *
 * The re-audit found `createFeeInvoice` saved the new invoice with zeroed
 * totals, so it showed as $0.00 in the list and the dashboard until it was
 * opened (which recalculated it). It now goes through the recalculation
 * service, like every other write.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createWebPlatform, setPlatform } from '@/adapters';
import { runLateFeeEngine } from './lateFees';
import { lateFeePolicySchema } from '@/core/schemas/automation';
import { documentLineSchema, documentSchema } from '@/core/schemas';
import { newBusinessProfile, newClient } from '@/core/schemas/crm';
import { newEntity } from '@/core/schemas/common';

let close: (() => Promise<void>) | null = null;

async function freshStorage() {
  const platform = createWebPlatform(`duly-test-latefee-${Math.random().toString(36).slice(2)}`);
  setPlatform(platform);
  await platform.storage.init();
  close = () => platform.storage.close();
  return platform.storage;
}

afterEach(async () => {
  await close?.();
  close = null;
});

describe('runLateFeeEngine — fee as a separate invoice', () => {
  it('stores the fee invoice with its totals, not zero', async () => {
    const db = await freshStorage();
    const profile = newBusinessProfile({ name: 'Acme', gstRegistered: true });
    const client = newClient({ displayName: 'Client Co' });
    await db.saveBusinessProfile(profile);
    await db.saveClient(client);

    const invoice = documentSchema.parse({
      ...newEntity({}),
      type: 'invoice',
      profileId: profile.id,
      clientId: client.id,
      status: 'finalised',
      number: 'INV-2026-0001',
      currency: 'AUD',
      taxMode: 'exclusive',
      taxCodeId: 'tax_gst',
      issueDate: '2026-09-01',
      dueDate: '2026-10-01',
      totals: { total: 100000, balance: 100000 },
    });
    const line = documentLineSchema.parse({
      ...newEntity({}),
      documentId: invoice.id,
      type: 'item',
      description: 'Consulting',
      quantity: '1',
      unitPrice: 100000,
      taxCodeId: 'tax_gst',
    });
    await db.saveDocument(invoice, [line]);

    await db.saveLateFeePolicy(
      lateFeePolicySchema.parse(
        newEntity({
          name: 'Overdue 2%',
          enabled: true,
          daysAfterDue: 0,
          kind: 'fixed',
          value: '5000',
          applyAs: 'invoice',
          taxCodeId: 'tax_gst',
        }),
      ),
    );

    const outcomes = await runLateFeeEngine('2026-12-01');
    expect(outcomes).toHaveLength(1);

    const fee = outcomes[0];
    const stored = await db.getDocument(fee.documentId);
    expect(stored).toBeDefined();
    expect(stored!.tags).toContain('late-fee');
    // Before R22 this was 0 until the invoice was opened.
    expect(stored!.totals.total).toBeGreaterThan(0);
  });
});
