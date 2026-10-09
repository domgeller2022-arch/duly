import { describe, expect, it } from 'vitest';
import type { Client, Contact, Document, Payment } from '@/core/schemas';
import { clientAddresses, clientStats, clientStatsById, daysToPayLabel, primaryContact } from '@/core/crm';

const STAMPS = {
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

function doc(overrides: Partial<Document> & Pick<Document, 'id'>): Document {
  return {
    type: 'invoice',
    profileId: 'prof_1',
    clientId: 'cli_1',
    issueDate: '2026-01-01',
    dueDate: '2026-01-31',
    status: 'sent',
    currency: 'AUD',
    totals: { total: 0, paid: 0, balance: 0 },
    ...STAMPS,
    ...overrides,
  } as Document;
}

function pay(documentId: string, date: string, amount = 0): Payment {
  return { id: `pay_${documentId}_${date}`, documentId, date, amount, ...STAMPS } as Payment;
}

const totals = (total: number, paid: number) =>
  ({ total, paid, balance: total - paid }) as unknown as Document['totals'];

describe('clientStats', () => {
  it('counts nothing for a client with no documents', () => {
    const stats = clientStats({ clientId: 'cli_9', documents: [doc({ id: 'd1' })], payments: [] });
    expect(stats.invoiceCount).toBe(0);
    expect(stats.lifetimeBilled).toBe(0);
    expect(stats.averageDaysToPay).toBeNull();
  });

  it('adds up lifetime billed and outstanding', () => {
    const documents = [
      doc({ id: 'd1', totals: totals(10000, 0) }),
      doc({ id: 'd2', totals: totals(25000, 25000) }),
      doc({ id: 'd3', totals: totals(5000, 1000) }),
    ];
    const stats = clientStats({ clientId: 'cli_1', documents, payments: [] });

    expect(stats.lifetimeBilled).toBe(40000);
    expect(stats.outstanding).toBe(14000);
    expect(stats.paidToDate).toBe(26000);
    expect(stats.invoiceCount).toBe(3);
  });

  it('ignores drafts, voids and deleted documents', () => {
    const documents = [
      doc({ id: 'd1', status: 'draft', totals: totals(99999, 0) }),
      doc({ id: 'd2', status: 'void', totals: totals(88888, 0) }),
      doc({ id: 'd3', deletedAt: '2026-02-01T00:00:00.000Z', totals: totals(77777, 0) }),
      doc({ id: 'd4', totals: totals(1000, 0) }),
    ];
    const stats = clientStats({ clientId: 'cli_1', documents, payments: [] });

    expect(stats.lifetimeBilled).toBe(1000);
  });

  it('ignores documents belonging to another client or another business', () => {
    const documents = [
      doc({ id: 'd1', clientId: 'cli_2', totals: totals(5000, 0) }),
      doc({ id: 'd2', profileId: 'prof_2', totals: totals(6000, 0) }),
      doc({ id: 'd3', totals: totals(1000, 0) }),
    ];
    const stats = clientStats({ clientId: 'cli_1', documents, payments: [], profileId: 'prof_1' });
    expect(stats.lifetimeBilled).toBe(1000);
  });

  it('subtracts a credit note, whose total is already negative', () => {
    const documents = [
      doc({ id: 'd1', totals: totals(10000, 0) }),
      doc({ id: 'c1', type: 'credit_note', totals: totals(-2000, -2000) }),
    ];
    const stats = clientStats({ clientId: 'cli_1', documents, payments: [] });

    expect(stats.lifetimeBilled).toBe(8000);
    expect(stats.creditNoteCount).toBe(1);
    expect(stats.outstanding).toBe(10000);
  });

  it('records the most recent invoice date', () => {
    const documents = [
      doc({ id: 'd1', issueDate: '2026-03-01', totals: totals(100, 0) }),
      doc({ id: 'd2', issueDate: '2026-07-15', totals: totals(100, 0) }),
      doc({ id: 'd3', issueDate: '2026-01-01', totals: totals(100, 0) }),
    ];
    expect(clientStats({ clientId: 'cli_1', documents, payments: [] }).lastInvoicedAt).toBe('2026-07-15');
  });

  it('measures days to pay from issue to the last payment', () => {
    const documents = [
      doc({ id: 'd1', issueDate: '2026-01-01', status: 'paid', totals: totals(1000, 1000) }),
    ];
    const payments = [pay('d1', '2026-01-20'), pay('d1', '2026-01-25')];

    const stats = clientStats({ clientId: 'cli_1', documents, payments });
    expect(stats.averageDaysToPay).toBe(24);
    expect(stats.settledCount).toBe(1);
  });

  it('averages over settled invoices only', () => {
    const documents = [
      doc({ id: 'd1', issueDate: '2026-01-01', status: 'paid', totals: totals(1000, 1000) }),
      doc({ id: 'd2', issueDate: '2026-01-01', status: 'paid', totals: totals(1000, 1000) }),
      // Still outstanding, so it says nothing about how long they take to pay.
      doc({ id: 'd3', issueDate: '2026-01-01', status: 'sent', totals: totals(1000, 0) }),
    ];
    const payments = [pay('d1', '2026-01-11'), pay('d2', '2026-01-21')];

    const stats = clientStats({ clientId: 'cli_1', documents, payments });
    expect(stats.settledCount).toBe(2);
    expect(stats.averageDaysToPay).toBe(15);
  });

  it('has no average when nothing has been paid', () => {
    const documents = [doc({ id: 'd1', status: 'sent', totals: totals(1000, 0) })];
    expect(clientStats({ clientId: 'cli_1', documents, payments: [] }).averageDaysToPay).toBeNull();
  });

  it('ignores a payment dated before the invoice was issued', () => {
    const documents = [
      doc({ id: 'd1', issueDate: '2026-01-10', status: 'paid', totals: totals(1000, 1000) }),
    ];
    const payments = [pay('d1', '2026-01-01')];

    const stats = clientStats({ clientId: 'cli_1', documents, payments });
    expect(stats.averageDaysToPay).toBeNull();
    expect(stats.settledCount).toBe(0);
  });

  it('counts overdue invoices against today', () => {
    const documents = [
      doc({ id: 'd1', dueDate: '2026-01-31', status: 'sent', totals: totals(1000, 0) }),
      doc({ id: 'd2', dueDate: '2026-08-31', status: 'sent', totals: totals(1000, 0) }),
      doc({ id: 'd3', dueDate: '2026-01-31', status: 'paid', totals: totals(1000, 1000) }),
    ];
    const stats = clientStats({ clientId: 'cli_1', documents, payments: [], today: '2026-06-01' });
    expect(stats.overdueCount).toBe(1);
  });

  it('counts quotes and credit notes separately from invoices', () => {
    const documents = [
      doc({ id: 'q1', type: 'quote', status: 'accepted', totals: totals(500, 0) }),
      doc({ id: 'i1', totals: totals(1000, 0) }),
    ];
    const stats = clientStats({ clientId: 'cli_1', documents, payments: [] });
    expect(stats.quoteCount).toBe(1);
    expect(stats.invoiceCount).toBe(1);
  });
});

describe('clientStatsById', () => {
  it('produces one entry per client that has documents', () => {
    const documents = [
      doc({ id: 'd1', clientId: 'a', totals: totals(100, 0) }),
      doc({ id: 'd2', clientId: 'b', totals: totals(200, 0) }),
      doc({ id: 'd3', clientId: 'a', totals: totals(300, 0) }),
    ];
    const map = clientStatsById({ documents, payments: [] });

    expect(map.size).toBe(2);
    expect(map.get('a')?.lifetimeBilled).toBe(400);
    expect(map.get('b')?.lifetimeBilled).toBe(200);
  });

  it('ignores documents with no client', () => {
    expect(clientStatsById({ documents: [doc({ id: 'd1', clientId: null })], payments: [] }).size).toBe(0);
  });
});

describe('daysToPayLabel', () => {
  it('phrases the average for a table', () => {
    expect(daysToPayLabel(null)).toBe('—');
    expect(daysToPayLabel(0)).toBe('Same day');
    expect(daysToPayLabel(1)).toBe('1 day');
    expect(daysToPayLabel(24)).toBe('24 days');
  });
});

describe('primaryContact', () => {
  const client = { id: 'cli_1', invoiceContactId: 'c_pick' } as Client;

  const contacts = [
    { id: 'c_a', clientId: 'cli_1', isPrimary: true, receivesInvoices: true } as Contact,
    { id: 'c_pick', clientId: 'cli_1', isPrimary: false, receivesInvoices: false } as Contact,
    { id: 'c_b', clientId: 'cli_1', isPrimary: false, receivesInvoices: true } as Contact,
  ];

  it('honours the explicit choice', () => {
    expect(primaryContact(client, contacts)?.id).toBe('c_pick');
  });

  it('falls back to the primary receiving contact', () => {
    expect(primaryContact({ ...client, invoiceContactId: null } as Client, contacts)?.id).toBe('c_a');
  });

  it('falls back to any receiving contact when none is primary', () => {
    const noPrimary = contacts.filter((c) => !c.isPrimary);
    expect(primaryContact({ ...client, invoiceContactId: null } as Client, noPrimary)?.id).toBe('c_b');
  });

  it('is null when the client has no contacts', () => {
    expect(primaryContact(client, [])).toBeNull();
  });

  it('ignores contacts belonging to another client', () => {
    expect(primaryContact(client, [{ ...contacts[0], clientId: 'cli_2' } as Contact])).toBeNull();
  });
});

describe('clientAddresses', () => {
  const client = {
    id: 'cli_1',
    billingAddress: {
      line1: '1 High St',
      line2: '',
      city: 'Sydney',
      state: 'NSW',
      postcode: '2000',
      country: 'Australia',
      formatted: null,
    },
    shippingAddress: {
      line1: '2 Warehouse Rd',
      line2: '',
      city: 'Melbourne',
      state: 'VIC',
      postcode: '3000',
      country: 'Australia',
      formatted: null,
    },
  } as Client;

  it('lists billing and shipping when both are filled in', () => {
    const out = clientAddresses(client);
    expect(out.map((a) => a.label)).toEqual(['Billing', 'Shipping']);
    expect(out[0].lines).toEqual(['1 High St', 'Sydney', 'NSW', '2000', 'Australia']);
  });

  it('leaves out an address with nothing in it', () => {
    expect(clientAddresses({ ...client, shippingAddress: null } as Client)).toHaveLength(1);
  });

  it('is empty when nothing is filled in', () => {
    const blank = {
      billingAddress: {
        line1: '',
        line2: '',
        city: '',
        state: '',
        postcode: '',
        country: '',
        formatted: null,
      },
      shippingAddress: null,
    } as Client;
    expect(clientAddresses(blank)).toEqual([]);
  });
});
