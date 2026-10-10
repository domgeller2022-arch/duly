/**
 * Number-pattern engine.
 *
 * A pattern is plain text with tokens, e.g. `INV-{YYYY}-{####}`. Tokens are
 * expanded against the issue date and the document's context, and the counter
 * token `{####}` is zero-padded to the width of the `#` run.
 *
 * The counter itself lives in the storage layer (see `numberSequence`), because
 * a number must be *reserved inside a transaction* to be un-reusable. This
 * module is pure: it formats a value it is given, and can preview the result of
 * a pattern without touching the database.
 */

import type { DocumentType } from '../schemas/document';
import type { NumberSequence, ResetRule } from '../schemas/automation';
import { financialYearKey } from '../validation/dates';

export interface NumberContext {
  /** Counter value for this document. 1-based. */
  value: number;
  /** Issue date, `YYYY-MM-DD`. */
  date: string;
  documentType: DocumentType;
  /** Client code for the `{CLIENT}` token. */
  clientCode?: string;
  /** Business code for the `{PROFILE}` token. */
  profileCode?: string;
  /** Australian Financial Year start month, for `{FY}`. */
  financialYearStartMonth?: number;
  /** Extra values available to custom tokens. */
  extra?: Record<string, string>;
}

/** Every token Duly understands, for the settings screen and tooltips. */
export const NUMBER_TOKENS: readonly { token: string; description: string }[] = [
  { token: '{YYYY}', description: 'Four-digit issue year, e.g. 2026' },
  { token: '{YY}', description: 'Two-digit issue year, e.g. 26' },
  { token: '{MM}', description: 'Two-digit issue month, e.g. 10' },
  { token: '{DD}', description: 'Two-digit issue day, e.g. 06' },
  { token: '{FY}', description: 'Financial year, e.g. 27 for July 2026 – June 2027' },
  { token: '{####}', description: 'Counter, zero-padded to the number of # (start at 1, never reused)' },
  { token: '{CLIENT}', description: "The client's code" },
  { token: '{PROFILE}', description: "The business profile's code" },
  { token: '{TYPE}', description: 'Short code for the document type, e.g. INV' },
];

const SHORT_TYPES: Record<DocumentType, string> = {
  invoice: 'INV',
  quote: 'Q',
  credit_note: 'CN',
  proforma: 'PF',
  delivery_note: 'DN',
  payment_receipt: 'RCT',
};

/**
 * Expand a pattern into a document number.
 *
 * Every token is substituted in a single pass, so a client code containing
 * something that looks like a token is never expanded a second time.
 */
