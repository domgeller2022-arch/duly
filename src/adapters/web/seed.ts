/**
 * Seed data for a new install.
 *
 * Everything here has a stable, readable id. That matters more than it looks:
 * every business profile, document and template references these by id, so the
 * ids are part of the app's contract with a user's data. Changing one would
 * orphan every record that points at it.
 *
 * Ids are namespaced by kind — `tpl_studio`, `emt_send`, `tax_gst` — so a row is
 * self-describing in a backup file you are reading by hand.
 */

import { newEntity } from '@/core/schemas/common';
import { contentPresetSchema, designTemplateSchema, emailTemplateSchema } from '@/core/schemas/template';
import type { DesignTemplate, EmailTemplate, LabelSet } from '@/core/schemas/template';
import { EN_LABELS } from '@/core/schemas/template';
import { reminderPolicySchema, lateFeePolicySchema } from '@/core/schemas/automation';
import { savedViewSchema } from '@/core/schemas/settings';
import type { ContentPreset } from '@/core/schemas/template';
import { builtinRules } from '@/core/engines/rules';
import type { CurrencyRate } from '@/core/schemas/crm';

/* ------------------------------------------------------------------ */
/* Design templates                                                    */
/* ------------------------------------------------------------------ */

/**
 * The three templates that ship in v1, in priority order.
 *
 * 1. Studio   — large logo, two-column header, generous spacing. The default,
 *               because it suits consulting and creative work, which is who Duly
 *               is for.
 * 2. Classic  — serif headings, ruled table, logo top-left.
 * 3. Modern   — accent band, bold total block.
 *
 * Minimal, Letterhead and Compact come later; their config is already valid, so
 * adding them is a data change rather than a code change.
 */
