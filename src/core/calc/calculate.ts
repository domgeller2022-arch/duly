/**
 * The calculation engine.
 *
 * Ten rules, in a fixed order, all of them unit-tested:
 *
 *  1. Line amount = quantity x unit price, rounded to the currency's minor unit.
 *  2. Line discount: percent or fixed, never below zero.
 *  3. Section subtotal = sum of that section's lines; section discount next.
 *  4. Document subtotal = sum of line amounts after line and section discounts.
 *  5. Document discount/surcharge applied to the subtotal, apportioned across tax
 *     codes by value so GST stays correct.
 *  6. Tax, grouped by tax code, per the chosen rounding method.
 *  7. Total = subtotal + tax when pricing is exclusive, or subtotal when
 *     pricing is inclusive (tax is then extracted from it).
 *  8. Paid = sum of payments; balance = total - paid.
 *  9. A credit note carries the negation of everything above.
 * 10. The AUD equivalent is informational only and never feeds a total.
 *
 * Nothing in this file touches the database, the DOM or a clock beyond the
 * `today` argument, so it runs identically in the browser, in Tauri and in a
 * test.
 */

import type { Document, DocumentLine, Payment, Totals } from '../schemas/document';
import { NON_VALUED_LINE_TYPES, VALUED_LINE_TYPES } from '../schemas/document';
import type { RoundingMethod, TaxCode, TaxCodeType } from '../tax/tax';
import { getTaxCode, isTaxable, roundTax } from '../tax/tax';
import type { Money } from '../money/money';
import { allocateProRata, currencyDecimalsOf, roundMinor } from './helpers';
import { percentToFraction } from '../money/money';
import Big from 'big.js';

Big.DP = 24;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface LineComputation {
  lineId: string;
  /** Amount after line discount, section discount and apportioned document discount. */
  gross: number;
  /** Amount before any tax. Equals gross when pricing is exclusive. */
  net: number;
  tax: number;
  taxCodeId: string;
  taxCodeName: string;
  /** Section heading this line rolls up into, or null when unsectioned. */
  sectionId: string | null;
  /** Position in the document, kept for sorting. */
  position: number;
  /** This line's share of any document-level discount, as a signed number. */
  documentDiscountShare: number;
  /** This line's share of its section's discount, as a signed number. */
  sectionDiscountShare: number;
  /** Line discount in minor units (positive). */
  lineDiscount: number;
  /** For `discount`/`surcharge` lines: the base the percentage was taken from. */
  discountBaseAmount: number;
}

export interface SectionSummary {
  id: string;
  title: string;
  description: string;
  position: number;
  /** Sum of the section's line amounts before the section discount. */
  subtotalBeforeDiscount: number;
  /** Sum after the section discount, excluding apportioned document discount. */
  subtotal: number;
  /** Signed section discount total (negative for a discount). */
  discount: number;
  lineIds: string[];
  collapsed: boolean;
  showSubtotal: boolean;
  pageBreakBefore: boolean;
}

export interface TaxGroupSummary {
  taxCodeId: string;
  name: string;
  rate: string;
  type: TaxCodeType;
  label: string | null;
  taxable: boolean;
  /** Sum of gross amounts under this code, after all discounts. */
  gross: number;
  net: number;
  tax: number;
  lineIds: string[];
  /** Rendered rate for display: "10%", "GST-free", "Export". */
  rateLabel: string;
  /** Whether a line under this code needs a marker beside it. */
  needsMarker: boolean;
}

export interface CalculateInput {
  document: Document;
  lines: DocumentLine[];
  payments?: Payment[];
  taxCodes: TaxCode[];
  roundingMethod?: RoundingMethod;
  /** Client credit available to apply, in minor units. */
  clientCreditAvailable?: number;
  /** Rate to AUD for the informational equivalent. */
  rateToAud?: string | null;
  /** Multiplies every result by -1 for a credit note. */
  sign?: 1 | -1;
}

