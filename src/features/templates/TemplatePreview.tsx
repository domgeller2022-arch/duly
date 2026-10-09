/**
 * A live, narrow preview of the open template against the first stored
 * document. A template is not a document, so without a sample to render it is
 * just styling; the first stored invoice is the sample that makes colours and
 * fonts visible.
 */

import { useEffect, useState } from 'react';
import { FileWarning, Loader2 } from 'lucide-react';
import { useAppStore } from '@/state/app';
import { storage } from '@/adapters';
import { calculate } from '@/core/calc/calculate';
import { buildDocumentModel } from '@/renderer/model';
import { paymentQrSrc } from '@/renderer/qr';
import { renderDocumentPdfDataUrl } from '@/renderer/pdf';
import { EmptyState } from '@/ui/components/base';

export function TemplatePreview({ templateId }: { templateId: string | null }) {
  const documents = useAppStore((s) => s.documents);
  const profiles = useAppStore((s) => s.profiles);
  const clients = useAppStore((s) => s.clients);
  const taxCodes = useAppStore((s) => s.taxCodes);
  const designTemplates = useAppStore((s) => s.designTemplates);
  const attachments = useAppStore((s) => s.attachments);

  const [pages, setPages] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'rendering' | 'error'>('idle');

  useEffect(() => {
    void (async () => {
      setStatus('rendering');
      try {
        const source = documents.find((d) => !d.deletedAt && d.status !== 'void');
        if (!source || !templateId) return;
        const bundle = await storage().getDocumentBundle(source.id);
        if (!bundle) return;
        const profile = profiles.find((p) => p.id === bundle.document.profileId) ?? null;
        const client = clients.find((c) => c.id === bundle.document.clientId) ?? null;
        const result = calculate({
          // no qr here; computed below
          document: bundle.document,
          lines: bundle.lines,
          payments: bundle.payments,
          taxCodes,
        });
        const template = designTemplates.find((t) => t.id === templateId) ?? null;
        const model = buildDocumentModel({
          document: bundle.document,
          lines: bundle.lines,
          payments: bundle.payments,
          result,
          profile,
          client,
          template,
          taxCodes,
          attachments,
          qrSrc: await paymentQrSrc(
            profile?.paymentDetails ?? null,
            bundle.document.number || bundle.document.draftNumber || bundle.document.id,
          ),
        });
        const dataUrl = await renderDocumentPdfDataUrl(model);
        setPages([dataUrl]);
        setStatus('idle');
      } catch (error) {
        void error;
        setStatus('error');
      }
    })();
  }, [templateId, documents, profiles, clients, taxCodes, designTemplates, attachments]);

  if (!documents.some((d) => !d.deletedAt && d.status !== 'void')) {
    return (
      <EmptyState
        icon={<FileWarning className="size-7" aria-hidden />}
        title="No document to preview"
        hint="Create an invoice and the template studio will draw it here."
      />
    );
  }

  if (status === 'error') {
    return <EmptyState icon={<FileWarning className="size-7" aria-hidden />} title="Preview failed" />;
  }

  if (status === 'rendering' || pages.length === 0) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-ink-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Rendering preview…
      </div>
    );
  }

  return (
    <iframe
      src={pages[0]}
      title="Template preview"
      className="w-full rounded-[8px] border border-rule bg-white"
      style={{ height: 420 }}
    />
  );
}
