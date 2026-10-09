/**
 * Bulk actions on the documents list.
 *
 * "Finalise, email, export, mark paid, or re-file many documents at once" is what
 * the plan asks for, and the button bar existed with nothing behind it.
 *
 * Two rules shape this file:
 *
 *   1. **One finalise path.** Bulk finalise calls `finaliseDocument`, the same
 *      function the editor's submit dialog calls, so a document finalised in a
 *      batch is byte-for-byte the same kind of document as one finalised alone.
 *
 *   2. **Every run reports what it skipped and why.** Twenty drafts selected and
 *      eighteen finalised, with two named and the reason given, is a result. Two
 *      silently skipped is a bug the user has to notice themselves.
 *
 * Sequential on purpose: number reservation is transactional per document, and
 * firing twenty at once would make the reserved order arbitrary. One at a time also
 * means a failure half way through leaves the first half done rather than nothing.
 */

import type { BusinessProfile, Client, Document, Settings } from '@/core/schemas';
import type { TaxCode } from '@/core/tax/tax';
import { calculate } from '@/core/calc/calculate';
import { files, storage } from '@/adapters';
import { newEntity } from '@/core/schemas/common';
import { deriveDocumentStatus } from '@/core/documents';
import { finaliseDocument } from '@/lib/finalise';
import { renderDocumentPdf } from '@/renderer/pdf';
import { buildDocumentModel } from '@/renderer/model';
import { paymentQrSrc } from '@/renderer/qr';

export interface BulkOutcome {
  /** What was acted on. */
  done: number;
  /** What was not, and why. */
  skipped: { document: Document; reason: string }[];
  /** A human summary, suitable for a toast. */
  summary: string;
  /** Errors that are not about a particular document. */
  errors: string[];
}

export interface BulkContext {
  settings: Settings;
  profiles: BusinessProfile[];
  clients: Client[];
  taxCodes: TaxCode[];
  templates: import('@/core/schemas').DesignTemplate[];
}

/**
 * Finalise a set of drafts.
 *
 * Each document is loaded with its lines and payments first, because the calculation
 * and the tax snapshot both need them and the list only has the headers.
 */
