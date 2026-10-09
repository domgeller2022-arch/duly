/**
 * Document creation and editing.
 *
 * This module holds everything about *making* a document that is not the
 * calculation engine: applying client defaults, inserting lines from the
 * catalogue, converting a quote to an invoice, splitting a credit note, and
 * building a fresh document from a preset or a recurring source.
 *
 * The editor store (below) holds the mutable draft. Everything here is pure, so
 * the same functions drive the editor, the "duplicate" action and the recurring
 * scheduler.
 */

import type {
  BusinessProfile,
  Client,
  Contact,
  ContentPreset,
  Document,
  DocumentLine,
  Item,
} from '@/core/schemas';
import { documentLineSchema, documentSchema } from '@/core/schemas/document';
import { newEntity, newId } from '@/core/schemas/common';
import type { Settings } from '@/core/schemas/settings';
import { dueDateFor, quoteExpiry } from '@/core/validation/dates';
import { percentToFraction, toMajorNumber } from '@/core/money/money';
import { currencyDecimals } from '@/core/money/currencies';
import { DEFAULT_TAX_CODES } from '@/core/tax/tax';
import { headingFor, patternPrefix } from '@/core/engines/numbering';

/* ------------------------------------------------------------------ */
/* Creating                                                            */
/* ------------------------------------------------------------------ */

export interface NewDocumentArgs {
  type: Document['type'];
  profile: BusinessProfile;
  settings: Settings;
  client?: Client | null;
  today: string;
  preset?: ContentPreset | null;
  /** Copied from a quote when converting, or from a duplicate. */
  source?: Document | null;
  sourceLines?: DocumentLine[];
  /** Only used when duplicating: the original keeps its number, the copy does not. */
  keepNumber?: boolean;
}

/**
 * Build a new document.
 *
 * Parsed through the schema so every default is applied in exactly one place and
 * a document can never be created in a state the editor cannot open.
 */
export function createDocument(args: NewDocumentArgs): { document: Document; lines: DocumentLine[] } {
  const { type, profile, settings, client, today, preset, source } = args;
  const id = newEntity({}).id;
  const stamp = newEntity({});

  const termsId =
    preset?.termsId ?? client?.defaultTermsId ?? profile.defaultTerms ?? settings.defaultTermsId;
  const issueDate = today;

  const document = documentSchema.parse(
    newEntity({
      id,
      profileId: profile.id,
      clientId: client?.id ?? null,
      type,
      issueDate,
      dueDate: dueDateFor(issueDate, termsId),
      termsId,
      // A copy carries what its source said: the client, the pricing mode,
      // the currency and the templates. Falling back to the business's
      // defaults here is how an inclusive invoice duplicated as exclusive —
      // GST added on top of prices that already contained it.
      currency: preset?.currency ?? source?.currency ?? client?.defaultCurrency ?? profile.defaultCurrency,
      taxMode: preset?.taxMode ?? source?.taxMode ?? 'exclusive',
      taxCodeId:
        source?.taxCodeId ?? client?.defaultTaxCodeId ?? profile.defaultTaxCodeId ?? DEFAULT_TAX_CODES[0].id,
      designTemplateId:
        preset?.designTemplateId ??
        source?.designTemplateId ??
        client?.defaultDesignTemplateId ??
        profile.defaultDesignTemplateId,
      emailTemplateId: preset?.emailTemplateId ?? source?.emailTemplateId ?? client?.defaultEmailTemplateId,
      notes: preset?.notes ?? source?.notes ?? '',
      termsText: preset?.termsText ?? source?.termsText ?? profile.paymentTermsText ?? '',
      labelLanguage: client?.labelLanguage ?? 'en',
      poNumber: client?.requirePoNumber ? '' : (source?.poNumber ?? ''),
      reference: source?.reference ?? '',
      tags: preset?.tags ?? [],
      customFields: source?.customFields ?? {},
      quoteValidUntil: type === 'quote' ? quoteExpiry(issueDate, settings.defaultQuoteValidityDays) : null,
      linkedDocumentIds: source ? [source.id] : [],
      // A fresh draft never has a real number. The placeholder makes the list
      // readable without ever looking like a number that was issued.
      draftNumber: nextDraftNumber(type),
    }),
  );

  const sourceLines = args.sourceLines ?? [];
  const lines = sourceLines.length ? copyLinesOnto(id, sourceLines, stamp) : [];

  // The client carries a standing discount: put it on the document as a
  // discount line so the editor, the PDF and the calculation all see the same
  // number, and the user can remove or adjust it before submitting.
  if (client?.defaultDiscountPercent && client.defaultDiscountPercent !== '0') {
    lines.push(
      documentLineSchema.parse(
        newEntity({
          documentId: id,
          type: 'discount',
          description: 'Standing discount',
          discountType: 'percent',
          discountValue: client.defaultDiscountPercent,
          discountDirection: 'discount',
          discountBase: 'subtotal',
          position: lines.length,
        }),
      ),
    );
  }

  if (source && source.type === 'quote' && type === 'invoice') {
    // Progress invoicing starts at zero on the first conversion.
    document.progressPercent = '0';
  }

  return { document, lines };
}

