/**
 * Templates.
 *
 * Three separate concepts, deliberately kept apart:
 *
 * - **Design template** — how the document looks. Consumed by the PDF renderer.
 * - **Content preset** — a saved document skeleton, for speed of entry.
 * - **Email template** — subject and body with merge fields.
 */

import { z } from 'zod';
import { baseEntity, isoDateTime, uuid } from './common';
import { DOCUMENT_TYPES, documentLineSchema } from './document';

export const LAYOUT_KEYS = ['studio', 'classic', 'modern', 'minimal', 'letterhead', 'compact'] as const;
export type LayoutKey = (typeof LAYOUT_KEYS)[number];

export const FONT_STACKS = [
  'inter',
  'source-serif',
  'ibm-plex-sans',
  'ibm-plex-mono',
  'fraunces',
  'lora',
] as const;
export type FontStackKey = (typeof FONT_STACKS)[number];

export interface FontStackInfo {
  key: FontStackKey;
  name: string;
  /** File names shipped with the app so PDFs render identically offline. */
  files: { regular: string; bold: string; italic: string };
  category: 'serif' | 'sans' | 'mono' | 'display';
}

export const FONT_STACK_LIST: readonly FontStackInfo[] = [
  {
    key: 'inter',
    name: 'Inter',
    files: { regular: 'Inter-Regular', bold: 'Inter-Bold', italic: 'Inter-Italic' },
    category: 'sans',
  },
  {
    key: 'source-serif',
    name: 'Source Serif 4',
    files: { regular: 'SourceSerif4-Regular', bold: 'SourceSerif4-Bold', italic: 'SourceSerif4-Italic' },
    category: 'serif',
  },
  {
    key: 'fraunces',
    name: 'Fraunces',
    files: { regular: 'Fraunces-Regular', bold: 'Fraunces-Bold', italic: 'Fraunces-Italic' },
    category: 'display',
  },
  {
    key: 'ibm-plex-sans',
    name: 'IBM Plex Sans',
    files: { regular: 'IBMPlexSans-Regular', bold: 'IBMPlexSans-Bold', italic: 'IBMPlexSans-Italic' },
    category: 'sans',
  },
  {
    key: 'ibm-plex-mono',
    name: 'IBM Plex Mono',
    files: { regular: 'IBMPlexMono-Regular', bold: 'IBMPlexMono-Bold', italic: 'IBMPlexMono-Italic' },
    category: 'mono',
  },
  {
    key: 'lora',
    name: 'Lora',
    files: { regular: 'Lora-Regular', bold: 'Lora-Bold', italic: 'Lora-Italic' },
    category: 'serif',
  },
];

/** Columns a design template can show or hide on the line item table. */
export const COLUMN_KEYS = [
  'position',
  'description',
  'details',
  'quantity',
  'unit',
  'unitPrice',
  'discount',
  'taxCode',
  'taxAmount',
  'amount',
] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];

export const DEFAULT_COLUMNS: readonly ColumnKey[] = [
  'position',
  'description',
  'quantity',
  'unitPrice',
  'taxCode',
  'amount',
];

/** Every printed label is renameable, which is how a language set works. */
export const labelSetSchema = z.object({
  invoice: z.string().default('Tax Invoice'),
  quote: z.string().default('Quote'),
  creditNote: z.string().default('Credit Note'),
  proforma: z.string().default('Pro-forma Invoice'),
  deliveryNote: z.string().default('Delivery Note'),
  receipt: z.string().default('Payment Receipt'),
  number: z.string().default('Invoice No.'),
  date: z.string().default('Issue date'),
  dueDate: z.string().default('Due date'),
  terms: z.string().default('Payment terms'),
  poNumber: z.string().default('PO number'),
  reference: z.string().default('Reference'),
  billTo: z.string().default('Bill to'),
  shipTo: z.string().default('Ship to'),
  from: z.string().default('From'),
  quantity: z.string().default('Qty'),
  unit: z.string().default('Unit'),
  unitPrice: z.string().default('Unit price'),
  discount: z.string().default('Discount'),
  taxCode: z.string().default('Tax'),
  amount: z.string().default('Amount'),
  subtotal: z.string().default('Subtotal'),
  discountTotal: z.string().default('Discount'),
  taxTotal: z.string().default('GST'),
  total: z.string().default('Total'),
  totalIncludingGst: z.string().default('Total inc. GST'),
  amountPaid: z.string().default('Amount paid'),
  balanceDue: z.string().default('Balance due'),
  depositDue: z.string().default('Deposit due'),
  depositReceived: z.string().default('Deposit received'),
  creditApplied: z.string().default('Credit applied'),
  gstBreakdown: z.string().default('GST breakdown'),
  paymentDetails: z.string().default('Payment details'),
  notes: z.string().default('Notes'),
  termsAndConditions: z.string().default('Terms and conditions'),
  thankYou: z.string().default('Thank you for your business'),
  page: z.string().default('Page'),
  of: z.string().default('of'),
  acceptedBy: z.string().default('Accepted by'),
  acceptedOn: z.string().default('Accepted on'),
  quoteValidUntil: z.string().default('Valid until'),
  issuedTo: z.string().default('Issued to'),
  signedBy: z.string().default('Signed by'),
});
export type LabelSet = z.infer<typeof labelSetSchema>;

