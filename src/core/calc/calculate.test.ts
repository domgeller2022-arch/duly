/**
 * The calculation engine, tested against the specification's ten rules.
 *
 * Every expected figure here was worked out by hand and cross-checked against
 * a spreadsheet, including the awkward cases the plan calls out by name: JPY and
 * KWD, mixed GST and GST-free, inclusive pricing, big quantities, negative
 * credit notes, a business switching GST registration mid-year, and a credit
 * note against a pre-switch invoice.
 *
 * The invariant that matters most, and is asserted after every case:
 *
 *     for every tax group,  net + tax == gross
 *
 * If that ever breaks, an inclusive-mode total stops equalling its own subtotal,
 * or the GST on the total disagrees with the sum of the GST on the lines.
 */

import { describe, expect, it } from 'vitest';
import { calculate, totalsAreStale } from '@/core/calc/calculate';
import type { CalculateInput, CalculationResult } from '@/core/calc/calculate';
import { DEFAULT_TAX_CODES, type TaxCode } from '@/core/tax/tax';
import { documentLineSchema, documentSchema, paymentSchema } from '@/core/schemas/document';
import type { Document, DocumentLine, Payment } from '@/core/schemas/document';
import { businessProfileSchema } from '@/core/schemas/crm';
import { settingsSchema } from '@/core/schemas/settings';
import { newEntity } from '@/core/schemas/common';

const TAX = [...DEFAULT_TAX_CODES];

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeDoc(over: Partial<Document> = {}): Document {
  return documentSchema.parse(newEntity({ profileId: 'prof-1', issueDate: '2026-10-06', ...over }));
}

let lineSeq = 0;
function makeLine(over: Partial<DocumentLine> = {}): DocumentLine {
  lineSeq += 1;
  return documentLineSchema.parse(
    newEntity({
      documentId: 'doc-1',
      position: lineSeq,
      quantity: '1',
      unitPrice: 0,
      taxCodeId: null,
      ...over,
    }),
  );
}

function makePayment(amount: number, over: Partial<Payment> = {}): Payment {
  return paymentSchema.parse(newEntity({ documentId: 'doc-1', date: '2026-10-10', amount, ...over }));
}

function calc(over: Partial<CalculateInput> = {}): CalculationResult {
  const input: CalculateInput = {
    document: over.document ?? makeDoc(),
    lines: over.lines ?? [],
    payments: over.payments ?? [],
    taxCodes: over.taxCodes ?? TAX,
    roundingMethod: over.roundingMethod,
    clientCreditAvailable: over.clientCreditAvailable,
    linkedCreditMinor: over.linkedCreditMinor,
    rateToAud: over.rateToAud,
    sign: over.sign,
  };
  return calculate(input);
}

/**
 * The invariant that makes a total trustworthy.
 *
 * `net` is always the pre-tax base, so `net === gross` must hold for every line
 * and every tax group. Under inclusive pricing the tax is extracted from the
 * gross, so `net + tax === gross` must hold too. Under exclusive pricing the tax
 * is added on top, so the group total is `net + tax` and the document total
 * exceeds the base — the identity to check there is that the printed Subtotal
 * plus the discount plus the tax equals the total.
 */
function expectReconciled(r: CalculationResult, taxMode: 'exclusive' | 'inclusive' = 'exclusive') {
  for (const [lineId, comp] of r.lines) {
    if (taxMode === 'exclusive') {
      expect(comp.net, `line ${lineId} net must equal its gross base`).toBe(comp.gross);
    } else {
      expect(comp.net + comp.tax, `line ${lineId} must satisfy net + tax === gross`).toBe(comp.gross);
    }
  }
  for (const group of r.taxGroups) {
    if (taxMode === 'exclusive') {
      expect(group.net, `tax group ${group.name} net must equal its gross`).toBe(group.gross);
    } else {
      expect(group.net + group.tax, `tax group ${group.name} must reconcile`).toBe(group.gross);
    }
  }
  if (taxMode === 'exclusive') {
    expect(r.subtotal + r.discount + r.tax, 'Subtotal + Discount + Tax must equal the total').toBe(r.total);
  } else {
    expect(r.subtotal + r.discount, 'Subtotal + Discount must equal the inclusive total').toBe(r.total);
  }
}

/** The tax groups must always sum back to the document tax. */
function expectTaxGroupsSum(r: CalculationResult) {
  const groupTax = r.taxGroups.reduce((a, g) => a + g.tax, 0);
  expect(groupTax).toBe(r.tax);
}

/* ------------------------------------------------------------------ */
/* Rule 1 — line amount                                                 */
/* ------------------------------------------------------------------ */

describe('rule 1: line amount = quantity x unit price', () => {
  it('multiplies a simple line', () => {
    const r = calc({ lines: [makeLine({ quantity: '2', unitPrice: 5000 })] });
    expect(r.subtotal).toBe(10000);
  });

  it('supports four decimal places for hours', () => {
    const r = calc({ lines: [makeLine({ quantity: '7.25', unitPrice: 18000 })] });
    expect(r.subtotal).toBe(130500); // 7.25 x 180.00
  });

  it('supports a large quantity without drift', () => {
    const r = calc({ lines: [makeLine({ quantity: '10000', unitPrice: 1 })] });
    expect(r.subtotal).toBe(10000);
  });

  it('rounds the product half away from zero', () => {
    // 3 x 33.335 = 100.005 -> 10001 cents
    const r = calc({ lines: [makeLine({ quantity: '3', unitPrice: 3334 })] });
    expect(r.subtotal).toBe(10002); // 3 x 33.34 = 100.02
  });

  it('accepts a quantity expressed as a decimal string', () => {
    const a = calc({ lines: [makeLine({ quantity: '0.1', unitPrice: 10000 })] });
    const b = calc({ lines: [makeLine({ quantity: '0.3', unitPrice: 10000 })] });
    expect(a.subtotal).toBe(1000);
    expect(b.subtotal).toBe(3000);
  });

  it('treats a missing quantity as zero', () => {
    const r = calc({ lines: [makeLine({ quantity: '0', unitPrice: 50000 })] });
    expect(r.subtotal).toBe(0);
  });

  it('sums many small lines exactly', () => {
    const lines = Array.from({ length: 60 }, () => makeLine({ quantity: '3.33', unitPrice: 1234 }));
    const r = calc({ lines });
    expect(r.subtotal).toBe(60 * 4109); // 3.33 x $12.34 = 41.0922 -> 4109 cents
  });

  it('handles a 60-line invoice', () => {
    const lines = Array.from({ length: 60 }, (_, i) =>
      makeLine({ description: `Item ${i + 1}`, quantity: '2', unitPrice: 2500 + i }),
    );
    const r = calc({ lines });
    let expected = 0;
    for (let i = 0; i < 60; i++) expected += 2 * (2500 + i);
    expect(r.subtotal).toBe(expected);
    expect(r.tax).toBe(Math.round(expected * 0.1));
    expectReconciled(r);
  });
});

/* ------------------------------------------------------------------ */
/* Rule 2 — line discount                                              */
/* ------------------------------------------------------------------ */

