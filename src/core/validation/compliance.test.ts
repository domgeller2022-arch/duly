import { describe, expect, it } from 'vitest';
import type {
  BusinessProfile,
  Client,
  DesignTemplate,
  Document,
  DocumentLine,
  Settings,
} from '@/core/schemas';
import { newBusinessProfile, newClient } from '@/core/schemas/crm';
import { documentLineSchema, documentSchema } from '@/core/schemas/document';
import { settingsSchema } from '@/core/schemas/settings';
import { designTemplateSchema } from '@/core/schemas/template';
import { DEFAULT_TAX_CODES } from '@/core/tax/tax';
import { calculate, type CalculationResult } from '@/core/calc/calculate';
import {
  buyerIdentityThreshold,
  countBySeverity,
  runComplianceChecks,
  summarise,
} from '@/core/validation/compliance';

const STAMPS = {
  id: 'x',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

/**
 * Built with the form-shaped factories rather than parsed, because several of these
 * tests need a record that is *missing* something the schema would require — an
 * unnamed seller is precisely the case the compliance checker exists to catch.
 */
function profile(overrides: Partial<BusinessProfile> = {}): BusinessProfile {
  return newBusinessProfile({
    name: 'Acme Pty Ltd',
    abn: '51824753556',
    gstRegistered: true,
    gstHistory: [{ registered: true, from: '2025-07-01', note: '' }],
    gstRegisteredFrom: '2025-07-01',
    ...overrides,
  });
}

function client(overrides: Partial<Client> = {}): Client {
  return newClient({ displayName: 'Acme Client', ...overrides });
}

function settings(overrides: Partial<Settings> = {}): Settings {
  return settingsSchema.parse({ ...STAMPS, ...overrides });
}

/** A complete, compliant invoice — every test starts here and breaks one thing. */
function document(overrides: Partial<Document> = {}): Document {
  return documentSchema.parse({
    ...STAMPS,
    id: 'doc_1',
    type: 'invoice',
    profileId: 'prof_1',
    clientId: 'cli_1',
    issueDate: '2026-10-06',
    dueDate: '2026-11-05',
    status: 'finalised',
    currency: 'AUD',
    taxMode: 'exclusive',
    taxCodeId: 'tax_gst',
    taxSnapshot: {
      gstRegistered: true,
      heading: 'Tax Invoice',
      codes: {},
      inclusiveGstStatementAllowed: false,
      buyerIdentityRequired: true,
      takenAt: '2026-10-06T00:00:00.000Z',
      financialYear: '2026-27',
    },
    ...overrides,
  });
}

function line(overrides: Partial<DocumentLine> = {}): DocumentLine {
  return documentLineSchema.parse({
    ...STAMPS,
    id: `line_${Math.random().toString(36).slice(2)}`,
    documentId: 'doc_1',
    description: 'Consulting',
    quantity: '1',
    unitPrice: 100000,
    taxCodeId: 'tax_gst',
    ...overrides,
  });
}

function run(
  args: {
    document?: Document;
    lines?: DocumentLine[];
    client?: Client | null;
    profile?: BusinessProfile;
    settings?: Settings;
    template?: DesignTemplate;
  } = {},
) {
  const doc = args.document ?? document();
  const lines = args.lines ?? [line()];
  const who = args.client === undefined ? client() : args.client;
  const business = args.profile ?? profile();
  const config = args.settings ?? settings();

  const result: CalculationResult = calculate({
    document: doc,
    lines,
    payments: [],
    taxCodes: [...DEFAULT_TAX_CODES],
  });

  return runComplianceChecks({
    document: doc,
    lines,
    client: who,
    profile: business,
    settings: config,
    result,
    template:
      args.template ??
      designTemplateSchema.parse({
        id: 'test_template',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        name: 'Test',
      }),
  });
}

const ids = (checks: { id: string }[]) => checks.map((c) => c.id);

describe('drafts: the checks run on what the document would print, not on a missing snapshot', () => {
  it('a GST-registered draft passes — its heading is the one it would print', () => {
    // A draft has no tax snapshot. The checker used to assume "Invoice" and
    // block every GST-registered submit with a heading error.
    const draft = document({ status: 'draft', taxSnapshot: null });
    const checks = run({ document: draft });
    expect(countBySeverity(checks).block).toBe(0);
  });

  it('a pro-forma is not subject to the tax-invoice heading rule', () => {
    // Pro-formas are not tax invoices; their heading is "Pro-forma Invoice"
    // and the ATO rules do not apply to them.
    const draft = document({ status: 'draft', taxSnapshot: null, type: 'proforma' });
    const checks = run({ document: draft });
    expect(checks.filter((c) => c.severity === 'block' && c.id === 'heading')).toHaveLength(0);
  });

  it('the GST status is read at the issue date, not from today’s switch', () => {
    // Registered from 2027-07-01 only: a document issued 2026-10-06 is not a
    // tax invoice, whatever the current switch says.
    const business = profile({
      gstRegistered: true,
      gstRegisteredFrom: '2027-07-01',
      gstHistory: [{ registered: true, from: '2027-07-01', note: '' }],
    });
    const draft = document({ status: 'draft', taxSnapshot: null });
    const checks = run({ document: draft, profile: business });
    expect(checks.filter((c) => c.id === 'heading')).toHaveLength(0);
  });
});

describe('the seven details a tax invoice under $1,000 must carry', () => {
  it('passes a complete invoice', () => {
    const blocking = countBySeverity(run()).block;
    expect(blocking).toBe(0);
  });

  it('blocks a heading that is not "Tax Invoice" when registered', () => {
    const checks = run({
      document: document({
        taxSnapshot: {
          gstRegistered: true,
          heading: 'Invoice',
          codes: {},
          inclusiveGstStatementAllowed: false,
          buyerIdentityRequired: true,
          takenAt: '2026-10-06T00:00:00.000Z',
          financialYear: '2026-27',
        },
      }),
    });
    expect(ids(checks)).toContain('heading');
    expect(checks.find((c) => c.id === 'heading')?.severity).toBe('block');
  });

  it('blocks a missing seller name', () => {
    const checks = run({ profile: profile({ name: '' }) });
    expect(ids(checks)).toContain('seller-name');
  });

  it('blocks a missing ABN, and reports a failing checksum differently', () => {
    expect(ids(run({ profile: profile({ abn: '' }) }))).toContain('seller-abn-missing');
    expect(ids(run({ profile: profile({ abn: '51824753550' }) }))).toContain('seller-abn-invalid');
  });

  it('blocks a missing issue date', () => {
    // Built by hand: the schema would refuse it, which is the point of the check.
    const base = document();
    const checks = run({ document: { ...base, issueDate: '' } as Document });
    expect(ids(checks)).toContain('issue-date');
  });

  it('warns about a line with no description', () => {
    const checks = run({ lines: [line({ description: '' })] });
    expect(ids(checks)).toContain('line-descriptions');
  });

  it('does not require any of this when the business is not registered', () => {
    const checks = run({
      profile: profile({
        gstRegistered: false,
        gstHistory: [{ registered: false, from: '2025-07-01', note: '' }],
        gstRegisteredFrom: '2025-07-01',
        abn: '',
      }),
      document: document({
        taxSnapshot: {
          gstRegistered: false,
          heading: 'Invoice',
          codes: {},
          inclusiveGstStatementAllowed: false,
          buyerIdentityRequired: false,
          takenAt: '2026-10-06T00:00:00.000Z',
          financialYear: '2026-27',
        },
      }),
    });
    expect(ids(checks)).not.toContain('seller-abn-missing');
    expect(ids(checks)).not.toContain('heading');
  });
});

describe('the buyer identity rule at $1,000 and above', () => {
  const overThreshold = [line({ unitPrice: 150000 })];

  it('warns about a missing buyer identity above it', () => {
    const checks = run({ client: client({ displayName: '' }), lines: overThreshold });
    expect(ids(checks)).toContain('buyer-name');
  });

  it('says nothing below it', () => {
    const checks = run({ client: client({ displayName: '' }), lines: [line({ unitPrice: 50000 })] });
    expect(ids(checks)).not.toContain('buyer-name');
  });

  it('counts the threshold as inclusive, at exactly $1,000', () => {
    const checks = run({ client: client({ displayName: '' }), lines: [line({ unitPrice: 100000 })] });
    expect(ids(checks)).toContain('buyer-name');
  });

  it('scales the threshold to the document currency', () => {
    // The bug this guards: a raw minor-unit constant made the threshold ¥100,000 on
    // a zero-decimal currency and 100.000 on a three-decimal one.
    expect(buyerIdentityThreshold('AUD')).toBe(100_000);
    expect(buyerIdentityThreshold('JPY')).toBe(1_000);
    expect(buyerIdentityThreshold('KWD')).toBe(1_000_000);
    expect(buyerIdentityThreshold('USD')).toBe(100_000);
  });

  it('applies the scaled threshold, not the AUD one', () => {
    // ¥1,500 is 1,500 minor units. Under the old fixed constant of 100,000 this was
    // read as $1,500 and skipped; at the JPY threshold of 1,000 it is correctly over.
    const jpy = run({
      document: document({ currency: 'JPY' }),
      client: client({ displayName: '' }),
      lines: [line({ unitPrice: 1500 })],
    });
    expect(ids(jpy)).toContain('buyer-name');

    // And 300 yen is under it.
    const small = run({
      document: document({ currency: 'JPY' }),
      client: client({ displayName: '' }),
      lines: [line({ unitPrice: 300 })],
    });
    expect(ids(small)).not.toContain('buyer-name');
  });

  it('can be switched off', () => {
    const checks = run({
      client: client({ displayName: '' }),
      lines: overThreshold,
      settings: settings({ warnOnMissingBuyerIdentity: false }),
    });
    expect(ids(checks)).not.toContain('buyer-name');
  });
});

describe('mixed taxable and non-taxable sales', () => {
  it('asks for the printed marker where taxable and non-taxable are mixed', () => {
    // This is the case the ATO rule names, and it was the case the check never ran in.
    // The template does not print the key: the buyer cannot tell which lines are taxable.
    const checks = run({
      lines: [line({ taxCodeId: 'tax_gst' }), line({ taxCodeId: 'tax_gst_free' })],
      template: designTemplateSchema.parse({
        id: 'tpl_1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        name: 'Test',
        extras: { taxMarkerKey: false },
      }),
    });
    expect(ids(checks)).toContain('zero-rated-marker');
  });

  it('says nothing once the template prints the key', () => {
    const checks = run({
      lines: [line({ taxCodeId: 'tax_gst' }), line({ taxCodeId: 'tax_gst_free' })],
      template: designTemplateSchema.parse({
        id: 'tpl_1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        name: 'Test',
        extras: { taxMarkerKey: true },
      }),
    });
    expect(ids(checks)).not.toContain('zero-rated-marker');
  });

  it('warns when the template has the key switched off', () => {
    const checks = run({
      lines: [line({ taxCodeId: 'tax_gst' }), line({ taxCodeId: 'tax_gst_free' })],
      template: designTemplateSchema.parse({
        id: 'tpl_1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        name: 'Test',
        extras: { taxMarkerKey: false },
      }),
    });
    expect(ids(checks)).toContain('zero-rated-marker');
  });

  it('says nothing about the marker when every line is taxable', () => {
    expect(
      ids(run({ lines: [line({ taxCodeId: 'tax_gst' }), line({ taxCodeId: 'tax_gst' })] })),
    ).not.toContain('zero-rated-marker');
  });

  it('says nothing when an all-zero-rated document explains itself', () => {
    // Every line GST-free and labelled: no mixing, so no marker rule to break.
    const checks = run({ lines: [line({ taxCodeId: 'tax_gst_free' })] });
    expect(ids(checks)).not.toContain('gst-zero-without-reason');
    expect(ids(checks)).not.toContain('zero-rated-marker');
  });

  it('flags a taxable line that charged nothing', () => {
    // A taxable code on a zero-value line: GST stays 0, but the code claims taxable.
    const checks = run({ lines: [line({ taxCodeId: 'tax_gst', unitPrice: 0 })] });
    expect(ids(checks)).toContain('gst-zero-without-reason');
  });
});

describe('the inclusive GST statement', () => {
  it('permits it at exactly 10%', () => {
    const checks = run({ document: document({ taxMode: 'inclusive' }) });
    expect(ids(checks)).not.toContain('inclusive-statement');
  });

  it('warns at any other rate, because the ATO allowance is only one eleventh', () => {
    const nzCode = { ...DEFAULT_TAX_CODES[0], id: 'tax_gst_nz', rate: '0.15' };
    const taxCodes = [...DEFAULT_TAX_CODES.map((c) => (c.id === 'tax_gst' ? nzCode : c))];
    const doc = document({
      taxMode: 'inclusive',
      taxCodeId: 'tax_gst_nz',
      // The snapshot is where the checker reads the rate a document was issued at,
      // which is the point of a snapshot.
      taxSnapshot: {
        gstRegistered: true,
        heading: 'Tax Invoice',
        codes: { tax_gst_nz: { name: 'GST', rate: '0.15', type: 'gst', label: null } },
        inclusiveGstStatementAllowed: false,
        buyerIdentityRequired: true,
        takenAt: '2026-10-06T00:00:00.000Z',
        financialYear: '2026-27',
      },
    });
    const lines = [line({ taxCodeId: 'tax_gst_nz' })];

    const result = calculate({ document: doc, lines, payments: [], taxCodes });
    const checks = runComplianceChecks({
      document: doc,
      lines,
      client: client(),
      profile: profile(),
      settings: settings(),
      result,
    });

    expect(ids(checks)).toContain('inclusive-statement');
  });
});

describe('an unregistered business', () => {
  it('is reminded it may print the "no GST" note', () => {
    const checks = run({
      profile: profile({
        gstRegistered: false,
        gstHistory: [{ registered: false, from: '2025-07-01', note: '' }],
        gstRegisteredFrom: '2025-07-01',
      }),
      document: document({
        taxSnapshot: {
          gstRegistered: false,
          heading: 'Invoice',
          codes: {},
          inclusiveGstStatementAllowed: false,
          buyerIdentityRequired: false,
          takenAt: '2026-10-06T00:00:00.000Z',
          financialYear: '2026-27',
        },
      }),
    });
    expect(ids(checks)).toContain('gst-on-unregistered');
  });
});

describe('every check names its rule', () => {
  it('so the reasoning is visible rather than a bare red cross', () => {
    for (const check of run({ client: client({ displayName: '' }) })) {
      expect(check.rule.length).toBeGreaterThan(10);
      expect(check.title.length).toBeGreaterThan(0);
      expect(check.detail.length).toBeGreaterThan(0);
    }
  });

  it('orders blocking findings first', () => {
    const checks = run({ client: client({ displayName: '' }), profile: profile({ abn: '' }) });
    const severities = checks.map((c) => c.severity);
    const rank = { block: 0, warn: 1, info: 2 } as const;
    for (let i = 1; i < severities.length; i++) {
      expect(rank[severities[i]]).toBeGreaterThanOrEqual(rank[severities[i - 1]]);
    }
  });
});

describe('summarise', () => {
  it('says nothing is wrong when nothing is wrong', () => {
    expect(summarise([])).toBe('All checks passed');
  });

  it('counts the problems', () => {
    const summary = summarise(run({ client: client({ displayName: '' }) }));
    expect(summary.length).toBeGreaterThan(0);
  });
});