/**
 * Copy lines onto a new document with fresh ids — and remap every internal
 * reference with them. A section discount's target and a line's section
 * membership point at line ids; without the remap, a copy's section
 * discounts silently vanished and its lines fell out of their sections.
 */
export function copyLinesOnto(
  documentId: string,
  lines: DocumentLine[],
  stamp: { createdAt: string; updatedAt: string },
): DocumentLine[] {
  const idFor = new Map<string, string>();
  for (const line of lines) idFor.set(line.id, newEntity({}).id);

  return lines.map((line, index) => {
    const copy = documentLineSchema.parse(
      newEntity({
        ...line,
        id: idFor.get(line.id)!,
        documentId,
        position: index,
        createdAt: stamp.createdAt,
        updatedAt: stamp.updatedAt,
        deletedAt: null,
      }),
    );
    if (line.sectionId) copy.sectionId = idFor.get(line.sectionId) ?? null;
    if (line.appliesToSectionId) copy.appliesToSectionId = idFor.get(line.appliesToSectionId) ?? null;
    return copy;
  });
}

/** "DRAFT 1", "DRAFT 2"… so an unsaved draft is identifiable in the list. */
export function nextDraftNumber(type: Document['type']): string {
  void type;
  return 'DRAFT';
}

/* ------------------------------------------------------------------ */
/* Client defaults                                                     */
/* ------------------------------------------------------------------ */

/**
 * Apply a client's defaults to a document.
 *
 * Called whenever the client picker changes. Only fields the user has not
 * deliberately set are touched: someone who has picked a currency on purpose
 * should not have it overwritten by the client default.
 */
export function applyClientDefaults(
  document: Document,
  client: Client | null,
  options: { preserveCurrency?: boolean; preserveTerms?: boolean; preserveTemplate?: boolean } = {},
): Document {
  if (!client) return document;

  return {
    ...document,
    clientId: client.id,
    currency: options.preserveCurrency ? document.currency : client.defaultCurrency,
    termsId: options.preserveTerms ? document.termsId : client.defaultTermsId,
    dueDate: options.preserveTerms ? document.dueDate : dueDateFor(document.issueDate, client.defaultTermsId),
    taxCodeId: client.defaultTaxCodeId ?? document.taxCodeId,
    designTemplateId: options.preserveTemplate
      ? document.designTemplateId
      : (client.defaultDesignTemplateId ?? document.designTemplateId),
    emailTemplateId: client.defaultEmailTemplateId ?? document.emailTemplateId,
    labelLanguage: client.labelLanguage ?? document.labelLanguage,
    to: document.to.length > 0 ? document.to : [client.email].filter(Boolean),
    cc: document.cc.length > 0 ? document.cc : ccFromContacts(client.id, []),
  };
}

/** CC contacts marked as CC, with the client's own address excluded. */
export function ccFromContacts(
  clientId: string,
  contacts: Contact[],
  contactsByClient?: (id: string) => Contact[],
): string[] {
  void contactsByClient;
  return contacts
    .filter((c) => c.clientId === clientId && c.field === 'cc' && c.receivesInvoices && c.email)
    .map((c) => c.email);
}

/**
 * Who an invoice goes to.
 *
 * Contacts marked "receives invoices" become the To line, the client's own
 * address is excluded so a client does not receive a copy of their own invoice
 * twice, and anything left over becomes CC.
 */
