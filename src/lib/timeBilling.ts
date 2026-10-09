/**
 * Billing tracked time and expenses onto an invoice.
 *
 * The plan's item 1: "Invoice unbilled time" creates time lines grouped by
 * project or date. The rate is the entry's override, else the project's hourly
 * rate. Grouping by project keeps one line per project with the entries
 * listed in the line's notes; grouping by date reads like a timesheet.
 *
 * The plan's item 2: an expense becomes an expense line, optionally marked up.
 * The markup is applied to the amount override, which is what an expense line
 * prices by.
 */

import type { TimeEntry, Expense, Project } from '@/core/schemas/automation';
import type { DocumentLine } from '@/core/schemas/document';
import { documentLineSchema } from '@/core/schemas/document';
import { newEntity } from '@/core/schemas/common';

export interface UnbilledGroup {
  /** Project id, or the date for date grouping. */
  key: string;
  label: string;
  entries: TimeEntry[];
  /** Total hours, as a number from the 4-decimal strings. */
  hours: number;
  amountMinor: number;
}

export type TimeGrouping = 'project' | 'date';

/** The rate one entry bills at: its override, else the project's rate. */
export function entryRate(entry: TimeEntry, projects: Project[]): number {
  if (entry.rateOverride !== null) return entry.rateOverride;
  return projects.find((p) => p.id === entry.projectId)?.hourlyRate ?? 0;
}

/** Group unbilled entries — billable ones that have never been invoiced. */
export function unbilledTimeGroups(
  entries: TimeEntry[],
  projects: Project[],
  grouping: TimeGrouping,
): UnbilledGroup[] {
  const billable = entries.filter((e) => e.billable && !e.invoicedOnDocumentId);
  const groups = new Map<string, UnbilledGroup>();

  for (const entry of billable) {
    const key = grouping === 'project' ? (entry.projectId ?? 'no-project') : entry.date;
    const label =
      grouping === 'project'
        ? (projects.find((p) => p.id === entry.projectId)?.name ?? 'No project')
        : entry.date;
    const group = groups.get(key) ?? { key, label, entries: [], hours: 0, amountMinor: 0 };
    const hours = Number.parseFloat(entry.hours) || 0;
    group.entries.push(entry);
    group.hours += hours;
    group.amountMinor += Math.round(hours * entryRate(entry, projects));
    groups.set(key, group);
  }

  return [...groups.values()];
}

/** One time line per group; the entries' descriptions list in the notes. */
export function timeLinesFromGroups(
  groups: UnbilledGroup[],
  projects: Project[],
  documentId: string,
  taxCodeId: string | null,
): DocumentLine[] {
  return groups.map((group) => {
    const rate = group.entries[0] ? entryRate(group.entries[0], projects) : 0;
    return documentLineSchema.parse({
      ...newEntity({}),
      documentId,
      type: 'time',
      description: group.label,
      notes: group.entries
        .map((e) => e.description || e.activity)
        .filter(Boolean)
        .join('\n'),
      quantity: group.hours.toFixed(4),
      unit: 'hours',
      unitPrice: rate,
      taxCodeId,
    });
  });
}

/** One expense line per expense, marked up by its markupPercent. */
export function expenseLines(
  expenses: Expense[],
  documentId: string,
  taxCodeId: string | null,
): DocumentLine[] {
  return expenses.map((expense) =>
    documentLineSchema.parse({
      ...newEntity({}),
      documentId,
      type: 'expense',
      description: expense.supplier ? `${expense.supplier} — ${expense.description}` : expense.description,
      quantity: '1',
      unit: 'each',
      amountOverride: Math.round(
        expense.amount * (1 + (Number.parseFloat(expense.markupPercent) || 0) / 100),
      ),
      taxCodeId: expense.taxCodeId ?? taxCodeId,
    }),
  );
}

/** Mark entries as invoiced, so they never bill twice. */
export function markTimeInvoiced(
  entries: TimeEntry[],
  documentId: string,
  lineIdByEntry: Map<string, string>,
): TimeEntry[] {
  return entries.map((entry) => ({
    ...entry,
    invoicedOnDocumentId: documentId,
    invoicedLineId: lineIdByEntry.get(entry.id) ?? null,
    updatedAt: new Date().toISOString(),
  }));
}