export function renderNumber(pattern: string, ctx: NumberContext): string {
  const [y, m, d] = ctx.date.split('-');
  const fy = financialYearKey(ctx.date, ctx.financialYearStartMonth ?? 7);

  const values: Record<string, string> = {
    YYYY: y ?? '',
    YY: (y ?? '').slice(2),
    MM: m ?? '',
    DD: d ?? '',
    // The short form: the closing year, so the printed heading reads FY27 rather
    // than the whole "2026-27".
    FY: fy.split('-')[1] ?? fy,
    CLIENT: ctx.clientCode ?? '',
    PROFILE: ctx.profileCode ?? '',
    TYPE: SHORT_TYPES[ctx.documentType] ?? '',
    ...(ctx.extra ?? {}),
  };

  // Counter runs of any length, so {###} and {####} both work.
  const counter = /\{(#+)\}/g;

  return pattern
    .replace(counter, (_match, hashes: string) => String(ctx.value).padStart(hashes.length, '0'))
    .replace(/\{([A-Za-z_]+)\}/g, (match, key: string) => {
      const upper = key.toUpperCase();
      if (upper in values) return values[upper];
      return match; // Unknown token left visible so it is obvious, not silently blank.
    });
}

/** The literal prefix before the first token, used to sort and group numbers. */
export function patternPrefix(pattern: string): string {
  const i = pattern.indexOf('{');
  return i === -1 ? pattern : pattern.slice(0, i);
}

/** True when the pattern contains a counter, and therefore needs a sequence row. */
export function hasCounter(pattern: string): boolean {
  return /\{#+\}/.test(pattern);
}

/** Thrown when a number pattern cannot produce a unique number. */
export class NumberPatternError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NumberPatternError';
  }
}

/**
 * Refuse a pattern that cannot produce a unique number.
 *
 * A pattern with no counter — `INV-{YYYY}` — renders the same string for every
 * document in the period. The reservation's "skip a number already issued" loop
 * would then never advance, freezing the app on submit. This is checked before
 * the loop runs (and before the settings screen saves), not inside it.
 */
export function assertCounterPattern(pattern: string): void {
  if (!hasCounter(pattern)) {
    throw new NumberPatternError(
      `The number pattern "${pattern}" has no counter. Add a {####} token, otherwise every document in a period would be given the same number.`,
    );
  }
}

/** A preview number for the settings screen, using the next unused value. */
export function previewNumber(pattern: string, ctx: Omit<NumberContext, 'value'>, nextValue = 1): string {
  return renderNumber(pattern, { ...ctx, value: nextValue });
}

/**
 * The period key a sequence resets on.
 *
 * `yearly` uses the calendar year, `financial_year` uses the Australian
 * financial year, and `never` uses a constant so the counter runs forever.
 */
export function periodKeyFor(date: string, rule: ResetRule, financialYearStartMonth = 7): string {
  switch (rule) {
    case 'yearly':
      return date.slice(0, 4);
    case 'financial_year':
      return financialYearKey(date, financialYearStartMonth);
    case 'never':
    default:
      return 'all-time';
  }
}

/**
 * Decide whether the counter must roll over before the next number.
 *
 * A period change resets to the sequence's start value — which is why
 * `INV-{YYYY}-{####}` restarts at 0001 each January while `CN-{####}` never
 * repeats a number at all.
 */
export function shouldReset(
  sequence: Pick<NumberSequence, 'resetRule' | 'periodKey'>,
  date: string,
  financialYearStartMonth = 7,
): boolean {
  if (sequence.resetRule === 'never') return false;
  const next = periodKeyFor(date, sequence.resetRule, financialYearStartMonth);
  // Only a period that has genuinely arrived rolls the counter over. A
  // backdated document — the invoice issued 31 Dec after the first of
  // January — must never roll the sequence back to a number it has already
  // handed out.
  return next > sequence.periodKey;
}

/** The counter value to hand out, applying the start value and any reset. */
export function nextCounterValue(
  sequence: Pick<NumberSequence, 'nextValue' | 'startAt'>,
  reset: boolean,
): number {
  return reset ? sequence.startAt : sequence.nextValue;
}

/**
 * Guard against a hand-typed pattern that would produce the same number twice.
 * Two sequences for the same profile and document type must not share a shape
 * once their literal parts differ only by something variable.
 */
export function patternsCollide(a: string, b: string): boolean {
  // Every `{...}` token collapses to the same placeholder, so `{####}` and
  // `{###}` count as the same shape and the collision is flagged.
  const skeleton = (p: string) => p.replace(/\{[^}]*\}/g, ' {} ');
  return skeleton(a) === skeleton(b);
}

/** Sort key for document numbers, so `INV-2` sorts before `INV-10`. */
export function numberSortKey(number: string): string {
  return number.replace(/\d+/g, (d) => d.padStart(12, '0'));
}

export function compareNumbers(a: string, b: string): number {
  const ka = numberSortKey(a);
  const kb = numberSortKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/** A short human label for a document type, used in the editor and lists. */
export function documentTypeLabel(type: DocumentType): string {
  switch (type) {
    case 'invoice':
      return 'Invoice';
    case 'quote':
      return 'Quote';
    case 'credit_note':
      return 'Credit Note';
    case 'proforma':
      return 'Pro-forma Invoice';
    case 'delivery_note':
      return 'Delivery Note';
    case 'payment_receipt':
      return 'Payment Receipt';
    default:
      return type;
  }
}

/**
 * The heading printed on the document.
 *
 * A GST-registered Australian business must call its invoice a "Tax Invoice";
 * everyone else calls it an "Invoice". This is decided at finalise time and
 * frozen into the tax snapshot, so later switching GST off cannot rename a
 * document that was already issued.
 */
export function headingFor(gstRegistered: boolean, type: DocumentType): string {
  switch (type) {
    case 'invoice':
      return gstRegistered ? 'Tax Invoice' : 'Invoice';
    case 'quote':
      // A quote is a quote: "Tax Quote" is not a term the ATO uses, and
      // the compliance rules exempt quotes from the tax-invoice heading.
      return 'Quote';
    case 'credit_note':
      return gstRegistered ? 'Tax Credit Note' : 'Credit Note';
    case 'proforma':
      return 'Pro-forma Invoice';
    case 'delivery_note':
      return 'Delivery Note';
    case 'payment_receipt':
      return 'Payment Receipt';
    default:
      return 'Invoice';
  }
}
