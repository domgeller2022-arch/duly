/**
 * A rule that has fired must not fire again on the same document.
 *
 * The re-audit found an override undone: a rule re-matched on every save (and
 * on the scheduler's 15-minute pass over open drafts), so setting a field back
 * by hand was overwritten moments later. A fired rule id is recorded on the
 * document and skipped. This drives the scheduler path
 * (`applyRulesToDocument`), which shares the marker with the editor.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createWebPlatform, setPlatform } from '@/adapters';
import { applyRulesToDocument } from './rules';
import { ruleSchema } from '@/core/schemas/automation';
import { documentLineSchema, documentSchema } from '@/core/schemas';
import { newBusinessProfile, newClient } from '@/core/schemas/crm';
import { newEntity } from '@/core/schemas/common';

let close: (() => Promise<void>) | null = null;

async function freshStorage() {
  const platform = createWebPlatform(`duly-test-rules-${Math.random().toString(36).slice(2)}`);
  setPlatform(platform);
  await platform.storage.init();
  close = () => platform.storage.close();
  return platform.storage;
}

afterEach(async () => {
  await close?.();
  close = null;
});

describe('applyRulesToDocument', () => {
  it('does not re-apply a rule the user has overridden', async () => {
    const db = await freshStorage();
    const profile = newBusinessProfile({ name: 'Acme', gstRegistered: true });
    const client = newClient({ displayName: 'Client Co', tags: ['Overseas'] });
    await db.saveBusinessProfile(profile);
    await db.saveClient(client);

    const rule = ruleSchema.parse(
      newEntity({
        name: 'Overseas clients are export-rated',
        enabled: true,
        match: 'any',
        conditions: [{ field: 'client.tag', operator: 'equals', value: 'Overseas' }],
        actions: [{ type: 'set_tax_code', field: '', value: 'tax_export' }],
      }),
    );
    await db.saveRule(rule);

    let document = documentSchema.parse({
      ...newEntity({}),
      type: 'invoice',
      profileId: profile.id,
      clientId: client.id,
      status: 'draft',
      currency: 'AUD',
      issueDate: '2026-10-06',
      dueDate: '2026-11-05',
      taxCodeId: 'tax_gst',
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

    const first = await applyRulesToDocument(document);
    expect(first).not.toBeNull();
    document = (await db.getDocument(document.id))!;
    expect(document.taxCodeId).toBe('tax_export');
    expect(document.appliedRuleIds).toContain(rule.id);

    // The user overrides the rule's result by hand.
    await db.saveDocument({ ...document, taxCodeId: 'tax_gst' });

    // The rule has fired, so it is not applied again — the override stands.
    const second = await applyRulesToDocument((await db.getDocument(document.id))!);
    expect(second).toBeNull();
    expect((await db.getDocument(document.id))?.taxCodeId).toBe('tax_gst');
  });
});
