/**
 * The rules engine.
 *
 * Rules are if-then statements a user can read and edit — no model, no
 * inference. The two rules the plan names as examples both work:
 *
 *   "If client tag = Overseas -> tax code Export, currency USD"
 *   "If total > 10,000 -> terms Net 14"
 *
 * Evaluation is deterministic: rules run in priority order, a matching rule may
 * stop the chain, and every action reports the value it set so the automation log
 * can explain exactly what happened.
 */

import type { Rule, RuleAction, RuleCondition } from '../schemas/automation';
import type { Client } from '../schemas/crm';
import type { Document, DocumentLine } from '../schemas/document';
import { getTaxCode } from '../tax/tax';

/** Everything a rule is allowed to look at. */
export interface RuleContext {
  client: Client | null;
  document: Document;
  lines: DocumentLine[];
  /** Totals already computed, so "total > 10,000" reads the real figure. */
  subtotalMinor: number;
  totalMinor: number;
  itemCount: number;
  /** Item categories present on the document, lower-cased. */
  categories: string[];
  profileCode: string;
}

export interface RuleOutcome {
  applied: Rule[];
  /** Field changes, as a flat patch for the caller to apply. */
  patch: Partial<
    Pick<
      Document,
      'currency' | 'termsId' | 'taxCodeId' | 'designTemplateId' | 'notes' | 'poNumber' | 'reference'
    >
  > & {
    /** Discount percentage to apply to the whole document. */
    discountPercent?: string;
    /** Percentage markup to add to matching expense lines. */
    markupPercent?: string;
    /** Turn on the PO-number requirement. */
    requirePoNumber?: boolean;
  };
  /** One plain-English sentence per fired rule, for the automation log. */
  log: string[];
  /** True when `stopOnMatch` halted the chain. */
  stopped: boolean;
}

/* ------------------------------------------------------------------ */
/* Conditions                                                          */
/* ------------------------------------------------------------------ */

/** Read a condition's field off the context. Missing fields read as empty. */
export function readField(field: string, ctx: RuleContext): string {
  const client = ctx.client;

  switch (field) {
    case 'client.tag': {
      const tag = client?.tags.find((t) => t.toLowerCase() === 'overseas');
      return tag ?? client?.tags[0] ?? '';
    }
    case 'client.country':
      return client?.billingAddress.country ?? '';
    case 'client.taxId':
      return client?.taxId ?? '';
    case 'client.currency':
      return client?.defaultCurrency ?? '';
    case 'client.defaultTaxCodeId':
      return client?.defaultTaxCodeId ?? '';
    case 'document.type':
      return ctx.document.type;
    case 'document.currency':
      return ctx.document.currency;
    case 'document.profileId':
      return ctx.document.profileId;
    case 'document.total':
      return String(ctx.totalMinor);
    case 'document.subtotal':
      return String(ctx.subtotalMinor);
    case 'document.itemCount':
      return String(ctx.itemCount);
    case 'line.itemCategory':
      return ctx.categories[0] ?? '';
    case 'line.taxCodeId':
      return ctx.lines[0]?.taxCodeId ?? '';
    case 'line.type':
      return ctx.lines[0]?.type ?? '';
    case 'line.amount':
      return String(ctx.lines[0]?.unitPrice ?? 0);
    default:
      return '';
  }
}

/** True when the condition holds. Comparisons are numeric where both sides parse. */
export function evaluateCondition(condition: RuleCondition, ctx: RuleContext): boolean {
  const actual = readField(condition.field, ctx);
  const expected = condition.value.trim();

  switch (condition.operator) {
    case 'equals':
      return normalise(actual) === normalise(expected);
    case 'not_equals':
      return normalise(actual) !== normalise(expected);
    case 'contains':
      return normalise(actual).includes(normalise(expected));
    case 'not_contains':
      return !normalise(actual).includes(normalise(expected));
    case 'greater_than':
      return toNumber(actual) > toNumber(expected);
    case 'less_than':
      return toNumber(actual) < toNumber(expected);
    case 'in':
      return expected
        .split(',')
        .map((v) => normalise(v))
        .filter(Boolean)
        .includes(normalise(actual));
    case 'is_empty':
      return actual.trim() === '';
    case 'is_not_empty':
      return actual.trim() !== '';
    default:
      return false;
  }
}

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

