/**
 * The payment reminder engine.
 *
 * Reminders are *queued*, never sent automatically in v1. Each policy defines a
 * sequence of offsets from the due date — 3 days before, on the day, then 7 and 14
 * days after — and each step resolves to its own email template so the tone can
 * escalate without rewriting the earlier steps.
 *
 * Every queued reminder carries a dedupe key of `<documentId>:<offset>`, so the
 * same step for the same invoice can never be queued twice, however many times the
 * scheduler runs.
 */

import type { Document } from '@/core/schemas/document';
import type { PaymentDetails } from '@/core/schemas/common';
import type { Reminder } from '@/core/schemas/automation';
import { reminderSchema } from '@/core/schemas/automation';
import type { EmailTemplate } from '@/core/schemas/template';
import { newEntity } from '@/core/schemas/common';
import { storage } from '@/adapters';
import { interpolate, buildMergeValues, type MergeValues } from '@/core/engines/merge';
import {
  addDaysIso,
  daysOverdue,
  diffDays,
  formatDate,
  termLabel,
  resolveTerms,
} from '@/core/validation/dates';
import { formatMoney } from '@/core/money/money';
import { documentTypeLabel } from '@/core/engines/numbering';
import { formatAddressLines } from '@/core/format/address';

export interface ReminderStep {
  offset: number;
  dueDate: string;
  scheduledFor: string;
  isToday: boolean;
  isPast: boolean;
  isFuture: boolean;
}

/** Every step a policy would produce for a document, past and future. */
export function reminderSteps(policy: { offsets: number[] }, dueDate: string, today: string): ReminderStep[] {
  return [...policy.offsets]
    .sort((a, b) => a - b)
    .map((offset) => {
      const scheduledFor = addDaysIso(dueDate, offset);
      return {
        offset,
        dueDate,
        scheduledFor,
        isToday: scheduledFor === today,
        isPast: diffDays(today, scheduledFor) > 0,
        isFuture: diffDays(scheduledFor, today) > 0,
      };
    });
}

/**
 * Queue the reminder steps that are due.
 *
 * Only steps whose date is today or in the past are queued, and only for
 * documents that are actually outstanding.
 */
export async function runReminderEngine(today: string): Promise<Reminder[]> {
  const db = storage();
  const policies = (await db.listReminderPolicies()).filter((p) => p.enabled && !p.deletedAt);
  if (policies.length === 0) return [];

  const templates = await db.listEmailTemplates();
  const documents = await db.listDocuments();
  const queued: Reminder[] = [];

  for (const policy of policies) {
    for (const doc of documents) {
      if (doc.type !== 'invoice') continue;
      if (!['finalised', 'sent', 'overdue', 'partially_paid'].includes(doc.status)) continue;
      if (doc.totals.balance <= 0) continue;
      if (!doc.dueDate) continue;
      if (policy.minimumAmount > 0 && doc.totals.balance < policy.minimumAmount) continue;

      // Don't nag: a document already being chased is left alone for the
      // policy's own quiet period.
      if (policy.minDaysSinceLastReminder > 0 && doc.remindersQueued.length > 0) {
        const last = doc.remindersQueued[doc.remindersQueued.length - 1];
        const lastReminder = last
          ? await db.listReminders().then((all) => all.find((r) => r.dedupeKey === last))
          : undefined;
        if (lastReminder && diffDays(lastReminder.scheduledFor, today) < policy.minDaysSinceLastReminder)
          continue;
      }

      for (const step of reminderSteps(policy, doc.dueDate, today)) {
        if (step.isFuture) continue;

        const dedupeKey = `${doc.id}:${step.offset}`;
        const existing = await db.listReminders();
        if (existing.some((r) => r.dedupeKey === dedupeKey)) continue;

        const template = resolveTemplateForStep(templates, policy.emailTemplateId, step.offset);
        const values = await buildDocumentMergeValues(doc, today);

        const reminder: Reminder = reminderSchema.parse(
          newEntity({
            documentId: doc.id,
            policyId: policy.id,
            offset: step.offset,
            scheduledFor: step.scheduledFor,
            subject:
              policy.subjectOverride || interpolate(template?.subject ?? defaultSubject(step.offset), values),
            body: policy.bodyOverride || interpolate(template?.body ?? defaultBody(step.offset), values),
            emailTemplateId: template?.id ?? null,
            status: 'pending',
            dedupeKey,
          }),
        );

        await db.saveReminder(reminder);
        await db.saveDocument({ ...doc, remindersQueued: [...doc.remindersQueued, dedupeKey] });
        queued.push(reminder);
      }
    }
  }

  return queued;
}

/**
 * Pick the template for a step.
 *
 * The policy's own template wins; otherwise the purpose is inferred from where in
 * the sequence the step sits, which is what gives each step its own voice.
 */
