/**
 * Australian compliance checks — the pre-finalise panel.
 *
 * The ATO requires specific details on a tax invoice. An invoice under $1,000
 * must show seven things; $1,000 and above must additionally identify the buyer.
 * Digital invoices, including PDFs, are valid when they contain the required
 * information, so PDF is Duly's primary output for a reason.
 *
 * These are checks, not tax advice. The user or their accountant remains
 * responsible for the treatment. Every result says which rule it came from so
 * the reasoning is visible rather than a bare red cross.
 */

import type { BusinessProfile, Client } from '../schemas/crm';
import type { Document, DocumentLine } from '../schemas/document';
import type { Settings } from '../schemas/settings';
import type { CalculationResult } from '../calc/calculate';
import { INCLUSIVE_GST_STATEMENT, NO_GST_STATEMENT, canUseInclusiveGstStatement } from '../tax/tax';
import { formatMoney } from '../money/money';
import { currencyDecimals } from '../money/currencies';
import type { DesignTemplate } from '../schemas/template';
import { formatAbn, isValidAbn } from './abn';

export type ComplianceSeverity = 'block' | 'warn' | 'info';

export interface ComplianceCheck {
  id: string;
  severity: ComplianceSeverity;
  title: string;
  detail: string;
  /** The ATO rule this comes from, for the "why" tooltip. */
  rule: string;
  /** What the user can do about it. */
  remedy?: string;
}

/**
 * The ATO threshold: a tax invoice at or above this amount must identify the buyer.
 *
 * Stated in major units and converted per document, because the rule is "a thousand
 * dollars" and a thousand yen is a different amount from a thousand dollars. Comparing
 * a raw minor-unit count against a single constant made the threshold ¥100,000 for a
 * zero-decimal currency and 100.000 for a three-decimal one.
 */
export const BUYER_IDENTITY_THRESHOLD_MAJOR = 1000;

/** The same threshold in minor units, for a given currency. */
export function buyerIdentityThreshold(currency: string): number {
  return Math.round(BUYER_IDENTITY_THRESHOLD_MAJOR * Math.pow(10, currencyDecimals(currency)));
}

export interface ComplianceInput {
  document: Document;
  lines: DocumentLine[];
  client: Client | null;
  profile: BusinessProfile;
  settings: Settings;
  result: CalculationResult;
  /**
   * The template the document will print on. Only used for the "is this printed?"
   * half of the zero-rated marker rule: without it the check nags every mixed invoice
   * even when the template already prints the key beside each zero-rated line.
   */
  template?: DesignTemplate;
}

/**
 * Run every check and return the results, worst first.
 *
 * `block` means the document would not be a valid tax invoice as drafted.
 * `warn` means it is probably wrong but the ATO rule is not absolute.
 * `info` is context worth surfacing before sending.
 */
