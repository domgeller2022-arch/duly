/**
 * The document editor.
 *
 * Split view, as the plan asks: the form on the left, a live preview on the right
 * that updates as you type. On a narrow screen the preview becomes a tab.
 *
 * The header, the line grid, the totals panel and the action bar all live here.
 * Every figure comes from the calculation engine, never from a cached total, so
 * what is on screen is what would print.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Download,
  Loader2,
  Mail,
  Plus,
  Redo2,
  Save,
  Send,
  Trash2,
  Undo2,
  Wand2,
  Percent,
} from 'lucide-react';
import type { Client, Document, DocumentLine, DocumentType } from '@/core/schemas';
import { contentPresetSchema } from '@/core/schemas/template';
import { newEntity } from '@/core/schemas/common';
import { useAppStore, useActiveProfile } from '@/state/app';
import { files, storage } from '@/adapters';
import { isLocked, setEditorCustomTerms, setEditorRoundingMethod, useEditorStore } from './editorStore';
import { LineGrid, type ColumnSet } from './LineGrid';
import { TotalsPanel } from './TotalsPanel';
import { DocumentHeaderForm } from './DocumentHeaderForm';
import { SubmitDialog } from './SubmitDialog';
import { PresetDialog, ProgressInvoiceDialog } from './PresetDialog';
import { PaymentsPanel } from './PaymentsPanel';
import { ClientCreditPanel } from './ClientCreditPanel';
import { AttachmentsPanel } from './AttachmentsPanel';
import { EmailDialog } from './EmailDialog';
import { DocumentPreview } from './DocumentPreview';
import { runComplianceChecks } from '@/core/validation/compliance';
import { renderBundlePdf } from '@/lib/exports';
import { tableBlob, documentTableExport, type ExportFormat } from '@/lib/exports';
import { date, money, statusDescriptor } from '@/ui/lib/format';
import {
  convertQuoteToInvoice,
  createCreditNote,
  documentHeading,
  duplicateDocument,
  voidDocument,
  insertDiscount,
  insertNote,
  insertSection,
} from '@/core/documents';
import {
  Alert,
  Badge,
  Button,
  Chip,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Menu,
  MenuItem,
  Tabs,
  TextArea,
  TextInput,
  Tooltip,
  useIsNarrow,
  useToast,
} from '@/ui/components/base';

export function DocumentEditorScreen({ type }: { type: DocumentType }) {
  const { documentId } = useParams<{ documentId: string }>();
  const [params] = useSearchParams();

  useEffect(() => {
    if (params.get('email') === '1') setShowEmail(true);
  }, [params]);
  const navigate = useNavigate();
  const { push } = useToast();
  const isNarrow = useIsNarrow();

  const profile = useActiveProfile();
  const settings = useAppStore((s) => s.settings);
  const clients = useAppStore((s) => s.clients);
  const attachments = useAppStore((s) => s.attachments);
  const today = useAppStore((s) => s.today);
  const refreshDocuments = useAppStore((s) => s.refreshDocuments);
  const designTemplates = useAppStore((s) => s.designTemplates);

  const store = useEditorStore();
  const {
    document: doc,
    lines,
    result,
    loading,
    saving,
    error,
    payments,
    load,
    create,
    reset,
    update,
    setClient,
    dirty,
    history,
    future,
    undo,
    redo,
    flush,
    reload,
    acceptQuote,
  } = store;

  const [tab, setTab] = useState<'details' | 'preview'>('details');
  const [showSubmit, setShowSubmit] = useState(false);
  const [showPayments, setShowPayments] = useState(false);
  const [showVoid, setShowVoid] = useState(false);
  const [showSavePreset, setShowSavePreset] = useState(false);
  const [presetName, setPresetName] = useState('');
  const saveContentPreset = useAppStore((s) => s.saveContentPreset);
  const [creating, setCreating] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [showAccept, setShowAccept] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [acceptName, setAcceptName] = useState('');
  const [acceptTitle, setAcceptTitle] = useState('');
  const [signatureImage, setSignatureImage] = useState<string | null>(null);
  const [attachedPdf, setAttachedPdf] = useState<{ filename: string; dataUrl: string; size: number } | null>(
    null,
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const hasSignedRef = useRef(false);

  const isNew = documentId === 'new';
  const locked = isLocked({ document: doc });

  /* ---------------------------------------------------------------- */
  /* Load or create                                                    */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (settings) {
      setEditorRoundingMethod(settings.roundingMethod);
      setEditorCustomTerms(settings.customTerms);
    }
  }, [settings]);

  useEffect(() => {
    if (!isNew) {
      if (documentId) void load(documentId);
      return;
    }
    if (!profile || !settings) return;

    let cancelled = false;
    setCreating(true);

    void (async () => {
      try {
        const db = storage();
        const clientId = params.get('clientId');
        const fromQuoteId = params.get('fromQuote');
        const forInvoiceId = params.get('forInvoice');

        // Convert a quote: copy everything, link both ways.
        if (fromQuoteId) {
          const bundle = await db.getDocumentBundle(fromQuoteId);
          if (cancelled || !bundle) return;
          // Opening the same conversion link twice used to create two
          // invoices from one quote. A quote that already points at its
          // invoice opens that invoice instead.
          if (bundle.document.convertedToDocumentId) {
            const existing = await db.getDocument(bundle.document.convertedToDocumentId);
            if (existing) {
              if (!cancelled) navigate(`/invoices/${existing.id}`, { replace: true });
              return;
            }
          }
          const built = convertQuoteToInvoice(
            bundle.document,
            bundle.lines,
            profile,
            settings,
            today,
            clients.find((c) => c.id === bundle.document.clientId) ?? null,
          );
          await db.saveDocument(built.document, built.lines);
          // The quote is accepted and points at the invoice, so the two are linked
          // from both ends and the quote cannot be converted a second time by accident.
          await db.saveDocument(built.updatedQuote);
          await db.saveAuditLog(
            newEntity({
              entity: 'document',
              entityId: built.updatedQuote.id,
              action: 'convert',
              summary: `Converted quote ${built.updatedQuote.number} to an invoice`,
              actor: 'user',
              after: built.document.id,
            }),
          );
          if (!cancelled) {
            await refreshDocuments();
            navigate(`/invoices/${built.document.id}`, { replace: true });
          }
          return;
        }

        // Credit a note against an invoice, inheriting its GST treatment.
        if (forInvoiceId) {
          const bundle = await db.getDocumentBundle(forInvoiceId);
          if (cancelled || !bundle) return;
          const built = createCreditNote(bundle.document, bundle.lines, profile, settings, today);
          await db.saveDocument(built.document, built.lines);
          if (!cancelled) {
            await refreshDocuments();
            navigate(`/credit-notes/${built.document.id}`, { replace: true });
          }
          return;
        }

        const client = clientId ? (clients.find((c) => c.id === clientId) ?? null) : null;
        const createdId = await create({ type, profile, settings, client, today });
        if (!cancelled)
          navigate(`${documentRoute({ id: createdId, type })}`.replace(/\/new$/, `/${createdId}`), {
            replace: true,
          });
      } catch (creationError) {
        push({
          tone: 'error',
          title: 'That document could not be created',
          description: creationError instanceof Error ? creationError.message : String(creationError),
        });
      } finally {
        if (!cancelled) setCreating(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, profile?.id, settings?.id]);

  /*
   * Export and duplicate links.
   *
   * The menus add a query param to the route the document is already on, and
   * this effect — keyed on params — is what reacts to it. The old flow only
   * ran inside the create path, so Export on an existing document did nothing.
   * Exporting reads the editor state rather than the database, so an unsaved
   * draft exports too, and what lands is what is on screen.
   */
  useEffect(() => {
    const exportFormat = params.get('export');
    const duplicate = params.get('duplicate');
    if ((!exportFormat && !duplicate) || !doc || !result || !profile || !settings) return;

    let cancelled = false;
    // Where the navigation should end: a duplicate's route is the copy, and
    // the finally must not walk it back to the original.
    let endedOn = doc;
    void (async () => {
      try {
        if (duplicate === '1') {
          const copy = duplicateDocument(
            doc,
            lines,
            profile,
            settings,
            today,
            clients.find((c) => c.id === doc.clientId) ?? null,
          );
          await storage().saveDocument(copy.document, copy.lines);
          await refreshDocuments();
          endedOn = copy.document;
          return;
        }

        const client = clients.find((c) => c.id === doc.clientId) ?? null;
        if (exportFormat === 'pdf') {
          const blob = await renderBundlePdf({
            document: doc,
            lines,
            payments,
            result,
            profile,
            client,
            template: designTemplates.find((t) => t.id === doc.designTemplateId) ?? null,
            taxCodes: useAppStore.getState().taxCodes,
            attachments,
          });
          await files().saveAs(`${doc.number || doc.id}.pdf`, blob);
        } else {
          const blob = tableBlob(
            documentTableExport({
              document: doc,
              lines,
              result,
              clientName: client?.displayName ?? '',
              money,
            }),
            exportFormat as ExportFormat,
          );
          await files().saveAs(`${doc.number || doc.id}.${exportFormat}`, blob);
        }
      } catch (error) {
        push({
          tone: 'error',
          title: 'Could not export',
          description: error instanceof Error ? error.message : '',
        });
      } finally {
        if (!cancelled) navigate(documentRoute(endedOn), { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params, doc, result, lines, payments, profile, settings, clients, designTemplates, attachments, today, push, navigate, refreshDocuments]);

  useEffect(() => () => reset(), [reset]);

  /**
   * The unsaved-changes guard.
   *
   * Autosave runs 600 ms after the last keystroke, so the window where something can
   * be lost is small — but small is not closed, and this is the one screen where a
   * person can lose a page of typing by pressing the wrong thing.
   *
   * Pending edits are flushed on the way out, so leaving is never actually lossy; the
   * guard exists for the browser-level close, where unmount ordering is not ours.
   */
  useEffect(() => {
    return () => {
      if (useEditorStore.getState().dirty) void useEditorStore.getState().flush();
    };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  // In-app navigation is blocked while edits are pending, and unblocked the moment
  // the user chooses to leave or the autosave lands.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
  );

  // The blocked navigation is held by React Router until the dialog below either
  // proceeds or resets it. Nothing is flushed automatically: the dialog is the
  // decision point, and a guard that dismisses itself is not a guard.

  // Keyboard shortcuts. Cmd/Ctrl+S flushes rather than opening a browser dialog.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void flush().then(() => push({ tone: 'success', title: 'Draft saved' }));
        return;
      }

      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (isTypingTarget(e.target)) return;
        e.preventDefault();
        undo();
        return;
      }

      if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        if (isTypingTarget(e.target)) return;
        e.preventDefault();
        redo();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [flush, push, undo, redo]);

  /* ---------------------------------------------------------------- */
  /* Derived                                                           */
  /* ---------------------------------------------------------------- */

  const client = useMemo(() => clients.find((c) => c.id === doc?.clientId) ?? null, [clients, doc?.clientId]);

  const template = useAppStore((s) => s.designTemplates.find((t) => t.id === doc?.designTemplateId));

  const compliance = useMemo(() => {
    if (!doc || !result || !profile || !settings) return [];
    return runComplianceChecks({ document: doc, lines, client, profile, settings, result, template });
  }, [doc, result, profile, settings, lines, client, template]);

  const blocking = compliance.filter((c) => c.severity === 'block');

  /** Column visibility follows the assigned design template. */
  const columns: ColumnSet = useMemo(() => {
    const visible = new Set(
      template?.columns ?? ['position', 'description', 'quantity', 'unitPrice', 'taxCode', 'amount'],
    );
    return {
      position: visible.has('position'),
      details: visible.has('description'),
      quantity: visible.has('quantity'),
      unit: visible.has('unit'),
      unitPrice: visible.has('unitPrice'),
      discount: visible.has('discount'),
      taxCode: visible.has('taxCode'),
      taxAmount: visible.has('taxAmount'),
      amount: visible.has('amount'),
    };
  }, [template?.columns]);

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  const handleDuplicate = useCallback(async () => {
    if (!doc || !profile || !settings) return;
    const copy = duplicateDocument(
            doc,
            lines,
            profile,
            settings,
            today,
            clients.find((c) => c.id === doc.clientId) ?? null,
          );
    await storage().saveDocument(copy.document, copy.lines);
    await refreshDocuments();
    push({ tone: 'success', title: 'Duplicated', description: 'A fresh draft with a new number.' });
    navigate(documentRoute(copy.document));
  }, [doc, lines, profile, settings, today, clients, refreshDocuments, push, navigate]);

  /**
   * Apply a preset to the open draft.
   *
   * The client is set through `setClient` rather than patched directly, so the
   * preset's client brings their defaults with them — otherwise a preset would
   * silently carry the wrong currency or terms.
   */
  const handlePreset = useCallback(
    (nextDocument: Document, presetLines: DocumentLine[]) => {
      if (!doc) return;
      store.update(nextDocument, 'Apply preset');
      store.addLines(presetLines);
      const presetClient = nextDocument.clientId
        ? (clients.find((c) => c.id === nextDocument.clientId) ?? null)
        : null;
      if (presetClient) store.setClient(presetClient);
      push({ tone: 'success', title: 'Preset applied', description: `${presetLines.length} lines added.` });
    },
    [doc, clients, push, store],
  );

  const handleSavePreset = useCallback(async () => {
    if (!doc || !lines || !presetName.trim()) return;

    // A preset is the invoice with a new name and fresh line ids, so nothing
    // about the old invoice is corrupted when a copy changes.
    const preset = contentPresetSchema.parse({
      id: newEntity({}).id,
      name: presetName.trim(),
      description: '',
      documentType: doc.type,
      clientId: doc.clientId,
      designTemplateId: doc.designTemplateId,
      emailTemplateId: doc.emailTemplateId,
      termsId: doc.termsId ?? 'net_30',
      currency: doc.currency,
      taxMode: doc.taxMode,
      notes: doc.notes,
      termsText: doc.termsText,
      tags: doc.tags,
      lines,
      builtin: false,
    });

    await saveContentPreset(preset);
    setShowSavePreset(false);
    setPresetName('');
    push({ tone: 'success', title: 'Preset saved', description: preset.name });
  }, [doc, lines, presetName, saveContentPreset, push]);

  const handleVoid = useCallback(async () => {
    if (!doc) return;
    const now = new Date().toISOString();
    const voided = voidDocument(doc, 'Voided from the editor', now);
    await storage().saveDocument(voided, lines);
    // The audit entry the bulk void path writes, from the one place a
    // document is voided by hand.
    await storage().saveAuditLog(
      newEntity({
        entity: 'document',
        entityId: voided.id,
        action: 'void',
        summary: `Voided ${voided.number || voided.draftNumber} from the editor`,
        actor: 'user',
        note: 'Voided from the editor',
      }),
    );
    await refreshDocuments();
    await reload();
    setShowVoid(false);
    push({
      tone: 'info',
      title: 'Document voided',
      description: 'Kept for the audit trail rather than deleted.',
    });
  }, [doc, lines, refreshDocuments, push, reload]);

  const handleDelete = useCallback(async () => {
    if (!doc) return;
    await storage().deleteDocument(doc.id);
    await refreshDocuments();
    push({ tone: 'info', title: 'Draft deleted' });
    navigate(documentListRoute(type));
  }, [doc, refreshDocuments, push, navigate, type]);

  /* ---------------------------------------------------------------- */
  /* Loading and error states                                          */
  /* ---------------------------------------------------------------- */

  if (loading || creating) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin-slow text-ink-faint" aria-hidden />
        <span className="sr-only">Loading the document</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <EmptyState
          title="That document could not be opened"
          hint={error}
          action={<Button onClick={() => navigate(documentListRoute(type))}>Back to the list</Button>}
        />
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <EmptyState
          title="No document selected"
          action={<Button onClick={() => navigate(documentListRoute(type))}>Back to the list</Button>}
        />
      </div>
    );
  }

  const heading = profile ? documentHeading(doc, profile) : '';
  const descriptor = statusDescriptor(doc.status);

  /* ---------------------------------------------------------------- */
  /* The form half of the split view                                   */
  /* ---------------------------------------------------------------- */

  const form = (
    <div className="space-y-5">
      {doc.reviewRequired && doc.status === 'draft' && (
        <Alert tone="info" title="This draft came from a recurring schedule">
          Nothing has been sent or finalised. Check the dates and the {lines.length} line items, then submit
          it when you are happy.
        </Alert>
      )}

      {blocking.length > 0 && (
        <Alert
          tone="error"
          title={
            blocking.some((check) => check.id === 'no-lines')
              ? `${blocking.length} issue${blocking.length === 1 ? '' : 's'} must be fixed before submitting`
              : `${blocking.length} issue${blocking.length === 1 ? '' : 's'} — fix them, or submit with issues`
          }
        >
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {blocking.map((check) => (
              <li key={check.id}>
                <span className="font-medium">{check.title}</span> — {check.detail}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {locked && (
        <Alert tone="info" title={`This document is ${descriptor.label.toLowerCase()} and locked`}>
          Finalised documents cannot be edited, so the audit trail stays honest. To correct one, create a
          credit note or void it and re-issue.
        </Alert>
      )}

      <DocumentHeaderForm document={doc} locked={locked} onPatch={update} onClientChange={setClient} />

      {/* ---- line items ---- */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="eyebrow">Line items</h2>
          <div className="flex items-center gap-1.5">
            {result && (
              <Badge>
                {result.lineOrder.length} line{result.lineOrder.length === 1 ? '' : 's'}
              </Badge>
            )}
            {result?.hasMixedTaxability && <Chip tone="due">Mixed taxability</Chip>}
          </div>
        </div>

        <LineGrid
          columns={columns}
          // The bottom buttons insert at the end through the same helpers as
          // each row's menu. They used to build the line with a bare
          // documentLineSchema.parse, which throws without id/createdAt/
          // updatedAt — so every click failed silently and added nothing.
          onAddSection={() =>
            store.replaceLines(insertSection(lines, lines.length, 'New section', doc.id), 'Add section')
          }
          onAddNote={() => store.replaceLines(insertNote(lines, lines.length, '', doc.id), 'Add note')}
          onAddDiscount={() =>
            store.replaceLines(
              insertDiscount(lines, lines.length, { kind: 'discount', percent: '5', documentId: doc.id }),
              'Add discount',
            )
          }
        />
      </section>

      {/* ---- notes and terms ---- */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">Notes</span>
          <TextArea
            value={doc.notes}
            disabled={locked}
            rows={3}
            placeholder="Printed on the document, above the totals"
            onChange={(e) => update({ notes: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">Terms and conditions</span>
          <TextArea
            value={doc.termsText}
            disabled={locked}
            rows={3}
            placeholder="Payment terms, late-payment policy, anything the client should read"
            onChange={(e) => update({ termsText: e.target.value })}
          />
        </label>
      </section>

      {/* ---- payments already recorded ---- */}
      {locked && payments.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="eyebrow">Payments</h2>
            <span className="text-[12px] text-ink-muted">
              {money(doc.totals.paid, doc.currency)} of {money(doc.totals.total, doc.currency)} received
            </span>
          </div>
          <ul className="sheet divide-y divide-rule">
            {payments.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Check className="size-3.5 text-paid" aria-hidden />
                  <span className="text-[13px] text-ink">{date(payment.date, settings)}</span>
                  <span className="text-[12px] text-ink-muted capitalize">
                    {payment.method.replace('_', ' ')}
                  </span>
                  {payment.reference && (
                    <span className="text-[11px] text-ink-faint">{payment.reference}</span>
                  )}
                </div>
                <span className="num text-[13px] font-medium text-ink">
                  {money(payment.amount, doc.currency)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AttachmentsPanel documentId={doc.id} readOnly={locked} />

      <ClientCreditPanel />

      <TotalsPanel />

      {doc.status === 'draft' && (
        <section className="flex justify-end">
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 className="size-3.5" aria-hidden />}
            onClick={() => void handleDelete()}
          >
            Delete this draft
          </Button>
        </section>
      )}
    </div>
  );

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  return (
    <div className="flex h-full min-h-0 flex-col" data-print="hide">
      {/* ---- action bar ---- */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-rule bg-paper px-3 py-2">
        <IconButton label="Back to the list" size="sm" onClick={() => navigate(documentListRoute(type))}>
          <ArrowLeft className="size-4" aria-hidden />
        </IconButton>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate font-display text-[15px] font-semibold text-ink">
              {doc.number || doc.draftNumber || 'Untitled'}
            </h1>
            <Chip tone={descriptor.tone}>{descriptor.label}</Chip>
            {doc.reviewRequired && doc.status === 'draft' && <Chip tone="accent">Ready for review</Chip>}
          </div>
          <p className="truncate text-[11px] text-ink-muted">
            {heading} · {client?.displayName ?? 'No client'} · {date(doc.issueDate, settings)}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {history.length > 0 && (
            <Tooltip label="Undo">
              <IconButton label="Undo" size="sm" disabled={locked} onClick={undo}>
                <Undo2 className="size-4" aria-hidden />
              </IconButton>
            </Tooltip>
          )}
          {future.length > 0 && (
            <Tooltip label="Redo">
              <IconButton label="Redo" size="sm" disabled={locked} onClick={redo}>
                <Redo2 className="size-4" aria-hidden />
              </IconButton>
            </Tooltip>
          )}

          <span className="mx-1 h-4 w-px bg-rule" aria-hidden />

          {saving ? (
            <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
              <Loader2 className="size-3 animate-spin-slow" aria-hidden />
              Saving
            </span>
          ) : dirty ? (
            <span className="text-[11px] text-ink-muted">Unsaved changes</span>
          ) : (
            <span className="text-[11px] text-ink-faint">Saved</span>
          )}

          <span className="mx-1 h-4 w-px bg-rule" aria-hidden />

          <Button size="sm" icon={<Save className="size-3.5" aria-hidden />} onClick={() => void flush()}>
            Save
          </Button>
          {!locked && (
            <Button
              size="sm"
              icon={<Wand2 className="size-3.5" aria-hidden />}
              onClick={() => setShowPresets(true)}
            >
              Preset
            </Button>
          )}
          <Button
            size="sm"
            icon={<Copy className="size-3.5" aria-hidden />}
            onClick={() => void handleDuplicate()}
          >
            Duplicate
          </Button>

          {doc.type === 'quote' && doc.status !== 'accepted' && doc.status !== 'void' && (
            <Button
              size="sm"
              icon={<Check className="size-3.5" aria-hidden />}
              onClick={() => setShowAccept(true)}
            >
              Accept
            </Button>
          )}

          {/* ---- what this document can become ---- */}
          {doc.type === 'quote' && doc.status !== 'void' && (
            <>
              {doc.convertedToDocumentId ? (
                <Button
                  size="sm"
                  icon={<ArrowRight className="size-3.5" aria-hidden />}
                  onClick={() => navigate(`/invoices/${doc.convertedToDocumentId}`)}
                >
                  View invoice
                </Button>
              ) : (
                <Button
                  size="sm"
                  icon={<ArrowRight className="size-3.5" aria-hidden />}
                  onClick={() => navigate(`/invoices/new?fromQuote=${doc.id}`)}
                >
                  Convert to invoice
                </Button>
              )}
              {doc.status !== 'draft' && (
                <Button
                  size="sm"
                  icon={<Percent className="size-3.5" aria-hidden />}
                  onClick={() => setShowProgress(true)}
                >
                  Progress invoice
                </Button>
              )}
            </>
          )}

          {(doc.type === 'invoice' || doc.type === 'proforma') &&
            doc.status !== 'draft' &&
            doc.status !== 'void' &&
            doc.totals.total !== 0 && (
              <Button
                size="sm"
                icon={<Undo2 className="size-3.5" aria-hidden />}
                onClick={() => navigate(`/credit-notes/new?forInvoice=${doc.id}`)}
              >
                Credit note
              </Button>
            )}
          <Menu
            trigger={
              <Button size="sm" icon={<Download className="size-3.5" aria-hidden />}>
                Export
              </Button>
            }
          >
            <MenuItem
              icon={<Download className="size-3.5" aria-hidden />}
              onClick={() => navigate(`${documentRoute(doc)}?export=pdf`)}
            >
              PDF
            </MenuItem>
            <MenuItem onClick={() => navigate(`${documentRoute(doc)}?export=csv`)}>CSV</MenuItem>
            <MenuItem onClick={() => navigate(`${documentRoute(doc)}?export=xlsx`)}>XLSX</MenuItem>
            <MenuItem onClick={() => navigate(`${documentRoute(doc)}?export=docx`)}>DOCX</MenuItem>
            <MenuItem onClick={() => navigate(`${documentRoute(doc)}?export=json`)}>JSON</MenuItem>
          </Menu>

          {doc.status !== 'draft' && (
            <Button
              size="sm"
              icon={<Mail className="size-3.5" aria-hidden />}
              onClick={() => setShowEmail(true)}
            >
              Email
            </Button>
          )}

          {locked ? (
            <>
              {doc.totals.balance > 0 && (
                <Button
                  size="sm"
                  icon={<Plus className="size-3.5" aria-hidden />}
                  onClick={() => setShowPayments(true)}
                >
                  Record payment
                </Button>
              )}
              {doc.status !== 'void' && (
                <Button size="sm" variant="danger" onClick={() => setShowVoid(true)}>
                  Void
                </Button>
              )}
            </>
          ) : (
            <Button
              variant="primary"
              size="sm"
              icon={<Send className="size-3.5" aria-hidden />}
              onClick={() => setShowSubmit(true)}
              disabled={lines.length === 0}
            >
              Submit
            </Button>
          )}
        </div>
      </header>

      {/* ---- split view ---- */}
      <div className="min-h-0 flex-1">
        {isNarrow ? (
          <>
            <Tabs
              className="px-3"
              active={tab}
              onChange={(id) => setTab(id as 'details' | 'preview')}
              tabs={[
                { id: 'details', label: 'Details' },
                { id: 'preview', label: 'Preview' },
              ]}
            />
            <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
              {tab === 'details' ? (
                <div className="p-4">{form}</div>
              ) : (
                <div className="p-4">
                  <DocumentPreview />
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="grid h-full min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(420px,42%)]">
            <div className="min-h-0 overflow-y-auto scroll-quiet p-4">{form}</div>
            <aside className="hidden min-h-0 overflow-y-auto scroll-quiet border-l border-rule bg-paper-sunken/50 p-4 xl:block">
              <DocumentPreview />
            </aside>
          </div>
        )}
      </div>

      <SubmitDialog open={showSubmit} onClose={() => setShowSubmit(false)} compliance={compliance} />
      <PaymentsPanel open={showPayments} onClose={() => setShowPayments(false)} />
      <PresetDialog
        open={showPresets}
        onClose={() => setShowPresets(false)}
        document={doc}
        lineCount={lines.length}
        onApply={handlePreset}
      />
      <ProgressInvoiceDialog open={showProgress} onClose={() => setShowProgress(false)} quoteId={doc.id} />
      <EmailDialog open={showEmail} onClose={() => setShowEmail(false)} />

      <Dialog
        open={showAccept}
        onClose={() => setShowAccept(false)}
        title="Mark quote accepted"
        description="The client's name and date are captured, and the signature appears on the copy."
        footer={
          <>
            <Button onClick={() => setShowAccept(false)}>Cancel</Button>
            <Button
              onClick={async () => {
                await acceptQuote({
                  signerName: acceptName.trim(),
                  signerTitle: acceptTitle.trim(),
                  signatureImage,
                  attachedPdfDataUrl: attachedPdf?.dataUrl ?? null,
                  attachedPdfName: attachedPdf?.filename,
                  attachedPdfSize: attachedPdf?.size,
                });
                setShowAccept(false);
                push({ tone: 'success', title: 'Quote accepted' });
              }}
              disabled={!acceptName.trim()}
            >
              Accept
            </Button>
          </>
        }
      >
        <Field label="Signer name">
          <TextInput
            value={acceptName}
            onChange={(e) => setAcceptName(e.target.value)}
            placeholder="e.g. Jane Citizen"
          />
        </Field>
        <Field label="Title (optional)">
          <TextInput
            value={acceptTitle}
            onChange={(e) => setAcceptTitle(e.target.value)}
            placeholder="e.g. Accounts Payable"
          />
        </Field>

        <Field label="Sign on screen (optional)">
          <div className="flex items-start gap-3">
            <canvas
              ref={canvasRef}
              width={160}
              height={64}
              className="rounded-[6px] border border-rule bg-white"
              onPointerDown={(e) => {
                drawingRef.current = true;
                hasSignedRef.current = true;
                canvasRef.current?.setPointerCapture(e.pointerId);
                const ctx = canvasRef.current?.getContext('2d');
                if (ctx) {
                  ctx.beginPath();
                  ctx.moveTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
                }
              }}
              onPointerMove={(e) => {
                if (!drawingRef.current) return;
                const ctx = canvasRef.current?.getContext('2d');
                if (ctx) {
                  ctx.lineTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
                  ctx.stroke();
                }
              }}
              onPointerUp={() => {
                drawingRef.current = false;
                if (hasSignedRef.current && canvasRef.current) {
                  setSignatureImage(canvasRef.current.toDataURL('image/png'));
                }
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (canvasRef.current) {
                  const ctx = canvasRef.current.getContext('2d');
                  ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
                }
                hasSignedRef.current = false;
                setSignatureImage(null);
              }}
            >
              Clear
            </Button>
          </div>
        </Field>

        <Field label="Or attach the signed PDF">
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                setAttachedPdf({
                  filename: file.name,
                  dataUrl: String(reader.result ?? ''),
                  size: file.size,
                });
              };
              reader.readAsDataURL(file);
            }}
            className="text-[12px] text-ink-muted"
          />
          {attachedPdf && (
            <p className="mt-1 truncate text-[12px] text-ink-muted">
              {attachedPdf.filename} · {Math.round(attachedPdf.size / 1024)} KB
            </p>
          )}
        </Field>
      </Dialog>

      <Dialog
        open={showSavePreset}
        onClose={() => setShowSavePreset(false)}
        title="Save as preset"
        description="Turns this invoice into a reusable starting point: same lines, same template, ready for the next one."
        footer={
          <>
            <Button onClick={() => setShowSavePreset(false)}>Cancel</Button>
            <Button onClick={() => void handleSavePreset()} disabled={!presetName.trim()}>
              Save
            </Button>
          </>
        }
      >
        <Field label="Preset name">
          <TextInput
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="e.g. Monthly retainer"
          />
        </Field>

        <Field label="Sign on screen (optional)">
          <div className="flex items-start gap-3">
            <canvas
              ref={canvasRef}
              width={160}
              height={64}
              className="rounded-[6px] border border-rule bg-white"
              onPointerDown={(e) => {
                drawingRef.current = true;
                hasSignedRef.current = true;
                canvasRef.current?.setPointerCapture(e.pointerId);
                const ctx = canvasRef.current?.getContext('2d');
                if (ctx) {
                  ctx.beginPath();
                  ctx.moveTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
                }
              }}
              onPointerMove={(e) => {
                if (!drawingRef.current) return;
                const ctx = canvasRef.current?.getContext('2d');
                if (ctx) {
                  ctx.lineTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
                  ctx.stroke();
                }
              }}
              onPointerUp={() => {
                drawingRef.current = false;
                if (hasSignedRef.current && canvasRef.current) {
                  setSignatureImage(canvasRef.current.toDataURL('image/png'));
                }
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (canvasRef.current) {
                  const ctx = canvasRef.current.getContext('2d');
                  ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
                }
                hasSignedRef.current = false;
                setSignatureImage(null);
              }}
            >
              Clear
            </Button>
          </div>
        </Field>

        <Field label="Or attach the signed PDF">
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                setAttachedPdf({
                  filename: file.name,
                  dataUrl: String(reader.result ?? ''),
                  size: file.size,
                });
              };
              reader.readAsDataURL(file);
            }}
            className="text-[12px] text-ink-muted"
          />
          {attachedPdf && (
            <p className="mt-1 truncate text-[12px] text-ink-muted">
              {attachedPdf.filename} · {Math.round(attachedPdf.size / 1024)} KB
            </p>
          )}
        </Field>
      </Dialog>

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onClose={() => {
          // Staying put: abort the navigation and carry on editing.
          blocker.reset?.();
        }}
        onConfirm={() => {
          void useEditorStore
            .getState()
            .flush()
            .then(() => blocker.proceed?.())
            .catch(() => blocker.reset?.());
        }}
        title="Leave with unsaved changes?"
        confirmLabel="Save and leave"
        body="Duly was about to leave this document. Saving takes a moment and loses nothing; staying keeps you here."
      />

      <ConfirmDialog
        open={showVoid}
        onClose={() => setShowVoid(false)}
        onConfirm={() => void handleVoid()}
        danger
        title="Void this document?"
        confirmLabel="Void it"
        body="A void document is kept for the audit trail rather than deleted, and it cannot be edited afterwards. To correct something, create a credit note instead."
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

export function documentRoute(doc: Pick<Document, 'id' | 'type'>): string {
  switch (doc.type) {
    case 'quote':
      return `/quotes/${doc.id}`;
    case 'credit_note':
      return `/credit-notes/${doc.id}`;
    case 'delivery_note':
      return `/delivery-notes/${doc.id}`;
    case 'proforma':
      return `/proformas/${doc.id}`;
    case 'payment_receipt':
      return `/receipts/${doc.id}`;
    default:
      return `/invoices/${doc.id}`;
  }
}

export function documentListRoute(type: DocumentType): string {
  switch (type) {
    case 'quote':
      return '/quotes';
    case 'credit_note':
      return '/credit-notes';
    case 'delivery_note':
      return '/delivery-notes';
    case 'proforma':
      return '/proformas';
    case 'payment_receipt':
      return '/receipts';
    default:
      return '/invoices';
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export type { Client };