export const BUILTIN_TEMPLATE_SEEDS: Omit<DesignTemplate, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'tpl_studio',
    deletedAt: null,
    name: 'Studio',
    layout: 'studio',
    builtin: true,
    colours: {
      primary: '#0D9488',
      accent: '#0D9488',
      text: '#1C1B19',
      muted: '#6E6A63',
      rule: '#E7E3DA',
      tableHeadFill: '#F3F0EA',
      tableHeadText: '#1C1B19',
      bandFill: '#FAF8F4',
      totalHighlight: true,
    },
    fonts: { heading: 'source-serif', body: 'inter', signature: 'fraunces', baseSize: 9.5, headingScale: 1 },
    columns: ['position', 'description', 'quantity', 'unitPrice', 'taxCode', 'amount'],
    labels: { ...EN_LABELS },
    header: {
      mode: 'designed',
      logoPosition: 'left',
      logoMaxHeightMm: 22,
      showBusinessDetails: true,
      showClientBlock: true,
      accentBand: false,
      accentBandHeightMm: 6,
      headingAlign: 'left',
    },
    footer: {
      mode: 'standard',
      showPageNumbers: true,
      showThankYou: true,
      thankYouText: 'Thank you for your business',
      showPaymentDetails: true,
      showTerms: true,
      legalText: '',
    },
    stamp: {
      enabled: true,
      showFor: ['draft', 'overdue', 'void'],
      text: '',
      image: null,
      position: 'centre',
      colour: '#9A3B36',
    },
    extras: { paymentQr: false, photoGrid: false, customFields: false, taxMarkerKey: true },
    page: { size: 'A4', orientation: 'portrait', marginMm: 16 },
  },
  {
    id: 'tpl_classic',
    deletedAt: null,
    name: 'Classic',
    layout: 'classic',
    builtin: true,
    colours: {
      primary: '#23395B',
      accent: '#23395B',
      text: '#1C1B19',
      muted: '#6E6A63',
      rule: '#D8D2C6',
      tableHeadFill: '#FFFFFF',
      tableHeadText: '#1C1B19',
      bandFill: '#FFFFFF',
      totalHighlight: false,
    },
    fonts: { heading: 'lora', body: 'inter', signature: 'lora', baseSize: 9.5, headingScale: 1 },
    columns: ['position', 'description', 'quantity', 'unit', 'unitPrice', 'amount'],
    labels: { ...EN_LABELS },
    header: {
      mode: 'designed',
      logoPosition: 'left',
      logoMaxHeightMm: 16,
      showBusinessDetails: true,
      showClientBlock: true,
      accentBand: false,
      accentBandHeightMm: 4,
      headingAlign: 'left',
    },
    footer: {
      mode: 'standard',
      showPageNumbers: true,
      showThankYou: false,
      thankYouText: 'Thank you for your business',
      showPaymentDetails: true,
      showTerms: true,
      legalText: '',
    },
    stamp: {
      enabled: true,
      showFor: ['draft', 'overdue', 'void'],
      text: '',
      image: null,
      position: 'header-right',
      colour: '#9A3B36',
    },
    extras: { paymentQr: false, photoGrid: false, customFields: false, taxMarkerKey: true },
    page: { size: 'A4', orientation: 'portrait', marginMm: 18 },
  },
  {
    id: 'tpl_modern',
    deletedAt: null,
    name: 'Modern',
    layout: 'modern',
    builtin: true,
    colours: {
      primary: '#0D9488',
      accent: '#0D9488',
      text: '#1C1B19',
      muted: '#6E6A63',
      rule: '#E7E3DA',
      tableHeadFill: '#1F5E5B',
      tableHeadText: '#FFFFFF',
      bandFill: '#F3F0EA',
      totalHighlight: true,
    },
    fonts: { heading: 'inter', body: 'inter', signature: 'fraunces', baseSize: 9.5, headingScale: 1 },
    columns: ['description', 'quantity', 'unitPrice', 'amount'],
    labels: { ...EN_LABELS },
    header: {
      mode: 'designed',
      logoPosition: 'left',
      logoMaxHeightMm: 14,
      showBusinessDetails: true,
      showClientBlock: true,
      accentBand: true,
      accentBandHeightMm: 8,
      headingAlign: 'right',
    },
    footer: {
      mode: 'standard',
      showPageNumbers: true,
      showThankYou: true,
      thankYouText: 'Thank you for your business',
      showPaymentDetails: true,
      showTerms: true,
      legalText: '',
    },
    stamp: {
      enabled: true,
      showFor: ['draft', 'overdue', 'void'],
      text: '',
      image: null,
      position: 'header-right',
      colour: '#9A3B36',
    },
    extras: { paymentQr: true, photoGrid: false, customFields: false, taxMarkerKey: true },
    page: { size: 'A4', orientation: 'portrait', marginMm: 14 },
  },

  /* Later templates. Valid configuration, simply not the v1 priority. */

  {
    id: 'tpl_minimal',
    deletedAt: null,
    name: 'Minimal',
    layout: 'minimal',
    builtin: true,
    colours: {
      primary: '#1C1B19',
      accent: '#1C1B19',
      text: '#1C1B19',
      muted: '#8A857C',
      rule: '#E7E3DA',
      tableHeadFill: '#FFFFFF',
      tableHeadText: '#1C1B19',
      bandFill: '#FFFFFF',
      totalHighlight: false,
    },
    fonts: { heading: 'inter', body: 'inter', signature: 'inter', baseSize: 9, headingScale: 1 },
    columns: ['description', 'quantity', 'unitPrice', 'amount'],
    labels: { ...EN_LABELS },
    header: {
      mode: 'designed',
      logoPosition: 'left',
      logoMaxHeightMm: 12,
      showBusinessDetails: false,
      showClientBlock: true,
      accentBand: false,
      accentBandHeightMm: 0,
      headingAlign: 'right',
    },
    footer: {
      mode: 'standard',
      showPageNumbers: true,
      showThankYou: false,
      thankYouText: '',
      showPaymentDetails: true,
      showTerms: false,
      legalText: '',
    },
    stamp: {
      enabled: true,
      showFor: ['draft', 'overdue', 'void'],
      text: '',
      image: null,
      position: 'footer-right',
      colour: '#9A3B36',
    },
    extras: { paymentQr: false, photoGrid: false, customFields: false, taxMarkerKey: true },
    page: { size: 'A4', orientation: 'portrait', marginMm: 22 },
  },
  {
    id: 'tpl_letterhead',
    deletedAt: null,
    name: 'Letterhead',
    layout: 'letterhead',
    builtin: true,
    colours: {
      primary: '#0D9488',
      accent: '#0D9488',
      text: '#1C1B19',
      muted: '#6E6A63',
      rule: '#E7E3DA',
      tableHeadFill: '#FAF8F4',
      tableHeadText: '#1C1B19',
      bandFill: '#FAF8F4',
      totalHighlight: false,
    },
    fonts: { heading: 'source-serif', body: 'inter', signature: 'fraunces', baseSize: 9.5, headingScale: 1 },
    columns: ['position', 'description', 'quantity', 'unitPrice', 'amount'],
    labels: { ...EN_LABELS },
    header: {
      mode: 'letterhead',
      logoPosition: 'left',
      logoMaxHeightMm: 10,
      showBusinessDetails: true,
      showClientBlock: true,
      accentBand: false,
      accentBandHeightMm: 0,
      headingAlign: 'left',
    },
    footer: {
      mode: 'letterhead',
      showPageNumbers: true,
      showThankYou: false,
      thankYouText: '',
      showPaymentDetails: true,
      showTerms: false,
      legalText: '',
    },
    stamp: {
      enabled: true,
      showFor: ['draft', 'overdue', 'void'],
      text: '',
      image: null,
      position: 'footer-right',
      colour: '#9A3B36',
    },
    extras: { paymentQr: false, photoGrid: false, customFields: false, taxMarkerKey: true },
    page: { size: 'A4', orientation: 'portrait', marginMm: 12 },
  },
  {
    id: 'tpl_compact',
    deletedAt: null,
    name: 'Compact',
    layout: 'compact',
    builtin: true,
    colours: {
      primary: '#0D9488',
      accent: '#0D9488',
      text: '#1C1B19',
      muted: '#6E6A63',
      rule: '#E7E3DA',
      tableHeadFill: '#F3F0EA',
      tableHeadText: '#1C1B19',
      bandFill: '#FAF8F4',
      totalHighlight: true,
    },
    fonts: { heading: 'inter', body: 'inter', signature: 'inter', baseSize: 7.5, headingScale: 1 },
    columns: ['position', 'description', 'quantity', 'unit', 'unitPrice', 'taxCode', 'amount'],
    labels: { ...EN_LABELS },
    header: {
      mode: 'designed',
      logoPosition: 'left',
      logoMaxHeightMm: 12,
      showBusinessDetails: true,
      showClientBlock: true,
      accentBand: false,
      accentBandHeightMm: 3,
      headingAlign: 'left',
    },
    footer: {
      mode: 'standard',
      showPageNumbers: true,
      showThankYou: true,
      thankYouText: 'Thank you for your business',
      showPaymentDetails: true,
      showTerms: true,
      legalText: '',
    },
    stamp: {
      enabled: true,
      showFor: ['draft', 'overdue', 'void'],
      text: '',
      image: null,
      position: 'header-right',
      colour: '#9A3B36',
    },
    extras: { paymentQr: false, photoGrid: false, customFields: false, taxMarkerKey: true },
    page: { size: 'A4', orientation: 'portrait', marginMm: 12 },
  },
];

