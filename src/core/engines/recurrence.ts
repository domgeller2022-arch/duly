/**
 * Recurring schedules and the date arithmetic behind them.
 *
 * The scheduler is deliberately conservative. Because the app runs locally with
 * no server, jobs fire on start and every fifteen minutes while it is open; if
 * the app was closed for two months, a monthly schedule produces one draft for
 * the current period rather than sixty catch-up drafts. Each run is keyed by its
 * run date, and a key that has already been consumed is skipped, so opening the
 * app five times in one afternoon still yields exactly one invoice.
 *
 * Nothing is ever finalised or emailed automatically in v1: every run creates a
 * draft flagged for review.
 */

import type { Frequency, RecurringSchedule } from '../schemas/automation';
import type { DocumentLine } from '../schemas/document';
import {
  addMonths,
  datePartsOf,
  isAfter,
  isBefore,
  isDateString,
  lastBusinessDayOf,
  nextWeekdayAfter,
  parseDate,
  startOfMonthOf,
} from '../validation/dates';
import { format } from 'date-fns';

/* ------------------------------------------------------------------ */
/* Occurrence maths                                                    */
/* ------------------------------------------------------------------ */

/**
 * The first run date on or after `from` that satisfies the schedule.
 *
 * A schedule that starts on the 15th of the month but is set to run on the 1st
 * should not fire immediately — it should wait for the next 1st.
 */
export function firstRunOnOrAfter(
  schedule: Pick<RecurringSchedule, 'frequency' | 'dayOfMonth' | 'dayOfWeek' | 'startDate'>,
  from: string,
): string {
  const start = schedule.startDate;

  switch (schedule.frequency) {
    case 'weekly':
    case 'fortnightly': {
      const first = nextWeekdayAfter(start, schedule.dayOfWeek, 0);
      return isBefore(first, from)
        ? nextWeekdayAfter(from, schedule.dayOfWeek, schedule.frequency === 'fortnightly' ? 14 : 7)
        : first;
    }
    case 'monthly': {
      const candidate = clampDayToMonth(start, schedule.dayOfMonth);
      if (!isBefore(candidate, from)) return candidate;
      return clampDayToMonth(advanceMonths(monthStartOf(start), 1), schedule.dayOfMonth);
    }
    case 'monthly_last_business_day': {
      const candidate = lastBusinessDayOf(start);
      if (!isBefore(candidate, from)) return candidate;
      return lastBusinessDayOf(advanceMonths(monthStartOf(start), 1));
    }
    case 'quarterly':
    case 'half_yearly':
    case 'yearly': {
      const step = schedule.frequency === 'quarterly' ? 3 : schedule.frequency === 'half_yearly' ? 6 : 12;
      const candidate = clampDayToMonth(start, schedule.dayOfMonth);
      if (!isBefore(candidate, from)) return candidate;
      // Advance in whole steps from the start date so the cadence never drifts.
      let next = candidate;
      for (let i = 0; i < step; i++) next = clampDayToMonth(advanceMonths(next, 1), schedule.dayOfMonth);
      return next;
    }
    default:
      return start;
  }
}

/** The run date immediately after `date`, according to the frequency. */
export function nextRunAfter(
  schedule: Pick<RecurringSchedule, 'frequency' | 'dayOfMonth' | 'dayOfWeek' | 'startDate'>,
  date: string,
): string {
  switch (schedule.frequency) {
    case 'weekly':
      return nextWeekdayAfter(date, schedule.dayOfWeek, 7);
    case 'fortnightly':
      return nextWeekdayAfter(date, schedule.dayOfWeek, 14);
    case 'monthly':
      return clampDayToMonth(advanceMonths(monthStartOf(date), 1), schedule.dayOfMonth);
    case 'monthly_last_business_day':
      return lastBusinessDayOf(advanceMonths(monthStartOf(date), 1));
    case 'quarterly':
      return clampDayToMonth(advanceMonths(monthStartOf(date), 3), schedule.dayOfMonth);
    case 'half_yearly':
      return clampDayToMonth(advanceMonths(monthStartOf(date), 6), schedule.dayOfMonth);
    case 'yearly':
      return clampDayToMonth(advanceMonths(monthStartOf(date), 12), schedule.dayOfMonth);
    default:
      return date;
  }
}

