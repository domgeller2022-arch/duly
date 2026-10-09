import { describe, expect, it } from 'vitest';
import type { BusinessProfile, Document } from '@/core/schemas';
import { businessProfileSchema } from '@/core/schemas/crm';
import { newEntity } from '@/core/schemas/common';
import {
  defaultTaxCodeFor,
  draftsAffectedByChange,
  gstChangeAt,
  gstHistoryOf,
  gstRegistrationDates,
  gstStatusAt,
  withGstChange,
} from '@/core/validation/gst';

/** A profile with no history, as an install that predates the history field has. */
function profile(overrides: Partial<BusinessProfile> = {}): BusinessProfile {
  return businessProfileSchema.parse(newEntity({ name: 'Acme', ...overrides }));
}

function draft(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    type: 'invoice',
    profileId: 'prof_1',
    issueDate: '2026-06-01',
    status: 'draft',
    currency: 'AUD',
    ...overrides,
  } as Document;
}

describe('gstHistoryOf', () => {
  it('synthesises a single entry for a profile with no history', () => {
    expect(gstHistoryOf({ gstRegistered: true, gstHistory: [], gstRegisteredFrom: '2025-01-01' })).toEqual([
      { registered: true, from: '2025-01-01', note: '' },
    ]);
  });

  it('uses the oldest possible date when there is no effective date', () => {
    const [entry] = gstHistoryOf({ gstRegistered: false, gstHistory: [] });
    expect(entry.from).toBe('0000-01-01');
  });

  it('sorts a history that was written out of order', () => {
    const history = gstHistoryOf({
      gstRegistered: true,
      gstHistory: [
        { registered: true, from: '2026-07-01', note: '' },
        { registered: false, from: '2025-01-01', note: '' },
      ],
    });
    expect(history.map((c) => c.from)).toEqual(['2025-01-01', '2026-07-01']);
  });
});

describe('gstStatusAt', () => {
  const history = [
    { registered: false, from: '2025-01-01', note: '' },
    { registered: true, from: '2026-07-01', note: 'Registered from 1 July' },
  ];
  const business = { gstRegistered: true, gstHistory: history };

  it('is false before the first change', () => {
    expect(gstStatusAt(business, '2024-12-31')).toBe(false);
  });

  it('is true on and after the effective date', () => {
    expect(gstStatusAt(business, '2026-07-01')).toBe(true);
    expect(gstStatusAt(business, '2026-09-30')).toBe(true);
  });

  it('is false the day before the effective date', () => {
    expect(gstStatusAt(business, '2026-06-30')).toBe(false);
  });

  it('agrees with the current flag for today and later', () => {
    expect(gstStatusAt(business, '2030-01-01')).toBe(business.gstRegistered);
  });

  it('treats a never-registered business as never registered', () => {
    expect(gstStatusAt({ gstRegistered: false, gstHistory: [] }, '2026-01-01')).toBe(false);
  });

  it('handles three changes, returning to unregistered', () => {
    const back = {
      gstRegistered: false,
      gstHistory: [
        { registered: false, from: '2024-01-01', note: '' },
        { registered: true, from: '2025-07-01', note: '' },
        { registered: false, from: '2026-07-01', note: '' },
      ],
    };
    expect(gstStatusAt(back, '2025-06-30')).toBe(false);
    expect(gstStatusAt(back, '2025-07-01')).toBe(true);
    expect(gstStatusAt(back, '2026-06-30')).toBe(true);
    expect(gstStatusAt(back, '2026-07-01')).toBe(false);
  });
});

describe('gstChangeAt', () => {
  it('names the change in force, for display', () => {
    const business = {
      gstRegistered: true,
      gstHistory: [
        { registered: false, from: '2025-01-01', note: 'before' },
        { registered: true, from: '2026-07-01', note: 'after' },
      ],
    };
    expect(gstChangeAt(business, '2026-08-01').note).toBe('after');
    expect(gstChangeAt(business, '2026-01-01').note).toBe('before');
  });
});

