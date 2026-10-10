/**
 * Due-date engine.
 *
 * The due date is always derived from the issue date and the payment terms, so
 * changing a date can never leave a stale due date behind. Dates are handled as
 * plain `YYYY-MM-DD` strings and manipulated as UTC calendar days, which avoids
 * the daylight-saving trap where "due in 30 days" silently becomes 29 or 31
 * days depending on which side of the DST change the invoice sits.
 *
 * All functions take an explicit `today` so the engine stays pure and testable.
 */

import { addDays, format, isValid, parseISO } from 'date-fns';
import type { PaymentTerms } from '../schemas/crm';
import { DEFAULT_TERMS, findTerm } from '../schemas/crm';
import { getCurrency } from '../money/currencies';

export type DateString = string;

/**
 * A user-defined payment term, as stored in settings: an id, a label and a day
 * count (null for a label-only "custom date" term).
 */
export interface CustomTerm {
  id: string;
  name: string;
  days: number | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Today in the app's configured time zone, as `YYYY-MM-DD`.
 *
 * `Intl.DateTimeFormat` resolves the zone for us, which matters when a laptop
 * travels: the same moment is a different calendar date in Sydney and in
 * London, and a schedule should fire on the local day.
 */
export function todayIn(timeZone: string): DateString {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return format(new Date(), 'yyyy-MM-dd');
  }
}

export function parseDate(value: string): Date {
  const d = parseISO(value);
  if (!isValid(d)) throw new Error(`Invalid date: ${value}`);
  return d;
}

export function isDateString(value: unknown): value is DateString {
  return typeof value === 'string' && ISO_DATE.test(value) && isValid(parseISO(value));
}

export function addDaysIso(iso: DateString, days: number): DateString {
  return format(addDays(parseDate(iso), days), 'yyyy-MM-dd');
}

export function diffDays(from: DateString, to: DateString): number {
  // Compare at UTC midnight so the answer is a whole number of calendar days.
  const a = Date.UTC(...(dateParts(from) as [number, number, number]));
  const b = Date.UTC(...(dateParts(to) as [number, number, number]));
  return Math.round((b - a) / 86_400_000);
}

function dateParts(iso: DateString): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m - 1, d];
}

export function compareIso(a: DateString, b: DateString): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isBefore(a: DateString, b: DateString): boolean {
  return compareIso(a, b) < 0;
}

export function isAfter(a: DateString, b: DateString): boolean {
  return compareIso(a, b) > 0;
}

export function minIso(dates: DateString[]): DateString | null {
  const valid = dates.filter(isDateString);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => (isBefore(a, b) ? a : b));
}

export function maxIso(dates: DateString[]): DateString | null {
  const valid = dates.filter(isDateString);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => (isAfter(a, b) ? a : b));
}

/* ------------------------------------------------------------------ */
/* Terms                                                               */
/* ------------------------------------------------------------------ */

/**
 * Resolve a terms id to a `PaymentTerms` record, falling back to Net 30 so a
 * missing or renamed term can never leave an invoice without a due date.
 */
export function resolveTerms(
  termsId: string,
  custom?: CustomTerm[],
): PaymentTerms {
  const built = findTerm(termsId);
  if (built) return built;
  const c = custom?.find((t) => t.id === termsId);
  if (c) {
    return {
      id: c.id,
      name: c.name,
      days: c.days,
      kind: c.days === null ? 'custom_date' : 'net_days',
    };
  }
  return findTerm('net_30') ?? DEFAULT_TERMS[3];
}

export function termLabel(terms: PaymentTerms): string {
  switch (terms.kind) {
    case 'due_on_receipt':
      return 'Due on receipt';
    case 'net_days':
      return terms.days === null ? 'Net 30' : `Net ${terms.days}`;
    case 'end_of_next_month':
      return 'End of next month';
    default:
      return terms.name;
  }
}

/**
 * Last calendar day of the month following `issueDate`.
 *
 * "End of next month" on 15 December 2026 is 31 January 2027. `date-fns` adds
 * months by clamping rather than overflowing, so the month is advanced first
 * and the last day taken from the resulting month.
 */
export function endOfNextMonth(issueDate: DateString): DateString {
  const d = parseDate(issueDate);
  const next = new Date(d.getFullYear(), d.getMonth() + 2, 0);
  return format(next, 'yyyy-MM-dd');
}

/**
 * The due date for an issue date and a set of terms.
 * `end_of_next_month` with a days override is honoured when supplied.
 */