/**
 * Every run date from the schedule's next run up to and including `today`.
 *
 * Bounded by `maxCatchUpRuns`, which is what stops a schedule that has been
 * paused for a year from producing a year of backlogged drafts the first time
 * the app reopens.
 */
export function dueRunDates(
  schedule: RecurringSchedule,
  today: string,
  maxCatchUpRuns = schedule.maxCatchUpRuns,
): string[] {
  if (schedule.paused || !schedule.nextRunDate || !isDateString(schedule.nextRunDate)) return [];

  const dates: string[] = [];
  let cursor = schedule.nextRunDate;

  // The run date itself counts as due, so `cursor === today` is included.
  while (dates.length < maxCatchUpRuns && !isAfter(cursor, today)) {
    dates.push(cursor);
    cursor = nextRunAfter(schedule, cursor);
  }

  return dates;
}

/** Has this schedule's end condition been met? */
export function hasEnded(schedule: RecurringSchedule, today: string): boolean {
  switch (schedule.endCondition) {
    case 'after_runs':
      return schedule.runsCompleted >= schedule.endAfterRuns;
    case 'on_date':
      return !!schedule.endOnDate && !isBefore(today, schedule.endOnDate);
    case 'never':
    default:
      return false;
  }
}

/** Should this schedule run today? */
export function isDue(schedule: RecurringSchedule, today: string): boolean {
  if (schedule.paused) return false;
  if (hasEnded(schedule, today)) return false;
  const dates = dueRunDates(schedule, today);
  return dates.some((d) => d === today);
}

/** A stable idempotency key: one schedule can only produce one draft per run date. */
export function runKey(scheduleId: string, runDate: string): string {
  return `${scheduleId}:${runDate}`;
}

export function alreadyConsumed(schedule: RecurringSchedule, runDate: string): boolean {
  return schedule.consumedRunKeys.includes(runKey(schedule.id, runDate));
}

