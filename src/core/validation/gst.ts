/**
 * GST registration over time.
 *
 * The plan makes GST registration a switch *with an effective date*: "changing the
 * switch applies to new documents and open drafts from the effective date", and
 * "finalised documents never change". A single boolean on the profile cannot answer
 * "was this business registered on the day this invoice was issued?" once the switch
 * has moved, which is the only question that matters for a document dated either
 * side of the change.
 *
 * So the profile keeps `gstHistory`: an ordered list of `{ registered, from }`
 * changes. `gstRegistered` remains the current value, because every existing read
 * path uses it and a finalised document never consults this at all — it reads its
 * own frozen tax snapshot.
 *
 * Everything here is pure. `today` is passed in rather than read.
 */

import type { BusinessProfile } from '../schemas/crm';
import type { Document } from '../schemas/document';
import { headingFor } from '../engines/numbering';
import { compareIso } from './dates';

export interface GstChange {
  registered: boolean;
  /** Effective date, `YYYY-MM-DD`. */
  from: string;
  note: string;
}

/**
 * What the history is read from.
 *
 * `gstRegisteredFrom` is optional because it only matters as a fallback for a
 * profile with no history at all, and a caller answering a question about a date
 * already has everything it needs without it.
 */
export interface GstSource {
  gstRegistered: boolean;
  gstHistory: readonly GstChange[];
  gstRegisteredFrom?: string | null;
}

/**
 * The registration history, always ordered and never empty.
 *
 * A profile with no history is a profile that has never changed the switch, so the
 * current value is the answer for every date. That is the fallback rather than a
 * special case, which means an install that predates this module behaves exactly as
 * it did before.
 */
export function gstHistoryOf(profile: GstSource): GstChange[] {
  const history = [...(profile.gstHistory ?? [])].sort((a, b) => compareIso(a.from, b.from));
  if (history.length === 0) {
    return [{ registered: profile.gstRegistered, from: profile.gstRegisteredFrom ?? '0000-01-01', note: '' }];
  }
  return history;
}

/**
 * Was the business registered for GST on a given date?
 *
 * The change in force is the last one whose effective date is on or before the
 * date asked about. With no such change, the business predates the record and is
 * treated as not registered — the same answer a business that never registered has
 * always got.
 */
export function gstStatusAt(profile: GstSource, date: string): boolean {
  let current = false;
  for (const change of gstHistoryOf(profile)) {
    if (compareIso(change.from, date) > 0) break;
    current = change.registered;
  }
  return current;
}

/**
 * The change that applies on a date, for display.
 *
 * Before the first recorded change there is nothing to display, so the answer is a
 * synthetic "not registered" entry — consistent with `gstStatusAt`.
 */
export function gstChangeAt(profile: GstSource, date: string): GstChange {
  let current: GstChange | null = null;
  for (const change of gstHistoryOf(profile)) {
    if (compareIso(change.from, date) > 0) break;
    current = change;
  }
  return current ?? { registered: false, from: '', note: '' };
}

/** Every registered-from date, so the settings screen can show the timeline. */
export function gstRegistrationDates(profile: GstSource): string[] {
  return gstHistoryOf(profile)
    .filter((c) => c.registered)
    .map((c) => c.from)
    .sort(compareIso);
}

/**
 * The draft documents whose printed heading a change would alter.
 *
 * The plan says "Duly lists the drafts that will change and asks you to confirm",
 * so this is what the confirmation dialog shows. Only drafts are listed: a
 * finalised document keeps the heading it was issued with, which is the entire
 * point of the tax snapshot, and a void one is not going anywhere.
 *
 * A draft's heading follows the live profile setting, so nothing is rewritten when
 * the change is saved — listing them is the whole of the confirmation step.
 */
export function draftsAffectedByChange<T extends Document>(
  documents: readonly T[],
  args: { profileId: string; from: string; registered: boolean },
): T[] {
  return documents.filter((doc) => {
    if (doc.profileId !== args.profileId) return false;
    if (doc.status !== 'draft' && doc.status !== 'accepted' && doc.status !== 'declined') return false;
    if (compareIso(doc.issueDate, args.from) < 0) return false;

    const heading = headingFor(args.registered, doc.type);
    return heading !== headingFor(!args.registered, doc.type);
  });
}

/**
 * Record a change to the switch.
 *
 * The last entry is replaced when the effective date matches an existing one, so
 * correcting a date does not leave two contradictory entries for the same day.
 * Reads `gstHistory` rather than `gstHistoryOf`, because the synthetic fallback
 * entry that helper returns for an install with no history must never be written
 * back — that would freeze today's answer as if it had always applied.
 *
 * Returns a new profile; the caller persists it.
 */
export function withGstChange(
  profile: BusinessProfile,
  change: { registered: boolean; from: string; note?: string },
  /** The app's today, so the switch agrees with the app's timezone. */
  today = new Date().toISOString().slice(0, 10),
): BusinessProfile {
  const history = [...(profile.gstHistory ?? [])]
    .filter((c) => c.from !== change.from)
    .concat({ registered: change.registered, from: change.from, note: change.note ?? '' })
    .sort((a, b) => compareIso(a.from, b.from));

  // The switch shows the status today. A change dated for the future is
  // recorded — drafts issued on or after that date follow it — but it must
  // not flip the current registration until the date arrives.
  return {
    ...profile,
    gstRegistered: gstStatusAt({ gstRegistered: profile.gstRegistered, gstHistory: history }, today),
    gstRegisteredFrom: change.from,
    gstHistory: history,
  };
}

/**
 * The GST tax code a document issued on a date should default to.
 *
 * "On: the default tax code is GST 10%. Off: the default tax code is no GST." A
 * business that registers mid-year therefore starts charging GST on documents it
 * issues after the effective date without every existing draft being touched.
 */
export function defaultTaxCodeFor(registered: boolean): string {
  return registered ? 'tax_gst' : 'tax_zero';
}