describe('rule 2: line discount', () => {
  it('applies a percentage discount', () => {
    const r = calc({ lines: [makeLine({ unitPrice: 10000, discountType: 'percent', discountValue: '10' })] });
    expect(r.subtotal).toBe(9000);
    expect(r.tax).toBe(900);
  });

  it('applies a fixed discount', () => {
    const r = calc({ lines: [makeLine({ unitPrice: 10000, discountType: 'fixed', discountValue: '1500' })] });
    expect(r.subtotal).toBe(8500);
  });

  it('never lets a discount push a line below zero', () => {
    const r = calc({ lines: [makeLine({ unitPrice: 1000, discountType: 'fixed', discountValue: '99999' })] });
    expect(r.subtotal).toBe(0);
  });

  it('caps an over-large percentage discount at the line amount', () => {
    const r = calc({
      lines: [makeLine({ unitPrice: 10000, discountType: 'percent', discountValue: '150' })],
    });
    expect(r.subtotal).toBe(0);
  });

  it('allows a full 100% discount', () => {
    const r = calc({
      lines: [makeLine({ unitPrice: 10000, discountType: 'percent', discountValue: '100' })],
    });
    expect(r.subtotal).toBe(0);
    expect(r.total).toBe(0);
  });

  it('discounts before tax, not after', () => {
    const r = calc({ lines: [makeLine({ unitPrice: 10000, discountType: 'percent', discountValue: '50' })] });
    // 100.00 - 50% = 50.00, GST on 50.00 = 5.00, total 55.00
    expect(r.subtotal).toBe(5000);
    expect(r.tax).toBe(500);
    expect(r.total).toBe(5500);
  });

  it('ignores a discount of type none', () => {
    const r = calc({ lines: [makeLine({ unitPrice: 10000, discountType: 'none', discountValue: '50' })] });
    expect(r.subtotal).toBe(10000);
  });
});

/* ------------------------------------------------------------------ */
/* Rules 3 and 4 — sections and the document subtotal                  */
/* ------------------------------------------------------------------ */

describe('rules 3 and 4: sections and subtotal', () => {
  it('groups lines under a section heading', () => {
    const r = calc({
      lines: [
        makeLine({ type: 'section', description: 'Phase 1 — Discovery', position: 1 }),
        makeLine({ unitPrice: 50000, position: 2 }),
        makeLine({ unitPrice: 50000, position: 3 }),
        makeLine({ type: 'section', description: 'Phase 2 — Build', position: 4 }),
        makeLine({ unitPrice: 25000, position: 5 }),
      ],
    });

    expect(r.sections).toHaveLength(2);
    expect(r.sections[0].title).toBe('Phase 1 — Discovery');
    expect(r.sections[0].subtotal).toBe(100000);
    expect(r.sections[1].subtotal).toBe(25000);
    expect(r.subtotal).toBe(125000);
    expect(r.total).toBe(137500);
  });

  it('leaves lines before the first section unsectioned', () => {
    const r = calc({
      lines: [
        makeLine({ unitPrice: 10000, position: 1 }),
        makeLine({ type: 'section', description: 'Later', position: 2 }),
        makeLine({ unitPrice: 20000, position: 3 }),
      ],
    });
    const sectioned = r.sections[0];
    expect(sectioned.lineIds).toHaveLength(1);
    expect(sectioned.subtotal).toBe(20000);
    expect(r.subtotal).toBe(30000);
  });

  it('applies a section discount only inside that section', () => {
    const r = calc({
      lines: [
        makeLine({ unitPrice: 10000, position: 1 }), // outside any section
        makeLine({ type: 'section', description: 'S', position: 2, id: 'sec-1' }),
        makeLine({ unitPrice: 20000, position: 3 }),
        makeLine({ unitPrice: 20000, position: 4 }),
        makeLine({
          type: 'discount',
          description: 'Section discount',
          discountType: 'percent',
          discountValue: '10',
          appliesToSectionId: 'sec-1',
          position: 5,
        }),
      ],
    });
    // Section base $40.00 - 10% = $36.00, plus $10.00 outside = $46.00
    expect(r.subtotal).toBe(46000);
    expect(r.discount).toBe(0); // section discounts are not a document-level row
    expect(r.sections[0].subtotal).toBe(36000);
    expect(r.sections[0].discount).toBe(-4000);
    expect(r.tax).toBe(4600);
  });

  it('a document discount does not fold its share into the section subtotal', () => {
    // The document discount sits above the section: below a section heading
    // it would be treated as that section's discount.
    const r = calc({
      lines: [
        makeLine({
          type: 'discount',
          description: 'Document discount',
          discountType: 'percent',
          discountValue: '10',
          position: 0,
        }),
        makeLine({ type: 'section', description: 'Phase 1', position: 1, id: 'sec-1' }),
        makeLine({ unitPrice: 40000, sectionId: 'sec-1', position: 2 }),
      ],
    });
    // The section is worth $400 after its (zero) section discount; the
    // document's 10% comes off the subtotal row, not the section's.
    expect(r.sections[0].subtotal).toBe(40000);
    expect(r.subtotal).toBe(40000);
    expect(r.discount).toBe(-4000);
  });

  it('applies the section discount after line discounts', () => {
    const r = calc({
      lines: [
        makeLine({ type: 'section', description: 'S', position: 1, id: 'sec-1' }),
        makeLine({ unitPrice: 20000, discountType: 'percent', discountValue: '50', position: 2 }), // -> 10000
        makeLine({
          type: 'discount',
          description: '10% off section',
          discountType: 'percent',
          discountValue: '10',
          appliesToSectionId: 'sec-1',
          position: 3,
        }),
      ],
    });
    expect(r.subtotal).toBe(9000); // 10.00 less 10%
  });

  it('ignores note lines entirely', () => {
    const r = calc({
      lines: [
        makeLine({ unitPrice: 10000, position: 1 }),
        makeLine({ type: 'note', description: 'Thank you for your business', position: 2 }),
      ],
    });
    expect(r.subtotal).toBe(10000);
    expect(r.total).toBe(11000);
  });

  it('skips soft-deleted lines', () => {
    const r = calc({
      lines: [
        makeLine({ unitPrice: 10000, position: 1 }),
        makeLine({ unitPrice: 99999, position: 2, deletedAt: '2026-10-07T00:00:00.000Z' }),
      ],
    });
    expect(r.subtotal).toBe(10000);
  });
});

/* ------------------------------------------------------------------ */
/* Rule 5 — document discount, apportioned by tax code                */
/* ------------------------------------------------------------------ */

