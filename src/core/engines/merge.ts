/**
 * Merge fields for email templates and document labels.
 *
 * `{client.name}`, `{invoice.number}`, `{invoice.total}`, `{invoice.due_date}`
 * and `{business.name}` are the fields the plan names. Everything resolves to a
 * plain string; an unknown token is left visible so a typo in a template shows
 * up in the preview instead of quietly deleting words from an email.
 *
 * Values are pre-formatted. An invoice total is never interpolated as a raw
 * integer — the caller passes the currency already formatted, because how money
 * should read is a document decision, not a templating one.
 */

export type MergeValues = Record<string, string | number | null | undefined>;

export interface InterpolateOptions {
  /** Token to use when a value is missing. Empty by default. */
  fallback?: string;
  /** Drop lines that end up empty, so the body has no ragged gaps. */
  collapseEmptyLines?: boolean;
  /** Trim each rendered line. */
  trim?: boolean;
}

/**
 * Replace `{token}` in a template.
 *
 * Matching is case-insensitive and accepts spaces inside the braces, so
 * `{ client.name }` and `{client.name}` are the same field.
 */
export function interpolate(template: string, values: MergeValues, options: InterpolateOptions = {}): string {
  const { fallback = '', trim = false } = options;
  if (!template) return '';

  const replaced = template.replace(/\{\s*([a-zA-Z0-9_.]+)\s*\}/g, (match, key: string) => {
    const value = lookup(values, key);

    // An unknown token is left visible: a typo should be obvious in the preview
    // rather than quietly deleting words from the email. A known field that
    // happens to be empty does collapse to the fallback.
    if (value === undefined) return match;
    if (value === null || value === '') return fallback;
    return String(value);
  });

  if (!trim) return replaced;

  const lines = replaced.split('\n').map((l) => l.trim());
  return options.collapseEmptyLines ? lines.filter((l) => l !== '').join('\n') : lines.join('\n');
}

/** Case-insensitive, dotted-path lookup. */
function lookup(values: MergeValues, key: string): string | number | null | undefined {
  if (key in values) return values[key];

  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(values)) {
    if (k.toLowerCase() === lower) return v;
  }

  // `client.name` should also match `clientName`.
  const flat = lower.replace(/\./g, '');
  for (const [k, v] of Object.entries(values)) {
    if (k.toLowerCase().replace(/\./g, '') === flat) return v;
  }

  return undefined;
}

/** Every token used in a template, for the template editor's field list. */
export function tokensIn(template: string): string[] {
  const found = new Set<string>();
  const re = /\{\s*([a-zA-Z0-9_.]+)\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template ?? '')) !== null) found.add(m[1]);
  return [...found];
}

/** Tokens a template uses that have no value, so the editor can flag them. */
export function missingTokens(template: string, values: MergeValues): string[] {
  return tokensIn(template).filter((t) => {
    const v = lookup(values, t);
    return v === undefined || v === null || v === '';
  });
}

/**
 * The standard field list, shown in the email editor.
 *
 * Grouped by where the value comes from so it is obvious what can be filled in.
 */
export const MERGE_FIELDS: readonly { group: string; token: string; description: string }[] = [
  { group: 'Business', token: '{business.name}', description: 'Business name' },
  { group: 'Business', token: '{business.legal_name}', description: 'Legal entity name' },
  { group: 'Business', token: '{business.abn}', description: 'Formatted ABN' },
  { group: 'Business', token: '{business.email}', description: 'Business email address' },
  { group: 'Business', token: '{business.phone}', description: 'Business phone number' },
  { group: 'Business', token: '{business.address}', description: 'Full business address, one line per part' },
  {
    group: 'Business',
    token: '{business.payment_details}',
    description: 'Bank, PayID or BPAY details block',
  },
  { group: 'Business', token: '{business.contact}', description: 'Contact person for this business' },

  { group: 'Client', token: '{client.name}', description: 'Client display name' },
  { group: 'Client', token: '{client.legal_name}', description: 'Client legal entity name' },
  { group: 'Client', token: '{client.first_name}', description: 'First word of the client name' },
  { group: 'Client', token: '{client.tax_id}', description: 'Client ABN or tax identifier' },
  { group: 'Client', token: '{client.address}', description: 'Billing address' },
  { group: 'Client', token: '{client.email}', description: 'Client email address' },

  { group: 'Document', token: '{invoice.number}', description: 'Document number, assigned on submit' },
  {
    group: 'Document',
    token: '{invoice.draft_number}',
    description: 'Placeholder number while still a draft',
  },
  { group: 'Document', token: '{invoice.type}', description: 'Tax Invoice, Quote, Credit Note…' },
  { group: 'Document', token: '{invoice.issue_date}', description: 'Issue date' },
  { group: 'Document', token: '{invoice.due_date}', description: 'Due date' },
  { group: 'Document', token: '{invoice.terms}', description: 'Payment terms, e.g. Net 30' },
  { group: 'Document', token: '{invoice.currency}', description: 'Currency code' },
  { group: 'Document', token: '{invoice.subtotal}', description: 'Subtotal, formatted' },
  { group: 'Document', token: '{invoice.discount}', description: 'Discount total, formatted' },
  { group: 'Document', token: '{invoice.gst}', description: 'GST amount, formatted' },
  { group: 'Document', token: '{invoice.total}', description: 'Total due, formatted' },
  { group: 'Document', token: '{invoice.balance}', description: 'Balance due, formatted' },
  { group: 'Document', token: '{invoice.amount_paid}', description: 'Amount paid so far, formatted' },
  { group: 'Document', token: '{invoice.po_number}', description: 'Purchase order number' },
  { group: 'Document', token: '{invoice.reference}', description: 'Reference field' },
  { group: 'Document', token: '{invoice.notes}', description: 'Notes printed on the document' },
  { group: 'Document', token: '{invoice.terms_text}', description: 'Terms and conditions text' },
  { group: 'Document', token: '{invoice.days_overdue}', description: 'Days past the due date' },
  { group: 'Document', token: '{invoice.payment_link}', description: 'A pasted payment link, if set' },

  { group: 'Sender', token: '{sender.name}', description: 'Your name' },
  { group: 'Sender', token: '{sender.email}', description: 'Your email address' },
  { group: 'Sender', token: '{sender.phone}', description: 'Your phone number' },

  { group: 'Date', token: '{today}', description: "Today's date" },
  { group: 'Date', token: '{today_long}', description: "Today's date, long form" },
];