export function resolveTemplateForStep(
  templates: EmailTemplate[],
  policyTemplateId: string | null,
  offset: number,
): EmailTemplate | undefined {
  if (policyTemplateId) {
    const explicit = templates.find((t) => t.id === policyTemplateId);
    if (explicit) return explicit;
  }

  const purpose: EmailTemplate['purpose'] =
    offset < 0 ? 'reminder_before' : offset === 0 ? 'reminder_due' : 'reminder_after';

  return (
    templates.find((t) => t.purpose === purpose && t.builtin) ?? templates.find((t) => t.purpose === purpose)
  );
}

function defaultSubject(offset: number): string {
  if (offset < 0) return 'Your invoice is due soon';
  if (offset === 0) return 'Your invoice is due today';
  return 'Your invoice is overdue';
}

function defaultBody(offset: number): string {
  if (offset < 0) return 'A quick note that your invoice is due in a few days. {invoice.payment_details}';
  if (offset === 0) return 'Your invoice is due today. {invoice.payment_details}';
  return 'Your invoice is now {invoice.days_overdue} days overdue. The balance outstanding is {invoice.balance}.';
}

/** Build the merge values for a document, formatting every figure first. */
export async function buildDocumentMergeValues(doc: DocumentLike, today: string): Promise<MergeValues> {
  const db = storage();
  const [profile, client] = await Promise.all([
    db.getBusinessProfile(doc.profileId),
    db.getClient(doc.clientId ?? ''),
  ]);

  const currency = doc.currency;
  const settings = await db.getSettings();
  const dateFormat = settings.dateFormat;

  return buildMergeValues({
    business: {
      name: profile?.name ?? '',
      legalName: profile?.legalName ?? '',
      abn: profile?.abn ?? '',
      email: profile?.email ?? '',
      phone: profile?.phone ?? '',
      contactName: profile?.contactName ?? '',
      addressLines: formatAddressLines(profile?.address),
      paymentDetailsLines: formatPaymentDetailLines(profile),
    },
    client: client
      ? {
          name: client.displayName,
          legalName: client.legalName,
          taxId: client.taxId,
          addressLines: formatAddressLines(client.billingAddress),
          email: client.email,
        }
      : null,
    document: {
      number: doc.number || doc.draftNumber || '',
      draftNumber: doc.draftNumber ?? '',
      typeLabel: doc.taxSnapshot?.heading ?? documentTypeLabel(doc.type),
      issueDate: formatDate(doc.issueDate, dateFormat),
      dueDate: doc.dueDate ? formatDate(doc.dueDate, dateFormat) : '',
      termsLabel: termLabel(resolveTerms(doc.termsId)),
      currency,
      subtotal: formatMoney({ minor: doc.totals.subtotal, currency }),
      discount: formatMoney({ minor: doc.totals.discount, currency }),
      gst: formatMoney({ minor: doc.totals.tax, currency }),
      total: formatMoney({ minor: doc.totals.total, currency }),
      balance: formatMoney({ minor: doc.totals.balance, currency }),
      amountPaid: formatMoney({ minor: doc.totals.paid, currency }),
      poNumber: doc.poNumber,
      reference: doc.reference,
      notes: doc.notes,
      termsText: doc.termsText,
      daysOverdue: doc.dueDate ? daysOverdue(doc.dueDate, today) : 0,
      paymentLink: profile?.paymentDetails.paymentLink ?? '',
    },
    sender: { name: profile?.contactName ?? '', email: profile?.email ?? '', phone: profile?.phone ?? '' },
    today: formatDate(today, dateFormat),
    todayLong: formatDate(today, dateFormat),
  });
}

/** The minimum shape the merge builder needs. */
export type DocumentLike = Pick<
  Document,
  | 'profileId'
  | 'clientId'
  | 'currency'
  | 'number'
  | 'draftNumber'
  | 'type'
  | 'issueDate'
  | 'dueDate'
  | 'termsId'
  | 'totals'
  | 'poNumber'
  | 'reference'
  | 'notes'
  | 'termsText'
> & { taxSnapshot: { heading: string } | null };

function formatPaymentDetailLines(profile: { paymentDetails?: PaymentDetails } | undefined): string[] {
  const p = profile?.paymentDetails;
  if (!p) return [];
  const lines: string[] = [];
  if (p.accountName) lines.push(`Account name: ${p.accountName}`);
  if (p.bsb && p.accountNumber) lines.push(`BSB ${p.bsb} · Account ${p.accountNumber}`);
  if (p.payId) lines.push(`PayID: ${p.payId}`);
  if (p.bpayBillerCode)
    lines.push(
      `BPAY Biller code ${p.bpayBillerCode}${p.bpayReference ? ` · Reference ${p.bpayReference}` : ''}`,
    );
  if (p.other) lines.push(p.other);
  return lines;
}