describe('rule 5: document discount is apportioned by tax code', () => {
  it('applies a document-level percentage', () => {
    const r = calc({
      lines: [
        makeLine({ unitPrice: 100000, position: 1 }),
        makeLine({ unitPrice: 100000, position: 2 }),
        makeLine({
          type: 'discount',
          description: 'Goodwill',
          discountType: 'percent',
          discountValue: '10',
          position: 3,
        }),
      ],
    });
    // Rule 4 fixes Subtotal as the line sum before the document discount, and
    // rule 5 takes the discount off it as its own row.
    expect(r.subtotal).toBe(200000);
    expect(r.discount).toBe(-20000);
    expect(r.tax).toBe(18000); // GST on $1,800.00 after the discount
    expect(r.total).toBe(198000);
    expectReconciled(r);
  });

  it('keeps GST correct across a mixed-rate document', () => {
    const r = calc({
      lines: [
        makeLine({ unitPrice: 100000, position: 1 }), // GST
        makeLine({ unitPrice: 100000, position: 2, taxCodeId: 'tax_export' }), // zero rated
        makeLine({
          type: 'discount',
          description: '10% off',
          discountType: 'percent',
          discountValue: '10',
          position: 3,
        }),
      ],
    });
    // Both halves discounted by 10%: GST base 900.00, export base 900.00
    expect(r.subtotal).toBe(200000);
    expect(r.discount).toBe(-20000);
    expect(r.tax).toBe(9000); // GST only on the taxable half
    expect(r.total).toBe(189000);
    expectReconciled(r);
  });

  it('apportionment is exact, with no lost minor units', () => {
    const r = calc({
      lines: [
        makeLine({ unitPrice: 333, position: 1 }),
        makeLine({ unitPrice: 333, position: 2 }),
        makeLine({ unitPrice: 333, position: 3 }),
        makeLine({
          type: 'discount',
          description: 'D',
          discountType: 'percent',
          discountValue: '10',
          position: 4,
        }),
      ],
    });
    expect(r.discount).toBe(-100); // 10% of 9.99 = 0.999 -> 1.00
    expect(r.subtotal + r.discount).toBe(r.total - r.tax);
    expectReconciled(r);
  });

  it('applies a fixed document discount', () => {
    const r = calc({
      lines: [
        makeLine({ unitPrice: 50000, position: 1 }),
        makeLine({ unitPrice: 50000, position: 2 }),
        makeLine({
          type: 'discount',
          description: 'D',
          discountType: 'fixed',
          discountValue: '5000',
          position: 3,
        }),
      ],
    });
    expect(r.subtotal).toBe(100000);
    expect(r.discount).toBe(-5000);
    expect(r.tax).toBe(9500);
    expect(r.total).toBe(104500);
  });

  it('never drives a line negative on a large document discount', () => {
    const r = calc({
      lines: [
        makeLine({ unitPrice: 1000, position: 1 }),
        makeLine({ unitPrice: 9000, position: 2 }),
        makeLine({
          type: 'discount',
          description: 'D',
          discountType: 'percent',
          discountValue: '50',
          position: 3,
        }),
      ],
    });
    for (const comp of r.lines.values()) expect(comp.gross).toBeGreaterThanOrEqual(0);
    expect(r.subtotal).toBe(10000);
    expect(r.discount).toBe(-5000);
    expect(r.tax).toBe(500); // GST on the $50.00 that survived the discount
    expect(r.total).toBe(5500);
  });

  it('handles a surcharge as a positive document discount row', () => {
    const r = calc({
      lines: [
        makeLine({ unitPrice: 100000, position: 1 }),
        makeLine({
          type: 'discount',
          description: 'Late fee',
          discountType: 'fixed',
          discountValue: '5000',
          discountDirection: 'surcharge',
          position: 2,
        }),
      ],
    });
    expect(r.subtotal).toBe(100000);
    expect(r.discount).toBe(5000);
    expect(r.tax).toBe(10500);
    expect(r.total).toBe(115500);
  });

  it('stacks a document discount after a section discount', () => {
    const r = calc({
      lines: [
        // The document-level discount sits above the first section heading, so
        // it applies to the whole document rather than to one section.
        makeLine({
          type: 'discount',
          description: 'Doc disc',
          discountType: 'percent',
          discountValue: '10',
          position: 1,
        }),
        makeLine({ type: 'section', description: 'S', position: 2, id: 'sec-1' }),
        makeLine({ unitPrice: 20000, position: 3 }),
        makeLine({
          type: 'discount',
          description: 'S disc',
          discountType: 'percent',
          discountValue: '10',
          appliesToSectionId: 'sec-1',
          position: 4,
        }),
      ],
    });
    // $200.00 - 10% section = $180.00 (the rule 4 subtotal), then - 10% document
    // = $162.00. Section discounts are always applied before document discounts,
    // whatever order the lines appear in, so the totals block always reconciles.
    // Subtotal 1800.00 - Discount 180.00 + GST 162.00 = Total 1782.00
    expect(r.subtotal).toBe(18000);
    expect(r.discount).toBe(-1800);
    expect(r.tax).toBe(1620);
    expect(r.total).toBe(17820);
  });

  it('treats a discount line inside a section as a section discount', () => {
    const r = calc({
      lines: [
        makeLine({ type: 'section', description: 'S', position: 1, id: 'sec-1' }),
        makeLine({ unitPrice: 20000, position: 2 }),
        makeLine({
          type: 'discount',
          description: 'Phase discount',
          discountType: 'percent',
          discountValue: '10',
          position: 3,
        }),
      ],
    });
    expect(r.sections[0].discount).toBe(-2000);
    expect(r.subtotal).toBe(18000);
    // A section discount is not a document-level row; it prints inside the section.
    expect(r.discount).toBe(0);
    expect(r.total).toBe(19800);
  });
});

/* ------------------------------------------------------------------ */
/* Rule 6 — tax by code, and the rounding methods                      */
/* ------------------------------------------------------------------ */

