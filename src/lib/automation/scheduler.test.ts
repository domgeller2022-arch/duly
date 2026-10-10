/**
 * Runner-level tests for the scheduler pass.
 *
 * The third check found the scheduler at 0% coverage. `runSchedulerPass` takes
 * the date it runs at, so these drive it against real storage: the disabled
 * gate, the daily backup, and a due recurring schedule.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createWebPlatform, setPlatform } from '@/adapters';
import { runSchedulerPass } from './scheduler';
import { recurringScheduleSchema } from '@/core/schemas/automation';
import { settingsSchema } from '@/core/schemas/settings';
import { newBusinessProfile } from '@/core/schemas/crm';
import { newEntity } from '@/core/schemas/common';

let close: (() => Promise<void>) | null = null;

async function freshStorage() {
  const platform = createWebPlatform(`duly-test-scheduler-${Math.random().toString(36).slice(2)}`);
  setPlatform(platform);
  await platform.storage.init();
  close = () => platform.storage.close();
  return platform.storage;
}

afterEach(async () => {
  await close?.();
  close = null;
});

function settingsFor(overrides: Record<string, unknown> = {}) {
  return settingsSchema.parse({
    id: 'settings',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    automationEnabled: true,
    ...overrides,
  });
}

function scheduleFor(overrides: Record<string, unknown> = {}) {
  return recurringScheduleSchema.parse(
    newEntity({
      name: 'Monthly retainer',
      profileId: 'prof_1',
      startDate: '2026-01-01',
      nextRunDate: '2026-08-01',
      frequency: 'monthly',
      dayOfMonth: 1,
      maxCatchUpRuns: 12,
      ...overrides,
    }),
  );
}

describe('runSchedulerPass', () => {
  it('does nothing at all when automation is disabled', async () => {
    const db = await freshStorage();
    await db.saveSettings(settingsFor({ automationEnabled: false }));

    const result = await runSchedulerPass('2026-11-15');

    expect(result.documentsCreated).toBe(0);
    expect(result.errors).toEqual([]);
    expect(await db.listBackups()).toHaveLength(0);
  });

  it('writes one daily backup and runs a due recurring schedule', async () => {
    const db = await freshStorage();
    await db.saveBusinessProfile({ ...newBusinessProfile({ name: 'Acme' }), id: 'prof_1' });
    await db.saveSettings(settingsFor({ runRecurring: true }));
    await db.saveRecurringSchedule(scheduleFor());

    const result = await runSchedulerPass('2026-11-15');

    expect(result.documentsCreated).toBe(4);
    expect(result.errors).toEqual([]);
    const backups = await db.listBackups();
    expect(backups.some((b) => b.name.startsWith('daily-'))).toBe(true);
  });

  it('does not repeat the daily backup on a second pass', async () => {
    const db = await freshStorage();
    await db.saveSettings(settingsFor());
    await runSchedulerPass('2026-11-15');
    await runSchedulerPass('2026-11-15');

    expect((await db.listBackups()).filter((b) => b.name.startsWith('daily-'))).toHaveLength(1);
  });
});
