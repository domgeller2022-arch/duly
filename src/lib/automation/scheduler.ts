/**
 * The scheduler.
 *
 * There is no server, so jobs cannot fire while the app is closed. They run on
 * start and then on a timer while the window is open. Every job is idempotent and
 * writes a plain-English entry to the automation log, so nothing happens
 * silently and re-running the scheduler never duplicates work.
 *
 * In v1 nothing is finalised or emailed automatically. A recurring run produces a
 * draft flagged "Ready for review", and a reminder is queued for approval.
 */

import type { AutomationLogEntry } from '@/core/schemas/automation';
import { newEntity } from '@/core/schemas/common';
import { todayIn } from '@/core/validation/dates';
import { platform, storage } from '@/adapters';
import { useAppStore } from '@/state/app';
import { runRecurringSchedules } from './recurring';
import { runOverdueFlagging, runQuoteExpiry } from './overdue';
import { runReminderEngine } from './reminders';
import { runLateFeeEngine } from './lateFees';
import { applyRulesToOpenDrafts } from './rules';

let timer: number | null = null;
let running = false;

export interface SchedulerRunResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  documentsCreated: number;
  documentsFlagged: number;
  remindersQueued: number;
  lateFeesApplied: number;
  rulesApplied: number;
  errors: string[];
}

/**
 * One scheduler pass.
 *
 * Order matters: recurring runs create drafts, which then need overdue flags and
 * reminders; reminders are queued only for documents that are actually overdue;
 * late fees apply last so they are not chased by a reminder in the same pass.
 */
export async function runSchedulerPass(now: string): Promise<SchedulerRunResult> {
  const startedAt = now;
  const t0 = Date.now();
  const errors: string[] = [];
  const result: SchedulerRunResult = {
    startedAt,
    finishedAt: now,
    durationMs: 0,
    documentsCreated: 0,
    documentsFlagged: 0,
    remindersQueued: 0,
    lateFeesApplied: 0,
    rulesApplied: 0,
    errors,
  };

  const settings = await storage().getSettings();
  if (!settings.automationEnabled) return { ...result, durationMs: Date.now() - t0 };

  /** Every log entry carries the same shape; defaults fill the optional fields. */
  const log = async (
    entry: Pick<AutomationLogEntry, 'category' | 'message'> & Partial<AutomationLogEntry>,
  ) => {
    await storage().saveAutomationLog(
      newEntity({
        documentId: null,
        profileId: null,
        entity: '',
        entityId: '',
        needsAttention: false,
        detail: '',
        ...entry,
        ranAt: now,
      }),
    );
  };

  try {
    /* ---- 0. the daily backup ---- */
    //
    // Once a day: a snapshot is written into the chosen backup folder —
    // silent on desktop, best-effort on the web where a folder grant only
    // lasts the session — and the restorable copy lands inside the database.
    // A failure is logged, never fatal: the restorable copy already exists.
    try {
      const backups = await storage().listBackups();
      const todayKey = `daily-${now.slice(0, 10)}`;
      if (!backups.some((b) => b.name === todayKey)) {
        const info = await storage().createBackup(todayKey);
        if (settings.backupFolderName) {
          try {
            const snapshot = await storage().exportSnapshot();
            await platform().files.writeFile(`duly-backup-${todayKey}.json`, JSON.stringify(snapshot, null, 2));
            await log({
              category: 'backup',
              message: `Daily backup written (${(info.sizeBytes / 1024).toFixed(0)} kB) to ${settings.backupFolderName}.`,
              entity: 'backup',
              entityId: info.id,
              detail: '',
            });
          } catch {
            await log({
              category: 'backup',
              message: 'Daily backup kept inside Duly; the backup folder could not be written.',
              entity: 'backup',
              entityId: info.id,
              needsAttention: true,
              detail:
                'On the web the folder grant lasts only the session — re-choose it in Settings → Files, or use the desktop build for silent backups.',
            });
          }
        }
      }
    } catch (error) {
      errors.push(`Daily backup: ${describe(error)}`);
    }

    /* ---- 1. recurring schedules ---- */
    if (settings.runRecurring) {
      try {
        const outcome = await runRecurringSchedules(now);
        result.documentsCreated = outcome.created.length;
        for (const created of outcome.created) {
          await log({
            category: 'recurring',
            message: outcome.message(created),
            documentId: created.document.id,
            profileId: created.document.profileId,
            entity: 'document',
            entityId: created.document.id,
            needsAttention: true,
            detail: 'Created as a draft for your review. Nothing has been sent.',
          });
        }
      } catch (error) {
        errors.push(`Recurring schedules: ${describe(error)}`);
      }
    }

    /* ---- 2. overdue flagging ---- */
    try {
      const overdue = await runOverdueFlagging(now);
      result.documentsFlagged = overdue.flagged.length;
      for (const doc of overdue.flagged) {
        await log({
          category: 'overdue',
          message: `Marked ${doc.number || doc.id} as overdue — ${overdue.daysOverdue} days past the due date.`,
          documentId: doc.id,
          profileId: doc.profileId,
          entity: 'document',
          entityId: doc.id,
          detail: '',
        });
      }
    } catch (error) {
      errors.push(`Overdue flagging: ${describe(error)}`);
    }

    /* ---- 3. quote expiry ---- */
    if (settings.runQuoteExpiry) {
      try {
        const expired = await runQuoteExpiry(now);
        for (const doc of expired.expired) {
          await log({
            category: 'quote_expiry',
            message: `Quote ${doc.number || doc.id} has passed its validity date.`,
            documentId: doc.id,
            profileId: doc.profileId,
            entity: 'document',
            entityId: doc.id,
            needsAttention: true,
            detail: 'Follow up, or re-issue with a new validity date.',
          });
        }
      } catch (error) {
        errors.push(`Quote expiry: ${describe(error)}`);
      }
    }

    /* ---- 4. rules on open drafts ---- */
    try {
      const applications = await applyRulesToOpenDrafts();
      result.rulesApplied = applications.length;
      for (const applied of applications) {
        await log({
          category: 'rules',
          message: applied.summary,
          documentId: applied.documentId,
          profileId: applied.profileId,
          entity: 'document',
          entityId: applied.documentId,
          detail: applied.details.join(' '),
        });
      }
    } catch (error) {
      errors.push(`Rules: ${describe(error)}`);
    }

    /* ---- 5. reminders ---- */
    if (settings.runReminderEngine) {
      try {
        const queued = await runReminderEngine(now);
        result.remindersQueued = queued.length;
      } catch (error) {
        errors.push(`Reminders: ${describe(error)}`);
      }
    }

    /* ---- 6. late fees ---- */
    if (settings.runLateFeeEngine) {
      try {
        const applied = await runLateFeeEngine(now);
        result.lateFeesApplied = applied.length;
        for (const fee of applied) {
          await log({
            category: 'late_fee',
            message: fee.message,
            documentId: fee.documentId,
            profileId: fee.profileId,
            entity: 'document',
            entityId: fee.documentId,
            needsAttention: true,
            detail: fee.detail,
          });
        }
      } catch (error) {
        errors.push(`Late fees: ${describe(error)}`);
      }
    }

    /* ---- 7. scheduled sends ---- */
    try {
      const queued = await queueScheduledSends(now);
      if (queued > 0) {
        await log({
          category: 'scheduled_send',
          message: `${queued} document(s) reached their scheduled send date and were queued for email.`,
          entity: 'email',
          entityId: '',
          detail: 'Approve them in Reminders to send.',
        });
      }
    } catch (error) {
      errors.push(`Scheduled sends: ${describe(error)}`);
    }
  } catch (error) {
    errors.push(describe(error));
  }

  return { ...result, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0 };
}