export function builtinDesignTemplates(now: string): DesignTemplate[] {
  return BUILTIN_TEMPLATE_SEEDS.map((seed) =>
    designTemplateSchema.parse({ ...seed, createdAt: now, updatedAt: now }),
  );
}

/* ------------------------------------------------------------------ */
/* Label sets                                                          */
/* ------------------------------------------------------------------ */

/**
 * Label sets per language.
 *
 * Renaming any printed label is how a language set works, which is why the label
 * set is a first-class record rather than a dictionary buried in the renderer.
 */
export const BUILTIN_LABEL_SETS: { id: string; name: string; language: string; labels: Partial<LabelSet> }[] =
  [
    { id: 'labels_en', name: 'English (Australia)', language: 'en', labels: {} },
    { id: 'labels_en_gb', name: 'English (United Kingdom)', language: 'en-GB', labels: { taxTotal: 'VAT' } },
    {
      id: 'labels_en_us',
      name: 'English (United States)',
      language: 'en-US',
      labels: { date: 'Issue date', dueDate: 'Due date', taxTotal: 'Sales tax', number: 'Invoice No.' },
    },
    {
      id: 'labels_nz',
      name: 'English (New Zealand)',
      language: 'en-NZ',
      labels: { taxTotal: 'GST', gstBreakdown: 'GST breakdown' },
    },
    {
      id: 'labels_de',
      name: 'Deutsch',
      language: 'de',
      labels: {
        invoice: 'Rechnung',
        quote: 'Angebot',
        creditNote: 'Gutschrift',
        number: 'Rechnungsnr.',
        date: 'Rechnungsdatum',
        dueDate: 'Fällig am',
        subtotal: 'Zwischensumme',
        taxTotal: 'MwSt.',
        total: 'Gesamt',
        amountPaid: 'Bezahlt',
        balanceDue: 'Offener Betrag',
        billTo: 'Rechnung an',
        notes: 'Anmerkungen',
        termsAndConditions: 'Zahlungsbedingungen',
        page: 'Seite',
        of: 'von',
        quantity: 'Menge',
        unit: 'Einheit',
        unitPrice: 'Einzelpreis',
        amount: 'Betrag',
      },
    },
    {
      id: 'labels_fr',
      name: 'Français',
      language: 'fr',
      labels: {
        invoice: 'Facture',
        quote: 'Devis',
        creditNote: 'Avoir',
        number: 'Facture n°',
        date: 'Date de facturation',
        dueDate: 'Échéance',
        subtotal: 'Sous-total',
        taxTotal: 'TVA',
        total: 'Total',
        amountPaid: 'Montant payé',
        balanceDue: 'Solde dû',
        billTo: 'Facturer à',
        notes: 'Notes',
        termsAndConditions: 'Conditions de paiement',
        page: 'Page',
        of: 'sur',
        quantity: 'Qté',
        unit: 'Unité',
        unitPrice: 'Prix unitaire',
        amount: 'Montant',
      },
    },
    {
      id: 'labels_es',
      name: 'Español',
      language: 'es',
      labels: {
        invoice: 'Factura',
        quote: 'Presupuesto',
        creditNote: 'Nota de crédito',
        number: 'Factura n.º',
        date: 'Fecha de factura',
        dueDate: 'Vencimiento',
        subtotal: 'Subtotal',
        taxTotal: 'IVA',
        total: 'Total',
        amountPaid: 'Importe pagado',
        balanceDue: 'Saldo pendiente',
        billTo: 'Facturar a',
        notes: 'Notas',
        termsAndConditions: 'Términos de pago',
        page: 'Página',
        of: 'de',
        quantity: 'Cant.',
        unit: 'Unidad',
        unitPrice: 'Precio unitario',
        amount: 'Importe',
      },
    },
    {
      id: 'labels_nl',
      name: 'Nederlands',
      language: 'nl',
      labels: {
        invoice: 'Factuur',
        quote: 'Offerte',
        creditNote: 'Creditnota',
        number: 'Factuurnr.',
        date: 'Factuurdatum',
        dueDate: 'Vervaldatum',
        subtotal: 'Subtotaal',
        taxTotal: 'Btw',
        total: 'Totaal',
        amountPaid: 'Betaald bedrag',
        balanceDue: 'Openstaand bedrag',
        billTo: 'Factuur aan',
        notes: 'Opmerkingen',
        termsAndConditions: 'Betalingsvoorwaarden',
        page: 'Pagina',
        of: 'van',
        quantity: 'Aantal',
        unit: 'Eenheid',
        unitPrice: 'Eenheidsprijs',
        amount: 'Bedrag',
      },
    },
  ];

