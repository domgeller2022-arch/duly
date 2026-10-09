import { describe, expect, it } from 'vitest';
import {
  parseOfx,
  parseQif,
  parseBankCsv,
  parseStatement,
  matchTransactions,
  type BankTransaction,
} from './bankImport';
import { newClient } from '@/core/schemas/crm';
import { documentSchema } from '@/core/schemas/document';

const OFX = `<OFX>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN><DTPOSTED>20261001<TRNAMT>-45.90<NAME>Coffee Co<MEMO>Flat white x3<FITID>FIT-1</STMTTRN>
<STMTTRN><DTPOSTED>20261002<TRNAMT>1870.00<NAME>ACME PTY LTD<MEMO>INV-2026-0001<FITID>FIT-2</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</OFX>`;

const QIF = `!Type:Bank
D1/10'2026
T-45.90
PCoffee Co
MFlat white
^
D2/10'2026
T1870.00
PACME PTY LTD
MINV-2026-0001
^`;

const CSV = `Date,Description,Amount
2026-10-01,Coffee Co,-45.90
2026-10-02,ACME PTY LTD INV-2026-0001,1870.00
2026-10-03,Journal only,0.00`;

function tx(overrides: Partial<BankTransaction>): BankTransaction {
  return {
    date: '2026-10-02',
    amountMinor: 187000,
    description: 'ACME PTY LTD',
    reference: 'INV-2026-0001',
    externalId: '',
    source: 'csv',
    ...overrides,
  };
}

function invoice(overrides: Record<string, unknown>) {
  return documentSchema.parse({
    id: 'inv-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    type: 'invoice',
    profileId: 'p1',
    clientId: newClient({ displayName: 'C' }).id,
    status: 'finalised',
    currency: 'AUD',
    issueDate: '2026-10-01',
    dueDate: '2026-11-01',
    totals: {
      currency: 'AUD',
      subtotal: 0,
      discountTotal: 0,
      taxTotal: 0,
      taxMinor: 0,
      total: 187000,
      paid: 0,
      balance: 187000,
      computedAt: null,
    },
    ...overrides,
  });
}

describe('parsers', () => {
  it('parses OFX blocks', () => {
    const parsed = parseOfx(OFX);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].date).toBe('2026-10-01');
    expect(parsed[0].amountMinor).toBe(-4590);
    expect(parsed[0].description).toBe('Coffee Co');
    expect(parsed[1].externalId).toBe('FIT-2');
    expect(parsed[1].amountMinor).toBe(187000);
  });

  it('parses QIF blocks with day-first dates', () => {
    const parsed = parseQif(QIF);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].date).toBe('2026-10-01');
    expect(parsed[0].amountMinor).toBe(-4590);
    expect(parsed[1].reference).toBe('INV-2026-0001');
  });

  it('parses bank CSV by header names', () => {
    const parsed = parseBankCsv(CSV);
    expect(parsed).toHaveLength(2);
    expect(parsed[1].amountMinor).toBe(187000);
    expect(parsed[1].description).toContain('ACME');
  });

  it('sniffs the format', () => {
    expect(parseStatement(OFX)).toHaveLength(2);
    expect(parseStatement(QIF)).toHaveLength(2);
    expect(parseStatement(CSV)).toHaveLength(2);
  });
});

describe('matchTransactions', () => {
  it('matches by reference and amount with high confidence', () => {
    const doc = invoice({ number: 'INV-2026-0001' });
    const results = matchTransactions([tx({})], [doc], []);
    expect(results[0].status).toBe('payment');
    expect(results[0].invoiceId).toBe('inv-1');
    expect(results[0].confidence).toBe('high');
  });

  it('matches by amount alone with medium confidence', () => {
    const doc = invoice({ number: '' });
    const results = matchTransactions([tx({ reference: '', description: 'Deposit from client' })], [doc], []);
    expect(results[0].status).toBe('payment');
    expect(results[0].confidence).toBe('medium');
  });

  it('skips money out and already-known transactions', () => {
    const doc = invoice({});
    const results = matchTransactions(
      [tx({ amountMinor: -5000 }), tx({ externalId: 'FIT-9' })],
      [doc],
      [
        {
          id: 'pay-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          deletedAt: null,
          documentId: 'inv-1',
          date: '2026-10-02',
          amount: 50000,
          method: 'bank_transfer',
          reference: '',
          note: '',
          isDeposit: false,
          bankTransactionId: 'FIT-9',
        },
      ],
    );
    expect(results[0].status).toBe('unmatched');
    expect(results[1].status).toBe('duplicate');
  });

  it('does not match when two invoices share the balance', () => {
    const doc = invoice({ number: '' });
    const other = invoice({ id: 'inv-2', number: '' });
    const results = matchTransactions([tx({ reference: '', description: 'Payment' })], [doc, other], []);
    expect(results[0].status).toBe('unmatched');
  });
});
