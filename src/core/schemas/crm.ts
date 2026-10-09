/**
 * Business profiles, clients, contacts, items, exchange rates.
 *
 * These are the records a business creates and maintains; documents reference
 * them but own copies of anything that must never change after issue.
 */

import { z } from 'zod';
import {
  addressSchema,
  baseEntity,
  currencyCode,
  decimal,
  emailAddress,
  EMPTY_ADDRESS,
  EMPTY_PAYMENT_DETAILS,
  isoDate,
  isoDateTime,
  logoSchema,
  newEntity,
  paymentDetailsSchema,
  stampedSignatureSchema,
  uuid,
} from './common';

/* ------------------------------------------------------------------ */
/* Business profile                                                    */
/* ------------------------------------------------------------------ */

/**
 * A blank business profile for a form to fill in.
 *
 * Deliberately not `businessProfileSchema.parse`: a name is required, and a form
 * has to be able to hold an empty one. Validation belongs on the save path, where
 * the storage adapter parses anyway. Every nested object the schema would have
 * defaulted is spelled out here, because a form reads `draft.address.line1`
 * directly and an absent object is a crash rather than an empty field.
 */
export function newBusinessProfile(fields: Partial<BusinessProfile> = {}): BusinessProfile {
  return {
    ...newEntity({
      name: '',
      legalName: '',
      abn: '',
      gstRegistered: false,
      gstRegisteredFrom: null,
      gstHistory: [],
      taxId: '',
      address: { ...EMPTY_ADDRESS },
      email: '',
      phone: '',
      website: '',
      contactName: '',
      logo: null,
      letterheadHeader: null,
      letterheadFooter: null,
      signature: null,
      brandPrimary: '#1F5E5B',
      brandAccent: '#1F5E5B',
      suggestedColours: [],
      defaultCurrency: 'AUD' as const,
      defaultTerms: 'net_30',
      defaultTaxCodeId: 'tax_zero',
      defaultDesignTemplateId: null,
      defaultLabels: null,
      paymentDetails: { ...EMPTY_PAYMENT_DETAILS },
      paymentTermsText: '',
      sendingEmailAccountId: null,
      outputSubFolder: '',
      code: '',
      archived: false,
      onboarded: false,
    }),
    ...fields,
  } as BusinessProfile;
}

export const businessProfileSchema = z.object({
  ...baseEntity,

  /** Short name shown in the switcher. */
  name: z.string().min(1, 'A business needs a name'),
  /** Legal entity name, printed on tax invoices when it differs from `name`. */
  legalName: z.string().default(''),

  /** Australian Business Number, stored formatted as "12 345 678 901". */
  abn: z.string().default(''),
  /** GST status with its own effective date, so history stays honest. */
  gstRegistered: z.boolean().default(false),
  gstRegisteredFrom: isoDate.nullable().default(null),
  /**
   * Every change to GST registration, oldest first.
   *
   * A single boolean cannot answer "was this business registered on the day this
   * invoice was issued?" once the switch has moved, which is exactly what a
   * document dated either side of the change needs to know. The final entry always
   * agrees with `gstRegistered`; entries are appended when the switch is moved.
   */
  gstHistory: z
    .array(z.object({ registered: z.boolean(), from: isoDate, note: z.string().default('') }))
    .default([]),
  /** Non-Australian tax identifiers, for export clients. */
  taxId: z.string().default(''),

  address: addressSchema.default({}),
  email: z.string().default(''),
  phone: z.string().default(''),
  website: z.string().default(''),
  contactName: z.string().default(''),

  logo: logoSchema.nullable().default(null),
  /** Full-width images for a scanned paper letterhead. */
  letterheadHeader: z.string().nullable().default(null),
  letterheadFooter: z.string().nullable().default(null),
  signature: stampedSignatureSchema.nullable().default(null),

  /** Interface stays teal; these are the document brand colours. */
  brandPrimary: z.string().default('#1F5E5B'),
  brandAccent: z.string().default('#1F5E5B'),
  /** Dominant colours suggested from the logo, offered in the setup wizard. */
  suggestedColours: z.array(z.string()).default([]),

  defaultCurrency: currencyCode,
  defaultTerms: z.string().default('Net 30'),
  defaultTaxCodeId: z.string().default('tax_gst'),
  defaultDesignTemplateId: uuid.nullable().default(null),
  defaultLabels: z.string().nullable().default(null),

  paymentDetails: paymentDetailsSchema.default({}),
  paymentTermsText: z.string().default(''),

  /** Email account id (settings.email_accounts) used to send this business's mail. */
  sendingEmailAccountId: uuid.nullable().default(null),
  /** Folder under the chosen output root. */
  outputSubFolder: z.string().default(''),

  /** Three-letter code used by the {PROFILE} number token. */
  code: z.string().default(''),
  archived: z.boolean().default(false),
  /** Marks the profile the setup wizard just created. */
  onboarded: z.boolean().default(false),
});
export type BusinessProfile = z.infer<typeof businessProfileSchema>;

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

