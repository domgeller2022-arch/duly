import { describe, expect, it } from 'vitest';
import type { Document } from '@/core/schemas';
import { deriveDocumentStatus, isOpenDocument, moveLine } from '@/core/documents';

const STAMPS = {
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

/** Only the three figures these tests read, so the fixture stays readable. */
const money = (total: number, paid: number) =>
  ({ total, paid, balance: total - paid }) as unknown as Document['totals'];

function doc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc_1',
    type: 'invoice',
    profileId: 'prof_1',
    issueDate: '2026-01-01',
    dueDate: '2026-01-31',
    status: 'finalised',
    currency: 'AUD',
    totals: money(100000, 0),
    ...STAMPS,
    ...overrides,
  } as Document;
}

const at = (document: Document, balance: number, today = '2026-01-15') =>
  deriveDocumentStatus({ document, balance, today });

describe('deriveDocumentStatus', () => {
  it('leaves a draft a draft', () => {
    expect(at(doc({ status: 'draft' }), 100000)).toBe('draft');
  });

  it('is paid once nothing is outstanding', () => {
    expect(at(doc(), 0)).toBe('paid');
    expect(at(doc(), -5000, '2026-06-01')).toBe('paid'); // an overpayment is still paid
  });

  it('is overdue the day after the due date, not on it', () => {
    expect(at(doc(), 100000, '2026-01-31')).toBe('finalised');
    expect(at(doc(), 100000, '2026-02-01')).toBe('overdue');
  });

  it('is partially paid once money has come in and some is still owed', () => {
    const partPaid = doc({ totals: money(100000, 40000) });
    expect(at(partPaid, 60000)).toBe('partially_paid');
  });

  it('is overdue rather than partially paid when both are true', () => {
    const partPaid = doc({ totals: money(100000, 40000) });
    expect(at(partPaid, 60000, '2026-02-15')).toBe('overdue');
  });

  it('keeps `sent` for a document that really was sent and has nothing paid', () => {
    expect(at(doc({ status: 'sent' }), 100000)).toBe('sent');
  });

  it('never invents `sent`, because nothing here has sent anything', () => {
    // The bug this replaced: the overdue sweep wrote `sent` when an invoice stopped
    // being overdue, claiming it had been emailed when it never had. A document that
    // genuinely was sent keeps its status — that is a different case.
    for (const status of ['finalised', 'overdue', 'partially_paid'] as const) {
      expect(at(doc({ status }), 100000, '2026-01-15'), status).not.toBe('sent');
    }
  });

  it('returns an overdue invoice to finalised once it is back in date', () => {
    // The bug this replaced: the overdue sweep wrote `sent` here, and a derivation
    // that echoed the current status would leave `overdue` stuck on forever.
    expect(at(doc({ status: 'overdue' }), 100000, '2026-02-15')).toBe('overdue');
    expect(at(doc({ status: 'overdue' }), 100000, '2026-01-15')).toBe('finalised');
  });

  it('returns an overdue part-paid invoice to partially paid', () => {
    const partPaid = doc({ status: 'overdue', totals: money(100000, 40000) });
    expect(at(partPaid, 60000, '2026-01-15')).toBe('partially_paid');
  });

  it('never derives away a terminal or pre-lifecycle state', () => {
    expect(at(doc({ status: 'void' }), 100000)).toBe('void');
    expect(at(doc({ status: 'void' }), 0)).toBe('void');
    expect(at(doc({ type: 'quote', status: 'accepted' }), 0)).toBe('accepted');
    expect(at(doc({ type: 'quote', status: 'expired' }), 0)).toBe('expired');
    expect(at(doc({ type: 'quote', status: 'declined' }), 0)).toBe('declined');
  });

  it('treats a document with no due date as never overdue', () => {
    expect(at(doc({ dueDate: null }), 100000, '2027-01-01')).toBe('finalised');
  });

  it('self-heals a contradictory record: `paid` with a balance outstanding', () => {
    // Nothing has been paid and it is not overdue, so `paid` was wrong and the
    // derivation says what is actually true.
    expect(at(doc({ status: 'paid' }), 100000)).toBe('finalised');
  });
});

describe('isOpenDocument', () => {
  it('is true only for statuses still moving through the lifecycle', () => {
    for (const status of ['finalised', 'sent', 'partially_paid', 'overdue'] as const) {
      expect(isOpenDocument(doc({ status })), status).toBe(true);
    }
    for (const status of ['draft', 'paid', 'void', 'expired', 'accepted', 'declined'] as const) {
      expect(isOpenDocument(doc({ status })), status).toBe(false);
    }
  });
});

describe('moveLine', () => {
  const line = (id: string, position: number) =>
    ({ id, position }) as unknown as Parameters<typeof moveLine>[0][number];

  it('reorders and renumbers, which is what makes drag-to-reorder safe', () => {
    const moved = moveLine([line('a', 0), line('b', 1), line('c', 2)], 0, 2);
    expect(moved.map((l) => l.id)).toEqual(['b', 'c', 'a']);
    expect(moved.map((l) => l.position)).toEqual([0, 1, 2]);
  });

  it('is a no-op for an out-of-range source', () => {
    const lines = [line('a', 0), line('b', 1)];
    expect(moveLine(lines, -1, 1).map((l) => l.id)).toEqual(['a', 'b']);
  });
});