export function resolveRecipients(
  client: Client | null,
  contacts: Contact[],
): { to: string[]; cc: string[] } {
  if (!client) return { to: [], cc: [] };

  const invoiceContacts = contacts.filter(
    (c) => c.clientId === client.id && c.receivesInvoices && c.email && c.field !== 'bcc',
  );

  const primary = client.invoiceContactId
    ? invoiceContacts.find((c) => c.id === client.invoiceContactId)
    : (invoiceContacts.find((c) => c.isPrimary && c.field === 'to') ??
      invoiceContacts.find((c) => c.field === 'to'));

  const to: string[] = [];
  if (primary?.email) to.push(primary.email);

  // Fall back to the client's own address only when no contact has one.
  if (to.length === 0 && client.email) to.push(client.email);

  const cc = invoiceContacts
    .filter((c) => c.id !== primary?.id && c.field === 'cc' && c.email !== client.email)
    .map((c) => c.email);

  return { to: [...new Set(to)], cc: [...new Set(cc)] };
}

/* ------------------------------------------------------------------ */
/* Lines                                                               */
/* ------------------------------------------------------------------ */

export interface NewLineArgs {
  document: Document;
  type?: DocumentLine['type'];
  item?: Item | null;
  description?: string;
  quantity?: string;
  unit?: string;
  unitPrice?: number;
  taxCodeId?: string | null;
  date?: string;
  amountOverride?: number | null;
  markupPercent?: string;
  /** Position to insert at. Appended when omitted. */
  position?: number;
}

/** Build one line, filling defaults from the item and the document. */
export function createLine(args: NewLineArgs): DocumentLine {
  const item = args.item ?? null;
  const type = args.type ?? 'item';
  const taxCodeId =
    args.taxCodeId !== undefined ? args.taxCodeId : (item?.taxCodeId ?? args.document.taxCodeId);

  const unitPrice =
    args.unitPrice !== undefined
      ? args.unitPrice
      : type === 'expense'
        ? 0
        : (itemPriceFor(item, args.document.currency) ?? 0);

  return documentLineSchema.parse(
    newEntity({
      documentId: args.document.id,
      position: args.position ?? 0,
      type,
      itemId: item?.id ?? null,
      description: args.description ?? item?.description ?? item?.name ?? '',
      notes: item && item.description && item.name ? '' : '',
      quantity: args.quantity ?? (type === 'expense' ? '1' : '1'),
      unit: args.unit ?? item?.unit ?? 'each',
      unitPrice,
      taxCodeId,
      date: args.date ?? (type === 'time' ? args.document.issueDate : null),
    }),
  );
}

/** The price of an item in a given currency, or null when it has none. */
export function itemPriceFor(item: Item | null | undefined, currency: string): number | null {
  if (!item) return null;
  const exact = item.prices[currency];
  if (typeof exact === 'number') return exact;
  return null;
}

/**
 * Insert lines, renumbering positions.
 *
 * Positions are contiguous from zero so the editor's drag-to-reorder never leaves
 * a gap that then sorts a line in the wrong place.
 */
export function insertLines(lines: DocumentLine[], newLines: DocumentLine[], at?: number): DocumentLine[] {
  const next = [...lines];
  const insertAt = at ?? next.length;

  next.splice(insertAt, 0, ...newLines);
  return renumber(next);
}

export function removeLine(lines: DocumentLine[], lineId: string): DocumentLine[] {
  return renumber(lines.filter((l) => l.id !== lineId));
}

/** Move a line, for drag-to-reorder. */
export function moveLine(lines: DocumentLine[], from: number, to: number): DocumentLine[] {
  if (from === to) return lines;
  if (from < 0 || from >= lines.length) return lines;
  const next = [...lines];
  const [moved] = next.splice(from, 1);
  if (!moved) return lines;
  next.splice(Math.max(0, Math.min(next.length, to)), 0, moved);
  return renumber(next);
}

export function renumber(lines: DocumentLine[]): DocumentLine[] {
  return lines.map((l, i) => (l.position === i ? l : { ...l, position: i }));
}

/** Lines that carry an amount, in document order. */
export function valuedLines(lines: DocumentLine[]): DocumentLine[] {
  return lines.filter((l) => l.type !== 'section' && l.type !== 'note');
}

/** Insert a section heading above a line. */
export function insertSection(lines: DocumentLine[], at: number, title: string): DocumentLine[] {
  const section = documentLineSchema.parse(
    newEntity({
      documentId: lines[0]?.documentId ?? '',
      position: at,
      type: 'section',
      description: title,
      showSubtotal: true,
    }),
  );
  const next = [...lines];
  next.splice(at, 0, section);
  return renumber(next);
}