/* ------------------------------------------------------------------ */
/* Email templates                                                     */
/* ------------------------------------------------------------------ */

export const BUILTIN_EMAIL_TEMPLATE_SEEDS: Omit<EmailTemplate, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'emt_send',
    deletedAt: null,
    name: 'Invoice',
    purpose: 'send',
    subject: '{invoice.type} {invoice.number} from {business.name}',
    body: `Hi {client.first_name},

{client.name} — here is {invoice.type.toLowerCase()} {invoice.number} for {invoice.total}.

{invoice.terms}: {invoice.due_date}
{invoice.payment_link}

{invoice.notes}

If anything looks off, reply to this message and I'll sort it out.

Thanks,
{sender.name}
{business.name}
{business.phone}`,
    fromName: '',
    replyTo: '',
    attachPdf: true,
    attachDocuments: false,
    builtin: true,
  },
  {
    id: 'emt_quote',
    deletedAt: null,
    name: 'Quote',
    purpose: 'quote',
    subject: 'Quote {invoice.number} for {client.name}',
    body: `Hi {client.first_name},

Thanks for the opportunity. Here's a quote for {invoice.total}, valid until {invoice.due_date}.

{invoice.notes}

Let me know if you'd like anything adjusted.

Thanks,
{sender.name}
{business.name}`,
    fromName: '',
    replyTo: '',
    attachPdf: true,
    attachDocuments: false,
    builtin: true,
  },
  {
    id: 'emt_reminder_before',
    deletedAt: null,
    name: 'Payment due soon',
    purpose: 'reminder_before',
    subject: '{invoice.number} is due on {invoice.due_date}',
    body: `Hi {client.first_name},

A quick note that {invoice.number} for {invoice.total} is due on {invoice.due_date}.

{invoice.payment_link}

{business.payment_details}

Thanks,
{sender.name}`,
    fromName: '',
    replyTo: '',
    attachPdf: false,
    attachDocuments: false,
    builtin: true,
  },
  {
    id: 'emt_reminder_due',
    deletedAt: null,
    name: 'Payment due today',
    purpose: 'reminder_due',
    subject: '{invoice.number} is due today',
    body: `Hi {client.first_name},

{invoice.number} for {invoice.total} is due today.

{business.payment_details}

Thanks,
{sender.name}`,
    fromName: '',
    replyTo: '',
    attachPdf: false,
    attachDocuments: false,
    builtin: true,
  },
  {
    id: 'emt_reminder_after',
    deletedAt: null,
    name: 'Payment overdue',
    purpose: 'reminder_after',
    subject: '{invoice.number} is {invoice.days_overdue} days overdue',
    body: `Hi {client.first_name},

{invoice.number} for {invoice.total} was due on {invoice.due_date} and is now {invoice.days_overdue} days past due. The balance outstanding is {invoice.balance}.

{business.payment_details}

If it's already on its way, ignore this. Otherwise could you let me know when to expect it?

Thanks,
{sender.name}`,
    fromName: '',
    replyTo: '',
    attachPdf: false,
    attachDocuments: false,
    builtin: true,
  },
  {
    id: 'emt_late_fee',
    deletedAt: null,
    name: 'Late payment fee',
    purpose: 'late_fee',
    subject: 'Late payment fee added to {invoice.number}',
    body: `Hi {client.first_name},

A late payment fee has been added to {invoice.number}. The balance now outstanding is {invoice.balance}.

{business.payment_details}

Thanks,
{sender.name}`,
    fromName: '',
    replyTo: '',
    attachPdf: true,
    attachDocuments: false,
    builtin: true,
  },
  {
    id: 'emt_statement',
    deletedAt: null,
    name: 'Account statement',
    purpose: 'statement',
    subject: 'Statement from {business.name} — {today}',
    body: `Hi {client.first_name},

Please find attached your statement from {business.name}, covering everything invoiced and paid up to {today}.

The balance outstanding is {invoice.balance}.

Thanks,
{sender.name}`,
    fromName: '',
    replyTo: '',
    attachPdf: true,
    attachDocuments: false,
    builtin: true,
  },
  {
    id: 'emt_receipt',
    deletedAt: null,
    name: 'Payment received',
    purpose: 'receipt',
    subject: 'Receipt for {invoice.number} — thank you',
    body: `Hi {client.first_name},

Thanks, we've received your payment of {invoice.amount_paid} against {invoice.number}. The receipt is attached.

{invoice.balance}

Thanks,
{sender.name}`,
    fromName: '',
    replyTo: '',
    attachPdf: true,
    attachDocuments: false,
    builtin: true,
  },
];

