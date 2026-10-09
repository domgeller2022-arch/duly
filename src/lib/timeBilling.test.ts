import { describe, expect, it } from 'vitest';
import {
  unbilledTimeGroups,
  timeLinesFromGroups,
  expenseLines,
  markTimeInvoiced,
  entryRate,
} from './timeBilling';
import type { TimeEntry, Expense, Project } from '@/core/schemas/automation';

function stamp(id: string) {
  return {
    id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  };
}

const PROJECTS: Project[] = [
  {
    ...stamp('proj-1'),
    name: 'Website',
    clientId: 'client-1',
    code: 'WEB',
    hourlyRate: 15000,
    budget: 0,
    status: 'active',
    colour: '#1F5E5B',
    notes: '',
  },
  {
    ...stamp('proj-2'),
    name: 'Retainer',
    clientId: 'client-1',
    code: 'RET',
    hourlyRate: 12000,
    budget: 0,
    status: 'active',
    colour: '#1F5E5B',
    notes: '',
  },
];

function entry(overrides: Partial<TimeEntry>): TimeEntry {
  return {
    ...stamp('e-' + Math.random()),
    clientId: 'client-1',
    projectId: 'proj-1',
    date: '2026-10-01',
    hours: '2',
    description: 'Consulting',
    activity: '',
    staff: '',
    billable: true,
    rateOverride: null,
    timerStartedAt: 0,
    invoicedOnDocumentId: null,
    invoicedLineId: null,
    ...overrides,
  };
}

function expense(overrides: Partial<Expense>): Expense {
  return {
    ...stamp('x-' + Math.random()),
    clientId: 'client-1',
    projectId: null,
    date: '2026-10-01',
    supplier: 'Acme Supplies',
    description: 'Widgets',
    amount: 10000,
    currency: 'AUD',
    gstAmount: 1000,
    category: '',
    billable: true,
    markupPercent: '10',
    taxCodeId: null,
    receiptAttachmentId: null,
    invoicedOnDocumentId: null,
    paymentMethod: '',
    ...overrides,
  };
}

describe('unbilledTimeGroups', () => {
  it('groups by project and sums hours and amounts', () => {
    const groups = unbilledTimeGroups(
      [entry({ hours: '2' }), entry({ projectId: 'proj-2', hours: '1.5', description: 'Support' })],
      PROJECTS,
      'project',
    );
    expect(groups).toHaveLength(2);
    const website = groups.find((g) => g.key === 'proj-1')!;
    expect(website.hours).toBe(2);
    expect(website.amountMinor).toBe(30000);
    const retainer = groups.find((g) => g.key === 'proj-2')!;
    expect(retainer.amountMinor).toBe(18000);
  });

  it('groups by date when asked', () => {
    const groups = unbilledTimeGroups([entry({}), entry({ date: '2026-10-02' })], PROJECTS, 'date');
    expect(groups).toHaveLength(2);
  });

  it('skips non-billable and already-invoiced entries', () => {
    const groups = unbilledTimeGroups(
      [entry({ billable: false }), entry({ invoicedOnDocumentId: 'doc-1' })],
      PROJECTS,
      'project',
    );
    expect(groups).toHaveLength(0);
  });

  it('honours a rate override over the project rate', () => {
    expect(entryRate(entry({ rateOverride: 20000 }), PROJECTS)).toBe(20000);
    expect(entryRate(entry({}), PROJECTS)).toBe(15000);
  });
});

describe('lines', () => {
  it('one time line per group with notes and 4-decimal quantity', () => {
    const groups = unbilledTimeGroups(
      [entry({ hours: '2' }), entry({ description: 'Pairing', date: '2026-10-01', projectId: 'proj-1' })],
      PROJECTS,
      'project',
    );
    const lines = timeLinesFromGroups(groups, PROJECTS, 'doc-1', 'tax_gst');
    expect(lines).toHaveLength(1);
    expect(lines[0].type).toBe('time');
    expect(lines[0].quantity).toBe('4.0000');
    expect(lines[0].unitPrice).toBe(15000);
    expect(lines[0].notes).toContain('Consulting');
    expect(lines[0].notes).toContain('Pairing');
  });

  it('one expense line per expense, marked up', () => {
    const lines = expenseLines([expense({})], 'doc-1', 'tax_gst');
    expect(lines).toHaveLength(1);
    expect(lines[0].type).toBe('expense');
    expect(lines[0].amountOverride).toBe(11000);
    expect(lines[0].description).toBe('Acme Supplies — Widgets');
  });
});

describe('markTimeInvoiced', () => {
  it('marks entries with the document and line ids', () => {
    const entries = [entry({}), entry({})];
    const marked = markTimeInvoiced(
      entries,
      'doc-9',
      new Map([
        [entries[0].id, 'line-1'],
        [entries[1].id, 'line-2'],
      ]),
    );
    expect(marked.every((m) => m.invoicedOnDocumentId === 'doc-9')).toBe(true);
    expect(marked[0].invoicedLineId).toBe('line-1');
    expect(marked[0].updatedAt).not.toBe(entries[0].updatedAt);
  });
});