function toNumber(value: string): number {
  const n = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** A one-line rendering of a condition, for the rules list. */
export function describeCondition(condition: RuleCondition): string {
  const labels: Record<string, string> = {
    equals: 'is',
    not_equals: 'is not',
    contains: 'contains',
    not_contains: 'does not contain',
    greater_than: 'is more than',
    less_than: 'is less than',
    in: 'is any of',
    is_empty: 'is empty',
    is_not_empty: 'is not empty',
  };
  const fields: Record<string, string> = {
    'client.tag': 'client tag',
    'client.country': 'client country',
    'client.taxId': 'client tax ID',
    'client.currency': 'client currency',
    'client.defaultTaxCodeId': 'client tax code',
    'document.type': 'document type',
    'document.currency': 'document currency',
    'document.total': 'document total',
    'document.subtotal': 'document subtotal',
    'document.itemCount': 'line count',
    'document.profileId': 'business profile',
    'line.itemCategory': 'item category',
    'line.taxCodeId': 'line tax code',
    'line.type': 'line type',
    'line.amount': 'line amount',
  };
  const field = fields[condition.field] ?? condition.field;
  const op = labels[condition.operator] ?? condition.operator;
  if (condition.operator === 'is_empty' || condition.operator === 'is_not_empty') return `${field} ${op}`;
  return `${field} ${op} "${condition.value}"`;
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

function describeAction(action: RuleAction): string {
  const labels: Record<string, string> = {
    set_field: `set ${action.field || 'a field'} to "${action.value}"`,
    set_tax_code: `set tax code to ${action.value}`,
    set_currency: `set currency to ${action.value}`,
    set_terms: `set payment terms to ${action.value}`,
    set_discount_percent: `apply a ${action.value}% discount`,
    set_design_template: `set the design template to ${action.value}`,
    add_line_markup_percent: `add ${action.value}% markup`,
    require_po_number: 'require a PO number',
  };
  return labels[action.type] ?? action.type;
}

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Run the enabled rules against a document.
 *
 * Pure: it returns a patch and a log rather than mutating anything, so the
 * caller decides whether to persist. The patch only carries keys a rule actually
 * set, so an untouched document stays untouched.
 */
export function evaluateRules(rules: readonly Rule[], ctx: RuleContext): RuleOutcome {
  const active = rules
    .filter((r) => r.enabled && !r.deletedAt && r.conditions.length > 0)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));

  const patch: RuleOutcome['patch'] = {};
  const applied: Rule[] = [];
  const log: string[] = [];
  let stopped = false;

  for (const rule of active) {
    if (stopped) break;

    const results = rule.conditions.map((c) => evaluateCondition(c, ctx));
    const matched = rule.match === 'any' ? results.some(Boolean) : results.every(Boolean);
    if (!matched) continue;

    applied.push(rule);

    for (const action of rule.actions) {
      applyAction(action, patch);
      log.push(`Rule "${rule.name}": ${describeAction(action)}`);
    }

    if (rule.actions.length === 0) {
      log.push(`Rule "${rule.name}" matched but has no actions`);
    }

    if (rule.stopOnMatch) stopped = true;
  }

  return { applied, patch, log, stopped };
}

function applyAction(action: RuleAction, patch: RuleOutcome['patch']): void {
  switch (action.type) {
    case 'set_tax_code':
      patch.taxCodeId = action.value;
      break;
    case 'set_currency':
      patch.currency = action.value.toUpperCase();
      break;
    case 'set_terms':
      patch.termsId = action.value;
      break;
    case 'set_design_template':
      patch.designTemplateId = action.value;
      break;
    case 'set_discount_percent':
      patch.discountPercent = action.value;
      break;
    case 'add_line_markup_percent':
      patch.markupPercent = action.value;
      break;
    case 'require_po_number':
      patch.requirePoNumber = action.value !== 'false';
      break;
    case 'set_field': {
      // Only known document fields may be set by a rule; anything else is
      // ignored rather than smuggled into the record.
      const allowed: Record<string, (v: string) => void> = {
        currency: (v) => {
          patch.currency = v.toUpperCase();
        },
        termsId: (v) => {
          patch.termsId = v;
        },
        taxCodeId: (v) => {
          patch.taxCodeId = v;
        },
        designTemplateId: (v) => {
          patch.designTemplateId = v;
        },
        notes: (v) => {
          patch.notes = v;
        },
        poNumber: (v) => {
          patch.poNumber = v;
        },
        reference: (v) => {
          patch.reference = v;
        },
        currencyCode: (v) => {
          patch.currency = v.toUpperCase();
        },
      };
      const setter = allowed[action.field];
      if (setter) setter(action.value);
      break;
    }
    default:
      break;
  }
}