export const paymentTermsSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Days after the issue date. Ignored for the two relative terms below. */
  days: z.number().int().nullable(),
  kind: z.enum(['due_on_receipt', 'net_days', 'end_of_next_month', 'custom_date']),
});
export type PaymentTerms = z.infer<typeof paymentTermsSchema>;

export const DEFAULT_TERMS: readonly PaymentTerms[] = [
  { id: 'due_on_receipt', name: 'Due on receipt', days: 0, kind: 'due_on_receipt' },
  { id: 'net_7', name: 'Net 7', days: 7, kind: 'net_days' },
  { id: 'net_14', name: 'Net 14', days: 14, kind: 'net_days' },
  { id: 'net_30', name: 'Net 30', days: 30, kind: 'net_days' },
  { id: 'net_60', name: 'Net 60', days: 60, kind: 'net_days' },
  { id: 'end_next_month', name: 'End of next month', days: null, kind: 'end_of_next_month' },
];

export function findTerm(id: string): PaymentTerms | undefined {
  return DEFAULT_TERMS.find((t) => t.id === id);
}

export const clientSchema = z.object({
  ...baseEntity,

  displayName: z.string().min(1, 'A client needs a name'),
  legalName: z.string().default(''),
  /** ABN or another tax identifier. Validated offline by checksum where possible. */
  taxId: z.string().default(''),
  taxIdCountry: z.string().default('AU'),

  billingAddress: addressSchema.default({}),
  shippingAddress: addressSchema.nullable().default(null),

  email: z.string().default(''),
  phone: z.string().default(''),
  notes: z.string().default(''),
  tags: z.array(z.string()).default([]),

  /* ---- defaults that auto-apply to new documents ---- */
  defaultCurrency: currencyCode,
  defaultTermsId: z.string().default('net_30'),
  /** Tax treatment: a tax code id, or null to inherit the document default. */
  defaultTaxCodeId: z.string().nullable().default(null),
  defaultDiscountPercent: decimal,
  /** Language for printed labels, e.g. "en" or "de". */
  labelLanguage: z.string().default('en'),
  defaultDesignTemplateId: uuid.nullable().default(null),
  defaultEmailTemplateId: uuid.nullable().default(null),
  /** When true, the editor refuses to finalise without a PO number. */
  requirePoNumber: z.boolean().default(false),
  /** Preferred contact for invoice emails. */
  invoiceContactId: uuid.nullable().default(null),
  /** Whether invoices go out by email at all. */
  emailInvoices: z.boolean().default(true),

  /** Opening credit balance, e.g. an advance payment received before any invoice. */
  openingCredit: z.number().int().default(0),
  openingCreditCurrency: currencyCode,

  customFields: z.record(z.string(), z.string()).default({}),
  archived: z.boolean().default(false),
});
export type Client = z.infer<typeof clientSchema>;

/**
 * A blank client for a form to fill in.
 *
 * Like `newBusinessProfile`, this is not schema-parsed: the form must be able to
 * hold an empty name, and the nested address object is spelled out because the form
 * reads it directly.
 */
export function newClient(fields: Partial<Client> = {}): Client {
  return {
    ...newEntity({
      displayName: '',
      legalName: '',
      taxId: '',
      taxIdCountry: 'AU',
      billingAddress: { ...EMPTY_ADDRESS },
      shippingAddress: null,
      email: '',
      phone: '',
      notes: '',
      tags: [],
      defaultCurrency: 'AUD' as const,
      defaultTermsId: 'net_30',
      defaultTaxCodeId: null,
      defaultDiscountPercent: '0',
      labelLanguage: 'en',
      defaultDesignTemplateId: null,
      defaultEmailTemplateId: null,
      requirePoNumber: false,
      invoiceContactId: null,
      emailInvoices: true,
      openingCredit: 0,
      openingCreditCurrency: 'AUD' as const,
      customFields: {},
      archived: false,
    }),
    ...fields,
  } as Client;
}

export const contactSchema = z.object({
  ...baseEntity,
  clientId: uuid,
  name: z.string().min(1),
  role: z.string().default(''),
  email: z.string().default(''),
  phone: z.string().default(''),
  /** Include this contact on invoice emails. */
  receivesInvoices: z.boolean().default(true),
  /** Which side of the To/CC split they belong on. */
  field: z.enum(['to', 'cc', 'bcc']).default('to'),
  isPrimary: z.boolean().default(false),
});
export type Contact = z.infer<typeof contactSchema>;

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