/**
 * The custom-field tokens available for a set of fields.
 *
 * The plan asks for custom fields "available as merge fields on templates". The
 * fields are the user's, so the token list is derived rather than declared: a field
 * named "Priority" on a client becomes `{client.custom.priority}`.
 *
 * Keys are slugged so a rename cannot produce a token with a space or a brace in
 * it, which would silently stop interpolating.
 */
export function customFieldTokens(
  fields: readonly { entity: string; key: string; name: string }[],
): { group: string; token: string; description: string }[] {
  const groupFor: Record<string, string> = {
    client: 'Client',
    item: 'Item',
    document: 'Document',
  };

  return fields.map((field) => ({
    group: groupFor[field.entity] ?? 'Custom',
    token: `{${field.entity}.custom.${slugifyKey(field.key)}}`,
    description: field.name,
  }));
}

/** Lowercase, spaces and punctuation to underscores. Keeps a token interpolatable. */
export function slugifyKey(key: string): string {
  return String(key ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Fold custom-field values into a merge set.
 *
 * Kept separate from `buildMergeValues` so the caller does not have to pass three
 * optional maps to get the standard fields. Returns a new object; the input is
 * untouched.
 */
export function withCustomFieldValues(
  values: MergeValues,
  customFields: {
    client?: Record<string, string>;
    item?: Record<string, string>;
    document?: Record<string, string>;
  },
): MergeValues {
  const merged: MergeValues = { ...values };

  for (const [entity, map] of Object.entries(customFields)) {
    for (const [key, value] of Object.entries(map ?? {})) {
      merged[`${entity}.custom.${slugifyKey(key)}`] = value;
    }
  }

  return merged;
}

/** Build the value set for a send. */
export function buildMergeValues(input: {
  business: {
    name: string;
    legalName?: string;
    abn?: string;
    email?: string;
    phone?: string;
    contactName?: string;
    addressLines?: string[];
    paymentDetailsLines?: string[];
  };
  client: {
    name: string;
    legalName?: string;
    taxId?: string;
    addressLines?: string[];
    email?: string;
  } | null;
  document: {
    number: string;
    draftNumber?: string;
    typeLabel: string;
    issueDate: string;
    dueDate?: string | null;
    termsLabel?: string;
    currency: string;
    subtotal?: string;
    discount?: string;
    gst?: string;
    total?: string;
    balance?: string;
    amountPaid?: string;
    poNumber?: string;
    reference?: string;
    notes?: string;
    termsText?: string;
    daysOverdue?: number;
    paymentLink?: string;
  };
  sender?: { name?: string; email?: string; phone?: string };
  today?: string;
  todayLong?: string;
}): MergeValues {
  const b = input.business;
  const c = input.client;
  const d = input.document;
  const s = input.sender ?? {};

  return {
    'business.name': b.name,
    'business.legal_name': b.legalName ?? '',
    'business.abn': b.abn ?? '',
    'business.email': b.email ?? '',
    'business.phone': b.phone ?? '',
    'business.contact': b.contactName ?? '',
    'business.address': (b.addressLines ?? []).join('\n'),
    'business.payment_details': (b.paymentDetailsLines ?? []).join('\n'),

    'client.name': c?.name ?? '',
    'client.legal_name': c?.legalName ?? '',
    'client.first_name': firstName(c?.name ?? ''),
    'client.tax_id': c?.taxId ?? '',
    'client.address': (c?.addressLines ?? []).join('\n'),
    'client.email': c?.email ?? '',

    'invoice.number': d.number || d.draftNumber || '',
    'invoice.draft_number': d.draftNumber ?? '',
    'invoice.type': d.typeLabel,
    'invoice.issue_date': d.issueDate,
    'invoice.due_date': d.dueDate ?? '',
    'invoice.terms': d.termsLabel ?? '',
    'invoice.currency': d.currency,
    'invoice.subtotal': d.subtotal ?? '',
    'invoice.discount': d.discount ?? '',
    'invoice.gst': d.gst ?? '',
    'invoice.total': d.total ?? '',
    'invoice.balance': d.balance ?? '',
    'invoice.amount_paid': d.amountPaid ?? '',
    'invoice.po_number': d.poNumber ?? '',
    'invoice.reference': d.reference ?? '',
    'invoice.notes': d.notes ?? '',
    'invoice.terms_text': d.termsText ?? '',
    'invoice.days_overdue': d.daysOverdue ?? 0,
    'invoice.payment_link': d.paymentLink ?? '',

    'sender.name': s.name ?? '',
    'sender.email': s.email ?? '',
    'sender.phone': s.phone ?? '',

    today: input.today ?? '',
    today_long: input.todayLong ?? input.today ?? '',
  };
}

function firstName(full: string): string {
  const trimmed = full.trim();
  if (!trimmed) return '';
  const words = trimmed.split(/\s+/);
  return words.length === 1 ? words[0] : words[0];
}
