/**
 * The document view model.
 *
 * The PDF and the on-screen preview are both rendered from this one object, which
 * is what makes "one renderer, one truth" true in practice: there is no second
 * layout pass that could disagree with the first about a total, a heading or a
 * page break.
 *
 * Building the model is pure and separate from drawing it, so it is testable
 * without a DOM and reusable for exports — HTML, DOCX and a JSON attachment all
 * read the same structure.
 */

import type { Attachment, BusinessProfile, Client, Payment } from '@/core/schemas';
import type { PaymentDetails } from '@/core/schemas/common';
import type { Document, DocumentLine } from '@/core/schemas/document';
import type { DesignTemplate, LabelSet, EmailTemplate } from '@/core/schemas/template';
import { EN_LABELS } from '@/core/schemas/template';
import type { TaxCode } from '@/core/tax/tax';
import { canUseInclusiveGstStatement, GST_RATE } from '@/core/tax/tax';
import type { CalculationResult } from '@/core/calc/calculate';
import type { Address } from '@/core/schemas/common';
import { getCurrency } from '@/core/money/currencies';
import { formatMoney } from '@/core/money/money';
import { formatDate, formatDateForFilename, termLabel, resolveTerms } from '@/core/validation/dates';
import { headingFor, documentTypeLabel } from '@/core/engines/numbering';
import { formatAddressLines } from '@/core/format/address';
import { buildOutputPath } from '@/ui/lib/format';
import { depositAmount } from '@/core/documents';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface ResolvedAddress {
  lines: string[];
}

export interface ModelLine {
  id: string;
  type: DocumentLine['type'];
  description: string;
  notes: string;
  quantity: string;
  unit: string;
  unitPriceMinor: number;
  /** After line discount, section discount and apportioned document discount. */
  amountMinor: number;
  taxMinor: number;
  taxCodeId: string | null;
  taxCodeLabel: string;
  /** Marker beside the line, e.g. "*". */
  marker: string;
  discountLabel: string;
  sectionId: string | null;
  position: number;
  pageBreakBefore: boolean;
  showInTable: boolean;
}

export interface ModelSection {
  id: string;
  title: string;
  notes: string;
  subtotalMinor: number;
  discountMinor: number;
  collapsed: boolean;
  showSubtotal: boolean;
}

export interface ModelTaxGroup {
  codeId: string;
  name: string;
  rateLabel: string;
  taxable: boolean;
  marker: string;
  grossMinor: number;
  taxMinor: number;
}

export interface ModelPayment {
  date: string;
  dateDisplay: string;
  method: string;
  reference: string;
  amountMinor: number;
  note: string;
}

export interface ModelSignature {
  kind: 'image' | 'typed';
  value: string;
}

export interface DocumentModel {
  /* ---- identity ---- */
  heading: string;
  /** Customer-supplied merge fields, printed when the template asks for them. */
  customFields: Record<string, string>;
  /** Attachments with image data, for the job-photo grid. */
  photos: Attachment[];
  number: string;
  draftNumber: string;
  issueDate: string;
  issueDateDisplay: string;
  dueDate: string | null;
  dueDateDisplay: string;
  termsLabel: string;
  quoteValidUntil: string | null;
  status: Document['status'];
  /** Quote acceptance, printed under the items table. */
  acceptedAt: string | null;
  acceptedBy: string | null;
  acceptedSignatureImage: string | null;

  /* ---- parties ---- */
  business: {
    name: string;
    legalName: string;
    abn: string;
    abnDisplay: string;
    gstRegistered: boolean;
    address: ResolvedAddress;
    email: string;
    phone: string;
    website: string;
    contactName: string;
    logoSrc: string | null;
    logoMaxHeightMm: number;
    logoPosition: 'left' | 'centre' | 'right';
    letterheadHeader: string | null;
    letterheadFooter: string | null;
    signature: ModelSignature | null;
  };
  client: {
    name: string;
    legalName: string;
    taxId: string;
    taxIdDisplay: string;
    address: ResolvedAddress;
    email: string;
  } | null;

  /* ---- items ---- */
  lines: ModelLine[];
  sections: ModelSection[];
  notes: string;
  termsText: string;

  /** Business payment details; the QR block and payment block both read this. */
  payment: PaymentDetails | null;
  /** Data-URL QR PNG, null when not generated or not allowed. */
  qrSrc: string | null;