/** Mark a run as consumed and advance the schedule. Returns a new object. */
export function advance(schedule: RecurringSchedule, runDate: string): RecurringSchedule {
  return {
    ...schedule,
    nextRunDate: nextRunAfter(schedule, runDate),
    lastRunDate: runDate,
    runsCompleted: schedule.runsCompleted + 1,
    consumedRunKeys: [...schedule.consumedRunKeys, runKey(schedule.id, runDate)],
    updatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Line-text variables                                                 */
/* ------------------------------------------------------------------ */

/**
 * Resolve `{month}`, `{prev_month}`, `{period_start}` and `{period_end}` in line
 * descriptions, so "Retainer — {month} {year}" becomes "Retainer — October 2026"
 * on each run without anyone editing it.
 */
export function resolveLineVariables(
  lines: DocumentLine[],
  runDate: string,
  currency = 'AUD',
): DocumentLine[] {
  const periodStart = startOfMonthOf(runDate);
  const periodEnd = lastDayOfMonth(runDate);
  const previous = addMonths(periodStart, -1);
  const previousEnd = lastDayOfMonth(previous);

  const values: Record<string, string> = {
    month: format(parseDate(runDate), 'MMMM'),
    month_short: format(parseDate(runDate), 'MMM'),
    year: runDate.slice(0, 4),
    month_year: format(parseDate(runDate), 'MMMM yyyy'),
    month_year_short: format(parseDate(runDate), 'MMM yyyy'),
    prev_month: format(parseDate(previous), 'MMMM'),
    prev_month_year: format(parseDate(previous), 'MMMM yyyy'),
    period_start: format(parseDate(periodStart), 'd MMMM yyyy'),
    period_end: format(parseDate(periodEnd), 'd MMMM yyyy'),
    prev_period_start: format(parseDate(previous), 'd MMMM yyyy'),
    prev_period_end: format(parseDate(previousEnd), 'd MMMM yyyy'),
    run_date: format(parseDate(runDate), 'd MMMM yyyy'),
    iso_date: runDate,
    currency,
  };

  return lines.map((line) => {
    const next: DocumentLine = { ...line, description: interpolate(line.description, values) };
    if (line.notes) next.notes = interpolate(line.notes, values);
    return next;
  });
}

/**
 * Replace `{token}` in a string. Unknown tokens are left visible rather than
 * blanked, so a typo in a line description is obvious instead of silently
 * deleting words from an invoice.
 */
export function interpolate(template: string, values: Record<string, string>): string {
  if (!template || !template.includes('{')) return template;
  return template.replace(/\{([a-z_]+)\}/gi, (match, key: string) => {
    const value = values[key.toLowerCase()];
    return value === undefined ? match : value;
  });
}

/** The variable names a recurring run understands, for the schedule editor. */
export const LINE_VARIABLES: readonly { token: string; description: string }[] = [
  { token: '{month}', description: 'Full month name, e.g. October' },
  { token: '{month_short}', description: 'Abbreviated month, e.g. Oct' },
  { token: '{year}', description: 'Four-digit year' },
  { token: '{month_year}', description: 'Month and year, e.g. October 2026' },
  { token: '{prev_month}', description: 'Previous month name' },
  { token: '{prev_month_year}', description: 'Previous month and year' },
  { token: '{period_start}', description: 'First day of the run month' },
  { token: '{period_end}', description: 'Last day of the run month' },
  { token: '{prev_period_start}', description: 'First day of the previous month' },
  { token: '{prev_period_end}', description: 'Last day of the previous month' },
  { token: '{run_date}', description: 'The date the run fired' },
  { token: '{currency}', description: 'The document currency code' },
];

/* ------------------------------------------------------------------ */
/* Frequency labels                                                    */
/* ------------------------------------------------------------------ */

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
  monthly_last_business_day: 'Monthly, on the last business day',
  quarterly: 'Quarterly',
  half_yearly: 'Every six months',
  yearly: 'Yearly',
};

/** A sentence describing when a schedule next runs, for the list screen. */
export function describeSchedule(schedule: RecurringSchedule): string {
  const base = FREQUENCY_LABELS[schedule.frequency] ?? schedule.frequency;
  if (schedule.paused) return 'Paused';
  if (hasEnded(schedule, schedule.nextRunDate ?? schedule.startDate)) return 'Finished';
  return `${base} — next ${schedule.nextRunDate ?? 'unscheduled'}`;
}

/* ------------------------------------------------------------------ */
/* Private date helpers                                                */
/* ------------------------------------------------------------------ */

function datePartsOfLocal(iso: string): { y: number; m: number; d: number } {
  return datePartsOf(iso);
}

/** First day of the month containing `iso`. */
export function monthStartOf(iso: string): string {
  return startOfMonthOf(iso);
}

/** Last calendar day of the month containing `iso`. */
export function lastDayOfMonth(iso: string): string {
  const { y, m } = datePartsOfLocal(iso);
  return format(new Date(y, m + 1, 0), 'yyyy-MM-dd');
}

/**
 * Clamp a day-of-month into a month that is too short.
 *
 * A schedule set to the 31st must not skip February; it runs on the 28th (or
 * 29th). Silently dropping the month would be a worse bug than a shifted date.
 */
export function clampDayToMonth(iso: string, dayOfMonth: number): string {
  const { y, m } = datePartsOfLocal(iso);
  const lastDay = new Date(y, m + 1, 0).getDate();
  const day = Math.min(Math.max(1, dayOfMonth), lastDay);
  return format(new Date(y, m, day), 'yyyy-MM-dd');
}

/** Add `count` months from the first of the month, keeping the cadence stable. */
function advanceMonths(iso: string, count: number): string {
  return startOfMonthOf(addMonths(iso, count));
}

/** Re-exported so the schedule editor can validate without importing dates. */
export { datePartsOf, lastBusinessDayOf, nextWeekdayAfter, startOfMonthOf };
