/**
 * Recurring schedule runs.
 *
 * Each due run produces a draft, never a finalised document. The run is keyed by
 * its run date, so opening the app five times on the same afternoon still yields
 * exactly one invoice — the plan's acceptance criterion for a monthly schedule
 * when the app is opened late.
 */

import type { Document } from '@/core/schemas/document';
import { documentSchema } from '@/core/schemas/document';
import { newEntity } from '@/core/schemas/common';
import { storage } from '@/adapters';
import {
  advance,
  alreadyConsumed,
  dueRunDates,
  resolveLineVariables,
  runKey,
} from '@/core/engines/recurrence';
import { dueDateFor } from '@/core/validation/dates';
import { copyLinesOnto } from '@/core/documents';

export interface RunOutcome {
  document: Document;
  scheduleId: string;
  scheduleName: string;
  runDate: string;
}

export interface RecurringOutcome {
  created: RunOutcome[];
  /** One log sentence per created document. */
  message: (outcome: RunOutcome) => string;
}

/**
 * Create a draft for every due run.
 *
 * `now` is passed in rather than read from the clock, so the whole module stays
 * testable and the scheduler's log timestamps line up with the run dates.
 */
export async function runRecurringSchedules(now: string): Promise<RecurringOutcome> {
  const db = storage();
  const schedules = await db.listRecurringSchedules();
  const created: RunOutcome[] = [];

  for (const schedule of schedules) {
    if (schedule.paused || schedule.deletedAt) continue;
    const dueDates = dueRunDates(schedule, now);

    for (const runDate of dueDates) {
      // Idempotency: a run key already consumed means this occurrence is done.
      if (alreadyConsumed(schedule, runDate)) continue;

      try {
        const outcome = await createRun(schedule.id, runDate);
        if (outcome) {
          created.push(outcome);
          await db.saveRecurringSchedule({
            ...advance(schedule, runDate),
            lastRunDocumentId: outcome.document.id,
          });
        }
      } catch (error) {
        // Log and carry on: one broken schedule must not stop the others.
        await db.saveAutomationLog(
          newEntity({
            category: 'recurring',
            message: `Could not run the schedule "${schedule.name}".`,
            documentId: null,
            profileId: schedule.profileId,
            entity: 'recurring_schedule',
            entityId: schedule.id,
            needsAttention: true,
            detail: error instanceof Error ? error.message : String(error),
            ranAt: now,
          }),
        );
      }
    }
  }

  return {
    created,
    message: (outcome) =>
      `Created a draft from the schedule "${outcome.scheduleName}" for ${outcome.runDate}. It is ready for your review — nothing has been sent.`,
  };
}

/** Build the draft for one run of one schedule. */
async function createRun(scheduleId: string, runDate: string): Promise<RunOutcome | null> {
  const db = storage();
  const schedule = await db.getRecurringSchedule(scheduleId);
  if (!schedule) return null;

  const source = schedule.sourceDocumentId ? await db.getDocument(schedule.sourceDocumentId) : null;
  const profile = await db.getBusinessProfile(schedule.profileId);
  if (!profile) return null;

  const clientId = schedule.clientId ?? source?.clientId ?? null;
  const termsId = schedule.termsId ?? source?.termsId ?? 'net_30';
  const currency = schedule.currency ?? source?.currency ?? profile.defaultCurrency;
  const taxCodeId = source?.taxCodeId ?? profile.defaultTaxCodeId ?? 'tax_gst';
  const templateId = schedule.designTemplateId ?? source?.designTemplateId ?? profile.defaultDesignTemplateId;
  const emailTemplateId = schedule.emailTemplateId ?? source?.emailTemplateId ?? null;

  const documentId = newEntity({}).id;
  const sourceLines = source ? await db.listDocumentLines(source.id) : [];
  const runStamp = { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };

  // Copied through the same helper every copy uses, so a run of a sectioned
  // source keeps its section discounts — and line-text variables resolve
  // here, so "Retainer — {month} {year}" updates itself on each run.
  const lines = resolveLineVariables(
    source ? copyLinesOnto(documentId, sourceLines, runStamp) : [],
    runDate,
    currency,
  );

  const dueDate =
    schedule.dueOffsetDays !== null && schedule.dueOffsetDays !== undefined
      ? addDays(runDate, schedule.dueOffsetDays)
      : dueDateFor(runDate, termsId);

  // Parsed rather than hand-built so every schema default is applied exactly
  // once, in one place, with no risk of a run producing a document the editor
  // cannot open.
  const document: Document = documentSchema.parse(
    newEntity({
      id: documentId,
      profileId: schedule.profileId,
      clientId,
      type: schedule.documentType,
      draftNumber: `${schedule.name} — ${runDate}`,
      issueDate: runDate,
      dueDate,
      termsId,
      currency,
      taxCodeId,
      // A run of an inclusive source is an inclusive draft — the copied
      // prices already contain the tax.
      taxMode: source?.taxMode ?? 'exclusive',
      labelLanguage: source?.labelLanguage ?? 'en',
      designTemplateId: templateId,
      emailTemplateId,
      notes: schedule.notes || source?.notes || '',
      tags: source?.tags ?? [],
      fromScheduleId: schedule.id,
      // A run always needs review. Nothing is finalised or emailed automatically.
      reviewRequired: true,
      scheduleRunKey: runKey(schedule.id, runDate),
      customFields: source?.customFields ?? {},
    }),
  );

  await db.saveDocument(document, lines);

  return { document, scheduleId: schedule.id, scheduleName: schedule.name, runDate };
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