export const EN_LABELS: LabelSet = labelSetSchema.parse({});

export const stampConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** Which states get a stamp at all. */
  showFor: z.array(z.enum(['draft', 'overdue', 'paid', 'void'])).default(['draft', 'overdue', 'void']),
  /** Optional custom watermark text. Empty uses the state name. */
  text: z.string().default(''),
  /** Optional watermark image, e.g. a "PAID" rubber stamp graphic. */
  image: z.string().nullable().default(null),
  position: z.enum(['centre', 'header-right', 'footer-right']).default('centre'),
  colour: z.string().default('#9A3B36'),
});
export type StampConfig = z.infer<typeof stampConfigSchema>;

export const designTemplateSchema = z.object({
  ...baseEntity,
  name: z.string().min(1),
  layout: z.enum(LAYOUT_KEYS).default('studio'),
  /** Built-ins cannot be deleted, but can be duplicated and edited. */
  builtin: z.boolean().default(false),

  colours: z
    .object({
      primary: z.string().default('#0D9488'),
      accent: z.string().default('#0D9488'),
      text: z.string().default('#1C1B19'),
      muted: z.string().default('#6E6A63'),
      rule: z.string().default('#E7E3DA'),
      /** Table header fill. Empty means no fill. */
      tableHeadFill: z.string().default('#F3F0EA'),
      tableHeadText: z.string().default('#1C1B19'),
      bandFill: z.string().default('#FAF8F4'),
      totalHighlight: z.boolean().default(true),
    })
    .default({}),

  fonts: z
    .object({
      heading: z.enum(FONT_STACKS).default('source-serif'),
      body: z.enum(FONT_STACKS).default('inter'),
      /** Used for the business signature when typed. */
      signature: z.enum(FONT_STACKS).default('fraunces'),
      baseSize: z.number().default(9.5),
      headingScale: z.number().default(1),
    })
    .default({}),

  columns: z.array(z.enum(COLUMN_KEYS)).default([...DEFAULT_COLUMNS]),

  labels: labelSetSchema.default({}),

  header: z
    .object({
      /** `designed` builds a header from the logo and details; `letterhead` uses the image. */
      mode: z.enum(['designed', 'letterhead', 'none']).default('designed'),
      logoPosition: z.enum(['left', 'centre', 'right']).default('left'),
      logoMaxHeightMm: z.number().default(18),
      showBusinessDetails: z.boolean().default(true),
      showClientBlock: z.boolean().default(true),
      /** Full-width accent band across the top of the page. */
      accentBand: z.boolean().default(false),
      accentBandHeightMm: z.number().default(6),
      /** Where the document heading sits. */
      headingAlign: z.enum(['left', 'right']).default('left'),
    })
    .default({}),

  footer: z
    .object({
      mode: z.enum(['standard', 'letterhead', 'none']).default('standard'),
      showPageNumbers: z.boolean().default(true),
      showThankYou: z.boolean().default(true),
      thankYouText: z.string().default('Thank you for your business'),
      showPaymentDetails: z.boolean().default(true),
      showTerms: z.boolean().default(true),
      legalText: z.string().default(''),
    })
    .default({}),

  stamp: stampConfigSchema.default({}),

  /** Optional extra blocks on the page. */
  extras: z
    .object({
      paymentQr: z.boolean().default(false),
      photoGrid: z.boolean().default(false),
      customFields: z.boolean().default(false),
      /** Draw the tax-code marker (*) and print the key beneath the table. */
      taxMarkerKey: z.boolean().default(true),
    })
    .default({}),

  /** Page geometry. A4 is the default; Legal is handy for long line tables. */
  page: z
    .object({
      size: z.enum(['A4', 'Letter', 'Legal']).default('A4'),
      orientation: z.enum(['portrait', 'landscape']).default('portrait'),
      marginMm: z.number().default(15),
    })
    .default({}),
});
export type DesignTemplate = z.infer<typeof designTemplateSchema>;