export function builtinEmailTemplates(now: string): EmailTemplate[] {
  return BUILTIN_EMAIL_TEMPLATE_SEEDS.map((seed) =>
    emailTemplateSchema.parse({ ...seed, createdAt: now, updatedAt: now }),
  );
}

/* ------------------------------------------------------------------ */
/* Automation defaults                                                 */
/* ------------------------------------------------------------------ */

/**
 * The default reminder sequence.
 *
 * Offsets are days from the due date; negative means before. Each step has its
 * own template so the tone can escalate without rewriting the earlier ones.
 */
export const DEFAULT_REMINDER_POLICY_SEED = {
  id: 'reminder_standard',
  name: 'Standard reminder sequence',
  enabled: true,
  offsets: [-3, 0, 7, 14],
  emailTemplateId: 'emt_reminder_before',
  subjectOverride: '',
  bodyOverride: '',
  // v1 always queues for approval. Automatic sending is a later opt-in.
  sendMode: 'queue' as const,
  minDaysSinceLastReminder: 3,
  minimumAmount: 0,
  lastEvaluatedAt: null,
};

/** Late fees are off by default: adding money to someone's invoice unasked is not a default. */
export const DEFAULT_LATE_FEE_SEED = {
  id: 'latefee_standard',
  name: 'Late payment fee',
  enabled: false,
  daysAfterDue: 14,
  kind: 'percent' as const,
  value: '2',
  applyAs: 'line' as const,
  description: 'Late payment fee',
  taxCodeId: null,
  capMinor: 0,
  compound: false,
  lastEvaluatedAt: null,
};