export interface CalculationResult {
  lines: Map<string, LineComputation>;
  lineOrder: string[];
  sections: SectionSummary[];
  taxGroups: TaxGroupSummary[];
  /** Rule 4: sum of line amounts after line and section discounts. */
  subtotal: number;
  /** Rule 5: document-level discount (negative) or surcharge (positive). */
  discount: number;
  /** Rule 6. */
  tax: number;
  /** Rule 7. */
  total: number;
  /** Rule 7: the tax-free base, useful for margin work. */
  net: number;
  /** Rule 8. */
  paid: number;
  balance: number;
  creditApplied: number;
  currency: string;
  decimals: number;
  /** -1 when this document is a credit note. */
  sign: 1 | -1;
  /** GST payable, used by the compliance panel and the BAS summary. */
  gstPayable: number;
  /** True when taxable and zero-rated lines are mixed on one document. */
  hasMixedTaxability: boolean;
  hasAnyTaxable: boolean;
  /** Tax codes that need a printed marker and key. */
  markerCodes: TaxGroupSummary[];
  audEquivalent: number | null;
  /** Lines whose description is empty — a finalise warning, not a block. */
  incompleteLineIds: string[];
}

/* ------------------------------------------------------------------ */
/* Internal shapes                                                     */
/* ------------------------------------------------------------------ */

/**
 * A tax group under construction.
 *
 * `grossRaw` is kept separately from `netRaw` and `taxRaw` because for exclusive
 * pricing `net + tax != gross` — the tax is on top of the listed price. For
 * inclusive pricing `net + tax == gross` exactly, which is the invariant the
 * rounding has to preserve.
 */
interface Group {
  taxCode: TaxCode;
  lineIds: string[];
  grossRaw: Big;
  taxRaw: Big;
  netRaw: Big;
  perLine: { lineId: string; grossRaw: Big; taxRaw: Big; netRaw: Big }[];
}