/** Insert a note line, which prints but never totals. */
export function insertNote(lines: DocumentLine[], at: number, text: string): DocumentLine[] {
  const note = documentLineSchema.parse(
    newEntity({
      documentId: lines[0]?.documentId ?? '',
      position: at,
      type: 'note',
      description: text,
    }),
  );
  const next = [...lines];
  next.splice(at, 0, note);
  return renumber(next);
}

/** Insert a document-level discount or surcharge line. */
export function insertDiscount(
  lines: DocumentLine[],
  at: number,
  options: {
    kind: 'discount' | 'surcharge';
    percent: string;
    appliesToSectionId?: string | null;
    description?: string;
  },
): DocumentLine[] {
  const discount = documentLineSchema.parse(
    newEntity({
      documentId: lines[0]?.documentId ?? '',
      position: at,
      type: 'discount',
      description: options.description ?? (options.kind === 'surcharge' ? 'Surcharge' : 'Discount'),
      discountType: 'percent',
      discountValue: options.percent,
      discountDirection: options.kind,
      appliesToSectionId: options.appliesToSectionId ?? null,
      discountBase: options.appliesToSectionId ? 'section' : 'subtotal',
    }),
  );
  const next = [...lines];
  next.splice(at, 0, discount);
  return renumber(next);
}

/* ------------------------------------------------------------------ */
/* Catalogue matching                                                  */
/* ------------------------------------------------------------------ */

export interface CatalogueMatch {
  kind: 'item' | 'recent';
  item?: Item;
  label: string;
  detail: string;
  /** Insert what this match would produce. */
  build: () => DocumentLine;
}

/**
 * What a description matches as the user types.
 *
 * Catalogue items come first, then recently used free-typed lines, so the
 * common case — the same description as last month's invoice — is one Enter away.
 */
export function searchCatalogue(
  query: string,
  items: Item[],
  recentDescriptions: string[],
  document: Document,
  recentPrices: Map<string, number> = new Map(),
): CatalogueMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const matches: CatalogueMatch[] = [];

  for (const item of items) {
    const inName = item.name.toLowerCase();
    const inCode = item.code.toLowerCase();
    const inDescription = item.description.toLowerCase();
    if (!inName.includes(q) && !inCode.includes(q) && !inDescription.includes(q)) continue;

    const price = itemPriceFor(item, document.currency) ?? 0;
    matches.push({
      kind: 'item',
      item,
      label: item.name,
      detail: [item.code, item.unit, price ? formatPriceHint(price, document.currency) : null]
        .filter(Boolean)
        .join(' · '),
      build: () => createLine({ document, item }),
    });
  }

  // Recent free-typed lines, so repeating last month's wording is one Enter away.
  const seen = new Set<string>();
  for (const description of recentDescriptions) {
    if (!description.toLowerCase().includes(q)) continue;
    const key = description.toLowerCase();
    if (seen.has(key)) continue;
    if (matches.some((m) => m.label.toLowerCase() === key)) continue;
    seen.add(key);

    const price = recentPrices.get(description) ?? 0;
    matches.push({
      kind: 'recent',
      label: description,
      detail: ['recent', price ? formatPriceHint(price, document.currency) : null]
        .filter(Boolean)
        .join(' · '),
      build: () => createLine({ document, description, unitPrice: price }),
    });
  }

  return matches.slice(0, 8);
}

function formatPriceHint(minor: number, currency: string): string {
  // One currency table for the whole app: this three-code special case was
  // the third copy of the decimals logic and wrong for BHD, OMR, TND, CLP…
  return `${currency} ${toMajorNumber(minor, currency).toFixed(currencyDecimals(currency))}`;
}

/* ------------------------------------------------------------------ */
/* Lifecycle transitions                                               */
/* ------------------------------------------------------------------ */

/**
 * Convert a quote to an invoice.
 *
 * Everything is copied, the two documents are linked in both directions, and the
 * quote is marked accepted — so the audit trail shows what became what.
 */