/** A content preset: a saved document skeleton, not a design. */
export const contentPresetSchema = z.object({
  ...baseEntity,
  name: z.string().min(1),
  description: z.string().default(''),
  documentType: z.enum(DOCUMENT_TYPES).default('invoice'),
  /** Pre-filled client, or null to ask each time. */
  clientId: uuid.nullable().default(null),
  designTemplateId: uuid.nullable().default(null),
  emailTemplateId: uuid.nullable().default(null),
  termsId: z.string().default('net_30'),
  currency: z.string().default('AUD'),
  taxMode: z.enum(['exclusive', 'inclusive']).default('exclusive'),
  notes: z.string().default(''),
  termsText: z.string().default(''),
  tags: z.array(z.string()).default([]),
  lines: z.array(documentLineSchema).default([]),
  builtin: z.boolean().default(false),
});
export type ContentPreset = z.infer<typeof contentPresetSchema>;

/* ------------------------------------------------------------------ */
/* Email templates                                                     */
/* ------------------------------------------------------------------ */

export const EMAIL_PURPOSES = [
  'send',
  'reminder_before',
  'reminder_due',
  'reminder_after',
  'statement',
  'receipt',
  'quote',
  'late_fee',
] as const;
export type EmailPurpose = (typeof EMAIL_PURPOSES)[number];

export const emailTemplateSchema = z.object({
  ...baseEntity,
  name: z.string().min(1),
  purpose: z.enum(EMAIL_PURPOSES).default('send'),
  subject: z.string().default(''),
  body: z.string().default(''),
  fromName: z.string().default(''),
  replyTo: z.string().default(''),
  /** Attach the generated PDF. */
  attachPdf: z.boolean().default(true),
  /** Also attach timesheets, receipts or contracts. */
  attachDocuments: z.boolean().default(false),
  builtin: z.boolean().default(false),
});
export type EmailTemplate = z.infer<typeof emailTemplateSchema>;

/** Sent-message log, kept per document so the invoice shows its history. */
export const emailLogSchema = z.object({
  ...baseEntity,
  documentId: uuid.nullable().default(null),
  profileId: uuid.nullable().default(null),
  accountId: uuid.nullable().default(null),
  to: z.array(z.string()).default([]),
  cc: z.array(z.string()).default([]),
  bcc: z.array(z.string()).default([]),
  subject: z.string().default(''),
  body: z.string().default(''),
  templateId: uuid.nullable().default(null),
  sentAt: isoDateTime.nullable().default(null),
  status: z.enum(['queued', 'sent', 'failed', 'opened_in_app', 'cancelled']).default('queued'),
  error: z.string().nullable().default(null),
  attachmentNames: z.array(z.string()).default([]),
  /** Which adapter handled it — "mailto" on the web, "smtp" on desktop. */
  via: z.string().default(''),
  notes: z.string().default(''),
});
export type EmailLog = z.infer<typeof emailLogSchema>;

/** Outbox entry that failed (or is waiting for Proton Mail Bridge to run). */
export const outboxSchema = z.object({
  ...baseEntity,
  documentId: uuid.nullable().default(null),
  accountId: uuid.nullable().default(null),
  to: z.array(z.string()).default([]),
  cc: z.array(z.string()).default([]),
  bcc: z.array(z.string()).default([]),
  subject: z.string().default(''),
  body: z.string().default(''),
  attachmentNames: z.array(z.string()).default([]),
  /** Where the rendered PDF was written, so Retry can attach it again. */
  pdfPath: z.string().nullable().default(null),
  pdfDataUrl: z.string().nullable().default(null),
  queuedAt: isoDateTime,
  attempts: z.number().int().default(0),
  lastError: z.string().nullable().default(null),
  status: z.enum(['waiting', 'ready', 'sent', 'failed']).default('waiting'),
});
export type OutboxEntry = z.infer<typeof outboxSchema>;
