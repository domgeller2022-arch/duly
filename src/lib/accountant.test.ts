import { describe, expect, it } from 'vitest';
import {
  xeroContactsCsv,
  xeroInvoicesCsv,
  xeroPaymentsCsv,
  myobContactsCsv,
  myobInvoicesCsv,
  myobPaymentsCsv,
  gstBasPeriodsCsv,
  type AccountantDocument,
} from './accountant';
import { calculate } from '@/core/calc/calculate';
import { DEFAULT_TAX_CODES } from '@/core/tax/tax';
import { newClient } from '@/core/schemas/crm';
import { documentSchema, documentLineSchema } from '@/core/schemas/document';

const STAMP = {
  id: 'r1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

/** The client the fixture document belongs to, by the id the invoice carries. */
function clientFor(doc: ReturnType<typeof invoice>) {
  const client = newClient({ displayName: 'Acme Pty Ltd' });
  return { ...client, id: doc.clientId ?? client.id };
}

function invoice() {
  return documentSchema.parse({
    ...STAMP,
    id: 'inv-1',
    type: 'invoice',
    profileId: 'p1',
    clientId: newClient({ displayName: 'Acme Pty Ltd' }).id,
    status: 'finalised',
    currency: 'AUD',
    number: 'INV-2026-0001',
    issueDate: '2026-10-06',
    dueDate: '2026-11-05',
    totals: {
      currency: 'AUD',
      subtotal: 100000,
      discountTotal: 0,
      tax: 10000,
      taxTotal: 10000,
      taxMinor: 0,
      total: 110000,
      paid: 0,
      balance: 110000,
      computedAt: null,
    },
  });
}

describe('xero exports', () => {
  it('contacts use the Xero layout with the required column first', () => {
    const csv = xeroContactsCsv([
      newClient({ displayName: 'Acme Pty Ltd', email: 'a@b.example', taxId: '51824753556' }),
    ]);
    expect(csv).toContain(
      '*ContactName,ContactFirstName,ContactLastName,EmailAddress,BankAccountDetails,TaxNumber',
    );
    expect(csv).toContain('Acme Pty Ltd');
  });

  it('invoices carry one row per line with the Xero columns', () => {
    const doc = invoice();
    const line = documentLineSchema.parse({
      ...STAMP,
      id: 'line-1',
      documentId: doc.id,
      type: 'item',
      description: 'Consulting',
      quantity: '2',
      unitPrice: 50000,
      taxCodeId: 'tax_gst',
    });
    const result = calculate({ document: doc, lines: [line], payments: [], taxCodes: [...DEFAULT_TAX_CODES] });
    const bundle: AccountantDocument[] = [{ document: doc, lines: [line], result }];
    const csv = xeroInvoicesCsv(bundle, [clientFor(doc)], [...DEFAULT_TAX_CODES]);
    expect(csv).toContain(
      '*ContactName,*InvoiceNumber,*InvoiceDate,DueDate,InventoryItemCode,Description,*Quantity,*UnitAmount,AccountCode,*TaxType',
    );
    expect(csv).toContain('Consulting');
    expect(csv).toContain('GST on Income');
  });

  it('payments reference the invoice number', () => {
    const doc = invoice();
    const csv = xeroPaymentsCsv(
      [
        {
          ...STAMP,
          id: 'pay-1',
          documentId: doc.id,
          date: '2026-10-07',
          amount: 110000,
          method: 'bank_transfer',
          reference: 'INV-2026-0001',
          note: '',
          isDeposit: false,
          bankTransactionId: null,
        },
      ],
      [doc],
    );
    expect(csv).toContain('*InvoiceNumber,*AccountCode,*Date,*Amount,Reference');
    expect(csv).toContain('INV-2026-0001');
    expect(csv).toContain('1100');
  });
});

describe('myob exports', () => {
  it('contacts and sales use the MYOB layout', () => {
    expect(myobContactsCsv([newClient({ displayName: 'Acme Pty Ltd' })])).toContain(
      'Co./Last Name,First Name,Card ID,Addr 1 - Line 1,Email,ABN',
    );
    const doc = invoice();
    const line = documentLineSchema.parse({
      ...STAMP,
      id: 'line-1',
      documentId: doc.id,
      type: 'item',
      description: 'Consulting',
      quantity: '1',
      unitPrice: 100000,
    });
    const result = calculate({ document: doc, lines: [line], payments: [], taxCodes: [...DEFAULT_TAX_CODES] });
    const bundle: AccountantDocument[] = [{ document: doc, lines: [line], result }];
    expect(myobInvoicesCsv(bundle, [clientFor(doc)], [...DEFAULT_TAX_CODES])).toContain(
      '*Co./Last Name,*Invoice No.,*Date,Description,*Quantity,*Unit Price,Tax Code',
    );
    expect(myobPaymentsCsv([], [doc])).toContain('*Invoice No.,*Date,*Amount Received,Method,Reference');
  });
});

describe('gst per BAS period', () => {
  it('sums GST per quarter from finalised invoices', () => {
    const csv = gstBasPeriodsCsv([invoice()]);
    expect(csv).toContain('BAS period,Invoices,GST collected,Total invoiced');
    expect(csv).toContain('2026-Q4');
    expect(csv).toContain('1100'); // total
    expect(csv).toContain('100'); // GST
  });
});