export async function bulkFinalise(documents: Document[], ctx: BulkContext): Promise<BulkOutcome> {
  const db = storage();
  const outcome: BulkOutcome = { done: 0, skipped: [], summary: '', errors: [] };

  for (const document of documents) {
    if (document.status !== 'draft') {
      outcome.skipped.push({ document, reason: `already ${document.status}` });
      continue;
    }

    const profile = ctx.profiles.find((p) => p.id === document.profileId);
    if (!profile) {
      outcome.skipped.push({ document, reason: 'its business no longer exists' });
      continue;
    }

    try {
      const bundle = await db.getDocumentBundle(document.id);
      if (!bundle) {
        outcome.skipped.push({ document, reason: 'it has no lines' });
        continue;
      }

      const client = ctx.clients.find((c) => c.id === document.clientId) ?? null;
      const result = calculate({
        document: bundle.document,
        lines: bundle.lines,
        payments: bundle.payments,
        taxCodes: ctx.taxCodes,
      });

      await finaliseDocument({
        document: bundle.document,
        lines: bundle.lines,
        payments: bundle.payments,
        result,
        profile,
        client,
        taxCodes: ctx.taxCodes,
        template: ctx.templates.find((t) => t.id === document.designTemplateId) ?? null,
        settings: ctx.settings,
      });

      outcome.done += 1;
    } catch (error) {
      outcome.errors.push(
        `${document.number || document.draftNumber || document.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  outcome.summary = `${outcome.done} finalised, ${outcome.skipped.length} skipped`;
  return outcome;
}

/**
 * Mark documents paid without inventing a payment.
 *
 * This sets the status and clears the balance, and writes an audit entry saying it
 * was done by hand. It deliberately does *not* create a payment row: the date and
 * method of money that arrived are facts only the user knows, and inventing a
 * payment with today's date would put a false entry in the audit trail and in the
 * client's payment history. Recording a real payment is one click per document, in
 * the editor.
 */
export async function bulkMarkPaid(documents: Document[], today: string): Promise<BulkOutcome> {
  const db = storage();
  const outcome: BulkOutcome = { done: 0, skipped: [], summary: '', errors: [] };

  for (const document of documents) {
    if (document.status === 'void' || document.status === 'draft') {
      outcome.skipped.push({ document, reason: document.status === 'draft' ? 'still a draft' : 'void' });
      continue;
    }
    if (document.totals.balance <= 0) {
      outcome.skipped.push({ document, reason: 'nothing outstanding' });
      continue;
    }

    try {
      // The same derivation a real payment uses, so a manual mark and a recorded
      // payment cannot leave the same invoice in two different states.
      const marked: Document = {
        ...document,
        status: deriveDocumentStatus({ document, balance: 0, today }),
        totals: { ...document.totals, balance: 0 },
      };
      await db.saveDocument(marked);
      await db.saveAuditLog(
        newEntity({
          entity: 'document',
          entityId: document.id,
          action: 'mark_paid',
          summary: `Marked ${document.number || 'document'} paid by hand`,
          actor: 'user',
          note: `No payment recorded; marked paid on ${today} from the documents list.`,
        }),
      );
      outcome.done += 1;
    } catch (error) {
      outcome.errors.push(
        `${document.number || document.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  outcome.summary = `${outcome.done} marked paid, ${outcome.skipped.length} skipped`;
  return outcome;
}

/** Void a set of documents, keeping them for the audit trail. */
export async function bulkVoid(documents: Document[], reason: string, now: string): Promise<BulkOutcome> {
  const db = storage();
  const outcome: BulkOutcome = { done: 0, skipped: [], summary: '', errors: [] };

  for (const document of documents) {
    if (document.status === 'void') {
      outcome.skipped.push({ document, reason: 'already void' });
      continue;
    }

    try {
      await db.saveDocument({
        ...document,
        status: 'void',
        voidedAt: now,
        voidReason: reason,
      });
      await db.saveAuditLog(
        newEntity({
          entity: 'document',
          entityId: document.id,
          action: 'void',
          summary: `Voided ${document.number || 'document'}`,
          actor: 'user',
          note: reason,
        }),
      );
      outcome.done += 1;
    } catch (error) {
      outcome.errors.push(
        `${document.number || document.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  outcome.summary = `${outcome.done} voided, ${outcome.skipped.length} skipped`;
  return outcome;
}

/**
 * Re-file the PDFs of documents already on disk.
 *
 * The plan lists this because a payment or a void changes what should print without
 * changing the document. Only documents that already have a filed path can be
 * rewritten — a document whose PDF was never written has nothing to update.
 */
export async function bulkRefile(documents: Document[], ctx: BulkContext): Promise<BulkOutcome> {
  const db = storage();
  const outcome: BulkOutcome = { done: 0, skipped: [], summary: '', errors: [] };

  for (const document of documents) {
    if (!document.lastPdfPath) {
      outcome.skipped.push({ document, reason: 'no PDF has been written for it yet' });
      continue;
    }
    if (document.status === 'draft') {
      outcome.skipped.push({ document, reason: 'still a draft' });
      continue;
    }

    try {
      const bundle = await db.getDocumentBundle(document.id);
      const profile = ctx.profiles.find((p) => p.id === document.profileId);
      if (!bundle || !profile) {
        outcome.skipped.push({ document, reason: 'could not be read back' });
        continue;
      }

      const client = ctx.clients.find((c) => c.id === document.clientId) ?? null;
      const result = calculate({
        document: bundle.document,
        lines: bundle.lines,
        payments: bundle.payments,
        taxCodes: ctx.taxCodes,
      });

      const model = buildDocumentModel({
        qrSrc: await paymentQrSrc(
          profile?.paymentDetails ?? null,
          document.number || document.draftNumber || document.id,
        ),
        document: bundle.document,
        lines: bundle.lines,
        payments: bundle.payments,
        result,
        profile,
        client,
        template: ctx.templates.find((t) => t.id === document.designTemplateId) ?? null,
        taxCodes: ctx.taxCodes,
      });
      const blob = await renderDocumentPdf(model);

      await files().writeFile(document.lastPdfPath, blob, { confirmOverwrite: false });
      outcome.done += 1;
    } catch (error) {
      outcome.errors.push(
        `${document.number || document.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  outcome.summary = `${outcome.done} PDFs rewritten, ${outcome.skipped.length} skipped`;
  return outcome;
}