describe('gstRegistrationDates', () => {
  it('lists only the dates the business was registered from', () => {
    const business = {
      gstRegistered: true,
      gstHistory: [
        { registered: true, from: '2025-07-01', note: '' },
        { registered: false, from: '2026-01-01', note: '' },
        { registered: true, from: '2026-07-01', note: '' },
      ],
    };
    expect(gstRegistrationDates(business)).toEqual(['2025-07-01', '2026-07-01']);
  });
});

describe('draftsAffectedByChange', () => {
  const documents = [
    draft({ id: 'a', issueDate: '2026-08-01' }),
    draft({ id: 'b', issueDate: '2026-05-01' }),
    draft({ id: 'c', issueDate: '2026-08-01', status: 'finalised' }),
    draft({ id: 'd', issueDate: '2026-08-01', status: 'void' }),
    draft({ id: 'e', issueDate: '2026-08-01', profileId: 'prof_other' }),
    draft({ id: 'f', issueDate: '2026-08-01', type: 'proforma' }),
  ];

  it('lists drafts on or after the effective date, for this business only', () => {
    const affected = draftsAffectedByChange(documents, {
      profileId: 'prof_1',
      from: '2026-07-01',
      registered: true,
    });
    expect(affected.map((d) => d.id)).toEqual(['a']);
  });

  it('includes an accepted quote, which is still an open document', () => {
    const affected = draftsAffectedByChange(
      [draft({ id: 'q', status: 'accepted', issueDate: '2026-08-01' })],
      { profileId: 'prof_1', from: '2026-07-01', registered: true },
    );
    expect(affected.map((d) => d.id)).toEqual(['q']);
  });

  it('leaves out a document type whose heading does not depend on registration', () => {
    // A pro-forma invoice is titled "Pro-forma Invoice" either way, so switching
    // GST registration does not change a word on it.
    const affected = draftsAffectedByChange(documents, {
      profileId: 'prof_1',
      from: '2020-01-01',
      registered: true,
    });
    expect(affected.map((d) => d.id)).not.toContain('f');
  });

  it('lists nothing when there are no documents', () => {
    expect(draftsAffectedByChange([], { profileId: 'prof_1', from: '2020-01-01', registered: true })).toEqual(
      [],
    );
  });
});

describe('withGstChange', () => {
  it('records the change and moves the current flag', () => {
    const next = withGstChange(profile({ gstRegistered: false }), {
      registered: true,
      from: '2026-07-01',
      note: 'Registered from 1 July',
    });
    expect(next.gstRegistered).toBe(true);
    expect(next.gstRegisteredFrom).toBe('2026-07-01');
    expect(next.gstHistory).toHaveLength(1);
    expect(gstStatusAt(next, '2026-06-30')).toBe(false);
    expect(gstStatusAt(next, '2026-07-01')).toBe(true);
  });

  it('replaces rather than duplicates an entry for the same date', () => {
    const first = withGstChange(profile(), { registered: true, from: '2026-07-01' });
    const corrected = withGstChange(first, { registered: false, from: '2026-07-01' });
    expect(corrected.gstHistory).toHaveLength(1);
    expect(corrected.gstRegistered).toBe(false);
  });

  it('orders history however the changes arrive', () => {
    let business = profile();
    business = withGstChange(business, { registered: true, from: '2026-07-01' });
    business = withGstChange(business, { registered: false, from: '2024-01-01' });
    expect(business.gstHistory.map((c) => c.from)).toEqual(['2024-01-01', '2026-07-01']);
    expect(gstStatusAt(business, '2025-01-01')).toBe(false);
    expect(gstStatusAt(business, '2026-07-01')).toBe(true);
  });

  it('survives a schema round trip', () => {
    const next = withGstChange(profile(), { registered: true, from: '2026-07-01' });
    expect(businessProfileSchema.parse(next)).toEqual(next);
  });
});

describe('defaultTaxCodeFor', () => {
  it('is GST when registered and no tax when not', () => {
    expect(defaultTaxCodeFor(true)).toBe('tax_gst');
    expect(defaultTaxCodeFor(false)).toBe('tax_zero');
  });
});