/** A value-bearing line mid-calculation. */
interface Draft {
  line: DocumentLine;
  amountBeforeLineDiscount: number;
  lineDiscount: number;
  amountAfterLineDiscount: number;
  /** Signed section-discount share already applied to this line. */
  sectionDiscountApplied: number;
  sectionId: string | null;
  taxCodeId: string;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function calculate(input: CalculateInput): CalculationResult {
  const { document: doc, lines, taxCodes } = input;
  const currency = doc.currency;
  const decimals = currencyDecimalsOf(currency);
  const sign: 1 | -1 = input.sign ?? (doc.type === 'credit_note' ? -1 : 1);
  const rounding: RoundingMethod = input.roundingMethod ?? 'total_invoice';
  const inclusive = doc.taxMode === 'inclusive';
  const defaultTaxCodeId = doc.taxCodeId;

  const ordered = [...lines].sort(byPositionThenId);
  const live = ordered.filter((l) => !l.deletedAt);

  /* -- Pass 1: raw line amounts and line-level discounts -- */

  const drafts: Draft[] = [];
  const sectionOf = new Map<string, string | null>();
  let currentSectionId: string | null = null;
  const sectionDrafts = new Map<string, DocumentLine>();

  for (const line of live) {
    if (line.type === 'section') {
      currentSectionId = line.id;
      sectionDrafts.set(line.id, line);
      sectionOf.set(line.id, null);
      continue;
    }
    sectionOf.set(line.id, currentSectionId);
  }

  for (const line of live) {
    if (NON_VALUED_LINE_TYPES.includes(line.type)) continue;

    const taxCodeId = line.taxCodeId ?? defaultTaxCodeId ?? 'tax_gst';

    if (line.type === 'discount') {
      drafts.push({
        line,
        amountBeforeLineDiscount: 0,
        lineDiscount: 0,
        amountAfterLineDiscount: 0,
        sectionDiscountApplied: 0,
        sectionId: sectionOf.get(line.id) ?? null,
        taxCodeId,
      });
      continue;
    }

    let amountBeforeLineDiscount = 0;

    if (line.type === 'expense' && line.amountOverride !== null) {
      // Expense lines are entered as a total, with an optional markup.
      const markup = num(line.markupPercent, 0);
      amountBeforeLineDiscount = roundMinor(
        new Big(line.amountOverride).mul(new Big(1).plus(percentToFraction(markup))),
      );
    } else {
      const qty = num(line.quantity, 0);
      amountBeforeLineDiscount = roundMinor(new Big(qty).mul(line.unitPrice));
    }

    // Rule 2 — line discount, never below zero.
    const { after, discount } = applyLineDiscount(amountBeforeLineDiscount, line);
    drafts.push({
      line,
      amountBeforeLineDiscount,
      lineDiscount: discount,
      amountAfterLineDiscount: after,
      sectionDiscountApplied: 0,
      sectionId: sectionOf.get(line.id) ?? null,
      taxCodeId,
    });
  }

  // Only item/time/expense lines carry a value into the tax base.
  const valued = drafts.filter((d) => VALUED_LINE_TYPES.includes(d.line.type) && d.line.type !== 'discount');

  /* -- Pass 2: section discounts, apportioned inside each section -- */

  const sectionDiscountShare = new Map<string, number>();
  const sectionDiscountTotals = new Map<string, number>();

  const discountLines = drafts.filter((d) => d.line.type === 'discount');

  for (const d of discountLines) {
    const targetSection = d.line.appliesToSectionId ?? d.sectionId;
    if (targetSection) {
      const members = valued.filter((v) => v.sectionId === targetSection);
      const base = members.reduce((acc, v) => acc + v.amountAfterLineDiscount, 0);
      const signed = signedDiscountAmount(d.line, base);
      const shares = distribute(
        signed,
        members.map((m) => m.amountAfterLineDiscount),
      );
      members.forEach((m, i) => {
        m.amountAfterLineDiscount = Math.max(0, m.amountAfterLineDiscount + shares[i]);
        m.sectionDiscountApplied += shares[i];
        sectionDiscountShare.set(m.line.id, (sectionDiscountShare.get(m.line.id) ?? 0) + shares[i]);
      });
      sectionDiscountTotals.set(targetSection, (sectionDiscountTotals.get(targetSection) ?? 0) + signed);
    }
  }

  /* -- Pass 3: document discounts, apportioned across tax codes by value -- */

  const documentDiscountShare = new Map<string, number>();
  let documentDiscountTotal = 0;

  /* -- Rule 4: the subtotal the client sees -- */

  // Captured here, while line amounts still hold everything except the document
  // discount. Rule 4 defines the printed Subtotal as the sum after *line and
  // section* discounts; rule 5 then takes the document discount off it. Keeping
  // both figures means the totals block reads Subtotal + Discount + Tax = Total,
  // with the document discount counted exactly once.
  const subtotalBeforeDocDiscount = valued.reduce((acc, v) => acc + v.amountAfterLineDiscount, 0);

  const docLevelDiscounts = discountLines.filter((d) => !d.line.appliesToSectionId && !d.sectionId);

  for (const d of docLevelDiscounts) {
    const base = valued.reduce((acc, v) => acc + v.amountAfterLineDiscount, 0);
    const signed = signedDiscountAmount(d.line, base);
    documentDiscountTotal += signed;

    // Rule 5: apportion by value so GST stays correct per tax code.
    const shares = distribute(
      signed,
      valued.map((v) => v.amountAfterLineDiscount),
    );
    valued.forEach((v, i) => {
      v.amountAfterLineDiscount = Math.max(0, v.amountAfterLineDiscount + shares[i]);
      documentDiscountShare.set(v.line.id, shares[i]);
    });
  }

  /* -- The tax base: line amounts after every discount, line and section alike -- */

  const taxableBase = valued.reduce((acc, v) => acc + v.amountAfterLineDiscount, 0);

  /* -- Rule 6: tax, grouped by tax code -- */

  const groups = new Map<string, Group>();

  for (const v of valued) {
    const taxCode = getTaxCode(taxCodes, v.taxCodeId);
    let group = groups.get(taxCode.id);
    if (!group) {
      group = {
        taxCode,
        lineIds: [],
        grossRaw: new Big(0),
        taxRaw: new Big(0),
        netRaw: new Big(0),
        perLine: [],
      };
      groups.set(taxCode.id, group);
    }
    const gross = new Big(v.amountAfterLineDiscount);
    group.grossRaw = group.grossRaw.plus(gross);
    group.lineIds.push(v.line.id);

    const perLine = perLineTax(gross, taxCode, doc.taxMode);
    group.taxRaw = group.taxRaw.plus(perLine.tax);
    group.netRaw = group.netRaw.plus(perLine.net);
    group.perLine.push({ lineId: v.line.id, grossRaw: gross, taxRaw: perLine.tax, netRaw: perLine.net });
  }

  // Compound tax is calculated on the base plus tax already accumulated.
  const orderedGroups = [...groups.values()].sort((a, b) => a.taxCode.displayOrder - b.taxCode.displayOrder);

  let compoundCarry = new Big(0);
  const perLineTaxMap = new Map<string, { tax: number; net: number }>();

  for (const group of orderedGroups) {
    if (group.taxCode.compound && isTaxable(group.taxCode)) {
      // A compound code charges on the net base *plus* the tax already applied
      // to this document, so it must run after the ordinary codes.
      const divisor = new Big(1).plus(num(group.taxCode.rate, 0));
      const alreadyTaxed = compoundCarry;
      let groupTax: Big;
      let groupNet: Big;

      if (inclusive) {
        // The compound tax is already inside the gross, so it must be extracted
        // from base + carried tax rather than added on top.
        groupTax = group.grossRaw.plus(alreadyTaxed).mul(num(group.taxCode.rate, 0)).div(divisor);
        groupNet = group.grossRaw.minus(groupTax);
      } else {
        groupTax = group.grossRaw.plus(alreadyTaxed).mul(num(group.taxCode.rate, 0));
        groupNet = group.grossRaw;
      }

      group.taxRaw = groupTax;
      group.netRaw = groupNet;

      // Per-line, the carried tax is apportioned by line gross value so the
      // per-line arithmetic still reconciles to the group.
      const lineWeights = group.perLine.map((p) => p.grossRaw.toNumber());
      const carryShares = allocateProRata(alreadyTaxed.toNumber(), lineWeights);
      const rewritten = group.perLine.map((p, i) => {
        const base = p.grossRaw.plus(carryShares[i]);
        const tax = inclusive
          ? base.mul(num(group.taxCode.rate, 0)).div(divisor)
          : base.mul(num(group.taxCode.rate, 0));
        return { lineId: p.lineId, grossRaw: p.grossRaw, taxRaw: tax, netRaw: p.grossRaw.minus(tax) };
      });
      group.perLine = rewritten;

      assignPerLine(group, groupTax, perLineTaxMap, rounding, inclusive);
      compoundCarry = compoundCarry.plus(groupTax);
      continue;
    }

    assignPerLine(group, group.taxRaw, perLineTaxMap, rounding, inclusive);
    compoundCarry = compoundCarry.plus(group.taxRaw);
  }

  // The document tax is the sum of the *rounded* per-line taxes, never a fresh
  // rounding of the unrounded total. Re-rounding here would quietly undo the
  // taxable sale rule, which rounds each sale before summing.
  const taxTotal = [...perLineTaxMap.values()].reduce((acc, p) => acc + p.tax, 0);
  /* -- Assemble per-line results -- */

  const computations = new Map<string, LineComputation>();
  const lineOrder: string[] = [];
  const incompleteLineIds: string[] = [];

  for (const v of valued) {
    const taxCode = getTaxCode(taxCodes, v.taxCodeId);
    const per = perLineTaxMap.get(v.line.id);
    const lineTax = per?.tax ?? 0;
    const lineNet = per?.net ?? v.amountAfterLineDiscount;

    // Every per-line figure carries the sign, so a credit note's PDF shows
    // negative amounts line by line and stays the exact mirror of its invoice.
    computations.set(v.line.id, {
      lineId: v.line.id,
      gross: sign * v.amountAfterLineDiscount,
      net: sign * lineNet,
      tax: sign * lineTax,
      taxCodeId: taxCode.id,
      taxCodeName: taxCode.name,
      sectionId: v.sectionId,
      position: v.line.position,
      documentDiscountShare: sign * (documentDiscountShare.get(v.line.id) ?? 0),
      sectionDiscountShare: sign * (sectionDiscountShare.get(v.line.id) ?? 0),
      lineDiscount: sign * v.lineDiscount,
      discountBaseAmount: 0,
    });

    lineOrder.push(v.line.id);
    if (!v.line.description.trim()) incompleteLineIds.push(v.line.id);
  }

  for (const d of discountLines) {
    const base =
      (d.line.appliesToSectionId ?? d.sectionId)
        ? valued
            .filter((v) => v.sectionId === (d.line.appliesToSectionId ?? d.sectionId))
            .reduce((acc, v) => acc + v.amountAfterLineDiscount, 0)
        : valued.reduce((acc, v) => acc + v.amountAfterLineDiscount, 0);

    computations.set(d.line.id, {
      lineId: d.line.id,
      gross: 0,
      net: 0,
      tax: 0,
      taxCodeId: d.taxCodeId,
      taxCodeName: getTaxCode(taxCodes, d.taxCodeId).name,
      sectionId: d.sectionId,
      position: d.line.position,
      // The discount line is what *takes* the discount, so it never also claims
      // a share of one; `discountBaseAmount` records what it was taken from.
      documentDiscountShare: 0,
      sectionDiscountShare: 0,
      lineDiscount: 0,
      discountBaseAmount: base,
    });
    lineOrder.push(d.line.id);
  }

  /* -- Sections -- */

  const sections: SectionSummary[] = [...sectionDrafts.values()]
    .map((s) => {
      const members = valued.filter((v) => v.sectionId === s.id);
      const lineIds = members.map((m) => m.line.id);
      return {
        id: s.id,
        title: s.description,
        description: s.notes,
        position: s.position,
        subtotalBeforeDiscount:
          sign *
          (members.reduce((acc, m) => acc + m.amountBeforeLineDiscount, 0) -
            members.reduce((acc, m) => acc + m.lineDiscount, 0)),
        subtotal: sign * members.reduce((acc, m) => acc + m.amountAfterLineDiscount, 0),
        discount: sign * (sectionDiscountTotals.get(s.id) ?? 0),
        lineIds,
        collapsed: s.collapsed,
        showSubtotal: s.showSubtotal,
        pageBreakBefore: s.pageBreakBefore,
      };
    })
    .sort((a, b) => a.position - b.position);

  /* -- Tax groups for the breakdown table -- */

  const taxGroups: TaxGroupSummary[] = orderedGroups.map((group) => {
    const groupTax = group.perLine.reduce((acc, p) => acc + (perLineTaxMap.get(p.lineId)?.tax ?? 0), 0);
    const groupNet = group.perLine.reduce((acc, p) => acc + (perLineTaxMap.get(p.lineId)?.net ?? 0), 0);
    return {
      taxCodeId: group.taxCode.id,
      name: group.taxCode.name,
      rate: group.taxCode.rate,
      type: group.taxCode.type,
      label: group.taxCode.label,
      taxable: isTaxable(group.taxCode),
      gross: sign * group.grossRaw.toNumber(),
      net: sign * groupNet,
      tax: sign * groupTax,
      lineIds: group.lineIds,
      rateLabel: rateLabel(group.taxCode),
      needsMarker: !!group.taxCode.label,
    };
  });

  const anyTaxable = taxGroups.some((g) => g.taxable);
  const anyUntaxable = taxGroups.some((g) => !g.taxable);
  const markerCodes = taxGroups.filter((g) => g.needsMarker);

  /* -- Rules 7 and 8 -- */

  const payments = input.payments ?? [];
  const paidRaw = payments.filter((p) => !p.deletedAt).reduce((acc, p) => acc + p.amount, 0);

  // Rule 7. In exclusive pricing the tax is added on top of the discounted base;
  // in inclusive pricing the listed prices already contain it, so the total is
  // the base itself and the tax is extracted from it for the breakdown.
  const subtotal = sign * subtotalBeforeDocDiscount;
  const discount = sign * documentDiscountTotal;
  const tax = sign * taxTotal;
  const total = inclusive ? sign * taxableBase : sign * (taxableBase + taxTotal);
  const net = inclusive ? sign * (taxableBase - taxTotal) : sign * taxableBase;
  const paid = sign * paidRaw;

  const creditAvailable = input.clientCreditAvailable ?? 0;
  const creditApplied = total > 0 ? Math.min(Math.max(0, creditAvailable), total) : 0;
  const balance = total - paid - creditApplied;

  // GST payable drives the BAS summary and the "includes GST" allowance, so it
  // must be the rounded GST total of the GST-coded lines.
  const gstPayable =
    sign *
    [...groups.values()]
      .filter((g) => g.taxCode.id === 'tax_gst')
      .flatMap((g) => g.perLine.map((p) => perLineTaxMap.get(p.lineId)?.tax ?? 0))
      .reduce((acc, t) => acc + t, 0);

  const audEquivalent = computeAudEquivalent(total, input.rateToAud, currency);

  return {
    lines: computations,
    lineOrder,
    sections,
    taxGroups,
    subtotal,
    discount,
    tax,
    total,
    net,
    paid,
    balance,
    creditApplied,
    currency,
    decimals,
    sign,
    gstPayable,
    hasMixedTaxability: anyTaxable && anyUntaxable,
    hasAnyTaxable: anyTaxable,
    markerCodes,
    audEquivalent,
    incompleteLineIds,
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function perLineTax(gross: Big, code: TaxCode, mode: 'exclusive' | 'inclusive') {
  if (!isTaxable(code)) return { tax: new Big(0), net: gross };
  const rate = num(code.rate, 0);
  if (mode === 'exclusive') return { tax: gross.mul(rate), net: gross };
  // Inclusive: GST is exactly 1/11 of the gross at 10%.
  const divisor = new Big(1).plus(rate);
  const tax = gross.mul(rate).div(divisor);
  return { tax, net: gross.minus(tax) };
}

/**
 * Decide where rounding happens, then hand each line its tax and net share.
 *
 * `taxable_sale` rounds each taxable sale on its own, then sums. `total_invoice`
 * — the ATO default — sums the unrounded tax for a code, rounds once, and
 * spreads the rounded total across the lines pro-rata by unrounded tax value.
 *
 * Either way `net + tax = gross` holds for every line, which is what keeps an
 * inclusive-mode total equal to its own subtotal after rounding.
 */
function assignPerLine(
  group: Group,
  groupTaxRaw: Big,
  out: Map<string, { tax: number; net: number }>,
  rounding: RoundingMethod,
  inclusive: boolean,
): void {
  if (group.perLine.length === 0) return;

  if (rounding === 'taxable_sale') {
    for (const p of group.perLine) {
      const tax = roundTax(p.taxRaw);
      const gross = p.grossRaw.toNumber();
      out.set(p.lineId, { tax, net: inclusive ? gross - tax : gross });
    }
    return;
  }

  const roundedTotal = roundTax(groupTaxRaw);
  if (roundedTotal === 0) {
    for (const p of group.perLine) {
      const gross = p.grossRaw.toNumber();
      out.set(p.lineId, { tax: 0, net: gross });
    }
    return;
  }

  // Spread the rounded total by unrounded tax magnitude. Largest-remainder
  // allocation makes the shares sum to exactly the rounded total.
  const weights = group.perLine.map((p) => Math.abs(p.taxRaw.toNumber()));
  const shares = allocateProRata(roundedTotal, weights);

  group.perLine.forEach((p, i) => {
    const gross = p.grossRaw.toNumber();
    out.set(p.lineId, { tax: shares[i], net: inclusive ? gross - shares[i] : gross });
  });
}

function applyLineDiscount(amount: number, line: DocumentLine): { after: number; discount: number } {
  if (line.discountType === 'none') return { after: amount, discount: 0 };
  const value = num(line.discountValue, 0);

  if (line.discountType === 'percent') {
    // `discountValue` is a whole percentage: "10" means 10%, not a 10x factor.
    const factor = new Big(1).minus(percentToFraction(value));
    const after = roundMinor(new Big(amount).mul(factor.lt(0) ? new Big(0) : factor));
    return { after: Math.max(0, after), discount: amount - Math.max(0, after) };
  }

  // Fixed: an amount in minor units. Never drives the line below zero.
  const fixed = Math.max(0, Math.round(value));
  const after = Math.max(0, amount - fixed);
  return { after, discount: amount - after };
}

/** Signed result of a discount/surcharge line against its base. */
function signedDiscountAmount(line: DocumentLine, base: number): number {
  if (base === 0) return 0;
  const positive = line.discountDirection === 'surcharge';
  let amount: number;

  if (line.discountType === 'percent') {
    const pct = percentToFraction(num(line.discountValue, 0));
    amount = roundMinor(new Big(Math.abs(base)).mul(pct));
  } else {
    amount = Math.max(0, Math.round(num(line.discountValue, 0)));
  }

  const capped = Math.min(amount, Math.abs(base));
  return positive ? capped : -capped;
}

/** Split a signed delta across members so the parts sum exactly to the delta. */
function distribute(delta: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const absWeights = weights.map((w) => Math.max(0, w));
  if (absWeights.every((w) => w === 0)) {
    const out = new Array<number>(weights.length).fill(0);
    out[0] = delta;
    return out;
  }
  const shares = allocateProRata(delta, absWeights);
  // A discount can never push a line below zero; give back any overshoot.
  let overshoot = 0;
  const out = shares.map((s, i) => {
    const next = weights[i] + s;
    if (next < 0) {
      overshoot += next;
      return -weights[i];
    }
    return s;
  });
  if (overshoot !== 0) {
    // Redistribute the leftover to the lines that still have room.
    const room = out.map((s, i) => Math.max(0, weights[i] + s));
    const extra = allocateProRata(overshoot, room);
    for (let i = 0; i < out.length; i++) out[i] += extra[i];
  }
  return out;
}

function num(value: string | number | undefined | null, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  try {
    return new Big(value).toNumber();
  } catch {
    return fallback;
  }
}

/** amount * (1 + markup%) as an exact decimal string before scaling. */
export function numMajor(amountMinor: number, percent: number): Big {
  return new Big(amountMinor).mul(new Big(1).plus(percent));
}

export function rateLabel(code: TaxCode): string {
  if (code.type === 'gst') return `${trim(num(code.rate, 0) * 100)}%`;
  if (code.type === 'custom' || code.type === 'compound') return `${trim(num(code.rate, 0) * 100)}%`;
  return code.label ?? code.name;
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}

function byPositionThenId(a: DocumentLine, b: DocumentLine): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function computeAudEquivalent(
  total: number,
  rate: string | null | undefined,
  currency: string,
): number | null {
  if (!rate || currency === 'AUD') return null;
  try {
    const r = new Big(rate);
    if (r.lte(0)) return null;
    return roundMinor(new Big(total).mul(r));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Totals cache                                                        */
/* ------------------------------------------------------------------ */

/** Writes the result into a document's cached totals. Always call after save. */
export function applyTotals<T extends { totals: Totals }>(target: T, result: CalculationResult): T {
  target.totals = {
    subtotal: result.subtotal,
    discount: result.discount,
    tax: result.tax,
    total: result.total,
    paid: result.paid,
    balance: result.balance,
    creditApplied: result.creditApplied,
    currency: result.currency,
    audEquivalent: result.audEquivalent,
    gstPayable: result.gstPayable,
    computedAt: new Date().toISOString(),
  };
  return target;
}

/** True when the cache is stale and the document must be recalculated. */
export function totalsAreStale(
  doc: Pick<Document, 'totals' | 'updatedAt'>,
  result: CalculationResult,
): boolean {
  if (!doc.totals.computedAt) return true;
  const t = doc.totals;
  return (
    t.subtotal !== result.subtotal ||
    t.discount !== result.discount ||
    t.tax !== result.tax ||
    t.total !== result.total ||
    t.paid !== result.paid ||
    t.currency !== result.currency
  );
}

export function moneyOf(minor: number, currency: string): Money {
  return { minor, currency };
}
