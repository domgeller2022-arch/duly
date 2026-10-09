/**
 * Preset picker and lifecycle actions for the editor.
 *
 * Two small dialogs that the action bar opens. They live together because they are
 * both "do something structural to this document before I carry on", and because the
 * progress dialog is the one the plan requires to warn before it writes.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Check, FileText, Percent } from 'lucide-react';
import type { Document, DocumentLine } from '@/core/schemas';
import { storage } from '@/adapters';
import { useAppStore, useActiveProfile } from '@/state/app';
import { applyPreset, buildProgressInvoice, linesFromPreset } from '@/core/documents';
import { calculate } from '@/core/calc/calculate';
import { money } from '@/ui/lib/format';
import { Alert, Button, Checkbox, Dialog, Field, NumberInput, useToast } from '@/ui/components/base';

/* ------------------------------------------------------------------ */
/* Preset picker                                                       */
/* ------------------------------------------------------------------ */

/**
 * Apply a saved skeleton to the open draft.
 *
 * Presets are the plan's answer to "fast to the second invoice": a saved client,
 * lines, notes, terms and template, so the second invoice for a retainer is one
 * click plus a date rather than ten lines of typing.
 *
 * Lines are added, never replaced — a half-built draft is somebody's work and this
 * is not the moment to throw it away. The dialog says so before it does it.
 */