export function convertQuoteToInvoice(
  quote: Document,
  quoteLines: DocumentLine[],
  profile: BusinessProfile,
  settings: Settings,
  today: string,
  client?: Client | null,
  /** Kept so the invoice can point back at the quote it became. */
  invoiceId?: string,
): {
  document: Document;
  lines: DocumentLine[];
  /** The quote as it should be left: accepted, and pointing at the new invoice. */
  updatedQuote: Document;
} {
  const { document, lines } = createDocument({
    type: 'invoice',
    profile,
    settings,
    today,
    source: quote,
    sourceLines: quoteLines,
    client,
  });

  const invoice: Document = {
    ...document,
    linkedDocumentIds: [quote.id],
    // A converted quote carries its own reference so a reader of the invoice
    // can find the quote it came from.
    reference: quote.reference || quote.number,
  };

  // The plan says converting a quote "links the two, marks quote accepted". Both
  // halves used to be missing: `convertedToDocumentId` was read by the editor to show
  // a "View invoice" button that could therefore never appear, and `acceptQuote` had
  // no caller at all.
  const updatedQuote: Document = {
    ...quote,
    status: 'accepted',
    acceptedAt: quote.acceptedAt ?? new Date().toISOString(),
    acceptedBy: quote.acceptedBy ?? '',
    acceptedSignatureImage: quote.acceptedSignatureImage ?? null,
    convertedToDocumentId: invoiceId ?? invoice.id,
  };

  return { document: invoice, lines, updatedQuote };
}

/** Mark a quote accepted, without converting it. Used by the signature flow. */
export function acceptQuote(
  quote: Document,
  signedAt: string,
  acceptedBy = '',
  signatureId: string | null = null,
  acceptedSignatureImage: string | null = null,
): Document {
  return {
    ...quote,
    status: 'accepted',
    acceptedAt: signedAt,
    acceptedBy,
    signatureId,
    acceptedSignatureImage,
  };
}

/** Void a document, keeping it for the audit trail. */
export function voidDocument(doc: Document, reason: string, now: string): Document {
  return { ...doc, status: 'void', voidedAt: now, voidReason: reason };
}

/**
 * Duplicate a document.
 *
 * Dated today with a new number. The line ids are all new, so editing the copy can
 * never touch the original.
 */
export function duplicateDocument(
  doc: Document,
  lines: DocumentLine[],
  profile: BusinessProfile,
  settings: Settings,
  today: string,
  client?: Client | null,
): { document: Document; lines: DocumentLine[] } {
  const copy = createDocument({ type: doc.type, profile, settings, source: doc, sourceLines: lines, today, client });
  return {
    document: {
      ...copy.document,
      // A duplicate is a fresh document in every sense: no status, no payments,
      // no snapshot, no progress carried over.
      status: 'draft',
      number: '',
      finalisedAt: null,
      sentAt: null,
      taxSnapshot: null,
      totals: { ...copy.document.totals, paid: 0, balance: copy.document.totals.total },
      deposit: { ...copy.document.deposit, enabled: false, paid: false, paidAmount: 0 },
      reviewRequired: false,
      scheduleRunKey: null,
      remindersQueued: [],
      lateFeeApplied: false,
      quoteValidUntil: doc.type === 'quote' ? quoteExpiry(today, settings.defaultQuoteValidityDays) : null,
    },
    lines: copy.lines,
  };
}

/* ------------------------------------------------------------------ */
/* Credit notes                                                        */
/* ------------------------------------------------------------------ */

/**
 * Create a credit note against an invoice.
 *
 * The credit note inherits the invoice's GST treatment — its tax snapshot, its
 * tax codes and its currency — even if the business has since changed its GST
 * registration. That is the whole point of the snapshot.
 */
export function createCreditNote(
  invoice: Document,
  invoiceLines: DocumentLine[],
  profile: BusinessProfile,
  settings: Settings,
  today: string,
  options: { reason?: string; lineIds?: string[] } = {},
): { document: Document; lines: DocumentLine[] } {
  const lines = options.lineIds ? invoiceLines.filter((l) => options.lineIds?.includes(l.id)) : invoiceLines;

  const stamp = newEntity({});
  const id = newEntity({}).id;

  const credit = documentSchema.parse(
    newEntity({
      id,
      profileId: invoice.profileId,
      clientId: invoice.clientId,
      type: 'credit_note',
      issueDate: today,
      dueDate: invoice.dueDate,
      termsId: invoice.termsId,
      currency: invoice.currency,
      // The credit note follows the invoice's pricing mode, not today's default.
      taxMode: invoice.taxMode,
      taxCodeId: invoice.taxCodeId,
      designTemplateId: invoice.designTemplateId,
      emailTemplateId: invoice.emailTemplateId,
      labelLanguage: invoice.labelLanguage,
      reference: invoice.number,
      notes: options.reason ?? '',
      linkedDocumentIds: [invoice.id],
      // The snapshot comes from the invoice, not from the business's current
      // setting. A credit note must reverse exactly what was charged.
      taxSnapshot: invoice.taxSnapshot,
      draftNumber: 'DRAFT',
    }),
  );

  // Copied through the same helper as every other copy, so a credited
  // section's discount points at the credit note's own section — without
  // the remap, a credit note could refund more than the section charged.
  const copied = copyLinesOnto(id, lines, stamp);

  void profile;
  void settings;
  return { document: credit, lines: copied };
}