export const UNITS: readonly string[] = [
  'each',
  'hour',
  'day',
  'week',
  'month',
  'km',
  'kg',
  'm²',
  'm³',
  'item',
  'fixed',
];

export const itemSchema = z.object({
  ...baseEntity,
  code: z.string().default(''),
  name: z.string().min(1, 'An item needs a name'),
  description: z.string().default(''),
  unit: z.string().default('each'),
  /** Price per currency code, in minor units. e.g. { AUD: 12000 } = $120.00 */
  prices: z.record(z.string(), z.number().int()).default({}),
  taxCodeId: z.string().nullable().default(null),
  category: z.string().default(''),
  /** Cost in AUD minor units, for margin tracking. */
  cost: z.number().int().default(0),
  active: z.boolean().default(true),
  customFields: z.record(z.string(), z.string()).default({}),
});
export type Item = z.infer<typeof itemSchema>;

/* ------------------------------------------------------------------ */
/* Currency rates                                                      */
/* ------------------------------------------------------------------ */

/**
 * Exchange rates are maintained locally — entered by hand or pasted from a CSV.
 * There is no rate API, because Duly makes no network calls.
 */
export const currencyRateSchema = z.object({
  ...baseEntity,
  from: currencyCode,
  /** Every rate is quoted against AUD, the home currency. */
  to: currencyCode.default('AUD'),
  rate: decimal,
  effectiveDate: isoDate,
  source: z.enum(['manual', 'import']).default('manual'),
  note: z.string().default(''),
});
export type CurrencyRate = z.infer<typeof currencyRateSchema>;

/* ------------------------------------------------------------------ */
/* Custom fields                                                       */
/* ------------------------------------------------------------------ */

export const customFieldSchema = z.object({
  ...baseEntity,
  /** Which entity the field is attached to. */
  entity: z.enum(['client', 'item', 'document']),
  name: z.string().min(1),
  key: z.string().min(1),
  type: z.enum(['text', 'number', 'date', 'select', 'multiselect', 'checkbox']),
  options: z.array(z.string()).default([]),
  /** Print the field on documents, and where. */
  showOnPdf: z.boolean().default(false),
  pdfLabel: z.string().default(''),
  displayOrder: z.number().int().default(0),
  required: z.boolean().default(false),
});
export type CustomField = z.infer<typeof customFieldSchema>;

/* ------------------------------------------------------------------ */
/* Attachments                                                         */
/* ------------------------------------------------------------------ */

export const attachmentSchema = z.object({
  ...baseEntity,
  /** Document, client or expense this belongs to. */
  ownerType: z.enum(['document', 'client', 'expense']),
  ownerId: uuid,
  fileName: z.string(),
  mimeType: z.string().default('application/octet-stream'),
  sizeBytes: z.number().int().default(0),
  /** Data URL for web storage, native path on desktop. */
  storedPath: z.string(),
  /** Appended as extra pages at the end of the PDF. */
  appendToPdf: z.boolean().default(false),
  /** Used as evidence on an expense line rather than shown to the client. */
  internal: z.boolean().default(false),
  caption: z.string().default(''),
});
export type Attachment = z.infer<typeof attachmentSchema>;

/* ------------------------------------------------------------------ */
/* Audit log                                                           */
/* ------------------------------------------------------------------ */

export const auditLogSchema = z.object({
  ...baseEntity,
  entity: z.string(),
  entityId: z.string().default(''),
  action: z.string(),
  summary: z.string().default(''),
  /** "user" for something you did, "automation" for something Duly did on its own. */
  actor: z.enum(['user', 'automation', 'system']).default('user'),
  actorLabel: z.string().default(''),
  /** Short human summaries of the before and after states, not a field diff. */
  before: z.string().nullable().default(null),
  after: z.string().nullable().default(null),
});
export type AuditLogEntry = z.infer<typeof auditLogSchema>;

/**
 * What a caller may hand to `saveAuditLog`.
 *
 * The input type, so the fields Zod defaults are optional here. A caller writing
 * "the user created a client" supplies only what it knows; the rest is filled in
 * at the storage boundary, which is the one place defaults belong.
 */
export type AuditLogInput = z.input<typeof auditLogSchema>;

/** Optional short signature captured on a quote acceptance. */
export const signatureSchema = z.object({
  ...baseEntity,
  documentId: uuid,
  signerName: z.string().default(''),
  signerTitle: z.string().default(''),
  /** Data URL of the drawn signature, or null for a typed acceptance. */
  image: z.string().nullable().default(null),
  typedName: z.string().default(''),
  method: z.enum(['drawn', 'typed', 'attached']).default('typed'),
  signedAt: isoDateTime,
  ipOrDevice: z.string().default(''),
});
export type Signature = z.infer<typeof signatureSchema>;

export const EMAIL_ADDRESS_FIELD = emailAddress;
