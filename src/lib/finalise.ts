/**
 * Finalising a document.
 *
 * One function, used by the editor's submit dialog and by the documents list's bulk
 * action. That sharing is the point: finalising reserves a number, freezes a tax
 * snapshot and writes a PDF, and a bulk path that did any of those differently from
 * the single path would be a way to issue a document that behaves differently
 * depending on whether one person or twenty were doing it.
 *
 * Order matters and is deliberate:
 *
 *   1. reserve the number — inside a transaction, never reused
 *   2. freeze the tax snapshot — what was charged cannot change afterwards
 *   3. save — the number is spent, so the document must carry it
 *   4. write the PDF — best effort; a missing file can be rewritten, a missing
 *      number cannot be reissued
 */

import type { BusinessProfile, Client, Document, DocumentLine, Payment, Settings } from '@/core/schemas';
import type { TaxCode } from '@/core/tax/tax';
import type { CalculationResult } from '@/core/calc/calculate';
import { storage, platform } from '@/adapters';
import { buildTaxSnapshot } from '@/core/validation/taxSnapshot';
import { financialYearKey, formatDateForFilename } from '@/core/validation/dates';
import { buildOutputPath, money } from '@/ui/lib/format';
import { newEntity } from '@/core/schemas/common';
import { syncDocumentToDrive } from '@/lib/cloudSync';
import { DEFAULT_PATTERNS } from '@/core/schemas/automation';
import { renderDocumentPdf } from '@/renderer/pdf';
import { buildDocumentModel } from '@/renderer/model';
import { paymentQrSrc } from '@/renderer/qr';
import type { DesignTemplate } from '@/core/schemas';

export interface FinaliseInput {
  document: Document;
  lines: DocumentLine[];
  payments: Payment[];
  result: CalculationResult;
  profile: BusinessProfile;
  client: Client | null;
  taxCodes: TaxCode[];
  template: DesignTemplate | null;
  settings: Settings;
  /** Overrides the default pattern, for a business that has changed its sequence. */
  pattern?: string;
  /** Skip the PDF, for a bulk run that writes files itself. */
  writePdf?: boolean;
}

export interface FinaliseResult {
  document: Document;
  number: string;
  /** Where the PDF landed, or null when none was written. */
  pdfPath: string | null;
  /** Set when the document was finalised but the PDF could not be written. */
  pdfError: string | null;
}

/** The number pattern a document type uses. */
export function patternFor(type: string, configured?: string): string {
  return configured ?? DEFAULT_PATTERNS[type] ?? 'INV-{YYYY}-{####}';
}

/**
 * The client code `{CLIENT}` resolves to: the first eight characters of the name,
 * with anything that is not a letter or digit removed.
 */
export function clientCodeFor(client: Client | null): string | undefined {
  return client?.displayName.slice(0, 8).replace(/\W/g, '') || undefined;
}