export function dueDateFor(issueDate: DateString, termsId: string, customTerms?: CustomTerm[]): DateString {
  const terms = resolveTerms(termsId, customTerms);
  switch (terms.kind) {
    case 'due_on_receipt':
      return issueDate;
    case 'end_of_next_month':
      return endOfNextMonth(issueDate);
    case 'net_days':
    case 'custom_date':
    default:
      return addDaysIso(issueDate, terms.days ?? 30);
  }
}

/** Days past due, 0 when not yet due, negative when still in credit. */
export function daysOverdue(dueDate: DateString | null, today: DateString): number {
  if (!dueDate) return 0;
  return Math.max(0, diffDays(dueDate, today));
}

/** True when today is strictly after the due date — the ATO-style overdue mark. */
export function isOverdue(dueDate: DateString | null, today: DateString): boolean {
  if (!dueDate) return false;
  return isAfter(today, dueDate);
}

/** "due today" and "due in 3 days" drive the amber badge. */
export function daysUntilDue(dueDate: DateString | null, today: DateString): number | null {
  if (!dueDate) return null;
  return diffDays(today, dueDate);
}

/* ------------------------------------------------------------------ */
/* Australian financial year                                           */
/* ------------------------------------------------------------------ */

/**
 * Australian Financial Year label, e.g. "2026-27".
 *
 * The ATO year runs 1 July to 30 June, which is why FY27 means July 2026 to
 * June 2027. The start month is configurable but defaults to 7.
 */
export function financialYear(iso: DateString, startMonth = 7): string {
  const [y, m] = iso.split('-').map(Number);
  if (m >= startMonth) return `${y}-${String(y + 1).slice(2)}`;
  return `${y - 1}-${String(y).slice(2)}`;
}

/** Stable key used by numbering sequences that reset on the financial year. */
export function financialYearKey(iso: DateString, startMonth = 7): string {
  return financialYear(iso, startMonth);
}

/** Inclusive first and last day of a financial year, as `YYYY-MM-DD`. */
export function financialYearRange(label: string, startMonth = 7): { start: DateString; end: DateString } {
  const [startYearStr] = label.split('-');
  const startYear = Number(startYearStr);
  const start = format(new Date(startYear, startMonth - 1, 1), 'yyyy-MM-dd');
  // Day zero of the month the year ends in, which is its last day.
  const end = format(new Date(startYear + 1, startMonth - 1, 0), 'yyyy-MM-dd');
  return { start, end };
}

/**
 * The BAS period a date falls in.
 *
 * The ATO lodgement quarters end 30 September, 31 December, 31 March and
 * 30 June, so the period boundaries are offset from the calendar year. The
 * returned range is inclusive and ready to filter reports by.
 */
export function basPeriod(iso: DateString): { label: string; start: DateString; end: DateString } {
  const d = parseDate(iso);
  const month = d.getMonth(); // 0-11
  const year = d.getFullYear();

  // Quarters start at these zero-based month indexes; the 9 wraps the year.
  const quarters: { startMonth: number; label: string }[] = [
    { startMonth: 0, label: 'Jan–Mar' },
    { startMonth: 3, label: 'Apr–Jun' },
    { startMonth: 6, label: 'Jul–Sep' },
    { startMonth: 9, label: 'Oct–Dec' },
  ];

  const quarter =
    quarters.find((q, i) => q.startMonth <= month && (i === 3 || month < quarters[i + 1].startMonth)) ??
    quarters[3];
  const periodYear = quarter.startMonth === 0 ? year : year;

  const start = format(new Date(periodYear, quarter.startMonth, 1), 'yyyy-MM-dd');
  const end = format(new Date(periodYear, quarter.startMonth + 3, 0), 'yyyy-MM-dd');
  return { label: `${quarter.label} ${periodYear}`, start, end };
}

/** Month key for reports and the `{month}` line-text variable. */
export function monthKey(iso: DateString): string {
  return iso.slice(0, 7);
}

export function monthLabel(iso: DateString, style: 'short' | 'long' = 'long'): string {
  const d = parseDate(iso);
  return style === 'long' ? format(d, 'MMMM yyyy') : format(d, 'MMM yyyy');
}

export function monthRange(iso: DateString): { start: DateString; end: DateString } {
  const d = parseDate(iso);
  return {
    start: format(new Date(d.getFullYear(), d.getMonth(), 1), 'yyyy-MM-dd'),
    end: format(new Date(d.getFullYear(), d.getMonth() + 1, 0), 'yyyy-MM-dd'),
  };
}

/** The month before `iso`, used by the `{prev_month}` variable. */
export function previousMonth(iso: DateString): DateString {
  const d = parseDate(iso);
  return format(new Date(d.getFullYear(), d.getMonth() - 1, 15), 'yyyy-MM-dd');
}

