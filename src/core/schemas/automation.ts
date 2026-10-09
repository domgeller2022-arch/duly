/**
 * Automation.
 *
 * Every automation in Duly is plain, readable logic — no model, no inference.
 * These schemas are what the Settings → Automation screens edit and what the
 * scheduler executes. `reviewRequired` is deliberately hard-wired true in v1:
 * a recurring run creates a draft for you, never a sent document.
 */

import { z } from 'zod';
import { baseEntity, currencyCode, decimal, isoDate, isoDateTime, percentString, uuid } from './common';
import { DOCUMENT_TYPES, documentLineSchema } from './document';

export const FREQUENCIES = [
  'weekly',
  'fortnightly',
  'monthly',
  'monthly_last_business_day',
  'quarterly',
  'half_yearly',
  'yearly',
] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const RECURRING_END_CONDITIONS = ['never', 'after_runs', 'on_date'] as const;
export type RecurringEndCondition = (typeof RECURRING_END_CONDITIONS)[number];

export const recurringScheduleSchema = z.object({
  ...baseEntity,
  name: z.string().min(1, 'Give the schedule a name'),
  documentType: z.enum(DOCUMENT_TYPES).default('invoice'),
  profileId: uuid,
  clientId: uuid.nullable().default(null),

  /** The source document whose lines are copied each run. */
  sourceDocumentId: uuid.nullable().default(null),
  designTemplateId: uuid.nullable().default(null),
  emailTemplateId: uuid.nullable().default(null),
  contentPresetId: uuid.nullable().default(null),

  frequency: z.enum(FREQUENCIES).default('monthly'),
  /** Day of month for monthly, day of week for weekly (0 = Sunday). */
  dayOfMonth: z.number().int().min(1).max(31).default(1),
  dayOfWeek: z.number().int().min(0).max(6).default(1),
  /** Minutes past midnight — lets a 07:00 run happen before office hours. */
  timeOfDayMinutes: z
    .number()
    .int()
    .min(0)
    .max(1439)
    .default(9 * 60),
  timezone: z.string().default('Australia/Sydney'),

  startDate: isoDate,
  nextRunDate: isoDate.nullable().default(null),
  lastRunDate: isoDate.nullable().default(null),
  lastRunDocumentId: uuid.nullable().default(null),

  endCondition: z.enum(RECURRING_END_CONDITIONS).default('never'),
  endAfterRuns: z.number().int().min(1).default(12),
  endOnDate: isoDate.nullable().default(null),
  runsCompleted: z.number().int().default(0),
  maxCatchUpRuns: z.number().int().default(3),

  /** Overrides carried onto each generated draft. */
  currency: currencyCode.nullable().default(null),
  termsId: z.string().nullable().default(null),
  dueOffsetDays: z.number().int().nullable().default(null),
  notes: z.string().default(''),

  paused: z.boolean().default(false),
  /** Always true in v1: a run produces a draft that needs your review. */
  reviewRequired: z.boolean().default(true),
  /** Run keys already consumed, so an app opened late cannot double-issue. */
  consumedRunKeys: z.array(z.string()).default([]),
});
export type RecurringSchedule = z.infer<typeof recurringScheduleSchema>;

/* ------------------------------------------------------------------ */
/* Numbering                                                           */
/* ------------------------------------------------------------------ */

export const RESET_RULES = ['never', 'yearly', 'financial_year'] as const;
export type ResetRule = (typeof RESET_RULES)[number];

export const numberSequenceSchema = z.object({
  ...baseEntity,
  profileId: uuid,
  documentType: z.enum(DOCUMENT_TYPES).default('invoice'),
  /** Pattern with tokens, e.g. "INV-{YYYY}-{####}". */
  pattern: z.string().default('INV-{YYYY}-{####}'),
  /** Next counter value to hand out. */
  nextValue: z.number().int().min(0).default(1),
  resetRule: z.enum(RESET_RULES).default('yearly'),
  /** Period the counter belongs to, e.g. "2026" or "2026-27". */
  periodKey: z.string().default(''),
  /** Numbers already issued; a value is never handed out twice. */
  issued: z.array(z.string()).default([]),
  startAt: z.number().int().default(1),
});
export type NumberSequence = z.infer<typeof numberSequenceSchema>;

export const DEFAULT_PATTERNS: Record<string, string> = {
  invoice: 'INV-{YYYY}-{####}',
  quote: 'Q-{YY}{MM}-{###}',
  credit_note: 'CN-{YYYY}-{####}',
  proforma: 'PF-{YYYY}-{####}',
  delivery_note: 'DN-{YYYY}-{####}',
  payment_receipt: 'RCT-{YYYY}-{####}',
};

/* ------------------------------------------------------------------ */
/* Rules engine                                                        */
/* ------------------------------------------------------------------ */

export const RULE_FIELDS = [
  'client.tag',
  'client.country',
  'client.taxId',
  'client.currency',
  'client.defaultTaxCodeId',
  'document.type',
  'document.currency',
  'document.total',
  'document.subtotal',
  'document.itemCount',
  'document.profileId',
  'line.itemCategory',
  'line.taxCodeId',
  'line.type',
  'line.amount',
] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