  /* ---- money ---- */
  currency: string;
  currencySymbol: string;
  decimals: number;
  taxMode: 'exclusive' | 'inclusive';
  /**
   * Whether the ATO permits "Total price includes GST" on this document.
   *
   * Only when the rate is exactly one eleventh and the document has a single taxable
   * code. The renderer prints the statement from this flag rather than re-deciding,
   * so the compliance check and the printed page can never disagree — which they did:
   * a 15% NZ GST invoice was warned about by one and printed the statement by the other.
   */
  inclusiveGstStatementAllowed: boolean;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  creditMinor: number;
  balanceMinor: number;
  gstPayableMinor: number;
  audEquivalentMinor: number | null;
  deposit: {
    enabled: boolean;
    label: string;
    amountMinor: number;
    paid: boolean;
    balanceAfterMinor: number;
  };
  taxGroups: ModelTaxGroup[];
  markerKey: string[];
  showNoGstNote: boolean;

  /* ---- payments ---- */
  payments: ModelPayment[];

  /* ---- presentation ---- */
  template: DesignTemplate | null;
  labels: LabelSet;
  columns: Set<string>;
  colours: DesignTemplate['colours'];
  fonts: DesignTemplate['fonts'];
  header: DesignTemplate['header'];
  footer: DesignTemplate['footer'];
  stamp: DesignTemplate['stamp'];
  extras: DesignTemplate['extras'];
  page: DesignTemplate['page'];

  /* ---- output ---- */
  suggestedFileName: string;
  suggestedPath: string;
  poNumber: string;
  reference: string;
  showPageNumbers: boolean;
  /** Set for a draft, so the DRAFT watermark is drawn. */
  isDraft: boolean;
}

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

export interface BuildModelArgs {
  document: Document;
  lines: DocumentLine[];
  payments: Payment[];
  result: CalculationResult;
  profile: BusinessProfile | null;
  client: Client | null;
  template: DesignTemplate | null;
  taxCodes: TaxCode[];
  /** Attached files, used by the photo grid and append-to-PDF checks. */
  attachments?: Attachment[];
  /** PNG data URL for the payment QR block, when one can be built. */
  qrSrc?: string | null;
  dateFormat?: 'DMY' | 'MDY' | 'ISO' | 'YMD';
  /** Settings, for the output path and address formatting. */
  outputPath?: {
    fileNamePattern?: string;
    yearFolderMode?: 'calendar' | 'financial' | 'none';
    useBusinessSubFolder?: boolean;
  };
}