export function runComplianceChecks(input: ComplianceInput): ComplianceCheck[] {
  const { document, lines, client, profile, settings, result, template } = input;
  const checks: ComplianceCheck[] = [];

  const gstRegistered = document.taxSnapshot?.gstRegistered ?? profile.gstRegistered;
  const heading = document.taxSnapshot?.heading ?? 'Invoice';
  const isTaxDocument =
    document.type === 'invoice' || document.type === 'credit_note' || document.type === 'proforma';
  const valued = lines.filter(
    (l) => !l.deletedAt && l.type !== 'section' && l.type !== 'note' && l.type !== 'discount',
  );

  /* ---- 1. It must actually be a tax invoice ---- */

  if (gstRegistered && isTaxDocument && heading !== 'Tax Invoice' && heading !== 'Tax Credit Note') {
    checks.push({
      id: 'heading',
      severity: 'block',
      title: 'Heading must say "Tax Invoice"',
      detail: `This business is registered for GST, so the document is titled "${heading}".`,
      rule: 'A tax invoice must show that it is a tax invoice.',
      remedy: 'Submit again, or fix the business GST setting if it is wrong.',
    });
  }

  /* ---- 2. Seller identity and ABN ---- */

  if (isTaxDocument) {
    if (!profile.name.trim()) {
      checks.push({
        id: 'seller-name',
        severity: 'block',
        title: 'Business name is missing',
        detail: 'A tax invoice must show the seller’s identity.',
        rule: 'Required on every tax invoice.',
        remedy: 'Add your business name in Settings → Profiles.',
      });
    }

    const abnPresent = profile.abn.replace(/\D/g, '').length > 0;
    const abnValid = isValidAbn(profile.abn);

    if (!abnPresent && gstRegistered) {
      checks.push({
        id: 'seller-abn-missing',
        severity: 'block',
        title: 'ABN is missing',
        detail: 'A GST-registered tax invoice must show your ABN.',
        rule: 'Required on every tax invoice.',
        remedy: 'Add your ABN in Settings → Profiles.',
      });
    } else if (!abnValid && abnPresent) {
      checks.push({
        id: 'seller-abn-invalid',
        severity: 'block',
        title: 'ABN fails its checksum',
        detail: `The ABN "${formatAbn(profile.abn)}" is not valid, so it will not satisfy the seller-details rule.`,
        rule: 'The ABN carries a checksum; an invalid one is treated as absent.',
        remedy: 'Correct the ABN in Settings → Profiles.',
      });
    }
  }

  /* ---- 3. Issue date ---- */

  if (!document.issueDate) {
    checks.push({
      id: 'issue-date',
      severity: 'block',
      title: 'Issue date is missing',
      detail: 'A tax invoice must show the date it was issued.',
      rule: 'Required on every tax invoice.',
    });
  }

  /* ---- 4. Description, quantity and price on each sale ---- */

  const linesMissingDescription = valued.filter((l) => !l.description.trim());
  if (isTaxDocument && linesMissingDescription.length > 0) {
    checks.push({
      id: 'line-descriptions',
      severity: linesMissingDescription.length === valued.length ? 'block' : 'warn',
      title:
        linesMissingDescription.length === valued.length
          ? 'No line has a description'
          : `${linesMissingDescription.length} line(s) have no description`,
      detail: 'Each sale needs a description that lets the buyer identify what they bought.',
      rule: 'Required on every tax invoice.',
      remedy: 'Add a description to each line, or delete the empty ones.',
    });
  }

  const linesMissingPrice = valued.filter((l) => {
    const comp = result.lines.get(l.id);
    if (l.type === 'expense') return (l.amountOverride ?? 0) === 0;
    return !comp || (comp.gross === 0 && (l.unitPrice === 0 || Number(l.quantity) === 0));
  });
  if (isTaxDocument && linesMissingPrice.length > 0) {
    checks.push({
      id: 'line-prices',
      severity: 'warn',
      title: `${linesMissingPrice.length} line(s) have a zero amount`,
      detail: 'A tax invoice must show the quantity and price of each sale.',
      rule: 'Required on every tax invoice.',
      remedy: 'Give each line a price, or remove the line.',
    });
  }

  if (isTaxDocument && valued.length === 0) {
    checks.push({
      id: 'no-lines',
      severity: 'block',
      title: 'The document has no line items',
      detail: 'There is nothing on this document to invoice.',
      rule: 'A tax invoice must describe the goods or services supplied.',
    });
  }

  /* ---- 5. GST amount, or the inclusive statement ---- */

  if (gstRegistered && isTaxDocument) {
    const gst = result.gstPayable;

    if (gst !== 0) {
      // GST is itemised, which always satisfies the rule.
      const showBreakdown = result.taxGroups.some((g) => g.taxable);
      if (!showBreakdown) {
        checks.push({
          id: 'gst-not-shown',
          severity: 'block',
          title: 'GST is charged but not shown',
          detail: 'GST must appear as an amount, or the invoice must say "Total price includes GST".',
          rule: 'The GST amount, or that the total price includes GST, must be shown.',
          remedy: 'Print the GST breakdown row on the template.',
        });
      }
    } else if (result.hasAnyTaxable) {
      // Something is taxable, yet no GST was charged. That only happens when the
      // taxable code is not actually a GST rate, so the code is doing nothing.
      checks.push({
        id: 'gst-zero-without-reason',
        severity: 'warn',
        title: 'GST is $0.00 but a taxable code was used',
        detail:
          'This document has taxable lines but charged no GST. Either the taxable line should carry a GST-free, input-taxed or export code, or the GST code itself is wrong.',
        rule: 'The extent to which each sale is taxable must be shown.',
        remedy: 'Check the tax code on the taxable lines.',
      });
    }
  }

  /* ---- 5b. Where taxable and non-taxable are mixed, say which is which ---- */

  if (gstRegistered && isTaxDocument && result.hasAnyTaxable) {
    // Deliberately not inside the GST-is-zero branch above: mixing means GST is
    // charged, so a check nested there never ran in the case it exists for.
    const untaxed = result.taxGroups.filter((g) => !g.taxable);
    // Mixed sales require the marker key to be printed; otherwise the buyer cannot tell which lines are taxable.
    if (untaxed.length > 0 && settings.enforceTaxInvoiceRules && template?.extras.taxMarkerKey !== true) {
      checks.push({
        id: 'zero-rated-marker',
        severity: 'warn',
        title: 'Zero-rated lines are not marked',
        detail:
          'This document mixes taxable and non-taxable sales, so it must show which items are taxable. A marker such as * beside each zero-rated line, with a printed key, does that.',
        rule: 'Required where taxable and non-taxable items are mixed.',
        remedy: 'Turn on "Tax marker key" for this template.',
      });
    }
  }

  /* ---- 6. Buyer identity above $1,000 ---- */

  if (
    isTaxDocument &&
    settings.warnOnMissingBuyerIdentity &&
    result.total >= buyerIdentityThreshold(document.currency)
  ) {
    const nameMissing = !client?.displayName?.trim();
    const idMissing = !client?.taxId?.trim();
    const idInvalid = idMissing ? false : client?.taxIdCountry === 'AU' ? !isValidAbn(client.taxId) : false;

    if (nameMissing) {
      checks.push({
        id: 'buyer-name',
        severity: 'warn',
        title: 'Buyer identity is missing',
        detail: `This invoice is ${formatMoney({ minor: result.total, currency: document.currency })}. At $1,000 or more a tax invoice must identify the buyer.`,
        rule: 'Invoices of $1,000 or more require the buyer’s identity or ABN.',
        remedy: 'Select a client, or add the buyer’s ABN on the client.',
      });
    } else if (idMissing || idInvalid) {
      checks.push({
        id: 'buyer-abn',
        severity: 'info',
        title: 'No buyer ABN on file',
        detail: `${formatAbn(client?.taxId ?? '')}${idInvalid ? ' fails its checksum' : ''}. The buyer’s name is present, which satisfies the rule, but their ABN is useful for them.`,
        rule: 'Invoices of $1,000 or more require the buyer’s identity or ABN.',
        remedy: 'Add the buyer’s ABN on the client record.',
      });
    }
  }

  /* ---- 7. Non-GST-registered businesses ---- */

  if (!gstRegistered && isTaxDocument) {
    const noteShown = document.showNoGstNote || settings.showNoGstNoteWhenUnregistered;
    if (result.taxGroups.some((g) => g.taxable)) {
      checks.push({
        id: 'gst-on-unregistered',
        severity: 'block',
        title: 'GST is being charged but the business is not registered',
        detail: 'Either the GST switch on this business is wrong, or these lines should not be taxable.',
        rule: 'Only a GST-registered entity can charge GST.',
        remedy: 'Set the GST switch and effective date in Settings → Profiles, or change the line tax codes.',
      });
    } else if (noteShown && !document.notes.includes(NO_GST_STATEMENT) && document.notes.trim() === '') {
      checks.push({
        id: 'no-gst-note',
        severity: 'info',
        title: 'Consider printing "No GST has been charged"',
        detail: `${NO_GST_STATEMENT} makes it clear the absence of a GST line was deliberate.`,
        rule: 'Not required, but it prevents queries.',
        remedy: 'Add it to the notes, or leave the note blank to stay quiet.',
      });
    }
  }

  /* ---- 8. Payment terms and a due date ---- */

  if (isTaxDocument && !document.dueDate) {
    checks.push({
      id: 'due-date',
      severity: 'warn',
      title: 'No due date',
      detail: 'Without a due date the buyer cannot tell when payment is expected.',
      rule: 'Good practice; not a strict ATO requirement.',
      remedy: 'Set payment terms in the document header.',
    });
  }

  /* ---- 9. Rounding method transparency ---- */

  if (isTaxDocument && settings.roundingMethod === 'taxable_sale' && result.taxGroups.length > 1) {
    checks.push({
      id: 'rounding',
      severity: 'info',
      title: 'Using the taxable sale rounding rule',
      detail:
        'This document charges GST on each taxable sale separately and rounds each one. The total invoice rule is the ATO default.',
      rule: 'Both methods are permitted; the total invoice rule is the default.',
      remedy: 'Switch in Settings → Money and tax if you prefer the ATO default.',
    });
  }

  /* ---- 10. The inclusive GST statement is only legal at exactly 10% ---- */

  if (document.taxMode === 'inclusive' && result.tax !== 0) {
    const rate =
      document.taxSnapshot?.codes?.[result.taxGroups.find((g) => g.taxable)?.taxCodeId ?? 'tax_gst']?.rate ??
      '0.10';
    if (!canUseInclusiveGstStatement(rate)) {
      checks.push({
        id: 'inclusive-statement',
        severity: 'warn',
        title: 'Inclusive pricing at a rate other than 10%',
        detail: `"${INCLUSIVE_GST_STATEMENT}" is only acceptable when GST is exactly one eleventh of the total. This document uses ${rate}.`,
        rule: 'The inclusive statement is allowed only at a 10% rate.',
        remedy: 'Itemise the GST amount on the template instead.',
      });
    }
  }

  /* ---- 11. A quote that has already been converted ---- */

  if (document.type === 'quote' && document.convertedToDocumentId) {
    checks.push({
      id: 'quote-converted',
      severity: 'info',
      title: 'This quote has been converted',
      detail: 'It has already become an invoice, so sending it again would double-bill.',
      rule: 'Housekeeping.',
      remedy: 'Void it if it was a mistake.',
    });
  }

  /* ---- 12. Void and paid documents ---- */

  if (document.status === 'void') {
    checks.push({
      id: 'void',
      severity: 'warn',
      title: 'This document is void',
      detail:
        'A void document should not be sent. Re-issue it as a new document to keep an honest audit trail.',
      rule: 'Housekeeping.',
    });
  }

  const order: Record<ComplianceSeverity, number> = { block: 0, warn: 1, info: 2 };
  return checks.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function hasBlockingIssues(checks: ComplianceCheck[]): boolean {
  return checks.some((c) => c.severity === 'block');
}

export function countBySeverity(checks: ComplianceCheck[]): Record<ComplianceSeverity, number> {
  return {
    block: checks.filter((c) => c.severity === 'block').length,
    warn: checks.filter((c) => c.severity === 'warn').length,
    info: checks.filter((c) => c.severity === 'info').length,
  };
}

/** A one-line summary for the submit dialog. */
export function summarise(checks: ComplianceCheck[]): string {
  const counts = countBySeverity(checks);
  if (counts.block > 0) return `${counts.block} issue(s) must be fixed before submitting`;
  if (counts.warn > 0) return `Ready to submit, with ${counts.warn} warning(s)`;
  if (counts.info > 0) return `Ready to submit`;
  return 'All checks passed';
}