/** Move a queued send from "waiting" to "ready" once its date has arrived. */
async function queueScheduledSends(now: string): Promise<number> {
  const db = storage();
  const outbox = await db.listOutbox();
  const nowIso = new Date().toISOString();
  let count = 0;

  for (const entry of outbox) {
    if (entry.status === 'waiting' && entry.queuedAt <= nowIso) {
      await db.saveOutbox({ ...entry, status: 'ready' });
      count += 1;
    }
  }

  void now;
  return count;
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

/** Start the scheduler: one pass now, then every 15 minutes. */
export async function startScheduler(): Promise<void> {
  stopScheduler();
  const settings = await storage().getSettings();

  const pass = async () => {
    // A pass already in flight must not be started again; the timer could easily
    // fire while a slow recurring run is still writing.
    if (running) return;
    running = true;
    try {
      // A fresh date every pass: the store's today is set at boot, so an app
      // left open overnight (or in the tray) used to keep running yesterday's
      // overdue and recurring checks until a reload. The date is the business
      // time zone's, not UTC — in Sydney UTC is still yesterday until mid-morning.
      const result = await runSchedulerPass(todayIn(settings.timeZone));
      if (result.documentsCreated > 0 || result.remindersQueued > 0) {
        await useAppStore.getState().refresh();
      }
    } catch (error) {
      console.warn('Scheduler pass failed:', error);
    } finally {
      running = false;
    }
  };

  void pass();
  timer = window.setInterval(pass, settings.schedulerIntervalMinutes * 60 * 1000);

  // Coming back to the tab is the other moment a pass is worth running: someone
  // who left Duly open overnight gets the morning's reminders without a reload.
  const onVisibilityGuarded = () => {
    // The same guard as the timer: a visibility change during a slow pass
    // used to start a second one alongside it.
    if (!document.hidden) void pass();
  };
  document.addEventListener('visibilitychange', onVisibilityGuarded);
  visibilityHandler = onVisibilityGuarded;
}

/** The installed visibility handler, so stopScheduler can remove exactly it. */
let visibilityHandler: (() => void) | null = null;

export function stopScheduler(): void {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }
}

/** True while a pass is in flight, so the UI can show a quiet indicator. */
export function isSchedulerBusy(): boolean {
  return running;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* Re-exported so features can apply rules without importing the engine. */
export type { RuleApplication } from './rules';