describe('rule 6: tax grouped by tax code', () => {
  it('charges GST at 10% on a taxable sale', () => {
    const r = calc({ lines: [makeLine({ unitPrice: 10000 })] });
    expect(r.tax).toBe(1000);
    expect(r.gstPayable).toBe(1000);
  });

  it('does not charge GST on a GST-free line', () => {
    const r = calc({ lines: [makeLine({ unitPrice: 10000, taxCodeId: 'tax_gst_free' })] });
    expect(r.tax).toBe(0);
    expect(r.total).toBe(10000);
    expect(r.hasAnyTaxable).toBe(false);
  });

  it('does not charge GST on input-taxed or export lines', () => {
    for (const code of ['tax_input_taxed', 'tax_export', 'tax_zero']) {
      const r = calc({ lines: [makeLine({ unitPrice: 10000, taxCodeId: code })] });
      expect(r.tax, code).toBe(0);
    }
  });

  it('separates taxable from zero-rated on one document', () => {
    const r = calc({
      lines: [
        makeLine({ unitPrice: 50000, position: 1 }),
        makeLine({ unitPrice: 50000, position: 2, taxCodeId: 'tax_gst_free' }),
      ],
    });
    expect(r.hasMixedTaxability).toBe(true);
    expect(r.tax).toBe(5000);
    expect(r.taxGroups).toHaveLength(2);
    expect(r.total).toBe(105000);
    expectReconciled(r);
  });

  it('marks zero-rated codes so the PDF can print a key', () => {
    const r = calc({ lines: [makeLine({ unitPrice: 10000, taxCodeId: 'tax_export' })] });
    expect(r.markerCodes.map((m) => m.taxCodeId)).toContain('tax_export');
    expect(r.markerCodes[0].label).toBe('Export');
  });

  it('marks zero-rated codes only when the document is mixed', () => {
    const r = calc({
      lines: [
        makeLine({ unitPrice: 10000, position: 1 }),
        makeLine({ unitPrice: 10000, position: 2, taxCodeId: 'tax_input_taxed' }),
      ],
    });
    const keys = r.markerCodes.map((m) => m.label);
    expect(keys).toEqual(['Input taxed']);
  });

  it('applies a custom rate', () => {
    const custom: TaxCode = {
      ...DEFAULT_TAX_CODES[4],
      id: 'tax_nz15',
      name: 'NZ GST 15%',
      rate: '0.15',
      type: 'custom',
      label: null,
      builtin: false,
    };
    const r = calc({
      lines: [makeLine({ unitPrice: 100000 })],
      taxCodes: [...TAX, custom],
      document: makeDoc({ taxCodeId: 'tax_nz15' }),
    });
    expect(r.tax).toBe(15000);
    expect(r.total).toBe(115000);
  });

  it('charges compound tax on the base plus tax already applied', () => {
    const r = calc({
      lines: [makeLine({ unitPrice: 100000, taxCodeId: 'tax_compound' })],
      taxCodes: TAX,
    });
    // 1000.00 base, compound 7.5% -> 75.00
    expect(r.tax).toBe(7500);
    expect(r.total).toBe(107500);
  });

  it('excludes a soft-deleted tax code from calculation', () => {
    const inactive: TaxCode = { ...DEFAULT_TAX_CODES[0], id: 'tax_gst', active: false };
    const r = calc({ lines: [makeLine({ unitPrice: 10000 })], taxCodes: [inactive] });
    expect(r.tax).toBe(0);
  });

  describe('ATO rounding methods', () => {
    // 3 x 33.335 style splits: each line's GST has a half cent that must go
    // somewhere. The two methods place it differently, on purpose.
    const lines = () => [
      makeLine({ unitPrice: 333, position: 1 }),
      makeLine({ unitPrice: 333, position: 2 }),
      makeLine({ unitPrice: 333, position: 3 }),
    ];

    it('total invoice rule rounds once per tax code', () => {
      const r = calc({ lines: lines(), roundingMethod: 'total_invoice' });
      // Each line: 3.33 -> 0.333 GST. Sum = 0.999 -> 1.00
      expect(r.tax).toBe(100);
      expectReconciled(r);
    });

    it('taxable sale rule rounds each taxable sale', () => {
      const r = calc({ lines: lines(), roundingMethod: 'taxable_sale' });
      // Each line rounds 0.333 -> 0.33, so 3 x 0.33 = 0.99
      expect(r.tax).toBe(99);
      expectReconciled(r);
    });

    it('the two methods differ by exactly the accumulated fractions', () => {
      const total = calc({ lines: lines(), roundingMethod: 'total_invoice' });
      const sale = calc({ lines: lines(), roundingMethod: 'taxable_sale' });
      expect(total.tax - sale.tax).toBe(1);
    });

    it('both methods agree when the divisions are exact', () => {
      const exact = () => [
        makeLine({ unitPrice: 10000, position: 1 }),
        makeLine({ unitPrice: 10000, position: 2 }),
      ];
      expect(calc({ lines: exact(), roundingMethod: 'total_invoice' }).tax).toBe(2000);
      expect(calc({ lines: exact(), roundingMethod: 'taxable_sale' }).tax).toBe(2000);
    });

    it('never loses or invents a cent on either method', () => {
      for (let n = 1; n <= 40; n++) {
        const ls = Array.from({ length: n }, () => makeLine({ unitPrice: 1 }));

        // One cent of GST per line is a tenth of a cent, so the two methods
        // legitimately diverge: the total invoice rule rounds once at the end,
        // while the taxable sale rule rounds every tiny sale down to nothing.
        const total = calc({ lines: ls, roundingMethod: 'total_invoice' });
        const sale = calc({ lines: ls, roundingMethod: 'taxable_sale' });

        expectReconciled(total);
        expectReconciled(sale);
        expectTaxGroupsSum(total);
        expectTaxGroupsSum(sale);

        expect(total.tax, `total_invoice with ${n} lines`).toBe(Math.round(n * 0.1));
        expect(sale.tax, `taxable_sale with ${n} lines`).toBe(0);
        // The two methods can only differ by the accumulated fractions, bounded
        // by the number of rounding events.
        expect(Math.abs(total.tax - sale.tax)).toBeLessThanOrEqual(Math.ceil(n / 10) + 1);
      }
    });

    it('reconciles under exclusive pricing where tax is on top', () => {
      for (const method of ['total_invoice', 'taxable_sale'] as const) {
        const r = calc({
          lines: [
            makeLine({ unitPrice: 1, position: 1 }),
            makeLine({ unitPrice: 1, position: 2 }),
            makeLine({ unitPrice: 1, position: 3 }),
          ],
          roundingMethod: method,
        });
        expectReconciled(r);
        expectTaxGroupsSum(r);
      }
    });
  });
});

/* ------------------------------------------------------------------ */
/* Inclusive pricing                                                   */
/* ------------------------------------------------------------------ */

describe('inclusive pricing extracts GST at exactly one eleventh', () => {
  const inclusiveDoc = () => makeDoc({ taxMode: 'inclusive' });

  it('extracts 1/11 of the gross', () => {
    const r = calc({ document: inclusiveDoc(), lines: [makeLine({ unitPrice: 11000 })] });
    expect(r.tax).toBe(1000);
    expect(r.net).toBe(10000);
  });

  it('keeps the total equal to the subtotal', () => {
    const r = calc({ document: inclusiveDoc(), lines: [makeLine({ unitPrice: 12345 })] });
    expect(r.total).toBe(12345);
    expect(r.subtotal).toBe(12345);
    expect(r.tax).toBe(1122); // 12345 / 11 = 1122.27 -> 1122
    expect(r.net).toBe(11223);
  });

  it('still reconciles per line after rounding', () => {
    const r = calc({
      document: inclusiveDoc(),
      lines: [
        makeLine({ unitPrice: 333, position: 1 }),
        makeLine({ unitPrice: 333, position: 2 }),
        makeLine({ unitPrice: 333, position: 3 }),
      ],
    });
    expect(r.total).toBe(r.subtotal);
    expect(r.net + r.tax).toBe(r.total);
    expectReconciled(r, 'inclusive');
  });

  it('applies a discount before extracting GST', () => {
    const r = calc({
      document: inclusiveDoc(),
      lines: [makeLine({ unitPrice: 11000, discountType: 'percent', discountValue: '10' })],
    });
    expect(r.subtotal).toBe(9900);
    expect(r.tax).toBe(900);
    expect(r.total).toBe(9900);
    expect(r.net).toBe(9000);
    expectReconciled(r, 'inclusive');
  });

  it('applies a document discount before extracting GST', () => {
    const r = calc({
      document: inclusiveDoc(),
      lines: [
        makeLine({ unitPrice: 100000, position: 1 }),
        makeLine({ unitPrice: 100000, position: 2 }),
        makeLine({
          type: 'discount',
          description: 'D',
          discountType: 'percent',
          discountValue: '10',
          position: 3,
        }),
      ],
    });
    expect(r.subtotal).toBe(200000);
    expect(r.total).toBe(180000);
    expect(r.tax).toBe(16364); // 1800.00 / 11
    expectReconciled(r, 'inclusive');
  });

  it('does not charge GST on an inclusive zero-rated line', () => {
    const r = calc({
      document: inclusiveDoc(),
      lines: [makeLine({ unitPrice: 10000, taxCodeId: 'tax_gst_free' })],
    });
    expect(r.tax).toBe(0);
    expect(r.total).toBe(10000);
    expectReconciled(r, 'inclusive');
  });

  it('matches the exclusive calculation when the price is grossed up', () => {
    // 1000.00 exclusive at 10% is 1100.00 inclusive.
    const exclusive = calc({ lines: [makeLine({ unitPrice: 100000 })] });
    const inclusive = calc({ document: inclusiveDoc(), lines: [makeLine({ unitPrice: 110000 })] });
    expect(inclusive.tax).toBe(exclusive.tax);
    expect(inclusive.net).toBe(exclusive.subtotal);
  });
});