/* ------------------------------------------------------------------ */
/* Built-in rules                                                      */
/* ------------------------------------------------------------------ */

/**
 * Rules that ship enabled, each one a piece of housekeeping an Australian
 * business would otherwise do by hand on every invoice.
 */
export function builtinRules(stamp: { id: string; createdAt: string; updatedAt: string }): Rule[] {
  type RuleSeed = Omit<Rule, 'createdAt' | 'updatedAt' | 'deletedAt' | 'lastFiredAt' | 'fireCount'> &
    Partial<Pick<Rule, 'lastFiredAt' | 'fireCount'>>;

  const mk = (r: RuleSeed): Rule => ({
    lastFiredAt: null,
    fireCount: 0,
    ...r,
    createdAt: stamp.createdAt,
    updatedAt: stamp.updatedAt,
    deletedAt: null,
  });

  return [
    mk({
      id: 'rule_overseas',
      // Setting a currency is not a rule action: relabelling an invoice as
      // USD converts nothing, and the prices would simply be wrong. The
      // user picks a currency; the rule engine only decides tax treatment.
      name: 'Overseas clients are export-rated',
      enabled: true,
      match: 'any',
      priority: 10,
      stopOnMatch: false,
      builtin: true,
      lastFiredAt: null,
      fireCount: 0,
      conditions: [{ field: 'client.tag', operator: 'equals', value: 'Overseas' }],
      actions: [{ type: 'set_tax_code', field: '', value: 'tax_export' }],
    }),
    mk({
      id: 'rule_large_terms',
      name: 'Invoices over 10,000 are Net 14',
      enabled: false,
      match: 'all',
      priority: 20,
      stopOnMatch: false,
      builtin: true,
      lastFiredAt: null,
      fireCount: 0,
      conditions: [{ field: 'document.total', operator: 'greater_than', value: '1000000' }],
      actions: [{ type: 'set_terms', field: '', value: 'net_14' }],
    }),
    mk({
      id: 'rule_travel_markup',
      name: 'Travel expenses carry a 10% markup',
      enabled: false,
      match: 'all',
      priority: 30,
      stopOnMatch: false,
      builtin: true,
      lastFiredAt: null,
      fireCount: 0,
      conditions: [{ field: 'line.itemCategory', operator: 'equals', value: 'Travel' }],
      actions: [{ type: 'add_line_markup_percent', field: '', value: '10' }],
    }),
    mk({
      id: 'rule_po_required',
      name: 'Government clients require a PO number',
      enabled: false,
      match: 'any',
      priority: 40,
      stopOnMatch: true,
      builtin: true,
      lastFiredAt: null,
      fireCount: 0,
      conditions: [{ field: 'client.tag', operator: 'equals', value: 'Government' }],
      actions: [{ type: 'require_po_number', field: '', value: 'true' }],
    }),
  ];
}

/** A short human summary of a rule, for the settings list. */
export function summariseRule(rule: Rule): string {
  const joiner = rule.match === 'any' ? ' OR ' : ' AND ';
  const when = rule.conditions.map(describeCondition).join(joiner) || 'always';
  const then = rule.actions.map(describeAction).join(', ') || 'nothing';
  return `If ${when}, then ${then}`;
}

/** Tax-code name for a rule action value, for display in the editor. */
export function taxCodeName(codes: { id: string; name: string }[], id: string | null | undefined): string {
  if (!id) return 'No tax';
  return getTaxCode(codes as never, id).name;
}
