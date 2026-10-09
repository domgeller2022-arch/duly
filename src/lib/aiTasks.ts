/**
 * The first-wave AI tasks.
 *
 * The plan's item 3: natural-language invoice entry, receipt capture (vision),
 * reminder and email drafting, ask-your-data. Each task is a prompt template,
 * a Zod schema and a model picker — the pipeline in `ai.ts` does the rest.
 *
 * None of these tasks submits, sends or records anything: they produce
 * values the review UI shows, and the user accepts, edits or discards.
 */

import { z } from 'zod';
import type { Settings } from '@/core/schemas';
import { AiTask } from '@/lib/ai';

export const invoiceEntrySchema = z.object({
  clientName: z.string().min(1),
  lines: z
    .array(
      z.object({
        description: z.string().min(1),
        quantity: z.string().default('1'),
        unit: z.string().default('each'),
        unitPriceDollars: z.number().default(0),
      }),
    )
    .min(1),
  dueDays: z.number().int().nullable().default(null),
  notes: z.string().default(''),
});
export type InvoiceEntryResult = z.infer<typeof invoiceEntrySchema>;

export const receiptScanSchema = z.object({
  supplier: z.string().default(''),
  date: z.string().default(''),
  amountDollars: z.number().default(0),
  gstDollars: z.number().default(0),
  category: z.string().default('Other'),
  description: z.string().default(''),
});
export type ReceiptScanResult = z.infer<typeof receiptScanSchema>;

export const emailDraftSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});
export type EmailDraftResult = z.infer<typeof emailDraftSchema>;

export const askDataSchema = z.object({
  answer: z.string().min(1),
});
export type AskDataResult = z.infer<typeof askDataSchema>;

const textModel = (settings: Settings) => settings.aiTextModel;
const visionModel = (settings: Settings) => settings.aiVisionModel || settings.aiTextModel;

/** "Bill Acme 3 days consulting at $1,200/day" → a draft's shape. */
export const invoiceEntryTask: AiTask<InvoiceEntryResult> = {
  feature: 'invoice entry',
  system:
    'You turn a natural-language billing instruction into invoice lines. ' +
    'Reply with JSON only, shaped as: {"clientName": string, "lines": [{"description": string, "quantity": string, "unit": string, "unitPriceDollars": number}], "dueDays": number | null, "notes": string}. ' +
    '"3 days consulting at $1,200/day" is quantity "3", unit "days", unitPriceDollars 1200. ' +
    'A bare price with no unit is quantity "1", unit "each". Never invent an amount that was not stated.',
  schema: invoiceEntrySchema,
  prompt: (args) => String(args.instruction ?? ''),
  model: textModel,
};

/** A receipt photo → supplier, date, amount, GST, category. */
export const receiptScanTask: AiTask<ReceiptScanResult> = {
  feature: 'receipt scan',
  system:
    'You read a receipt photo and return its fields. ' +
    'Reply with JSON only, shaped as: {"supplier": string, "date": "YYYY-MM-DD", "amountDollars": number, "gstDollars": number, "category": string, "description": string}. ' +
    'GST is the tax line on the receipt, not the total. Amount is the total paid.',
  schema: receiptScanSchema,
  prompt: (args) => String(args.hint ?? 'Read this receipt.'),
  images: (args) => (args.images as string[]) ?? [],
  model: visionModel,
};

/** Reminder and email drafting. */
export const emailDraftTask: AiTask<EmailDraftResult> = {
  feature: 'email draft',
  system:
    'You draft a short, plain email for an invoice. ' +
    'Reply with JSON only, shaped as: {"subject": string, "body": string}. ' +
    'The body is a few sentences: what is attached, when payment is due, a thank you. No placeholders in braces — write the actual values in.',
  schema: emailDraftSchema,
  prompt: (args) => String(args.context ?? ''),
  model: textModel,
};

/** Ask-your-data with read-only report context. */
export const askDataTask: AiTask<AskDataResult> = {
  feature: 'ask your data',
  system:
    "You answer a question about the user's invoicing data, using ONLY the context provided. " +
    'Reply with JSON only, shaped as: {"answer": string}. The answer is one short paragraph of plain text.',
  schema: askDataSchema,
  prompt: (args) => `Context:\n${String(args.context ?? '')}\n\nQuestion: ${String(args.question ?? '')}`,
  model: textModel,
};
