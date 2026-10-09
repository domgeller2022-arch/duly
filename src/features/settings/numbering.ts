/**
 * Numbering helpers for the settings screen.
 *
 * `reserveDocumentNumber` creates a sequence lazily on first use, so sequences are
 * not required for numbering to work. `ensureNumberSequences` exists so the setup
 * wizard and settings can show a pattern and a preview for every document type
 * *before* any document exists — otherwise the numbering screen is empty on a
 * fresh install and the plan's "never reuses a number" guarantee is invisible.
 *
 * `issued` is preserved on every row. That array is the record of numbers already
 * handed out; overwriting it would allow a number to be issued twice.
 */

import type { DocumentType, NumberSequence } from '@/core/schemas';
import { DEFAULT_PATTERNS, DOCUMENT_TYPES } from '@/core/schemas';
import { periodKeyFor, renderNumber } from '@/core/engines/numbering';
import { storage } from '@/adapters';

/** Ensure one sequence exists per document type for a business. */
export async function ensureNumberSequences(
  profileId: string,
  date: string,
  resetRule: NumberSequence['resetRule'] = 'yearly',
): Promise<NumberSequence[]> {
  const db = storage();
  const existing = await db.listNumberSequences(profileId);
  const known = new Set(existing.map((s) => s.documentType));
  const now = new Date().toISOString();
  const created: NumberSequence[] = [];

  for (const documentType of DOCUMENT_TYPES) {
    if (known.has(documentType)) continue;
    const sequence: NumberSequence = {
      id: `seq_${profileId}_${documentType}`,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      profileId,
      documentType,
      pattern: DEFAULT_PATTERNS[documentType] ?? 'INV-{YYYY}-{####}',
      nextValue: 1,
      resetRule,
      periodKey: periodKeyFor(date, resetRule),
      issued: [],
      startAt: 1,
    };
    await db.saveNumberSequence(sequence);
    created.push(sequence);
  }

  return [...existing, ...created];
}

/** The sequence for one document type, or a fresh preview row if none exists yet. */
export function sequenceFor(
  sequences: NumberSequence[],
  profileId: string,
  documentType: DocumentType,
  date: string,
): NumberSequence {
  const found = sequences.find((s) => s.profileId === profileId && s.documentType === documentType);
  if (found) return found;

  const now = new Date().toISOString();
  return {
    id: `seq_${profileId}_${documentType}`,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    profileId,
    documentType,
    pattern: DEFAULT_PATTERNS[documentType] ?? 'INV-{YYYY}-{####}',
    nextValue: 1,
    resetRule: 'yearly',
    periodKey: periodKeyFor(date, 'yearly'),
    issued: [],
    startAt: 1,
  };
}

/**
 * The next number a pattern would produce on a date.
 *
 * Applies the reset rule first, so a counter that has rolled into a new calendar or
 * financial year previews the value that would actually be issued. Tokens needing
 * document context render as their own name rather than blanking, so a pattern that
 * depends on them is visible at a glance.
 */
export function previewFor(
  sequence: NumberSequence,
  date: string,
  documentType: DocumentType,
  financialYearStartMonth = 7,
): string {
  const periodChanged =
    sequence.resetRule !== 'never' &&
    periodKeyFor(date, sequence.resetRule, financialYearStartMonth) !== sequence.periodKey;

  return renderNumber(sequence.pattern, {
    value: periodChanged ? sequence.startAt : sequence.nextValue,
    date,
    documentType,
    financialYearStartMonth,
  });
}
