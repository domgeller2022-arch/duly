import { afterEach, describe, expect, it } from 'vitest';
import { createWebPlatform, setPlatform } from '@/adapters';
import { storage } from '@/adapters/types';
import { newClient } from '@/core/schemas/crm';
import { newEntity } from '@/core/schemas/common';
import type { DataSnapshot } from '@/adapters/types';

/**
 * The import path is the trust boundary of the whole app: a restore from a
 * JSON file is how somebody gets their data back, so what it does with empty
 * tables, unknown keys, malformed rows and newer schemas is not academic.
 */

let close: (() => Promise<void>) | null = null;

async function freshStorage() {
  const platform = createWebPlatform(`duly-test-imp-${Math.random().toString(36).slice(2)}`);
  setPlatform(platform);
  await platform.storage.init();
  close = () => platform.storage.close();
  return platform.storage;
}

afterEach(async () => {
  await close?.();
  close = null;
});

function snapshotOf(db: ReturnType<typeof storage>, overrides: Record<string, unknown> = {}): DataSnapshot {
  void db;
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    appVersion: 'test',
    ...(overrides as object),
  } as DataSnapshot;
}

describe('importSnapshot', () => {
  it('replace clears a table the snapshot holds none of', async () => {
    const db = await freshStorage();
    await db.saveClient(newClient({ displayName: 'Ghost Client' }));

    const outcome = await db.importSnapshot(snapshotOf(db, { clients: [] }), 'replace');
    expect(outcome.imported).toBe(0);

    // The client the snapshot had no record of is gone: a replace that kept
    // it was not a replace.
    expect(await db.listClients()).toHaveLength(0);
  });

  it('merge leaves local rows alone when the snapshot has none of that table', async () => {
    const db = await freshStorage();
    await db.saveClient(newClient({ displayName: 'Kept Client' }));

    await db.importSnapshot(snapshotOf(db, { clients: [] }), 'merge');
    expect(await db.listClients()).toHaveLength(1);
  });

  it('refuses a snapshot from a newer schema before reading anything', async () => {
    const db = await freshStorage();
    await expect(db.importSnapshot(snapshotOf(db, { schemaVersion: 99 }), 'replace')).rejects.toThrow(/newer/i);
  });

  it('skips malformed rows rather than importing them', async () => {
    const db = await freshStorage();
    const valid = newClient({ displayName: 'Valid Client' });
    const outcome = await db.importSnapshot(
      snapshotOf(db, {
        clients: [
          valid,
          // A hand-edited row missing required stamps: skipped, counted.
          { displayName: 'No Stamps' },
        ],
      }),
      'replace',
    );
    expect(outcome.skipped).toBe(1);
    const clients = await db.listClients();
    expect(clients.map((c) => c.displayName)).toEqual(['Valid Client']);
  });

  it('skips unknown keys instead of throwing the whole import', async () => {
    const db = await freshStorage();
    const outcome = await db.importSnapshot(
      snapshotOf(db, { futureTable: [{ id: newEntity({}).id }] }),
      'replace',
    );
    expect(outcome.skipped).toBe(1);
    expect(outcome.imported).toBe(0);
  });
});