export async function finaliseDocument(input: FinaliseInput): Promise<FinaliseResult> {
  const { document, lines, payments, result, profile, client, taxCodes, template, settings } = input;
  const db = storage();
  const now = new Date().toISOString();
  const pattern = patternFor(document.type, input.pattern);
  const clientCode = clientCodeFor(client);

  // 1. Reserve the number. Once reserved, never reused — so a failure after this
  //    point costs a gap in the sequence, never a duplicate.
  const reserved = await db.reserveDocumentNumber({
    profileId: document.profileId,
    documentType: document.type,
    date: document.issueDate,
    pattern,
    clientCode,
    profileCode: profile.code,
  });

  // 2. Freeze the tax snapshot. `buildTaxSnapshot` applies the ATO's narrow
  //    allowance for "Total price includes GST" — only when the rate is exactly one
  //    eleventh — rather than assuming any inclusive document may use it.
  const snapshot = buildTaxSnapshot({
    document,
    gstRegistered: profile.gstRegistered,
    result,
    taxCodes,
    now,
    financialYearStartMonth: settings.financialYearStartMonth,
  });

  const finalised: Document = {
    ...document,
    number: reserved.number,
    numberAssignedAt: now,
    status: 'finalised',
    finalisedAt: now,
    taxSnapshot: snapshot,
  };

  // 3. Save, carrying the number.
  await db.saveDocument(finalised, lines);

  // 4. Write the PDF, and sync it to the cloud when configured.
  //    A failure at either does not undo the finalisation.
  let pdfPath: string | null = null;
  let pdfError: string | null = null;

  if (input.writePdf !== false && (settings.autoFileOnSubmit && settings.outputFolderName)) {
    try {
      const model = buildDocumentModel({
        qrSrc: await paymentQrSrc(
          profile?.paymentDetails ?? null,
          finalised.number || finalised.draftNumber || finalised.id,
        ),
        document: finalised,
        lines,
        payments,
        result,
        profile,
        client,
        template,
        taxCodes,
      });
      const blob = await renderDocumentPdf(model);
      pdfPath = await platform().files.writeFile(
        outputPathFor(settings, finalised, client, reserved.number, profile),
        blob,
        { confirmOverwrite: false },
      );
    } catch (error) {
      pdfError =
        error instanceof Error
          ? `The document was finalised, but the PDF could not be written: ${error.message}. You can export it from the list.`
          : 'The document was finalised, but the PDF could not be written. You can export it from the list.';
    }

    await db.saveDocument({ ...finalised, lastPdfPath: pdfPath }, lines);
  }

  // 4b. Cloud sync: the same document uploaded to the user's Google Drive, so
  //     the invoices do not live on one device alone. A failure here never
  //     blocks the submit; the automation log records what happened.
  const cloudFileName = outputPathFor(settings, finalised, client, reserved.number, profile);
  if (input.writePdf !== false && settings.cloudSyncOnSubmit && settings.cloudClientId) {
    try {
      const model = buildDocumentModel({
        qrSrc: await paymentQrSrc(
          profile?.paymentDetails ?? null,
          finalised.number || finalised.draftNumber || finalised.id,
        ),
        document: finalised,
        lines,
        payments,
        result,
        profile,
        client,
        template,
        taxCodes,
      });
      const blob = await renderDocumentPdf(model);
      const sync = await syncDocumentToDrive(cloudFileName, blob, {
        clientId: settings.cloudClientId,
        folderName: settings.cloudFolderName || 'Duly',
      });
      await db.saveAutomationLog(
        newEntity({
          category: sync.ok ? 'backup' : 'system',
          message: sync.ok
            ? `Uploaded ${finalised.number || finalised.id} to Google Drive.`
            : `Google Drive sync failed for ${finalised.number || finalised.id}.`,
          documentId: finalised.id,
          profileId: finalised.profileId,
          entity: 'document',
          entityId: finalised.id,
          needsAttention: !sync.ok,
          detail: sync.detail,
          ranAt: new Date().toISOString(),
        }),
      );
    } catch (error) {
      await db.saveAutomationLog(
        newEntity({
          category: 'system',
          message: `Google Drive sync failed for ${finalised.number || finalised.id}.`,
          documentId: finalised.id,
          profileId: finalised.profileId,
          entity: 'document',
          entityId: finalised.id,
          needsAttention: true,
          detail: error instanceof Error ? error.message : '',
          ranAt: new Date().toISOString(),
        }),
      );
    }
  }

  // 5. An issued credit note takes money back off the invoice it credits.
  //
  //    Rule 9 of the calculation rules: "credit notes carry negative totals and
  //    reduce the linked invoice's balance". The link was written but never read, so
  //    a credit note existed without the client ever getting the benefit of it. Done
  //    here, in the one place every finalisation passes through, so a credit note
  //    cannot be issued without also updating its invoice.
  if (document.type === 'credit_note') {
    await applyCreditToLinkedInvoices(input);
  }

  // 6. The audit trail, because a document that changed state should say so.
  await db.saveAuditLog(
    newEntity({
      entity: 'document',
      entityId: finalised.id,
      action: 'finalise',
      summary: `Submitted ${reserved.number} for ${client?.displayName ?? 'no client'}, ${money(result.total, finalised.currency)}`,
      actor: 'user',
      before: `draft ${document.draftNumber}`,
      after: `final ${reserved.number}`,
    }),
  );

  return { document: { ...finalised, lastPdfPath: pdfPath }, number: reserved.number, pdfPath, pdfError };
}