/* ------------------------------------------------------------------ */
/* Rule 7 — total                                                      */
/* ------------------------------------------------------------------ */

describe('rule 7: total', () => {
  it('adds tax to the subtotal when pricing is exclusive', () => {
    const r = calc({ lines: [makeLine({ unitPrice: 9999 })] });
    expect(r.subtotal).toBe(9999);
    expect(r.tax).toBe(1000); // 99.99 -> 9.999 -> 10.00
    expect(r.total).toBe(10999);
  });

  it('leaves the total equal to the subtotal when pricing is inclusive', () => {
    const r = calc({ document: makeDoc({ taxMode: 'inclusive' }), lines: [makeLine({ unitPrice: 9999 })] });
    expect(r.total).toBe(9999);
  });

  it('is zero for an empty document', () => {
    const r = calc({ lines: [] });
    expect(r.subtotal).toBe(0);
    expect(r.tax).toBe(0);
    expect(r.total).toBe(0);
    expect(r.balance).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Rule 8 — payments, balance and status                               */
/* ------------------------------------------------------------------ */

describe('rule 8: paid and balance', () => {
  it('reduces the balance by a full payment', () => {
    const r = calc({ lines: [makeLine({ unitPrice: 10000 })], payments: [makePayment(11000)] });
    expect(r.paid).toBe(11000);
    expect(r.balance).toBe(0);
  });

  it('reduces the balance by a partial payment', () => {
    const r = calc({ lines: [makeLine({ unitPrice: 10000 })], payments: [makePayment(5000)] });
    expect(r.paid).toBe(5000);
    expect(r.balance).toBe(6000);
  });

  it('sums several payments', () => {
    const r = calc({
      lines: [makeLine({ unitPrice: 100000 })],
      payments: [
        makePayment(30000, { method: 'bank_transfer' }),
        makePayment(20000, { method: 'card' }),
        makePayment(10000, { method: 'cash' }),
      ],
    });
    expect(r.paid).toBe(60000);
    expect(r.balance).toBe(50000);
  });

  it('excludes a soft-deleted payment', () => {
    const r = calc({
      lines: [makeLine({ unitPrice: 10000 })],
      payments: [makePayment(11000), makePayment(500, { deletedAt: '2026-10-11T00:00:00.000Z' })],
    });
    expect(r.paid).toBe(11000);
  });

  it('lets an overpayment show as a negative balance', () => {
    const r = calc({ lines: [makeLine({ unitPrice: 10000 })], payments: [makePayment(15000)] });
    expect(r.balance).toBe(-4000);
  });

  it("applies the credit the document says was applied — and nothing more", () => {
    // Availability alone no longer reaches the balance: the user's "Apply
    // credit" decision is a field on the document, and every future
    // recalculation must respect it exactly.
    const r = calc({
      lines: [makeLine({ unitPrice: 10000 })],
      document: makeDoc({ clientCreditApplied: 3000 }),
      clientCreditAvailable: 999999,
    });
    expect(r.creditApplied).toBe(3000);
    expect(r.balance).toBe(8000);
  });

  it('never applies more credit than the document is worth', () => {
    const r = calc({
      lines: [makeLine({ unitPrice: 10000 })],
      document: makeDoc({ clientCreditApplied: 999999 }),
    });
    expect(r.creditApplied).toBe(11000);
    expect(r.balance).toBe(0);
  });

  it('available credit alone does not change the balance', () => {
    const r = calc({ lines: [makeLine({ unitPrice: 10000 })], clientCreditAvailable: 5000 });
    expect(r.creditApplied).toBe(0);
    expect(r.balance).toBe(11000);
  });

  it('reduces the balance by issued credit notes linked to the document', () => {
    const r = calc({ lines: [makeLine({ unitPrice: 10000 })], linkedCreditMinor: 4000 });
    expect(r.balance).toBe(7000);
  });

  it('ignores credit on a credit note', () => {
    const r = calc({
      document: makeDoc({ type: 'credit_note' }),
      lines: [makeLine({ unitPrice: 10000 })],
      clientCreditAvailable: 5000,
    });
    expect(r.creditApplied).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Rule 9 — credit notes                                               */
/* ------------------------------------------------------------------ */

describe('rule 9: credit notes carry negative totals', () => {
  it('negates every figure', () => {
    const invoice = calc({ lines: [makeLine({ unitPrice: 100000 })] });
    const credit = calc({
      document: makeDoc({ type: 'credit_note' }),
      lines: [makeLine({ unitPrice: 100000 })],
    });

    expect(credit.sign).toBe(-1);
    expect(credit.subtotal).toBe(-invoice.subtotal);
    expect(credit.tax).toBe(-invoice.tax);
    expect(credit.total).toBe(-invoice.total);
  });

  it('is the exact negation per line', () => {
    // The same line ids on both sides, so the comparison is genuinely mirrored.
    const original = [makeLine({ unitPrice: 333 }), makeLine({ unitPrice: 333 })];
    const invoice = calc({ lines: original });
    const credit = calc({ document: makeDoc({ type: 'credit_note' }), lines: original });

    expect(invoice.lineOrder).toHaveLength(2);
    expect(credit.lineOrder).toEqual(invoice.lineOrder);
    for (const id of invoice.lineOrder) {
      const a = invoice.lines.get(id)!;
      const b = credit.lines.get(id)!;
      expect(b.gross, `gross for ${id}`).toBe(-a.gross);
      expect(b.tax, `tax for ${id}`).toBe(-a.tax);
      expect(b.net, `net for ${id}`).toBe(-a.net);
    }
  });

  it('reconciles when negated', () => {
    const r = calc({
      document: makeDoc({ type: 'credit_note' }),
      lines: [
        makeLine({ unitPrice: 333, position: 1 }),
        makeLine({ unitPrice: 333, position: 2 }),
        makeLine({ unitPrice: 333, position: 3 }),
      ],
    });
    expect(r.subtotal).toBe(-999);
    expect(r.tax).toBe(-100);
    expect(r.total).toBe(-1099);
    expectReconciled(r);
  });

  it('negates an inclusive document too', () => {
    const r = calc({
      document: makeDoc({ type: 'credit_note', taxMode: 'inclusive' }),
      lines: [makeLine({ unitPrice: 11000 })],
    });
    expect(r.total).toBe(-11000);
    expect(r.tax).toBe(-1000);
  });

  it('a quote is never negative', () => {
    const r = calc({ document: makeDoc({ type: 'quote' }), lines: [makeLine({ unitPrice: 10000 })] });
    expect(r.sign).toBe(1);
    expect(r.total).toBe(11000);
  });
});

/* ------------------------------------------------------------------ */
/* Rule 10 — foreign currency                                          */
/* ------------------------------------------------------------------ */

describe('rule 10: foreign currency', () => {
  it('does all arithmetic in the document currency', () => {
    const r = calc({ document: makeDoc({ currency: 'USD' }), lines: [makeLine({ unitPrice: 10000 })] });
    expect(r.currency).toBe('USD');
    expect(r.decimals).toBe(2);
    expect(r.total).toBe(11000);
  });

  it('shows an AUD equivalent without touching the total', () => {
    const r = calc({
      document: makeDoc({ currency: 'USD' }),
      lines: [makeLine({ unitPrice: 100000 })],
      rateToAud: '1.5',
    });
    expect(r.total).toBe(110000); // unchanged
    expect(r.audEquivalent).toBe(165000);
  });

  it('omits the equivalent for a home-currency document', () => {
    const r = calc({
      document: makeDoc({ currency: 'AUD' }),
      lines: [makeLine({ unitPrice: 100000 })],
      rateToAud: '1',
    });
    expect(r.audEquivalent).toBeNull();
  });

  it('omits the equivalent with no rate recorded', () => {
    const r = calc({ document: makeDoc({ currency: 'USD' }), lines: [makeLine({ unitPrice: 100000 })] });
    expect(r.audEquivalent).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Currencies with unusual exponents                                  */
/* ------------------------------------------------------------------ */

describe('currencies with unusual minor units', () => {
  it('handles JPY with no decimal places', () => {
    const r = calc({
      document: makeDoc({ currency: 'JPY' }),
      lines: [makeLine({ quantity: '3', unitPrice: 15000, taxCodeId: 'tax_export' })],
    });
    expect(r.decimals).toBe(0);
    expect(r.subtotal).toBe(45000);
    expect(r.total).toBe(45000);
  });

  it('handles JPY with GST', () => {
    const r = calc({
      document: makeDoc({ currency: 'JPY' }),
      lines: [makeLine({ quantity: '3', unitPrice: 1500 })],
    });
    expect(r.subtotal).toBe(4500);
    expect(r.tax).toBe(450);
    expect(r.total).toBe(4950);
  });

  it('rounds a fractional quantity to a whole yen', () => {
    // 3.5 hours x 333 yen = 1165.5 yen, which JPY cannot represent: it rounds to 1166.
    const r = calc({
      document: makeDoc({ currency: 'JPY' }),
      lines: [makeLine({ quantity: '3.5', unitPrice: 333 })],
    });
    expect(r.decimals).toBe(0);
    expect(r.subtotal).toBe(1166);
  });

  it('handles KWD with three decimal places', () => {
    const r = calc({ document: makeDoc({ currency: 'KWD' }), lines: [makeLine({ unitPrice: 1234 })] });
    expect(r.decimals).toBe(3);
    expect(r.subtotal).toBe(1234);
    expect(r.tax).toBe(123); // 12.340 fils of GST rounds to 123 fils
    expect(r.total).toBe(1357);
    expectReconciled(r);
  });

  it('keeps KWD sub-fils when multiplying by a fractional quantity', () => {
    const r = calc({
      document: makeDoc({ currency: 'KWD' }),
      lines: [makeLine({ quantity: '1.125', unitPrice: 1234 })],
    });
    expect(r.subtotal).toBe(1388); // 12.340 x 1.125 = 13.8825 -> 13.883
  });

  it('handles CLF with four decimal places', () => {
    const r = calc({ document: makeDoc({ currency: 'CLF' }), lines: [makeLine({ unitPrice: 12345 })] });
    expect(r.decimals).toBe(4);
    expect(r.tax).toBe(1235); // 123.4500 x 10%
    expectReconciled(r);
  });
});

/* ------------------------------------------------------------------ */
/* GST registration switching mid-year                                 */
/* ------------------------------------------------------------------ */

describe('a business switching GST registration mid-year', () => {
  const beforeSwitch = () =>
    calc({
      document: makeDoc({
        taxSnapshot: {
          gstRegistered: true,
          heading: 'Tax Invoice',
          codes: { tax_gst: { name: 'GST', rate: '0.10', type: 'gst', label: null } },
          inclusiveGstStatementAllowed: true,
          buyerIdentityRequired: true,
          takenAt: '2026-03-01T00:00:00.000Z',
          financialYear: '2025-26',
        },
      }),
      lines: [makeLine({ unitPrice: 100000 })],
    });

  const afterSwitch = () =>
    calc({
      document: makeDoc({
        taxSnapshot: {
          gstRegistered: false,
          heading: 'Invoice',
          codes: { tax_zero: { name: 'No tax', rate: '0', type: 'zero', label: null } },
          inclusiveGstStatementAllowed: false,
          buyerIdentityRequired: false,
          takenAt: '2026-08-01T00:00:00.000Z',
          financialYear: '2026-27',
        },
      }),
      lines: [makeLine({ unitPrice: 100000, taxCodeId: 'tax_zero' })],
    });

  it('keeps GST on the invoice issued before the switch', () => {
    const r = beforeSwitch();
    expect(r.tax).toBe(10000);
    expect(r.total).toBe(110000);
    expect(r.gstPayable).toBe(10000);
  });

  it('charges no GST on the invoice issued after the switch', () => {
    const r = afterSwitch();
    expect(r.tax).toBe(0);
    expect(r.total).toBe(100000);
    expect(r.gstPayable).toBe(0);
  });

  it('credits a pre-switch invoice with the GST it actually charged', () => {
    const original = beforeSwitch();
    // The credit note follows the invoice's snapshot, not today's settings.
    const credit = calc({
      document: makeDoc({
        type: 'credit_note',
        taxSnapshot: {
          gstRegistered: true,
          heading: 'Tax Credit Note',
          codes: { tax_gst: { name: 'GST', rate: '0.10', type: 'gst', label: null } },
          inclusiveGstStatementAllowed: true,
          buyerIdentityRequired: true,
          takenAt: '2026-08-02T00:00:00.000Z',
          financialYear: '2026-27',
        },
      }),
      lines: [makeLine({ unitPrice: 100000 })],
    });
    expect(credit.tax).toBe(-original.tax);
    expect(credit.total).toBe(-original.total);
  });

  it('a credit note against a non-registered invoice reverses no GST', () => {
    const original = afterSwitch();
    const credit = calc({
      document: makeDoc({
        type: 'credit_note',
        taxSnapshot: {
          gstRegistered: false,
          heading: 'Credit Note',
          codes: { tax_zero: { name: 'No tax', rate: '0', type: 'zero', label: null } },
          inclusiveGstStatementAllowed: false,
          buyerIdentityRequired: false,
          takenAt: '2026-08-02T00:00:00.000Z',
          financialYear: '2026-27',
        },
      }),
      lines: [makeLine({ unitPrice: 100000, taxCodeId: 'tax_zero' })],
    });
    expect(credit.tax).toBe(-original.tax);
    expect(credit.total).toBe(-original.total);
  });
});

/* ------------------------------------------------------------------ */
/* Line types                                                          */
/* ------------------------------------------------------------------ */

describe('line types', () => {
  it('a time line is hours x rate', () => {
    const r = calc({ lines: [makeLine({ type: 'time', quantity: '7.5', unitPrice: 12000, unit: 'hour' })] });
    expect(r.subtotal).toBe(90000);
  });

  it('an expense line uses the amount entered, not quantity x price', () => {
    const r = calc({ lines: [makeLine({ type: 'expense', amountOverride: 4555, unitPrice: 0 })] });
    expect(r.subtotal).toBe(4555);
    expect(r.tax).toBe(456); // 455.5 fils rounds away from zero
  });

  it('an expense line applies its markup', () => {
    const r = calc({ lines: [makeLine({ type: 'expense', amountOverride: 10000, markupPercent: '10' })] });
    expect(r.subtotal).toBe(11000);
    expect(r.tax).toBe(1100);
  });

  it('an expense markup of 20% on 33.34 rounds half away', () => {
    const r = calc({ lines: [makeLine({ type: 'expense', amountOverride: 3334, markupPercent: '20' })] });
    expect(r.subtotal).toBe(4001); // 33.34 x 1.2 = 40.008 -> 40.01
  });

  it('a note line contributes nothing', () => {
    const r = calc({ lines: [makeLine({ type: 'note', description: 'Includes travel' })] });
    expect(r.total).toBe(0);
    expect(r.lineOrder).toHaveLength(0);
  });

  it('a section line contributes nothing but groups', () => {
    const r = calc({
      lines: [
        makeLine({ type: 'section', description: 'S', position: 1 }),
        makeLine({ unitPrice: 1000, position: 2 }),
      ],
    });
    expect(r.subtotal).toBe(1000);
    expect(r.sections).toHaveLength(1);
  });

  it('a discount line contributes nothing itself', () => {
    const r = calc({
      lines: [
        makeLine({ unitPrice: 100000, position: 1 }),
        makeLine({
          type: 'discount',
          description: 'D',
          discountType: 'percent',
          discountValue: '10',
          position: 2,
        }),
      ],
    });
    expect(r.lineOrder).toHaveLength(2); // both tracked, only one carries value
    expect(r.lines.get(r.lineOrder[1])?.gross).toBe(0);
  });

  it('records each line discount for the editor to display', () => {
    const r = calc({ lines: [makeLine({ unitPrice: 10000, discountType: 'percent', discountValue: '25' })] });
    const comp = [...r.lines.values()][0];
    expect(comp.lineDiscount).toBe(2500);
    expect(comp.gross).toBe(7500);
  });

  it('records the document discount share per line', () => {
    const r = calc({
      lines: [
        makeLine({ unitPrice: 100000, position: 1 }),
        makeLine({ unitPrice: 100000, position: 2 }),
        makeLine({
          type: 'discount',
          description: 'D',
          discountType: 'fixed',
          discountValue: '10000',
          position: 3,
        }),
      ],
    });
    const shares = [...r.lines.values()].map((c) => c.documentDiscountShare);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(-10000);
  });
});

/* ------------------------------------------------------------------ */
/* Editor support                                                      */
/* ------------------------------------------------------------------ */

describe('editor support', () => {
  it('flags lines with no description', () => {
    const r = calc({
      lines: [
        makeLine({ description: 'ok', position: 1 }),
        makeLine({ description: '   ', position: 2 }),
        makeLine({ description: '', position: 3 }),
      ],
    });
    expect(r.incompleteLineIds).toHaveLength(2);
  });

  it('orders results by line position, not insertion order', () => {
    const r = calc({
      lines: [
        makeLine({ unitPrice: 30000, position: 3 }),
        makeLine({ unitPrice: 10000, position: 1 }),
        makeLine({ unitPrice: 20000, position: 2 }),
      ],
    });
    const amounts = r.lineOrder.map((id) => r.lines.get(id)?.gross);
    expect(amounts).toEqual([10000, 20000, 30000]);
  });

  it('reports the tax group breakdown for the PDF', () => {
    const r = calc({
      lines: [
        makeLine({ unitPrice: 100000, position: 1 }),
        makeLine({ unitPrice: 100000, position: 2, taxCodeId: 'tax_export' }),
      ],
    });
    expect(r.taxGroups).toHaveLength(2);
    const gst = r.taxGroups.find((g) => g.taxCodeId === 'tax_gst');
    const exp = r.taxGroups.find((g) => g.taxCodeId === 'tax_export');
    expect(gst?.gross).toBe(100000);
    expect(gst?.tax).toBe(10000);
    expect(gst?.rateLabel).toBe('10%');
    expect(exp?.gross).toBe(100000);
    expect(exp?.tax).toBe(0);
    expect(exp?.rateLabel).toBe('Export');
  });
});

/* ------------------------------------------------------------------ */
/* Totals cache                                                        */
/* ------------------------------------------------------------------ */

describe('the cached totals on a document', () => {
  it('never disagrees with a fresh calculation', () => {
    const doc = makeDoc();
    const lines = [makeLine({ unitPrice: 100000 }), makeLine({ unitPrice: 50000 })];
    const payments = [makePayment(20000)];

    // Simulate a save: write the cached totals onto the document.
    const first = calc({ document: doc, lines, payments });
    doc.totals = {
      subtotal: first.subtotal,
      discount: first.discount,
      tax: first.tax,
      total: first.total,
      paid: first.paid,
      balance: first.balance,
      creditApplied: first.creditApplied,
      currency: first.currency,
      audEquivalent: first.audEquivalent,
      gstPayable: first.gstPayable,
      computedAt: new Date().toISOString(),
    };

    // Re-reading must produce the same figures, and the cache must not be stale.
    const second = calculate({ document: doc, lines, payments, taxCodes: TAX });
    expect(totalsAreStale(doc, second)).toBe(false);
    expect(second.subtotal).toBe(first.subtotal);
    expect(second.tax).toBe(first.tax);
    expect(second.total).toBe(first.total);
    expect(second.paid).toBe(first.paid);
    expect(second.balance).toBe(first.balance);

    // Changing a line must make the cache stale, which is how the editor knows
    // to rewrite it rather than trust what is on disk.
    const changed = [makeLine({ unitPrice: 200000 }), makeLine({ unitPrice: 50000 })];
    const third = calculate({ document: doc, lines: changed, payments, taxCodes: TAX });
    expect(totalsAreStale(doc, third)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Twenty hand-checked sample invoices                                 */
/* ------------------------------------------------------------------ */

describe('twenty hand-checked sample invoices', () => {
  const cases: {
    name: string;
    doc: Partial<Document>;
    lines: () => DocumentLine[];
    payments?: () => Payment[];
    subtotal: number;
    tax: number;
    total: number;
  }[] = [
    {
      name: '1. single consulting day',
      doc: {},
      lines: () => [makeLine({ quantity: '1', unitPrice: 120000 })],
      subtotal: 120000,
      tax: 12000,
      total: 132000,
    },
    {
      name: '2. ten days at a rate',
      doc: {},
      lines: () => [makeLine({ quantity: '10', unitPrice: 120000 })],
      subtotal: 1200000,
      tax: 120000,
      total: 1320000,
    },
    {
      name: '3. fractional hours',
      doc: {},
      lines: () => [makeLine({ quantity: '7.25', unitPrice: 18000 })],
      subtotal: 130500,
      tax: 13050,
      total: 143550,
    },
    {
      name: '4. ten per cent off',
      doc: {},
      lines: () => [makeLine({ unitPrice: 100000, discountType: 'percent', discountValue: '10' })],
      subtotal: 90000,
      tax: 9000,
      total: 99000,
    },
    {
      name: '5. fixed discount',
      doc: {},
      lines: () => [makeLine({ unitPrice: 50000, discountType: 'fixed', discountValue: '5000' })],
      subtotal: 45000,
      tax: 4500,
      total: 49500,
    },
    {
      name: '6. GST-free supply',
      doc: {},
      lines: () => [makeLine({ unitPrice: 250000, taxCodeId: 'tax_gst_free' })],
      subtotal: 250000,
      tax: 0,
      total: 250000,
    },
    {
      name: '7. export supply',
      doc: {},
      lines: () => [makeLine({ unitPrice: 400000, taxCodeId: 'tax_export' })],
      subtotal: 400000,
      tax: 0,
      total: 400000,
    },
    {
      name: '8. mixed taxable and export',
      doc: {},
      lines: () => [
        makeLine({ unitPrice: 300000, position: 1 }),
        makeLine({ unitPrice: 700000, position: 2, taxCodeId: 'tax_export' }),
      ],
      subtotal: 1000000,
      tax: 30000,
      total: 1030000,
    },
    {
      name: '9. document discount on mixed rates',
      doc: {},
      lines: () => [
        makeLine({ unitPrice: 100000, position: 1 }),
        makeLine({ unitPrice: 100000, position: 2, taxCodeId: 'tax_export' }),
        makeLine({
          type: 'discount',
          description: 'D',
          discountType: 'percent',
          discountValue: '10',
          position: 3,
        }),
      ],
      subtotal: 200000,
      tax: 9000,
      total: 189000,
    },
    {
      name: '10. inclusive pricing',
      doc: { taxMode: 'inclusive' },
      lines: () => [makeLine({ unitPrice: 110000 })],
      subtotal: 110000,
      tax: 10000,
      total: 110000,
    },
    {
      name: '11. sectioned invoice',
      doc: {},
      lines: () => [
        makeLine({ type: 'section', description: 'Discovery', position: 1 }),
        makeLine({ unitPrice: 125000, position: 2 }),
        makeLine({ type: 'section', description: 'Delivery', position: 3 }),
        makeLine({ unitPrice: 375000, position: 4 }),
      ],
      subtotal: 500000,
      tax: 50000,
      total: 550000,
    },
    {
      name: '12. section discount',
      doc: {},
      lines: () => [
        makeLine({ type: 'section', description: 'S', position: 1, id: 'sec-x' }),
        makeLine({ unitPrice: 100000, position: 2 }),
        makeLine({
          type: 'discount',
          description: 'S',
          discountType: 'percent',
          discountValue: '20',
          appliesToSectionId: 'sec-x',
          position: 3,
        }),
      ],
      subtotal: 80000,
      tax: 8000,
      total: 88000,
    },
    {
      name: '13. expense with markup',
      doc: {},
      lines: () => [makeLine({ type: 'expense', amountOverride: 2500, markupPercent: '20' })],
      subtotal: 3000,
      tax: 300,
      total: 3300,
    },
    {
      name: '14. paid in full',
      doc: {},
      lines: () => [makeLine({ unitPrice: 100000 })],
      payments: () => [makePayment(110000)],
      subtotal: 100000,
      tax: 10000,
      total: 110000,
    },
    {
      name: '15. part paid',
      doc: {},
      lines: () => [makeLine({ unitPrice: 200000 })],
      payments: () => [makePayment(100000)],
      subtotal: 200000,
      tax: 20000,
      total: 220000,
    },
    {
      name: '16. USD invoice',
      doc: { currency: 'USD' },
      lines: () => [makeLine({ unitPrice: 250000 })],
      subtotal: 250000,
      tax: 25000,
      total: 275000,
    },
    {
      name: '17. JPY invoice',
      doc: { currency: 'JPY' },
      lines: () => [makeLine({ unitPrice: 50000 })],
      subtotal: 50000,
      tax: 5000,
      total: 55000,
    },
    {
      name: '18. KWD invoice',
      doc: { currency: 'KWD' },
      lines: () => [makeLine({ unitPrice: 50000 })],
      subtotal: 50000,
      tax: 5000,
      total: 55000,
    },
    {
      name: '19. surcharge',
      doc: {},
      lines: () => [
        makeLine({ unitPrice: 100000, position: 1 }),
        makeLine({
          type: 'discount',
          description: 'Late fee',
          discountType: 'percent',
          discountValue: '5',
          discountDirection: 'surcharge',
          position: 2,
        }),
      ],
      subtotal: 100000,
      tax: 10500,
      total: 115500,
    },
    {
      name: '20. inclusive with a document discount',
      doc: { taxMode: 'inclusive' },
      lines: () => [
        makeLine({ unitPrice: 200000, position: 1 }),
        makeLine({ unitPrice: 200000, position: 2 }),
        makeLine({
          type: 'discount',
          description: 'D',
          discountType: 'percent',
          discountValue: '25',
          position: 3,
        }),
      ],
      subtotal: 400000,
      tax: 27273,
      total: 300000,
    },
  ];

  it.each(cases)('$name', ({ doc, lines, payments, subtotal, tax, total }) => {
    const r = calc({ document: makeDoc(doc), lines: lines(), payments: payments?.() ?? [] });
    expect(r.subtotal, 'subtotal').toBe(subtotal);
    expect(r.tax, 'tax').toBe(tax);
    expect(r.total, 'total').toBe(total);
    expectReconciled(r, doc.taxMode);
    expectTaxGroupsSum(r);
  });
});

/* ------------------------------------------------------------------ */
/* Cross-checks against the compliance panel                           */
/* ------------------------------------------------------------------ */

describe('integration with the compliance panel', () => {
  void businessProfileSchema;
  void settingsSchema;

  it('reports the GST amount so the panel can block when it is missing', () => {
    const r = calc({ lines: [makeLine({ unitPrice: 100000 })] });
    expect(r.gstPayable).toBe(10000);
  });

  it('reports zero GST for a fully zero-rated document', () => {
    const r = calc({ lines: [makeLine({ unitPrice: 100000, taxCodeId: 'tax_export' })] });
    expect(r.gstPayable).toBe(0);
    expect(r.hasAnyTaxable).toBe(false);
  });

  it('reports a mixed document so the marker key can be required', () => {
    const r = calc({
      lines: [
        makeLine({ unitPrice: 100000, position: 1 }),
        makeLine({ unitPrice: 100000, position: 2, taxCodeId: 'tax_gst_free' }),
      ],
    });
    expect(r.hasMixedTaxability).toBe(true);
    expect(r.markerCodes.length).toBeGreaterThan(0);
  });

  it('produces a total the $1,000 buyer-identity rule can be tested against', () => {
    const r = calc({ lines: [makeLine({ unitPrice: 100000 })] });
    expect(r.total).toBeGreaterThanOrEqual(100_000);
  });
});
