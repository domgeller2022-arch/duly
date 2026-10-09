/**
 * The live preview.
 *
 * The preview and the PDF are generated from the same view model and rendered by
 * the same renderer, so what you see is exactly what the client gets. The only
 * difference is that here the PDF is drawn into a canvas rather than a file.
 *
 * Rendering is debounced: a PDF render is not free, and typing should not queue
 * one per keystroke.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { FileWarning, Maximize2 } from 'lucide-react';
import { useEditorStore } from './editorStore';
import { useAppStore, useActiveProfile } from '@/state/app';
import { buildDocumentModel } from '@/renderer/model';
import { paymentQrSrc } from '@/renderer/qr';
import { renderDocumentPdfDataUrl } from '@/renderer/pdf';
import {
  Alert,
  Badge,
  Button,
  Chip,
  EmptyState,
  IndeterminateBar,
  Progress,
  useToast,
} from '@/ui/components/base';
import { cn } from '@/ui/lib/cn';

/** How long to wait after the last edit before re-rendering. */
const RENDER_DEBOUNCE_MS = 400;

export function DocumentPreview() {
  const { push } = useToast();
  const profile = useActiveProfile();
  const settings = useAppStore((s) => s.settings);

  const document = useEditorStore((s) => s.document);
  const lines = useEditorStore((s) => s.lines);
  const payments = useEditorStore((s) => s.payments);
  const result = useEditorStore((s) => s.result);
  const taxCodes = useEditorStore((s) => s.taxCodes);
  const client = useEditorStore((s) => s.client);
  const attachments = useAppStore((s) => s.attachments);

  const [qrSrc, setQrSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!profile?.paymentDetails || !document) {
      setQrSrc(null);
      return;
    }
    void paymentQrSrc(profile.paymentDetails, document.number || document.draftNumber || document.id).then(
      (src) => {
        if (!cancelled) setQrSrc(src);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [profile?.paymentDetails, document]);

  const dirty = useEditorStore((s) => s.dirty);

  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'idle' | 'rendering' | 'ready' | 'error'>('idle');
  const [pages, setPages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);

  /** The model both the preview and the export read. */
  const model = useMemo(() => {
    if (!document || !result) return null;
    return buildDocumentModel({
      document,
      lines,
      payments,
      result,
      profile,
      client,
      template:
        useAppStore.getState().designTemplates.find((t) => t.id === document.designTemplateId) ?? null,
      taxCodes,
      attachments,
      qrSrc,
      dateFormat: settings?.dateFormat,
    });
  }, [
    document,
    lines,
    payments,
    result,
    profile,
    client,
    taxCodes,
    attachments,
    qrSrc,
    settings?.dateFormat,
  ]);

  // Debounced re-render, so typing does not queue a PDF per keystroke.
  useEffect(() => {
    if (!model) return;

    let cancelled = false;

    const run = async () => {
      setStatus('rendering');
      try {
        // The shared render: it registers the fonts (the preview's own pdf()
        // call never did, which is why a fresh preview failed with "Font
        // family not registered") and produces a real base64 data URL.
        const dataUrl = await renderDocumentPdfDataUrl(model);
        if (cancelled) return;
        setPages([dataUrl]);
        setStatus('ready');
        setError(null);
      } catch (renderError) {
        if (cancelled) return;
        setStatus('error');
        setError(renderError instanceof Error ? renderError.message : 'The preview could not be rendered.');
      }
    };

    // Declared here so the cleanup closure captures the same handle.
    const timer = window.setTimeout(() => void run(), RENDER_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [model]);

  if (!model) {
    return (
      <EmptyState
        icon={<FileWarning className="size-7" aria-hidden />}
        title="Nothing to preview yet"
        hint="Add a client and at least one line, and the page will appear here."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ---- preview toolbar ---- */}
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="eyebrow">Preview</span>
          {dirty && <Badge className="bg-due-soft text-due">Updating</Badge>}
        </div>
        <div className="flex items-center gap-1.5">
          <Chip tone="muted">{model.template?.name ?? 'Studio'}</Chip>
          <Button
            size="sm"
            variant="ghost"
            aria-label={zoomed ? 'Fit the page to the pane' : 'Enlarge the preview'}
            onClick={() => setZoomed((v) => !v)}
          >
            <Maximize2 className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      {/* ---- render state ---- */}
      {status === 'rendering' && (
        <div className="mb-2">
          <IndeterminateBar label="Rendering the preview" />
        </div>
      )}

      {status === 'error' && (
        <Alert tone="warning" title="The preview could not be rendered" className="mb-2">
          {error ?? 'Unknown error.'}{' '}
          <button
            type="button"
            className="underline"
            onClick={() =>
              push({
                tone: 'info',
                title: 'The PDF export will report the same problem',
                description: error ?? '',
              })
            }
          >
            Why?
          </button>
        </Alert>
      )}

      {/* ---- the page ---- */}
      <div
        ref={containerRef}
        className={cn(
          'min-h-0 flex-1 overflow-auto scroll-quiet rounded-[8px] border border-rule bg-paper-sunken p-3',
          zoomed ? '' : 'flex items-start justify-center',
        )}
      >
        {pages.length === 0 && status !== 'error' ? (
          <div className="w-full">
            {/* A skeleton page while the first render happens, so the pane is
                never just blank. */}
            <div className="mx-auto aspect-[1/1.414] w-full max-w-md rounded-[4px] bg-paper-raised p-6 shadow-sheet">
              <div className="mb-6 h-4 w-2/3 rounded bg-paper-sunken" />
              <div className="mb-8 h-3 w-1/3 rounded bg-paper-sunken" />
              {[0.85, 1, 0.7, 0.95, 0.6, 0.9].map((w, i) => (
                <div key={i} className="mb-3 flex gap-3">
                  <div className="h-2.5 flex-1 rounded bg-paper-sunken" style={{ width: `${w * 100}%` }} />
                  <div className="h-2.5 w-16 rounded bg-paper-sunken" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className={cn('space-y-3', zoomed ? '' : 'w-full')}>
            {pages.map((src, i) => (
              <iframe
                key={i}
                src={src}
                title={`Page ${i + 1} of ${model.heading} ${model.number}`}
                className="block w-full rounded-[4px] bg-white shadow-sheet"
                style={{ aspectRatio: model.page.orientation === 'landscape' ? '1.414' : '1 / 1.414' }}
              />
            ))}
          </div>
        )}
      </div>

      {/* ---- footer facts ---- */}
      <div className="mt-2 shrink-0 space-y-1">
        <Progress
          value={pages.length}
          max={Math.max(1, pages.length)}
          label="Pages rendered"
          className="opacity-0"
        />
        <p className="truncate text-[11px] text-ink-faint" title={model.suggestedPath}>
          Would be written to {model.suggestedPath}
        </p>
      </div>
    </div>
  );
}