export const RULE_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'greater_than',
  'less_than',
  'in',
  'is_empty',
  'is_not_empty',
] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

export const RULE_ACTIONS = [
  'set_field',
  'set_tax_code',
  'set_currency',
  'set_terms',
  'set_discount_percent',
  'set_design_template',
  'add_line_markup_percent',
  'require_po_number',
] as const;
export type RuleActionType = (typeof RULE_ACTIONS)[number];

export const ruleConditionSchema = z.object({
  field: z.enum(RULE_FIELDS),
  operator: z.enum(RULE_OPERATORS),
  /** Comma-separated for `in`. */
  value: z.string().default(''),
});
export type RuleCondition = z.infer<typeof ruleConditionSchema>;

export const ruleActionSchema = z.object({
  type: z.enum(RULE_ACTIONS),
  /** Target field name for `set_field`. */
  field: z.string().default(''),
  value: z.string().default(''),
});
export type RuleAction = z.infer<typeof ruleActionSchema>;

export const ruleSchema = z.object({
  ...baseEntity,
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  /** All conditions must hold for the rule to fire. */
  match: z.enum(['all', 'any']).default('all'),
  conditions: z.array(ruleConditionSchema).default([]),
  actions: z.array(ruleActionSchema).default([]),
  priority: z.number().int().default(100),
  /** Lower runs first. */
  stopOnMatch: z.boolean().default(false),
  builtin: z.boolean().default(false),
  lastFiredAt: isoDateTime.nullable().default(null),
  fireCount: z.number().int().default(0),
});
export type Rule = z.infer<typeof ruleSchema>;

/* ------------------------------------------------------------------ */
/* Payment reminders and late fees                                     */
/* ------------------------------------------------------------------ */

export const reminderPolicySchema = z.object({
  ...baseEntity,
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  /** Offsets in days from the due date. Negative means before. */
  offsets: z.array(z.number().int()).default([-3, 0, 7, 14]),
  emailTemplateId: uuid.nullable().default(null),
  subjectOverride: z.string().default(''),
  bodyOverride: z.string().default(''),
  /** v1 always queues for approval. Automatic sending is a later opt-in. */
  sendMode: z.enum(['queue', 'auto']).default('queue'),
  /** Skip clients with a running reminder sequence. */
  minDaysSinceLastReminder: z.number().int().default(3),
  minimumAmount: z.number().int().default(0),
  lastEvaluatedAt: isoDateTime.nullable().default(null),
});
export type ReminderPolicy = z.infer<typeof reminderPolicySchema>;

export const lateFeePolicySchema = z.object({
  ...baseEntity,
  name: z.string().default('Late fee'),
  enabled: z.boolean().default(false),
  /** Days past the due date before the fee applies. */
  daysAfterDue: z.number().int().default(14),
  kind: z.enum(['percent', 'fixed']).default('percent'),
  value: percentString.default('2'),
  /** `line` adds a fee line to the invoice; `invoice` raises a new document. */
  applyAs: z.enum(['line', 'invoice']).default('line'),
  description: z.string().default('Late payment fee'),
  taxCodeId: z.string().nullable().default(null),
  /** Never apply more than this much, in minor units. */
  capMinor: z.number().int().default(0),
  compound: z.boolean().default(false),
  lastEvaluatedAt: isoDateTime.nullable().default(null),
});
export type LateFeePolicy = z.infer<typeof lateFeePolicySchema>;

/* ------------------------------------------------------------------ */
/* Reminder queue                                                      */
/* ------------------------------------------------------------------ */

/** A reminder waiting for approval. Approving it puts it in the outbox. */
export const reminderSchema = z.object({
  ...baseEntity,
  documentId: uuid,
  policyId: uuid.nullable().default(null),
  /** Days offset from the due date that produced this reminder. */
  offset: z.number().int().default(0),
  scheduledFor: isoDate,
  subject: z.string().default(''),
  body: z.string().default(''),
  emailTemplateId: uuid.nullable().default(null),
  status: z.enum(['pending', 'approved', 'sent', 'dismissed', 'failed']).default('pending'),
  approvedAt: isoDateTime.nullable().default(null),
  sentAt: isoDateTime.nullable().default(null),
  /** Dedup key: `<documentId>:<offset>`. */
  dedupeKey: z.string().default(''),
});
export type Reminder = z.infer<typeof reminderSchema>;

/* ------------------------------------------------------------------ */
/* Automation log                                                      */
/* ------------------------------------------------------------------ */