/**
 * Write an already-finalised document's PDF again.
 *
 * Used when a payment lands and the PAID stamp is on, and when a void happens —
 * both of which change what should print without changing the document itself.
 */
export async function refileDocument(input: {
  document: Document;
  lines: DocumentLine[];
  payments: Payment[];
  result: CalculationResult;
  profile: BusinessProfile;
  client: Client | null;
  taxCodes: TaxCode[];
  template: DesignTemplate | null;
  settings: Settings;
}): Promise<string | null> {
  const model = buildDocumentModel({
    document: input.document,
    lines: input.lines,
    payments: input.payments,
    result: input.result,
    profile: input.profile,
    client: input.client,
    template: input.template,
    taxCodes: input.taxCodes,
  });
  const blob = await renderDocumentPdf(model);
  return platform().files.writeFile(
    outputPathFor(input.settings, input.document, input.client, input.document.number, input.profile),
    blob,
    { confirmOverwrite: false },
  );
}

/** The relative path a document's PDF is filed at. */
export function outputPathFor(
  settings: Settings,
  document: Pick<Document, 'type' | 'issueDate' | 'dueDate' | 'currency'>,
  client: Client | null,
  number: string,
  profile: BusinessProfile,
): string {
  return buildOutputPath({
    fileNamePattern: settings.fileNamePattern,
    number,
    client: client?.displayName ?? '',
    date: document.issueDate,
    yearFolderMode: settings.yearFolderMode,
    businessSubFolder: settings.useBusinessSubFolder ? profile.outputSubFolder : '',
    financialYear: financialYearKey(document.issueDate, settings.financialYearStartMonth),
    documentType: document.type,
    dueDate: document.dueDate ? formatDateForFilename(document.dueDate) : '',
    currency: document.currency,
  });
}

/**
 * Reduce the invoices a newly issued credit note points at.
 *
 * The invoice's cached totals are recomputed from its own lines and payments minus
 * whatever credit notes have been issued against it, so the two can never drift: the
 * figure on the invoice is the figure the client is asked for.
 */
export async function applyCreditToLinkedInvoices(input: FinaliseInput): Promise<string[]> {
  const document = input.document;
  const links = document.linkedDocumentIds;
  if (links.length === 0) return [];

  const db = storage();
  const touched: string[] = [];

  for (const invoiceId of links) {
    const bundle = await db.getDocumentBundle(invoiceId);
    if (!bundle || bundle.document.type === 'credit_note') continue;

    // Void credit notes are not money back; they were never money back.
    const siblings = await db.listDocuments({ type: 'credit_note' });
    const credit = siblings
      .filter(
        (note) =>
          note.linkedDocumentIds.includes(invoiceId) &&
          note.status !== 'void' &&
          note.status !== 'draft' &&
          note.id !== document.id,
      )
      .reduce((sum, note) => sum + Math.abs(note.totals.total), 0);

    if (credit === 0) continue;

    const nextBalance = Math.max(0, bundle.document.totals.total - bundle.document.totals.paid - credit);

    const updated: Document = {
      ...bundle.document,
      totals: { ...bundle.document.totals, balance: nextBalance },
    };
    await db.saveDocument(updated, bundle.lines);
    touched.push(invoiceId);
  }

  return touched;
}
