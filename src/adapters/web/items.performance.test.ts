/**
 * Catalogue search under load.
 *
 * The plan's acceptance gate for this phase: "500 imported items search in under
 * 100 ms". Measured here rather than asserted in a comment, because the only way to
 * know whether a filter is fast is to run it against a catalogue of the size the gate
 * names.
 *
 * The rows go in through the real `DexieStorageAdapter` and, in the second test,
 * through the real importer, so what is timed is the code the screens call.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createWebPlatform, setPlatform } from '@/adapters';
import { storage } from '@/adapters/types';
import { itemSchema } from '@/core/schemas/crm';
import { newEntity } from '@/core/schemas/common';
import { searchCatalogue } from '@/core/documents';
import { importItems } from '@/lib/import';
import type { Document, Item } from '@/core/schemas';

/** The worst of several runs, because one fast run says nothing about a filter. */
async function timed(runs: number, fn: () => Promise<unknown> | unknown): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    await fn();
    times.push(performance.now() - started);
  }
  return Math.max(...times);
}

/** Install a web platform on its own database and open it. */
async function freshPlatform(): Promise<() => Promise<void>> {
  const dbName = `duly-test-items-${Math.random().toString(36).slice(2)}`;
  const platform = createWebPlatform(dbName);
  setPlatform(platform);
  await platform.storage.init();
  return () => platform.storage.close();
}

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

function makeItems(count: number): Item[] {
  return Array.from({ length: count }, (_, i) =>
    itemSchema.parse(
      newEntity({
        code: `SKU-${String(i).padStart(4, '0')}`,
        name: `Consulting service ${i}`,
        description: `Professional services row number ${i}`,
        unit: 'hour',
        prices: { AUD: 18000 },
        taxCodeId: null,
        category: i % 2 === 0 ? 'Consulting' : 'Design',
        cost: 0,
        active: true,
        customFields: {},
      }),
    ),
  );
}

describe('catalogue search with 500 items', () => {
  it('searches by name, code and description well inside 100 ms', async () => {
    cleanup = await freshPlatform();
    const db = storage();

    await db.saveItems(makeItems(500));

    const worst = await timed(5, () => db.listItems({ search: 'Consulting' }));
    expect(worst, `slowest search was ${worst.toFixed(1)}ms`).toBeLessThan(100);

    // Fast is not enough; it has to find the right rows.
    expect(await db.listItems({ search: 'Consulting' })).toHaveLength(500);

    const byCode = await db.listItems({ search: 'SKU-0100' });
    expect(byCode).toHaveLength(1);
    expect(byCode[0].name).toBe('Consulting service 100');

    expect(await db.listItems({ search: 'no such item anywhere' })).toHaveLength(0);
  }, 30_000);

  it('imports 500 rows and still searches inside 100 ms', async () => {
    cleanup = await freshPlatform();
    const db = storage();

    const records = makeItems(500).map((item) => ({
      name: item.name,
      code: item.code,
      description: item.description,
      unit: item.unit,
      price: 18000,
      category: item.category,
      currency: 'AUD',
    }));

    // The gate says "500 imported items", so the import path is timed as well.
    const importMs = await timed(1, () => importItems(records));
    const imported = await db.listItems({});
    expect(imported).toHaveLength(500);
    expect(importMs, `importing 500 rows took ${importMs.toFixed(0)}ms`).toBeLessThan(10_000);

    const search = await timed(5, () => db.listItems({ search: 'Consulting' }));
    expect(search, `slowest search after import was ${search.toFixed(1)}ms`).toBeLessThan(100);

    const found = await db.listItems({ search: 'SKU-0499' });
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('Consulting service 499');
  }, 60_000);

  it('keeps the invoice autocomplete under 8 matches and fast', async () => {
    // The other thing that searches the whole catalogue: typing a description on a
    // document. That runs on every keystroke, so 500 items must not make it stutter.
    const items = makeItems(500);
    const document = { type: 'invoice', currency: 'AUD' } as unknown as Document;

    const worst = await timed(20, () =>
      Promise.resolve(searchCatalogue('Consulting service 42', items, [], document)),
    );

    expect(worst, `slowest autocomplete was ${worst.toFixed(1)}ms`).toBeLessThan(100);

    const matches = searchCatalogue('Consulting service 42', items, [], document);
    expect(matches.length).toBeLessThanOrEqual(8);
    expect(matches[0].label).toBe('Consulting service 42');
  }, 30_000);
});