/* ------------------------------------------------------------------ */
/* Quote validity                                                      */
/* ------------------------------------------------------------------ */

/** A quote expires on the day after its validity date, not on the date itself. */
export function isQuoteExpired(validUntil: DateString | null, today: DateString): boolean {
  if (!validUntil) return false;
  return isAfter(today, validUntil);
}

export function quoteExpiry(validFrom: DateString, validityDays: number): DateString {
  return addDaysIso(validFrom, validityDays);
}

/* ------------------------------------------------------------------ */
/* Date display                                                        */
/* ------------------------------------------------------------------ */

export type DateFormatStyle = 'DMY' | 'MDY' | 'ISO' | 'YMD';

/**
 * Format a stored date for a person.
 *
 * Dates live in the database as `YYYY-MM-DD` precisely so that display is a
 * presentation decision: an Australian business sees 06/10/2026, a US client
 * can be shown 10/06/2026, and the stored value never moves.
 */
export function formatDate(iso: DateString, style: DateFormatStyle = 'DMY'): string {
  if (!isDateString(iso)) return String(iso ?? '');
  const [y, m, d] = iso.split('-');
  switch (style) {
    case 'MDY':
      return `${m}/${d}/${y}`;
    case 'ISO':
      return iso;
    case 'YMD':
      return `${y}-${m}-${d}`;
    case 'DMY':
    default:
      return `${d}/${m}/${y}`;
  }
}

/** File-name-safe date: 06-10-2026. Hyphens so no path separator can appear. */
export function formatDateForFilename(iso: DateString): string {
  return isDateString(iso) ? iso.split('-').join('-') : 'undated';
}

/** Human relative label used in the document list. */
export function relativeDays(from: DateString, to: DateString): string {
  const days = diffDays(from, to);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 0) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}

/** Number of whole days a quote or invoice has been outstanding. */
export function ageInDays(from: DateString, to: DateString): number {
  return Math.max(0, diffDays(from, to));
}

/**
 * Deposit due dates: once a deposit is paid, the balance falls due a set number
 * of days after the payment, or on a fixed date if one was given.
 */
export function depositBalanceDueDate(
  depositPaidOn: DateString,
  termsId: string,
  explicit: DateString | null,
  customTerms?: CustomTerm[],
): DateString {
  if (explicit && isDateString(explicit)) return explicit;
  return dueDateFor(depositPaidOn, termsId, customTerms);
}

/** Currency-aware sort so an AUD list and a JPY list still order sensibly. */
export function compareAmounts(aMinor: number, bMinor: number, currency: string): number {
  void getCurrency(currency);
  return aMinor - bMinor;
}

/* ------------------------------------------------------------------ */
/* Calendar helpers for the recurring scheduler                       */
/* ------------------------------------------------------------------ */

/** The year, zero-based month and day of a stored date. */
export function datePartsOf(iso: DateString): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m: m - 1, d };
}

/** First day of the month containing `iso`. */
export function startOfMonthOf(iso: DateString): DateString {
  const { y, m } = datePartsOf(iso);
  return format(new Date(y, m, 1), 'yyyy-MM-dd');
}

/**
 * The last *business* day of the month containing `iso`.
 *
 * Australian public holidays are not consulted — that would need a maintained
 * holiday calendar, and a schedule that runs one day late is far better than one
 * that skips a month. Weekends are handled, which is the common case.
 */
export function lastBusinessDayOf(iso: DateString): DateString {
  const { y, m } = datePartsOf(iso);
  let day = new Date(y, m + 1, 0);
  while (day.getDay() === 0 || day.getDay() === 6) day = new Date(y, m, day.getDate() - 1);
  return format(day, 'yyyy-MM-dd');
}

/**
 * The first `dayOfWeek` at or after `from + minDays` days.
 *
 * `dayOfWeek` is 0 for Sunday. Pass `minDays: 1` for a strictly later weekday;
 * `minDays: 0` may return `from` itself when `from` already falls on that day,
 * which is what first-run resolution wants but "next run" does not.
 */
export function nextWeekdayAfter(from: DateString, dayOfWeek: number, minDays: number): DateString {
  const base = parseDate(from);
  const start = new Date(base.getTime());
  start.setDate(start.getDate() + Math.max(0, minDays));
  while (start.getDay() !== ((dayOfWeek % 7) + 7) % 7) {
    start.setDate(start.getDate() + 1);
  }
  return format(start, 'yyyy-MM-dd');
}

/** Add whole months, clamping the day into the target month. */
export function addMonths(iso: DateString, months: number): DateString {
  const { y, m, d } = datePartsOf(iso);
  const target = new Date(y, m + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, lastDay));
  return format(target, 'yyyy-MM-dd');
}