export function builtinReminderPolicies(now: string) {
  return [reminderPolicySchema.parse({ ...DEFAULT_REMINDER_POLICY_SEED, createdAt: now, updatedAt: now })];
}

export function builtinLateFeePolicies(now: string) {
  return [lateFeePolicySchema.parse({ ...DEFAULT_LATE_FEE_SEED, createdAt: now, updatedAt: now })];
}

export function builtinRulesAt(now: string): ReturnType<typeof builtinRules> {
  return builtinRules({ id: now, createdAt: now, updatedAt: now });
}

/* ------------------------------------------------------------------ */
/* Saved views                                                         */
/* ------------------------------------------------------------------ */

/** The document-list views every install starts with. */
export const BUILTIN_VIEW_SEEDS: Omit<
  import('@/core/schemas/settings').SavedView,
  'createdAt' | 'updatedAt'
>[] = [
  {
    id: 'view_all_invoices',
    deletedAt: null,
    name: 'All invoices',
    entity: 'document',
    filters: JSON.stringify({ type: 'invoice', status: [] }),
    icon: 'file-text',
    colour: '#1F5E5B',
    displayOrder: 10,
    builtin: true,
    hidden: false,
  },
  {
    id: 'view_drafts',
    deletedAt: null,
    name: 'Drafts to submit',
    entity: 'document',
    filters: JSON.stringify({ type: 'invoice', status: ['draft'] }),
    icon: 'pencil',
    colour: '#8A857C',
    displayOrder: 20,
    builtin: true,
    hidden: false,
  },
  {
    id: 'view_outstanding',
    deletedAt: null,
    name: 'Outstanding',
    entity: 'document',
    filters: JSON.stringify({
      type: 'invoice',
      status: ['finalised', 'sent', 'overdue'],
      balancePositive: true,
    }),
    icon: 'clock',
    colour: '#B07B3C',
    displayOrder: 30,
    builtin: true,
    hidden: false,
  },
  {
    id: 'view_overdue',
    deletedAt: null,
    name: 'Overdue',
    entity: 'document',
    filters: JSON.stringify({ type: 'invoice', status: ['overdue'] }),
    icon: 'alert',
    colour: '#9A3B36',
    displayOrder: 40,
    builtin: true,
    hidden: false,
  },
  {
    id: 'view_paid',
    deletedAt: null,
    name: 'Paid',
    entity: 'document',
    filters: JSON.stringify({ type: 'invoice', status: ['paid'] }),
    icon: 'check',
    colour: '#2E6B4F',
    displayOrder: 50,
    builtin: true,
    hidden: false,
  },
  {
    id: 'view_quotes',
    deletedAt: null,
    name: 'Quotes',
    entity: 'document',
    filters: JSON.stringify({ type: 'quote', status: [] }),
    icon: 'file-plus',
    colour: '#23395B',
    displayOrder: 60,
    builtin: true,
    hidden: false,
  },
  {
    id: 'view_credit_notes',
    deletedAt: null,
    name: 'Credit notes',
    entity: 'document',
    filters: JSON.stringify({ type: 'credit_note', status: [] }),
    icon: 'undo',
    colour: '#6E6A63',
    displayOrder: 70,
    builtin: true,
    hidden: false,
  },
  {
    id: 'view_void',
    deletedAt: null,
    name: 'Void',
    entity: 'document',
    filters: JSON.stringify({ status: ['void'] }),
    icon: 'ban',
    colour: '#9A3B36',
    displayOrder: 80,
    builtin: true,
    hidden: true,
  },
];

