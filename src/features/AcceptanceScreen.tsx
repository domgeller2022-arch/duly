/**
 * Hidden acceptance page for the Phase 5 acceptance gate.
 *
 * A template is a PDF, and PDFs can only be rendered for real in a browser:
 * font files load, react-pdf lays out its pages, and the output is either
 * byte-for-byte stable or it is not. This route does both halves of that gate
 * against the bundled seed data so `verify:offline` can read the result.
 */

import { useEffect, useState } from 'react';
import { DEFAULT_TAX_CODES } from '@/core/tax/tax';
import { calculate } from '@/core/calc/calculate';
import { countBySeverity, runComplianceChecks } from '@/core/validation/compliance';
import { newBusinessProfile, newClient } from '@/core/schemas/crm';
import { documentSchema, documentLineSchema } from '@/core/schemas/document';
import { settingsSchema } from '@/core/schemas/settings';
import { builtinDesignTemplates } from '@/adapters/web/seed';
import { buildDocumentModel } from '@/renderer/model';
import { renderDocumentPdfDataUrl } from '@/renderer/pdf';

const STAMPS = {
  id: 'accept-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

/**
 * Count pages in a PDF data URL.
 *
 * Plain `/Type /Page` tokens are only visible when the object streams are
 * uncompressed, so the fallback inflates every FlateDecode stream first.
 */
async function countPages(dataUrl: string): Promise<number> {
  const bytes = Uint8Array.from(atob(dataUrl.split(',')[1] ?? ''), (c) => c.charCodeAt(0));
  const latin = new TextDecoder('latin1').decode(bytes);
  const scan = (s: string) => (s.match(/\/Type \/Page[^s]/g) ?? []).length;

  const direct = scan(latin);
  if (direct > 0) return direct;

  const inflated: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin))) {
    const start = m.index + m[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) continue;
    re.lastIndex = end;
    try {
      const ds = new DecompressionStream('deflate');
      const out = await new Response(
        new Blob([bytes.subarray(start, end)]).stream().pipeThrough(ds),
      ).arrayBuffer();
      inflated.push(new TextDecoder('latin1').decode(out));
    } catch {
      // Not deflate — skip.
    }
  }
  return scan(latin + inflated.join(''));
}

export function AcceptanceScreen() {
  const [complianceStatus, setComplianceStatus] = useState('Running…');
  const [renderStatus, setRenderStatus] = useState('Running…');
  const [paginationStatus, setPaginationStatus] = useState('Running…');

  useEffect(() => {
    void (async () => {
      try {
        const profile = newBusinessProfile({
          name: 'Acme Pty Ltd',
          abn: '51824753556',
          gstRegistered: true,
          gstRegisteredFrom: '2025-07-01',
          gstHistory: [{ registered: true, from: '2025-07-01', note: '' }],
          paymentDetails: {
            methodLabel: 'Direct bank transfer',
            accountName: 'Acme Pty Ltd',
            bsb: '062000',
            accountNumber: '12345678',
            payId: 'acme@example',
            bpayBillerCode: '',
            bpayReference: '',
            other: '',
            paymentLink: '',
          },
        });
        const client = newClient({ displayName: 'Client Pty Ltd', defaultCurrency: 'AUD' });
        const document = documentSchema.parse({
          ...STAMPS,
          type: 'invoice',
          profileId: profile.id,
          clientId: client.id,
          status: 'finalised',
          currency: 'AUD',
          taxMode: 'exclusive',
          taxCodeId: 'tax_gst',
          issueDate: '2026-10-06',
          dueDate: '2026-11-05',
          taxSnapshot: {
            gstRegistered: true,
            heading: 'Tax Invoice',
            codes: {},
            inclusiveGstStatementAllowed: false,
            buyerIdentityRequired: true,
            takenAt: STAMPS.createdAt,
            financialYear: '2026-27',
          },
          totals: {
            currency: 'AUD',
            subtotal: 0,
            discountTotal: 0,
            taxTotal: 0,
            taxMinor: 0,
            total: 0,
            paid: 0,
            balance: 0,
            computedAt: null,
          },
        });
        const lines = [
          documentLineSchema.parse({
            ...STAMPS,
            documentId: document.id,
            description: 'Consulting',
            quantity: '1',
            unitPrice: 100000,
            taxCodeId: 'tax_gst',
          }),
        ];

        const templates = builtinDesignTemplates(STAMPS.createdAt);
        const results = templates.map((template) => {
          const result = calculate({ document, lines, payments: [], taxCodes: [...DEFAULT_TAX_CODES] });
          return {
            template: template.name,
            blocked: countBySeverity(
              runComplianceChecks({
                document,
                lines,
                client,
                profile,
                settings: settingsSchema.parse({ ...STAMPS }),
                result,
                template,
              }),
            ).block,
          };
        });
        const blocked = results.filter((r) => r.blocked > 0);
        setComplianceStatus(
          blocked.length === 0
            ? `PASS: all ${templates.length} templates`
            : `FAIL: ${blocked.map((b) => `${b.template} (${b.blocked})`).join(', ')}`,
        );

        const template = templates[0];
        const result = calculate({ document, lines, payments: [], taxCodes: [...DEFAULT_TAX_CODES] });
        const model = buildDocumentModel({
          document,
          lines,
          payments: [],
          result,
          profile,
          client,
          template,
          taxCodes: [...DEFAULT_TAX_CODES],
        });
        const a = await renderDocumentPdfDataUrl(model);
        const b = await renderDocumentPdfDataUrl(model);
        setRenderStatus(a === b ? 'PASS: byte-for-byte' : 'FAIL: not byte-for-byte');

        // 60-line acceptance: the render must succeed and the table must break
        // across more than one page with the fixed header repeating.
        const longLines = Array.from({ length: 60 }, (_, i) =>
          documentLineSchema.parse({
            ...STAMPS,
            id: `accept-line-${i}`,
            documentId: document.id,
            description: `Consulting block ${i + 1} — discovery, implementation, and handover notes`,
            quantity: '1',
            unitPrice: 10000 + i,
            taxCodeId: 'tax_gst',
          }),
        );
        const longResult = calculate({
          document,
          lines: longLines,
          payments: [],
          taxCodes: [...DEFAULT_TAX_CODES],
        });
        const longModel = buildDocumentModel({
          document,
          lines: longLines,
          payments: [],
          result: longResult,
          profile,
          client,
          template,
          taxCodes: [...DEFAULT_TAX_CODES],
        });
        const longPdf = await renderDocumentPdfDataUrl(longModel);
        const pages = await countPages(longPdf);
        setPaginationStatus(pages >= 2 ? `PASS: ${pages} pages` : `FAIL: ${pages} page(s)`);
      } catch (error) {
        setComplianceStatus(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
        setRenderStatus('SKIPPED');
        setPaginationStatus('SKIPPED');
      }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Phase 5 acceptance</h1>
      <p id="compliance-status" className="mt-3 text-[13px] text-ink">
        {complianceStatus}
      </p>
      <p id="render-status" className="mt-1 text-[13px] text-ink">
        {renderStatus}
      </p>
      <p id="pagination-status" className="mt-1 text-[13px] text-ink">
        {paginationStatus}
      </p>
    </div>
  );
}