export function PresetDialog({
  open,
  onClose,
  document,
  lineCount,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  document: Document;
  /** How many lines the open draft already has, so the dialog can warn. */
  lineCount: number;
  onApply: (document: Document, lines: DocumentLine[]) => void;
}) {
  const presets = useAppStore((s) => s.contentPresets);
  const clients = useAppStore((s) => s.clients);
  const items = useAppStore((s) => s.items);
  const [chosen, setChosen] = useState<string | null>(null);

  const applicable = useMemo(
    () => presets.filter((p) => p.documentType === document.type),
    [presets, document.type],
  );

  const preset = applicable.find((p) => p.id === chosen) ?? null;

  /**
   * Preset rows are read straight from storage, and an imported row is not guaranteed
   * to have every field the schema would have filled in. One `lines` missing turns the
   * whole editor blank, so it is read defensively here rather than trusted.
   */
  const presetLines = preset?.lines ?? [];

  const apply = () => {
    if (!preset) return;
    const lines = linesFromPreset({ ...preset, lines: presetLines }, document, items);
    onApply({ ...applyPreset(document, preset), clientId: preset.clientId ?? document.clientId }, lines);
    setChosen(null);
    onClose();
  };

  const clientName = (id: string | null) =>
    id ? (clients.find((c) => c.id === id)?.displayName ?? 'Unknown') : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Start from a preset"
      description="A saved skeleton: client, lines, notes, terms and template."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!preset} onClick={apply}>
            {preset
              ? `Add ${presetLines.length} line${presetLines.length === 1 ? '' : 's'}`
              : 'Choose a preset'}
          </Button>
        </>
      }
    >
      {applicable.length === 0 ? (
        <Alert tone="info" title="No presets yet">
          A preset is a saved invoice skeleton — set one up once and reuse it. Saving one from an invoice is
          in the templates screen.
        </Alert>
      ) : (
        <div className="space-y-2">
          {applicable.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setChosen(p.id)}
              className={[
                'flex w-full items-start gap-3 rounded-[8px] border p-3 text-left transition-colors',
                chosen === p.id ? 'border-accent bg-accent-soft' : 'border-rule hover:border-rule-strong',
              ].join(' ')}
            >
              <span className="mt-0.5 shrink-0">
                {chosen === p.id ? (
                  <Check className="size-4 text-accent" aria-hidden />
                ) : (
                  <FileText className="size-4 text-ink-faint" aria-hidden />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-ink">{p.name}</span>
                {p.description && <span className="block text-[12px] text-ink-muted">{p.description}</span>}
                <span className="mt-0.5 block text-[11px] text-ink-faint">
                  {(p.lines ?? []).length} line{(p.lines ?? []).length === 1 ? '' : 's'}
                  {clientName(p.clientId) && ` · ${clientName(p.clientId)}`}
                  {p.tags.length > 0 && ` · ${p.tags.join(', ')}`}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {preset && lineCount > 0 && (
        <Alert tone="warning" title="This adds to the document">
          It has {lineCount} line{lineCount === 1 ? '' : 's'} already. A preset adds its lines to what is
          there; it does not replace them.
        </Alert>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Progress invoice                                                    */
/* ------------------------------------------------------------------ */

/**
 * Invoice part of an accepted quote.
 *
 * "From an accepted quote, invoice a %, selected lines or the remainder; track quoted
 * vs invoiced; warn above 100%." The arithmetic is `buildProgressInvoice`, already
 * written and tested; this is the screen that chooses the percentage and shows the
 * consequence before anything is written.
 */
export function ProgressInvoiceDialog({
  open,
  onClose,
  quoteId,
}: {
  open: boolean;
  onClose: () => void;
  quoteId: string;
}) {
  const navigate = useNavigate();
  const { push } = useToast();
  const profile = useActiveProfile();
  const settings = useAppStore((s) => s.settings);
  const today = useAppStore((s) => s.today);
  const taxCodes = useAppStore((s) => s.taxCodes);
  const refreshDocuments = useAppStore((s) => s.refreshDocuments);

  const [bundle, setBundle] = useState<{ document: Document; lines: DocumentLine[] } | null>(null);
  const [mode, setMode] = useState<'remainder' | 'percent' | 'lines'>('remainder');
  const [percent, setPercent] = useState('50');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Loaded when the dialog opens, because the quote may have changed since the
  // editor was mounted.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void storage()
      .getDocumentBundle(quoteId)
      .then((found) => {
        if (!cancelled && found) setBundle({ document: found.document, lines: found.lines });
      });
    return () => {
      cancelled = true;
    };
  }, [open, quoteId]);

  const already = Number(bundle?.document.progressPercent ?? 0);
  const chosen = mode === 'remainder' ? 100 - already : Number(percent) || 0;
  const over = chosen + already > 100;

  const billable = useMemo(
    () => (bundle?.lines ?? []).filter((l) => l.type !== 'section' && l.type !== 'note'),
    [bundle],
  );

  const build = () => {
    if (!bundle || !profile || !settings) return null;
    return buildProgressInvoice(bundle.document, bundle.lines, profile, settings, today, {
      percent: chosen,
      selectedLineIds: mode === 'lines' ? [...picked] : undefined,
      alreadyInvoicedPercent: already,
    });
  };

  const preview = build();
  const previewTotal = preview
    ? calculate({
        document: preview.document,
        lines: preview.lines,
        payments: [],
        taxCodes,
      }).total
    : 0;
  const quotedTotal = bundle
    ? calculate({ document: bundle.document, lines: bundle.lines, payments: [], taxCodes }).total
    : 0;

  const create = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await storage().saveDocument(preview.document, preview.lines);
      await refreshDocuments();
      push({
        tone: preview.warning ? 'warning' : 'success',
        title: 'Progress invoice created',
        description:
          preview.warning ?? `${money(previewTotal, preview.document.currency)} on a draft invoice.`,
      });
      onClose();
      navigate(`/invoices/${preview.document.id}`);
    } catch (error) {
      push({
        tone: 'error',
        title: 'That could not be created',
        description: error instanceof Error ? error.message : '',
      });
    } finally {
      setBusy(false);
    }
  };

  const total = preview ? previewTotal : 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Invoice part of this quote"
      description="Quoted, already invoiced, and what this would add."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!preview || (mode === 'lines' && picked.size === 0)}
            onClick={() => void create()}
          >
            Create the invoice
          </Button>
        </>
      }
    >
      {!bundle ? (
        <p className="text-[13px] text-ink-muted">Reading the quote…</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <Figure label="Quoted" value={money(quotedTotal, bundle.document.currency)} />
            <Figure label="Already invoiced" value={`${already}%`} />
            <Figure label="This invoice" value={money(total, bundle.document.currency)} tone="accent" />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-[13px] font-medium text-ink">What to invoice</legend>
            {[
              { id: 'remainder' as const, label: `The remainder (${Math.max(0, 100 - already)}%)` },
              { id: 'percent' as const, label: 'A percentage' },
              { id: 'lines' as const, label: 'Specific lines, at full value' },
            ].map((option) => (
              <label key={option.id} className="flex items-center gap-2.5 text-[13px] text-ink">
                <input
                  type="radio"
                  name="progress-mode"
                  checked={mode === option.id}
                  onChange={() => setMode(option.id)}
                />
                {option.label}
              </label>
            ))}
          </fieldset>

          {mode === 'percent' && (
            <Field
              label="Percentage of the quoted amount"
              hint="Each line is rounded so the total matches the percentage exactly"
            >
              <NumberInput value={percent} onChange={setPercent} ariaLabel="Percentage" />
            </Field>
          )}

          {mode === 'lines' && (
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-ink">Lines</p>
              <ul className="divide-y divide-rule rounded-[8px] border border-rule">
                {billable.map((line) => (
                  <li key={line.id} className="flex items-center gap-2.5 px-3 py-1.5">
                    <Checkbox
                      checked={picked.has(line.id)}
                      onChange={(on) =>
                        setPicked((current) => {
                          const next = new Set(current);
                          if (on) next.add(line.id);
                          else next.delete(line.id);
                          return next;
                        })
                      }
                      label={line.description || 'Untitled line'}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {over && (
            <Alert tone="warning" title="That would go past the quoted amount">
              <AlertTriangle className="mr-1 inline size-3" aria-hidden />
              Progress would reach {chosen + already}%. Check the figure before creating it.
            </Alert>
          )}

          {preview?.warning && !over && <Alert tone="warning">{preview.warning}</Alert>}

          <p className="flex items-center gap-1.5 text-[12px] text-ink-muted">
            <ArrowRight className="size-3" aria-hidden />
            The new invoice is a draft with the lines filled in. Nothing is submitted or emailed.
          </p>
          <p className="flex items-center gap-1.5 text-[12px] text-ink-faint">
            <Percent className="size-3" aria-hidden />
            Quoted versus invoiced is tracked on the quote, so the next progress invoice picks up from here.
          </p>
        </div>
      )}
    </Dialog>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'accent' }) {
  return (
    <div className="rounded-[8px] border border-rule px-3 py-2">
      <p className="text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase">{label}</p>
      <p
        className={
          tone === 'accent'
            ? 'num font-display text-base font-semibold text-accent'
            : 'num font-display text-base font-semibold text-ink'
        }
      >
        {value}
      </p>
    </div>
  );
}
