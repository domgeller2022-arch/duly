import { describe, expect, it } from 'vitest';
import { DEFAULT_TAX_CODES } from '@/core/tax/tax';
import { calculate } from '@/core/calc/calculate';
import { runComplianceChecks, countBySeverity } from '@/core/validation/compliance';
import { builtinDesignTemplates } from '@/adapters/web/seed';
import { newBusinessProfile, newClient } from '@/core/schemas/crm';
import { documentLineSchema, documentSchema } from '@/core/schemas/document';
import { settingsSchema } from '@/core/schemas/settings';

const STAMPS = {
  id: 't1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};
const now = STAMPS.createdAt;

function profile() {
  return newBusinessProfile({
    name: 'Acme Pty Ltd',
    abn: '51824753556',
    gstRegistered: true,
    gstHistory: [{ registered: true, from: '2025-07-01', note: '' }],
    gstRegisteredFrom: '2025-07-01',
    brandPrimary: '#1F5E5B',
    brandAccent: '#1F5E5B',
    paymentDetails: {
      methodLabel: 'Direct bank transfer',
      accountName: 'Acme',
      bsb: '062000',
      accountNumber: '12345678',
      payId: 'acme@example',
      bpayBillerCode: '',
      bpayReference: '',
      other: '',
      paymentLink: '',
    },
  });
}
function client() {
  return newClient({ displayName: 'Client Pty Ltd', defaultCurrency: 'AUD' });
}
function doc() {
  return documentSchema.parse({
    ...STAMPS,
    id: 'd1',
    profileId: 't1',
    clientId: 'c1',
    status: 'finalised',
    currency: 'AUD',
    taxMode: 'exclusive',
    taxCodeId: 'tax_gst',
    issueDate: '2026-10-06',
    dueDate: '2026-11-05',
    taxSnapshot: {
      gstRegistered: true,
      heading: 'Tax Invoice',
      codes: {},
      inclusiveGstStatementAllowed: false,
      buyerIdentityRequired: true,
      takenAt: now,
      financialYear: '2026-27',
    },
    totals: {
      currency: 'AUD',
      subtotal: 0,
      discountTotal: 0,
      taxTotal: 0,
      taxMinor: 0,
      total: 0,
      paid: 0,
      balance: 0,
      computedAt: null,
    },
  });
}
function line(id: string) {
  return documentLineSchema.parse({
    ...STAMPS,
    id,
    documentId: 'd1',
    description: 'Consulting',
    quantity: '1',
    unitPrice: 100000,
    taxCodeId: 'tax_gst',
  });
}

describe('template compliance', () => {
  it('every built-in template passes the compliance checker with a complete invoice', () => {
    const templates = builtinDesignTemplates(now);
    for (const template of templates) {
      const result = calculate({
        document: doc(),
        lines: [line('l1')],
        payments: [],
        taxCodes: [...DEFAULT_TAX_CODES],
      });
      const checks = runComplianceChecks({
        document: doc(),
        lines: [line('l1')],
        client: client(),
        profile: profile(),
        settings: settingsSchema.parse({ ...STAMPS }),
        result,
        template,
      });
      expect(countBySeverity(checks).block, template.name).toBe(0);
    }
  });
});
