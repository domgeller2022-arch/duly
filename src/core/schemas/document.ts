/**
 * Documents and their line items.
 *
 * Two rules govern this file:
 *
 * 1. **Totals are cached, never trusted.** `totals` on the document is what the
 *    calculation engine produced last; every read path recomputes and compares,
 *    so a stale cache can never reach a client.
 *
 * 2. **Finalised documents are immutable.** Anything that must not change after
 *    issue is copied onto the document at finalise time — in particular
 *    `taxSnapshot`, which freezes the GST status, the rates and the heading. A
 *    credit note always reads the snapshot of the invoice it credits, never the
 *    live business setting.
 */

import { z } from 'zod';
import {
  baseEntity,
  currencyCode,
  decimal,
  isoDate,
  isoDateTime,
  percentString,
  positiveDecimal,
  uuid,
} from './common';

export const DOCUMENT_TYPES = [
  'invoice',
  'quote',
  'credit_note',
  'payment_receipt',
  'delivery_note',
  'proforma',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_STATUSES = [
  'draft',
  'finalised',
  'sent',
  'partially_paid',
  'paid',
  'overdue',
  'void',
  'accepted',
  'declined',
  'expired',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const LINE_TYPES = ['item', 'time', 'expense', 'section', 'note', 'discount'] as const;
export type LineType = (typeof LINE_TYPES)[number];

/** Line types that carry a monetary amount and therefore feed tax. */
export const VALUED_LINE_TYPES: readonly LineType[] = ['item', 'time', 'expense', 'discount'];

/** Line types with no amount at all — they only organise or annotate. */
export const NON_VALUED_LINE_TYPES: readonly LineType[] = ['section', 'note'];

export const documentLineSchema = z.object({
  ...baseEntity,
  documentId: uuid,
  /** Manual ordering; sections and notes occupy positions too. */
  position: z.number().int().default(0),

  type: z.enum(LINE_TYPES).default('item'),

  /** Catalogue link. Null for a custom/free-typed line. */
  itemId: uuid.nullable().default(null),
  description: z.string().default(''),
  /** Extra detail under the description, supports line breaks. */
  notes: z.string().default(''),

  /** Up to 4 decimals: 7.25 hours. Stored as an exact decimal string. */
  quantity: positiveDecimal.default('1'),
  unit: z.string().default('each'),
  /** Price per single unit, in minor units. */
  unitPrice: z.number().int().default(0),
  /** Total entered directly for an expense line, in minor units. */
  amountOverride: z.number().int().nullable().default(null),

  /** Line discount. `none` means the line is not discounted. */
  discountType: z.enum(['none', 'percent', 'fixed']).default('none'),
  /** Percent as a string ("10" = 10%); for `fixed`, an amount in minor units as a string. */
  discountValue: z.string().default('0'),

  /** Tax code for this line. Null inherits the document default. */
  taxCodeId: z.string().nullable().default(null),

  /** Set for expense lines: percentage added to the amount before invoicing. */
  markupPercent: percentString.default('0'),
  /** Receipt attachment id for an expense line. */
  receiptAttachmentId: uuid.nullable().default(null),
  expenseId: uuid.nullable().default(null),

  /** Time lines: the day the work happened, and who or what it was for. */
  date: isoDate.nullable().default(null),
  activity: z.string().default(''),
  staff: z.string().default(''),
  timeEntryId: uuid.nullable().default(null),

  /** Section this line belongs to, filled in as the document is parsed. */
  sectionId: uuid.nullable().default(null),
  /** For a `discount` line: the section it applies to, or null for the whole document. */
  appliesToSectionId: uuid.nullable().default(null),

  /** `discount` lines only. A surcharge is a discount with a negative value. */
  discountDirection: z.enum(['discount', 'surcharge']).default('discount'),
  /** Base the discount applies to. */
  discountBase: z.enum(['subtotal', 'section']).default('subtotal'),

  /** Section lines only: whether the section starts collapsed in the editor. */
  collapsed: z.boolean().default(false),
  /** Section lines only: show the section subtotal in the editor and on the PDF. */
  showSubtotal: z.boolean().default(true),

  /** A note or section line that must start a new page in the PDF. */
  pageBreakBefore: z.boolean().default(false),

  /** Cached, recalculated on every read. Never treated as authoritative. */
  computedAmount: z.number().int().default(0),

  customFields: z.record(z.string(), z.string()).default({}),
});
export type DocumentLine = z.infer<typeof documentLineSchema>;

export const paymentSchema = z.object({
  ...baseEntity,
  documentId: uuid,
  date: isoDate,
  /** Minor units. Positive for money in; refunds are recorded as a new line. */
  amount: z.number().int(),
  method: z
    .enum(['bank_transfer', 'card', 'cash', 'cheque', 'paypal', 'other', 'credit_note', 'deposit'])
    .default('bank_transfer'),
  reference: z.string().default(''),
  note: z.string().default(''),
  /** True when the payment settled a requested deposit rather than the balance. */
  isDeposit: z.boolean().default(false),
  /** Set when this payment came from a bank statement import. */
  bankTransactionId: uuid.nullable().default(null),
});
export type Payment = z.infer<typeof paymentSchema>;

export const taxSnapshotSchema = z.object({
  /** GST status of the issuing business at the moment of finalising. */
  gstRegistered: z.boolean(),
  /** The printed heading: "Tax Invoice" when registered, "Invoice" otherwise. */
  heading: z.string(),
  /** Frozen copy of every tax code used, by id. */
  codes: z.record(
    z.string(),
    z.object({
      name: z.string(),
      rate: z.string(),
      type: z.string(),
      label: z.string().nullable(),
    }),
  ),
  /** The ATO "Total price includes GST" allowance, and the $1,000 threshold. */
  inclusiveGstStatementAllowed: z.boolean().default(false),
  buyerIdentityRequired: z.boolean().default(true),
  takenAt: isoDateTime,
  /** Australian Financial Year the document belongs to, e.g. "2026-27". */
  financialYear: z.string().default(''),
});
export type TaxSnapshot = z.infer<typeof taxSnapshotSchema>;

export const depositSchema = z.object({
  enabled: z.boolean().default(false),
  kind: z.enum(['percent', 'fixed']).default('percent'),
  /** Percent as a string, or a fixed amount in minor units. */
  value: z.string().default('50'),
  paid: z.boolean().default(false),
  paidAmount: z.number().int().default(0),
  /** Once a deposit is paid, the due date moves to the balance's due date. */
  balanceDueDate: isoDate.nullable().default(null),
  label: z.string().default('Deposit due'),
});
export type Deposit = z.infer<typeof depositSchema>;

export const totalsSchema = z.object({
  /** Sum of line amounts after line and section discounts. Net when pricing is exclusive. */
  subtotal: z.number().int().default(0),
  /** Total document-level discount or surcharge, signed. */
  discount: z.number().int().default(0),
  /** Sum of tax across all tax codes. */
  tax: z.number().int().default(0),
  /** What the client pays: subtotal + tax when exclusive, subtotal when inclusive. */
  total: z.number().int().default(0),
  paid: z.number().int().default(0),
  balance: z.number().int().default(0),
  /** Credit available on the client, applied to this document. */
  creditApplied: z.number().int().default(0),
  currency: currencyCode,
  /** Informational AUD equivalent for a foreign-currency document. */
  audEquivalent: z.number().int().nullable().default(null),
  /** Informational total including GST, for a GST-free document. */
  gstPayable: z.number().int().default(0),
  computedAt: isoDateTime.nullable().default(null),
});
export type Totals = z.infer<typeof totalsSchema>;

export const documentSchema = z.object({
  ...baseEntity,

  type: z.enum(DOCUMENT_TYPES).default('invoice'),
  profileId: uuid,
  clientId: uuid.nullable().default(null),

  /**
   * Draft placeholder shown in the editor; the real number is reserved inside a
   * transaction at finalise, and never reused afterwards.
   */
  number: z.string().default(''),
  draftNumber: z.string().default(''),
  numberAssignedAt: isoDateTime.nullable().default(null),

  status: z.enum(DOCUMENT_STATUSES).default('draft'),

  issueDate: isoDate,
  dueDate: isoDate.nullable().default(null),
  termsId: z.string().default('net_30'),
  /** Printed payment terms, free text. */
  termsText: z.string().default(''),

  currency: currencyCode,
  /** Whether listed prices contain tax. */
  taxMode: z.enum(['exclusive', 'inclusive']).default('exclusive'),
  /** Default tax code for new lines. Individual lines may override. */
  taxCodeId: z.string().nullable().default(null),

  poNumber: z.string().default(''),
  reference: z.string().default(''),
  /** Customer / their own reference shown near the number. */
  customerReference: z.string().default(''),

  notes: z.string().default(''),
  /** Print the "No GST has been charged" note. */
  showNoGstNote: z.boolean().default(false),

  designTemplateId: uuid.nullable().default(null),
  labelLanguage: z.string().default('en'),
  emailTemplateId: uuid.nullable().default(null),

  /** Recipients chosen at send time; empty means fall back to client defaults. */
  to: z.array(z.string()).default([]),
  cc: z.array(z.string()).default([]),
  bcc: z.array(z.string()).default([]),

  totals: totalsSchema.default({ currency: 'AUD' }),

  /** Credit notes and quotes link back to the invoice they relate to. */
  linkedDocumentIds: z.array(uuid).default([]),
  sourceQuoteId: uuid.nullable().default(null),
  /** Set on a quote that became an invoice. */
  convertedToDocumentId: uuid.nullable().default(null),
  /** Progress invoicing: how much of an accepted quote has been billed. */
  progressPercent: decimal.default('0'),

  deposit: depositSchema.default({}),
  /** Credit balance taken from the client when this document was created. */
  clientCreditApplied: z.number().int().default(0),
  /**
   * Rules that have already fired on this document. A rule that has fired is
   * never evaluated again, so a user's override of what it set is not undone
   * by the next save — or by the scheduler's 15-minute pass over open drafts.
   */
  appliedRuleIds: z.array(z.string()).default([]),

  finalisedAt: isoDateTime.nullable().default(null),
  voidedAt: isoDateTime.nullable().default(null),
  voidReason: z.string().default(''),
  sentAt: isoDateTime.nullable().default(null),
  /** Queue an email for a future date; the scheduler picks it up. */
  sendAt: isoDateTime.nullable().default(null),
  lastPdfPath: z.string().nullable().default(null),
  lastPdfHash: z.string().nullable().default(null),
  revision: z.number().int().default(0),

  taxSnapshot: taxSnapshotSchema.nullable().default(null),

  /** Set on a recurring run so the run can be explained and undone. */
  fromScheduleId: uuid.nullable().default(null),
  /** Recurring runs always come back as drafts flagged for review. */
  reviewRequired: z.boolean().default(false),
  /** Guards idempotency: a schedule run uses `yyyy-mm-dd` of its run date. */
  scheduleRunKey: z.string().nullable().default(null),

  /** Reminder steps already queued for this document, by step id. */
  remindersQueued: z.array(z.string()).default([]),
  lateFeeApplied: z.boolean().default(false),

  signatureId: uuid.nullable().default(null),
  quoteValidUntil: isoDate.nullable().default(null),
  acceptedAt: isoDateTime.nullable().default(null),
  acceptedBy: z.string().default(''),
  /** Data URL of the drawn signature, when the client signed rather than typed. */
  acceptedSignatureImage: z.string().nullable().default(null),
  declineReason: z.string().default(''),

  tags: z.array(z.string()).default([]),
  customFields: z.record(z.string(), z.string()).default({}),
  notesInternal: z.string().default(''),
  showAudEquivalent: z.boolean().default(false),
  exchangeRateToAud: z.string().nullable().default(null),
});
export type Document = z.infer<typeof documentSchema>;

/* ------------------------------------------------------------------ */
/* Credit balances                                                     */
/* ------------------------------------------------------------------ */

/**
 * Money owed *to* the client: an overpayment, a tip returned as credit, or an
 * issued-but-unapplied credit note. Applied to the next invoice.
 */
export const clientCreditSchema = z.object({
  ...baseEntity,
  clientId: uuid,
  /** Positive amount of credit held. */
  amount: z.number().int(),
  currency: currencyCode,
  source: z.enum(['payment', 'credit_note', 'manual', 'opening']),
  /** Document that created the credit. */
  sourceDocumentId: uuid.nullable().default(null),
  /** Document the credit was consumed by. */
  appliedToDocumentId: uuid.nullable().default(null),
  appliedAmount: z.number().int().default(0),
  date: isoDate,
  note: z.string().default(''),
});
export type ClientCredit = z.infer<typeof clientCreditSchema>;

/* ------------------------------------------------------------------ */
/* Quote / invoice convenience shapes                                  */
/* ------------------------------------------------------------------ */

export interface DocumentWithLines extends Document {
  lines: DocumentLine[];
}

export function isQuote(doc: Pick<Document, 'type'>): boolean {
  return doc.type === 'quote';
}

export function isInvoice(doc: Pick<Document, 'type'>): boolean {
  return doc.type === 'invoice' || doc.type === 'proforma';
}

export function isCreditNote(doc: Pick<Document, 'type'>): boolean {
  return doc.type === 'credit_note';
}

/** Documents that can be finalised and sent to a client. */
export function isSendable(doc: Pick<Document, 'type'>): boolean {
  return doc.type !== 'delivery_note';
}

/** Terminal states: nothing further happens without a new document. */
export function isTerminalStatus(status: DocumentStatus): boolean {
  return status === 'void' || status === 'paid';
}