/** Turn a document plus its records into everything the renderer needs. */
export function buildDocumentModel(args: BuildModelArgs): DocumentModel {
  const { document, lines, result, profile, client, template, taxCodes } = args;
  const dateFormat = args.dateFormat ?? 'DMY';
  const style = template ?? defaultTemplate();

  const attachments = args.attachments ?? [];
  const photos = attachments.filter((a) => !a.internal && a.mimeType.startsWith('image/'));

  const currency = document.currency;
  const currencyMeta = currencyInfo(currency);

  /* ---- tax snapshot wins for a finalised document ---- */
  const gstRegistered = document.taxSnapshot?.gstRegistered ?? profile?.gstRegistered ?? false;
  const heading = document.taxSnapshot?.heading ?? headingFor(gstRegistered, document.type);

  /* ---- tax labels ---- */
  const taxCodeById = new Map(taxCodes.map((c) => [c.id, c]));
  const markerSet = new Set(result.markerCodes.map((m) => m.taxCodeId));

  const modelLines: ModelLine[] = lines.map((line) => {
    const comp = result.lines.get(line.id);
    const code = line.taxCodeId ? taxCodeById.get(line.taxCodeId) : null;
    const marker = code?.label ? '*' : '';

    const discountLabel =
      line.discountType === 'none'
        ? ''
        : line.discountType === 'percent'
          ? `${line.discountValue}%`
          : formatMoney({ minor: Number(line.discountValue) || 0, currency });

    return {
      id: line.id,
      type: line.type,
      description: line.description,
      notes: line.notes,
      quantity: line.quantity,
      unit: line.unit,
      unitPriceMinor: line.type === 'expense' ? 0 : line.unitPrice,
      amountMinor: comp?.gross ?? 0,
      taxMinor: comp?.tax ?? 0,
      taxCodeId: line.taxCodeId,
      taxCodeLabel: code?.label ?? (code?.name === 'GST' ? 'GST' : (code?.name ?? '')),
      marker,
      discountLabel,
      sectionId: comp?.sectionId ?? null,
      position: line.position,
      pageBreakBefore: line.pageBreakBefore,
      showInTable: line.type === 'item' || line.type === 'time' || line.type === 'expense',
    };
  });

  const sections: ModelSection[] = result.sections.map((section) => ({
    id: section.id,
    title: section.title,
    notes: section.description,
    subtotalMinor: section.subtotal,
    discountMinor: section.discount,
    collapsed: false,
    showSubtotal: section.showSubtotal,
  }));

  const taxGroups: ModelTaxGroup[] = result.taxGroups.map((group) => ({
    codeId: group.taxCodeId,
    name: group.taxCodeId === 'tax_gst' && gstRegistered ? 'GST' : group.name,
    rateLabel: group.rateLabel,
    taxable: group.taxable,
    marker: markerSet.has(group.taxCodeId) ? '*' : '',
    grossMinor: group.gross,
    taxMinor: group.tax,
  }));

  const depositAmountMinor = depositAmount(result.total, document.deposit);

  const markerKey =
    result.hasMixedTaxability && result.markerCodes.length > 0
      ? result.markerCodes.map((m) => `* ${m.label ?? m.name}`)
      : [];

  const clientAddress = client ? formatAddressLines(client.billingAddress) : [];

  const model: DocumentModel = {
    heading,
    number: document.number,
    draftNumber: document.draftNumber,
    issueDate: document.issueDate,
    issueDateDisplay: formatDate(document.issueDate, dateFormat),
    dueDate: document.dueDate,
    dueDateDisplay: document.dueDate ? formatDate(document.dueDate, dateFormat) : '',
    termsLabel: termLabel(resolveTerms(document.termsId)),
    quoteValidUntil: document.quoteValidUntil,
    status: document.status,
    acceptedAt: document.acceptedAt ?? null,
    acceptedBy: document.acceptedBy || null,
    acceptedSignatureImage: document.acceptedSignatureImage ?? null,
    customFields: document.customFields ?? {},
    photos,
    payment: profile?.paymentDetails ?? null,
    qrSrc: args.qrSrc ?? null,

    business: {
      name: profile?.name ?? '',
      legalName: profile?.legalName ?? '',
      abn: profile?.abn ?? '',
      abnDisplay: formatAbnForPrint(profile?.abn ?? ''),
      gstRegistered,
      address: { lines: formatAddressLines(profile?.address) },
      email: profile?.email ?? '',
      phone: profile?.phone ?? '',
      website: profile?.website ?? '',
      contactName: profile?.contactName ?? '',
      logoSrc: profile?.logo?.src ?? null,
      logoMaxHeightMm: profile?.logo?.maxHeightMm ?? style.header.logoMaxHeightMm,
      logoPosition: profile?.logo?.position ?? style.header.logoPosition,
      letterheadHeader: profile?.letterheadHeader ?? null,
      letterheadFooter: profile?.letterheadFooter ?? null,
      signature: profile?.signature
        ? {
            kind: profile.signature.kind,
            value: profile.signature.kind === 'image' ? profile.signature.value : profile.signature.value,
          }
        : null,
    },

    client: client
      ? {
          name: client.displayName,
          legalName: client.legalName,
          taxId: client.taxId,
          taxIdDisplay: client.taxIdCountry === 'AU' ? formatAbnForPrint(client.taxId) : client.taxId,
          address: { lines: clientAddress },
          email: client.email,
        }
      : null,

    lines: modelLines,
    sections,
    notes: document.notes,
    termsText: document.termsText || (profile?.paymentTermsText ?? ''),

    currency,
    currencySymbol: currencyMeta.symbol,
    decimals: currencyMeta.decimals,
    taxMode: document.taxMode,
    inclusiveGstStatementAllowed:
      document.taxSnapshot?.inclusiveGstStatementAllowed ??
      (document.taxMode === 'inclusive' &&
        result.taxGroups.length === 1 &&
        canUseInclusiveGstStatement(taxCodeById.get(result.taxGroups[0]?.taxCodeId ?? '')?.rate ?? GST_RATE)),
    subtotalMinor: result.subtotal,
    discountMinor: result.discount,
    taxMinor: result.tax,
    totalMinor: result.total,
    paidMinor: result.paid,
    creditMinor: result.creditApplied,
    balanceMinor: result.balance,
    gstPayableMinor: result.gstPayable,
    audEquivalentMinor: result.audEquivalent,
    deposit: {
      enabled: document.deposit.enabled,
      label: document.deposit.label,
      amountMinor: depositAmountMinor,
      paid: document.deposit.paid,
      balanceAfterMinor: Math.max(0, result.total - (document.deposit.paid ? depositAmountMinor : 0)),
    },
    taxGroups,
    markerKey,
    showNoGstNote:
      !gstRegistered && result.tax === 0 && (document.showNoGstNote || settingsShowNoGst(profile)),

    payments: args.payments
      .filter((p) => !p.deletedAt)
      .map((payment) => ({
        date: payment.date,
        dateDisplay: formatDate(payment.date, dateFormat),
        method: payment.method,
        reference: payment.reference,
        amountMinor: payment.amount,
        note: payment.note,
      })),

    template: style,
    labels: style.labels,
    columns: new Set(style.columns),
    colours: style.colours,
    fonts: style.fonts,
    header: style.header,
    footer: style.footer,
    stamp: style.stamp,
    extras: style.extras,
    page: style.page,

    suggestedFileName: '',
    suggestedPath: '',
    poNumber: document.poNumber,
    reference: document.reference,
    showPageNumbers: style.footer.showPageNumbers,
    isDraft: document.status === 'draft',
  };

  // The output path, so the submit dialog can show exactly where it will land.
  const number = document.number || document.draftNumber || 'UNNUMBERED';
  const path = buildOutputPath({
    fileNamePattern: args.outputPath?.fileNamePattern ?? '{number} - {client} - {date}.pdf',
    number,
    client: client?.displayName ?? '',
    date: document.issueDate,
    yearFolderMode: args.outputPath?.yearFolderMode ?? 'calendar',
    businessSubFolder: args.outputPath?.useBusinessSubFolder ? (profile?.outputSubFolder ?? '') : '',
    financialYear: financialYearFor(document.issueDate),
    documentType: document.type,
    profileCode: profile?.code ?? '',
    dueDate: document.dueDate ? formatDateForFilename(document.dueDate) : '',
    currency,
  });

  model.suggestedPath = path;
  model.suggestedFileName = path.split('/').pop() ?? path;

  return model;
}

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                  */
/* ------------------------------------------------------------------ */

