/**
 * Runner-level tests for recurring schedules.
 *
 * The third check found the recurring runner at 0% coverage: the end-condition
 * fix (an "after N runs" schedule used to run forever) and the catch-up/
 * idempotency behaviour had nothing to catch them breaking again. These drive
 * `runRecurringSchedules` against real storage.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createWebPlatform, setPlatform } from '@/adapters';
import { runRecurringSchedules } from './recurring';
import { runKey } from '@/core/engines/recurrence';
import { recurringScheduleSchema } from '@/core/schemas/automation';
import { newBusinessProfile } from '@/core/schemas/crm';
import { newEntity } from '@/core/schemas/common';

let close: (() => Promise<void>) | null = null;

async function freshStorage() {
  const platform = createWebPlatform(`duly-test-recurring-${Math.random().toString(36).slice(2)}`);
  setPlatform(platform);
  await platform.storage.init();
  close = () => platform.storage.close();
  return platform.storage;
}

afterEach(async () => {
  await close?.();
  close = null;
});

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

async function seedBusiness(db: Awaited<ReturnType<typeof freshStorage>>) {
  await db.saveBusinessProfile({ ...newBusinessProfile({ name: 'Acme' }), id: 'prof_1' });
}

describe('runRecurringSchedules', () => {
  it('honours an "after N runs" end condition', async () => {
    const db = await freshStorage();
    await seedBusiness(db);
    await db.saveRecurringSchedule(scheduleFor({ endCondition: 'after_runs', endAfterRuns: 2 }));

    const outcome = await runRecurringSchedules('2026-11-15');

    expect(outcome.created).toHaveLength(2);
    const drafts = (await db.listDocuments()).filter((d) => d.fromScheduleId);
    expect(drafts).toHaveLength(2);
    expect(drafts.every((d) => d.reviewRequired)).toBe(true);
    expect(drafts.every((d) => d.status === 'draft')).toBe(true);
  });

  it('catches up one draft per missed run, then does not double', async () => {
    const db = await freshStorage();
    await seedBusiness(db);
    await db.saveRecurringSchedule(scheduleFor());

    const first = await runRecurringSchedules('2026-11-15');
    expect(first.created.map((c) => c.runDate)).toEqual([
      '2026-08-01',
      '2026-09-01',
      '2026-10-01',
      '2026-11-01',
    ]);

    // A second pass the same day creates nothing.
    const second = await runRecurringSchedules('2026-11-15');
    expect(second.created).toHaveLength(0);
    expect((await db.listDocuments()).filter((d) => d.fromScheduleId)).toHaveLength(4);
  });

  it('does not re-create a run whose key is already consumed', async () => {
    const db = await freshStorage();
    await seedBusiness(db);
    const schedule = scheduleFor({ nextRunDate: '2026-08-01' });
    // As if the app closed mid-run: nextRunDate still points at a run whose key
    // was already recorded. The consumed key must stop a duplicate.
    await db.saveRecurringSchedule({ ...schedule, consumedRunKeys: [runKey(schedule.id, '2026-08-01')] });

    const outcome = await runRecurringSchedules('2026-08-01');

    expect(outcome.created).toHaveLength(0);
    expect((await db.listDocuments()).filter((d) => d.fromScheduleId)).toHaveLength(0);
  });

  it('does not run a schedule that is paused', async () => {
    const db = await freshStorage();
    await seedBusiness(db);
    await db.saveRecurringSchedule(scheduleFor({ paused: true }));

    const outcome = await runRecurringSchedules('2026-11-15');

    expect(outcome.created).toHaveLength(0);
  });
});