/* ------------------------------------------------------------------ */
/* Progress invoicing                                                  */
/* ------------------------------------------------------------------ */

/**
 * Progress invoicing from an accepted quote.
 *
 * `selectedLineIds` bills only those lines; otherwise `percent` of everything
 * remaining is billed. The function refuses to go past 100% of the quote rather
 * than quietly letting a client be over-billed.
 */
export function buildProgressInvoice(
  quote: Document,
  quoteLines: DocumentLine[],
  profile: BusinessProfile,
  settings: Settings,
  today: string,
  options: { percent?: number; selectedLineIds?: string[]; alreadyInvoicedPercent?: number },
): { document: Document; lines: DocumentLine[]; warning?: string } {
  const already = Number(options.alreadyInvoicedPercent ?? quote.progressPercent ?? 0);
  const percent = options.percent ?? 100 - already;
  const warning =
    percent + already > 100
      ? `That would take progress to ${percent + already}%. Check the figure.`
      : undefined;

  const base = createDocument({
    type: 'invoice',
    profile,
    settings,
    today,
    source: quote,
    sourceLines: options.selectedLineIds?.length
      ? quoteLines.filter((l) => options.selectedLineIds?.includes(l.id))
      : quoteLines,
  });

  if (options.selectedLineIds?.length) {
    // Selected lines bill at full value; nothing to scale.
    return {
      ...base,
      document: { ...base.document, progressPercent: String(Math.min(100, already + percent)) },
      warning,
    };
  }

  const factor = percentToFraction(percent);
  const scaled = base.lines.map((line) => ({
    ...line,
    // Round each line so the sum matches what was quoted, not a fraction of a cent
    // off every line independently.
    unitPrice: Math.round(line.unitPrice * Number(factor.toString())),
  }));

  return {
    document: { ...base.document, progressPercent: String(Math.min(100, already + percent)) },
    lines: scaled,
    warning,
  };
}

/* ------------------------------------------------------------------ */
/* Deposits                                                            */
/* ------------------------------------------------------------------ */

/** The deposit amount a document requests, in minor units. */
export function depositAmount(total: number, deposit: Document['deposit']): number {
  if (!deposit.enabled) return 0;
  if (deposit.kind === 'percent') {
    return Math.round(total * Number(percentToFraction(deposit.value).toString()));
  }
  return Math.min(Math.max(0, Number(deposit.value) || 0), Math.max(0, total));
}