export function builtinSavedViews(now: string) {
  return BUILTIN_VIEW_SEEDS.map((seed) => savedViewSchema.parse({ ...seed, createdAt: now, updatedAt: now }));
}

/* ------------------------------------------------------------------ */
/* Content presets                                                     */
/* ------------------------------------------------------------------ */

/**
 * Starter content presets.
 *
 * These are skeletons, not line items — they carry the terms, notes and layout
 * that make the second invoice of a month take ten seconds instead of two
 * minutes. The catalogue items they reference are created by the setup wizard,
 * so nothing here depends on a client existing.
 */
export const BUILTIN_PRESET_SEEDS: Omit<ContentPreset, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'preset_standard_day',
    deletedAt: null,
    name: 'Standard consulting day',
    description: 'One day of consulting at the standard rate',
    documentType: 'invoice',
    clientId: null,
    designTemplateId: 'tpl_studio',
    emailTemplateId: 'emt_send',
    termsId: 'net_30',
    currency: 'AUD',
    taxMode: 'exclusive',
    notes: '',
    termsText: '',
    tags: ['consulting'],
    lines: [],
    builtin: true,
  },
  {
    id: 'preset_monthly_retainer',
    deletedAt: null,
    name: 'Monthly retainer',
    description: 'A recurring monthly fee, for turning into a recurring schedule',
    documentType: 'invoice',
    clientId: null,
    designTemplateId: 'tpl_studio',
    emailTemplateId: 'emt_send',
    termsId: 'net_14',
    currency: 'AUD',
    taxMode: 'exclusive',
    notes: 'Covers {month} {year}.',
    termsText: '',
    tags: ['retainer'],
    lines: [],
    builtin: true,
  },
  {
    id: 'preset_expenses',
    deletedAt: null,
    name: 'Expenses and reimbursements',
    description: 'A document for recharging expenses',
    documentType: 'invoice',
    clientId: null,
    designTemplateId: 'tpl_studio',
    emailTemplateId: 'emt_send',
    termsId: 'net_30',
    currency: 'AUD',
    taxMode: 'exclusive',
    notes: 'Receipts available on request.',
    termsText: '',
    tags: ['expenses'],
    lines: [],
    builtin: true,
  },
  {
    id: 'preset_project_quote',
    deletedAt: null,
    name: 'Project quote',
    description: 'A phased quote for a defined piece of work',
    documentType: 'quote',
    clientId: null,
    designTemplateId: 'tpl_classic',
    emailTemplateId: 'emt_quote',
    termsId: 'due_on_receipt',
    currency: 'AUD',
    taxMode: 'exclusive',
    notes: '',
    termsText: 'This quote is valid for 30 days from the issue date.',
    tags: ['project'],
    lines: [],
    builtin: true,
  },
];

export function builtinContentPresets(now: string): ContentPreset[] {
  return BUILTIN_PRESET_SEEDS.map((seed) =>
    contentPresetSchema.parse({ ...seed, createdAt: now, updatedAt: now }),
  );
}

/* ------------------------------------------------------------------ */
/* Exchange rates                                                      */
/* ------------------------------------------------------------------ */

/**
 * Indicative rates, present so a first foreign-currency invoice is not blocked.
 *
 * These are starting figures the user is expected to replace from a CSV — Duly
 * makes no rate API calls and no rate in here is ever authoritative. They exist
 * to make the "AUD equivalent" line work on day one, and the settings screen says
 * so.
 */