export const automationLogSchema = z.object({
  ...baseEntity,
  category: z.enum([
    'recurring',
    'overdue',
    'reminder',
    'late_fee',
    'quote_expiry',
    'scheduled_send',
    'rules',
    'backup',
    'pdf',
    'bank_match',
    'ai',
    'system',
  ] as const),
  /** Plain-English sentence describing exactly what happened. */
  message: z.string(),
  documentId: uuid.nullable().default(null),
  profileId: uuid.nullable().default(null),
  entity: z.string().default(''),
  entityId: z.string().default(''),
  /** Whether the user needs to do anything about it. */
  needsAttention: z.boolean().default(false),
  detail: z.string().default(''),
  /** Human-readable timestamp of the run that produced this entry. */
  ranAt: isoDateTime,
});
export type AutomationLogEntry = z.infer<typeof automationLogSchema>;

/** See `AuditLogInput`: the defaulted fields are optional on the way in. */
export type AutomationLogInput = z.input<typeof automationLogSchema>;

/* ------------------------------------------------------------------ */
/* Bank import                                                         */
/* ------------------------------------------------------------------ */

export const bankTransactionSchema = z.object({
  ...baseEntity,
  date: isoDate,
  description: z.string().default(''),
  /** Signed as imported: negative is money out. */
  amount: z.number().int().default(0),
  reference: z.string().default(''),
  /** Best-guess invoice, awaiting confirmation. */
  matchedDocumentId: uuid.nullable().default(null),
  matchedPaymentId: uuid.nullable().default(null),
  /** Exact amount match, unique reference match, or nothing. */
  matchMethod: z.enum(['amount_and_reference', 'amount_only', 'reference_only', 'none']).default('none'),
  matchConfidence: z.number().default(0),
  status: z.enum(['unmatched', 'suggested', 'confirmed', 'ignored']).default('unmatched'),
  importBatchId: uuid.nullable().default(null),
  note: z.string().default(''),
});
export type BankTransaction = z.infer<typeof bankTransactionSchema>;

/* ------------------------------------------------------------------ */
/* Projects, time tracking, expenses, retainers (business modules)     */
/* ------------------------------------------------------------------ */

export const projectSchema = z.object({
  ...baseEntity,
  name: z.string().min(1),
  clientId: uuid.nullable().default(null),
  code: z.string().default(''),
  hourlyRate: z.number().int().default(0),
  /** Budget in minor units, 0 means no budget. */
  budget: z.number().int().default(0),
  status: z.enum(['active', 'on_hold', 'completed', 'archived']).default('active'),
  colour: z.string().default('#1F5E5B'),
  notes: z.string().default(''),
});
export type Project = z.infer<typeof projectSchema>;

export const timeEntrySchema = z.object({
  ...baseEntity,
  clientId: uuid.nullable().default(null),
  projectId: uuid.nullable().default(null),
  date: isoDate,
  /** Hours, up to 4 decimals. */
  hours: decimal.default('0'),
  description: z.string().default(''),
  activity: z.string().default(''),
  staff: z.string().default(''),
  billable: z.boolean().default(true),
  rateOverride: z.number().int().nullable().default(null),
  /** 0 = no timer running. Milliseconds since epoch. */
  timerStartedAt: z.number().int().default(0),
  /** The document line this entry was invoiced on. */
  invoicedOnDocumentId: uuid.nullable().default(null),
  invoicedLineId: uuid.nullable().default(null),
});
export type TimeEntry = z.infer<typeof timeEntrySchema>;

export const expenseSchema = z.object({
  ...baseEntity,
  clientId: uuid.nullable().default(null),
  projectId: uuid.nullable().default(null),
  date: isoDate,
  supplier: z.string().default(''),
  description: z.string().default(''),
  /** Minor units in the document currency. */
  amount: z.number().int().default(0),
  currency: currencyCode,
  /** GST recoverable on the expense, in minor units. */
  gstAmount: z.number().int().default(0),
  category: z.string().default(''),
  billable: z.boolean().default(false),
  markupPercent: percentString.default('0'),
  taxCodeId: z.string().nullable().default(null),
  receiptAttachmentId: uuid.nullable().default(null),
  invoicedOnDocumentId: uuid.nullable().default(null),
  paymentMethod: z.string().default(''),
});
export type Expense = z.infer<typeof expenseSchema>;

export const retainerSchema = z.object({
  ...baseEntity,
  name: z.string().min(1),
  clientId: uuid,
  profileId: uuid,
  /** Prepaid money held, in minor units. */
  amount: z.number().int().default(0),
  currency: currencyCode,
  /** Prepaid hours held, if the retainer is time-based rather than money-based. */
  hours: decimal.default('0'),
  /** Draw-down lines that consumed the balance. */
  consumedMinor: z.number().int().default(0),
  consumedHours: decimal.default('0'),
  billingCycle: z.enum(['monthly', 'quarterly', 'half_yearly', 'yearly']).default('monthly'),
  startDate: isoDate,
  renewsOn: isoDate.nullable().default(null),
  alertThresholdMinor: z.number().int().default(0),
  alertSentAt: isoDateTime.nullable().default(null),
  status: z.enum(['active', 'paused', 'expired', 'completed']).default('active'),
  notes: z.string().default(''),
});
export type Retainer = z.infer<typeof retainerSchema>;

export const savedScheduleLineSchema = documentLineSchema;