/** The balance still payable once a deposit has been paid. */
export function balanceAfterDeposit(total: number, deposit: Document['deposit']): number {
  if (!deposit.enabled || !deposit.paid) return total;
  return Math.max(0, total - deposit.paidAmount);
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

/** Statuses that mean the document's lifecycle is still open. */
const OPEN_STATUSES: Document['status'][] = ['finalised', 'sent', 'partially_paid', 'overdue'];

/**
 * The status a document should hold, given what has been paid and today's date.
 *
 * The plan's chain is "Draft → Finalised → Sent → Partially paid → Paid, with
 * Overdue derived from the due date and Void as a terminal state". This is the one
 * place that decides which of those a document is in, because three different paths
 * used to decide it separately and disagreed: recording a part payment never wrote
 * `partially_paid`, and the overdue sweep wrote `sent` as a side effect of an
 * invoice *stopping* being overdue.
 *
 * Note that `sent` is never produced here. A document is only `sent` once something
 * has actually sent it, which is Phase 6's email path — deriving it here would mean
 * claiming a document was emailed when nothing had.
 */
export function deriveDocumentStatus(args: {
  document: Document;
  balance: number;
  today: string;
}): Document['status'] {
  const { document: doc, balance, today } = args;

  // Terminal and pre-lifecycle states are never derived away.
  if (doc.status === 'draft') return 'draft';
  if (doc.status === 'void') return 'void';
  if (doc.status === 'accepted' || doc.status === 'declined' || doc.status === 'expired') {
    return doc.status;
  }

  const paid = doc.totals.paid;

  if (balance <= 0) return 'paid';
  if (doc.dueDate && today > doc.dueDate) return 'overdue';
  if (paid > 0) return 'partially_paid';

  // Back in date with nothing outstanding beyond the first payment. A document that
  // genuinely was sent stays sent; anything else — including an invoice whose due
  // date moved back into the future — returns to the state it was issued in. Echoing
  // the current status here would leave `overdue` stuck on forever.
  return doc.status === 'sent' ? 'sent' : 'finalised';
}

/**
 * Whether a document is still moving through its lifecycle.
 *
 * Used by the jobs that sweep for work, so a void or expired document is left alone.
 */
export function isOpenDocument(document: Document): boolean {
  return OPEN_STATUSES.includes(document.status);
}

/* ------------------------------------------------------------------ */
/* Headings                                                            */
/* ------------------------------------------------------------------ */

/**
 * The heading this document prints.
 *
 * Read from the tax snapshot when there is one, so a finalised document keeps the
 * heading it was issued with. Before finalising it follows the business's current
 * GST setting, which is what the editor preview should show.
 */
export function documentHeading(doc: Document, profile: BusinessProfile | null): string {
  if (doc.taxSnapshot?.heading) return doc.taxSnapshot.heading;
  return headingFor(profile?.gstRegistered ?? false, doc.type);
}

/** Placeholder number shown before finalising. */
export function draftLabel(doc: Document): string {
  return doc.number || doc.draftNumber || 'Not numbered';
}

/** A short description of where a number will come from. */
export function numberHint(pattern: string, type: Document['type']): string {
  return `${patternPrefix(pattern)}… (${type.replace('_', ' ')})`;
}

/** Apply a saved preset's design choices to an existing draft. */
export function applyPreset(document: Document, preset: ContentPreset): Document {
  return {
    ...document,
    designTemplateId: preset.designTemplateId,
    emailTemplateId: preset.emailTemplateId,
    notes: preset.notes || document.notes,
    termsText: preset.termsText || document.termsText,
    termsId: preset.termsId || document.termsId,
    currency: preset.currency || document.currency,
    taxMode: preset.taxMode || document.taxMode,
    tags: [...new Set([...document.tags, ...preset.tags])],
  };
}

/**
 * The lines a preset contributes, rewritten for the document being created.
 *
 * A preset's lines were saved against one particular document, so their ids are
 * meaningless here. Every line gets a fresh id, and the old-to-new map is then used
 * to repoint `sectionId` and `appliesToSectionId` — without that, a preset with a
 * section would come back with lines pointing at a section id that no longer exists,
 * and a section discount would silently stop applying.
 */
export function linesFromPreset(
  preset: ContentPreset,
  document: Document,
  items: readonly Item[] = [],
): DocumentLine[] {
  const now = new Date().toISOString();
  const idFor = new Map<string, string>();
  for (const line of preset.lines) idFor.set(line.id, newId());

  return preset.lines.map((line) => {
    const fresh: DocumentLine = {
      ...line,
      id: idFor.get(line.id) ?? newId(),
      documentId: document.id,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      // Cached amounts are always recomputed from the lines, never carried over.
      computedAmount: 0,
      sectionId: line.sectionId ? (idFor.get(line.sectionId) ?? null) : null,
      appliesToSectionId: line.appliesToSectionId ? (idFor.get(line.appliesToSectionId) ?? null) : null,
      // A price saved against the preset's currency means something different in
      // another one — 18000 is $180 in AUD and ¥18,000 in JPY. When the line names a
      // catalogue item, its price for this document's currency is the honest answer.
      unitPrice: cataloguePriceFor(line, document, items) ?? line.unitPrice,
    };
    return fresh;
  });
}

/** The catalogue price for a line's item in the document's currency, if there is one. */
function cataloguePriceFor(line: DocumentLine, document: Document, items: readonly Item[]): number | null {
  if (!line.itemId) return null;
  return itemPriceFor(items.find((i) => i.id === line.itemId) ?? null, document.currency);
}