export const INDICATIVE_RATES: { from: string; rate: string; note: string }[] = [
  { from: 'AUD', rate: '1', note: 'Home currency' },
  { from: 'NZD', rate: '0.93', note: 'Indicative only — replace from the RBA or your bank' },
  { from: 'USD', rate: '0.66', note: 'Indicative only — replace from the RBA or your bank' },
  { from: 'EUR', rate: '1.08', note: 'Indicative only — replace from the RBA or your bank' },
  { from: 'GBP', rate: '1.17', note: 'Indicative only — replace from the RBA or your bank' },
  { from: 'JPY', rate: '97', note: 'Indicative only — replace from the RBA or your bank' },
  { from: 'CAD', rate: '0.91', note: 'Indicative only — replace from the RBA or your bank' },
  { from: 'SGD', rate: '0.88', note: 'Indicative only — replace from the RBA or your bank' },
  { from: 'CHF', rate: '1.24', note: 'Indicative only — replace from the RBA or your bank' },
  { from: 'HKD', rate: '5.17', note: 'Indicative only — replace from the RBA or your bank' },
];

/** Fresh indicative rates stamped for today. */
export function indicativeRates(today: string): CurrencyRate[] {
  return INDICATIVE_RATES.map((r) =>
    newEntity({
      from: r.from,
      to: 'AUD',
      rate: r.rate,
      effectiveDate: today,
      source: 'manual' as const,
      note: r.note,
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Catalogue starter items                                             */
/* ------------------------------------------------------------------ */

/**
 * A small starter catalogue.
 *
 * Enough to make the first invoice fast without pretending to know what the
 * business sells. Everything is editable, and the catalogue can be emptied.
 */
export const STARTER_ITEMS: {
  name: string;
  description: string;
  unit: string;
  price: number;
  category: string;
  taxCodeId?: string;
}[] = [
  {
    name: 'Consulting — hourly',
    description: 'Professional services at the hourly rate',
    unit: 'hour',
    price: 18000,
    category: 'Consulting',
  },
  {
    name: 'Consulting — day rate',
    description: 'A full day of consulting',
    unit: 'day',
    price: 120000,
    category: 'Consulting',
  },
  {
    name: 'Project work — fixed fee',
    description: 'A defined piece of work at an agreed price',
    unit: 'each',
    price: 0,
    category: 'Consulting',
  },
  { name: 'Design', description: 'Design work', unit: 'hour', price: 15000, category: 'Design' },
  {
    name: 'Development',
    description: 'Software development',
    unit: 'hour',
    price: 16000,
    category: 'Development',
  },
  {
    name: 'Meeting',
    description: 'A meeting or workshop',
    unit: 'hour',
    price: 12000,
    category: 'Consulting',
  },
  {
    name: 'Travel — domestic',
    description: 'Flights, rail and taxi, recharged at cost',
    unit: 'km',
    price: 0,
    category: 'Travel',
  },
  {
    name: 'Travel — accommodation',
    description: 'Accommodation, recharged at cost',
    unit: 'each',
    price: 0,
    category: 'Travel',
  },
  {
    name: 'Software subscription',
    description: 'A monthly software subscription',
    unit: 'month',
    price: 0,
    category: 'Software',
  },
  {
    name: 'Printing and postage',
    description: 'Printing, postage and courier',
    unit: 'each',
    price: 0,
    category: 'Office',
  },
  {
    name: 'Photocopying',
    description: 'Photocopying and scanning',
    unit: 'each',
    price: 150,
    category: 'Office',
  },
  {
    name: 'Shop — materials',
    description: 'Materials and consumables',
    unit: 'each',
    price: 0,
    category: 'Materials',
  },
];

export function starterItems(currency: string) {
  return STARTER_ITEMS.map((item) =>
    newEntity({
      code: '',
      name: item.name,
      description: item.description,
      unit: item.unit,
      prices: item.price > 0 ? { [currency]: item.price } : {},
      taxCodeId: item.taxCodeId ?? null,
      category: item.category,
      cost: 0,
      active: true,
      customFields: {},
    }),
  );
}