export function formatMoneyFor(
  model: { currency: string },
  minor: number,
  options?: { showSymbol?: boolean },
): string {
  return formatMoney({ minor, currency: model.currency }, { symbol: options?.showSymbol !== false });
}

/**
 * One currency table for the whole app. The renderer used to keep its own
 * 14-entry copy, wrong for BHD, OMR, TND, CLP, ISK and everything else the
 * plan's ISO 4217 list carries; `currencies.ts` is the single source.
 */
export function currencyInfo(code: string): { symbol: string; decimals: number } {
  const meta = getCurrency(code);
  return { symbol: meta.symbol || code, decimals: meta.decimals };
}

function formatAbnForPrint(abn: string): string {
  const digits = abn.replace(/\D/g, '');
  if (digits.length !== 11) return abn;
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
}

function settingsShowNoGst(profile: BusinessProfile | null): boolean {
  return Boolean(profile && !profile.gstRegistered);
}

function financialYearFor(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return m >= 7 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`;
}

/** A sensible default when no template has been assigned. */
export function defaultTemplate(): DesignTemplate {
  return {
    id: 'default',
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    name: 'Studio',
    layout: 'studio',
    builtin: true,
    colours: {
      primary: '#1F5E5B',
      accent: '#1F5E5B',
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
  };
}

/** Which stamp, if any, applies to a document's current state. */
export function stampFor(model: DocumentModel): string | null {
  if (!model.stamp.enabled) return null;
  const states: Record<string, string> = {
    draft: 'DRAFT',
    overdue: 'OVERDUE',
    void: 'VOID',
    paid: 'PAID',
  };
  const applies = (Object.keys(states) as string[]).filter((s) => model.stamp.showFor.includes(s as never));
  const active = applies.find((s) => s === model.status);
  if (active) return model.stamp.text || states[active];

  // Paid is not a stored status; derive it from the balance.
  if (model.stamp.showFor.includes('paid') && model.balanceMinor === 0 && model.status !== 'draft')
    return 'PAID';

  return null;
}

export { documentTypeLabel };
export type { Address, EmailTemplate };
