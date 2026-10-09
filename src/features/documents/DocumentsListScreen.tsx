/**
 * The documents list.
 *
 * One screen serves invoices, quotes, credit notes, delivery notes and receipts,
 * because they differ only in a filter. What it has to get right:
 *
 *  - filters that compose (status, client, date range, currency, saved view)
 *  - saved views, so "Overdue" is one click rather than four filter changes
 *  - a bulk-action bar, so twenty invoices can be finalised or emailed at once
 *  - a status column that reflects the *current* date, not the stored status
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Ban,
  Check,
  Copy,
  Download,
  FileDown,
  Filter,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { Document, DocumentStatus } from '@/core/schemas';
import { useAppStore, useActiveProfile } from '@/state/app';
import { documentPath } from '@/lib/commands';
import { getCurrency } from '@/core/money/currencies';
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  Row,
  Select,
  Table,
  Td,
  TextInput,
  Th,
} from '@/ui/components/base';
import { countLabel, date, dueDescription, effectiveStatus, money, statusDescriptor } from '@/ui/lib/format';
import {
  bulkBodies,
  bulkConfirmLabels,
  bulkRunner,
  BulkResultDialog,
  type BulkAction,
  type BulkRequest,
} from './BulkResultDialog';
import { files, storage } from '@/adapters';
import { recalculateDocument } from '@/lib/documentService';
import { toMajorNumber } from '@/core/money/money';
import { tableCsv, zipBlob, renderBundlePdf } from '@/lib/exports';
import { AiInvoiceDialog } from './editor/AiInvoiceDialog';
import { cn } from '@/ui/lib/cn';
import { ConfirmDialog, useToast } from '@/ui/components/base';

export type DocumentKind =
  'invoice' | 'quote' | 'credit_note' | 'delivery_note' | 'proforma' | 'payment_receipt';

interface ListFilters {
  type?: DocumentKind | 'all';
  status?: DocumentStatus[];
  clientId?: string;
  currency?: string;
  from?: string;
  to?: string;
  balancePositive?: boolean;
  search?: string;
}

const KIND_TITLES: Record<DocumentKind, string> = {
  invoice: 'Invoices',
  quote: 'Quotes',
  credit_note: 'Credit notes',
  delivery_note: 'Delivery notes',
  proforma: 'Pro-forma invoices',
  payment_receipt: 'Payment receipts',
};

export function DocumentsListScreen({ kind = 'invoice' }: { kind?: DocumentKind }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const profile = useActiveProfile();
  const settings = useAppStore((s) => s.settings);
  const documents = useAppStore((s) => s.documents);
  const clients = useAppStore((s) => s.clients);
  const profiles = useAppStore((s) => s.profiles);
  const taxCodes = useAppStore((s) => s.taxCodes);
  const designTemplates = useAppStore((s) => s.designTemplates);
  const attachments = useAppStore((s) => s.attachments);
  const savedViews = useAppStore((s) => s.savedViews);
  const today = useAppStore((s) => s.today);
  const { push } = useToast();
  const refreshDocuments = useAppStore((s) => s.refreshDocuments);
  const removeDocument = useAppStore((s) => s.removeDocument);

  // Built once per render from stable store slices, so the bulk action's context
  // never depends on a filtered list that is about to change under it.
  const bulkContext = useMemo(
    () => (settings ? { settings, profiles, clients, taxCodes, templates: designTemplates } : null),
    [settings, profiles, clients, taxCodes, designTemplates],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAi, setShowAi] = useState(false);
  const [bulk, setBulk] = useState<BulkRequest | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; number: string } | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  /** Filters live in the URL so a filtered list can be linked and bookmarked. */
  const filters = useMemo<ListFilters>(() => {
    const view = params.get('view');
    const saved = savedViews.find((v) => v.id === view);
    const fromSaved = saved ? (JSON.parse(saved.filters) as ListFilters) : {};
    return {
      type: (params.get('type') as ListFilters['type']) ?? fromSaved.type ?? kind,
      status: params.get('status')
        ? (params.get('status')!.split(',') as DocumentStatus[])
        : fromSaved.status,
      clientId: params.get('client') ?? fromSaved.clientId,
      currency: params.get('currency') ?? fromSaved.currency,
      from: params.get('from') ?? fromSaved.from,
      to: params.get('to') ?? fromSaved.to,
      balancePositive: params.get('outstanding') === '1' || fromSaved.balancePositive,
      search: params.get('q') ?? fromSaved.search ?? '',
    };
  }, [params, savedViews, kind]);

  const setFilter = useCallback(
    (patch: Partial<ListFilters>) => {
      const next = new URLSearchParams(params);
      // Changing a filter invalidates the saved-view shortcut it came from.
      next.delete('view');
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === '' || value === false) {
          next.delete(
            {
              status: 'status',
              clientId: 'client',
              currency: 'currency',
              from: 'from',
              to: 'to',
              search: 'q',
              type: 'type',
            }[key as string] ?? key,
          );
          continue;
        }
        next.set(
          { status: 'status', clientId: 'client', search: 'q' }[key as string] ?? key,
          Array.isArray(value) ? value.join(',') : String(value),
        );
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const clearFilters = useCallback(() => {
    setParams(new URLSearchParams(), { replace: true });
  }, [setParams]);

  /* ---- the filtered set ---- */

  const rows = useMemo(() => {
    const clientName = (id: string | null) => clients.find((c) => c.id === id)?.displayName ?? '';

    return documents
      .filter((d) => !d.deletedAt && d.profileId === profile?.id)
      .filter((d) => (filters.type && filters.type !== 'all' ? d.type === filters.type : true))
      .filter((d) => (filters.status?.length ? filters.status.includes(effectiveStatus(d, today)) : true))
      .filter((d) => (filters.clientId ? d.clientId === filters.clientId : true))
      .filter((d) => (filters.currency ? d.currency === filters.currency : true))
      .filter((d) => (filters.balancePositive ? d.totals.balance > 0 : true))
      .filter((d) => (filters.from ? d.issueDate >= filters.from : true))
      .filter((d) => (filters.to ? d.issueDate <= filters.to : true))
      .filter((d) => {
        const q = (filters.search ?? '').trim().toLowerCase();
        if (!q) return true;
        return (
          (d.number || d.draftNumber || '').toLowerCase().includes(q) ||
          clientName(d.clientId).toLowerCase().includes(q) ||
          d.reference.toLowerCase().includes(q) ||
          d.poNumber.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.createdAt.localeCompare(a.createdAt));
  }, [documents, profile?.id, filters, clients, today]);

  /** Totals for the current filter, so the header answers "how much is this". */
  const summary = useMemo(() => {
    const byCurrency = new Map<string, { count: number; total: number; balance: number }>();
    for (const doc of rows) {
      const entry = byCurrency.get(doc.currency) ?? { count: 0, total: 0, balance: 0 };
      entry.count += 1;
      entry.total += doc.totals.total;
      entry.balance += doc.totals.balance;
      byCurrency.set(doc.currency, entry);
    }
    return [...byCurrency.entries()].map(([currency, entry]) => ({ currency, ...entry }));
  }, [rows]);

  const toggleRow = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((d) => d.id))));
  }, [rows]);

  // Clear the selection when the filter changes, so a bulk action can never hit a
  // document that is no longer on screen.
  useEffect(() => setSelected(new Set()), [filters]);

  const relevantViews = savedViews.filter(
    (v) =>
      v.entity === 'document' &&
      (() => {
        try {
          const parsed = JSON.parse(v.filters) as ListFilters;
          return parsed.type === kind || (!parsed.type && kind === 'invoice');
        } catch {
          return false;
        }
      })(),
  );

  const title = KIND_TITLES[kind];

  /* ---------------------------------------------------------------- */
  /* Bulk actions                                                       */
  /* ---------------------------------------------------------------- */

  /** Only documents currently on screen can be selected, so this is never stale. */
  const selectedDocuments = useMemo(() => rows.filter((d) => selected.has(d.id)), [rows, selected]);

  const request = useCallback((action: BulkAction) => setBulk({ action, busy: false, outcome: null }), []);

  const runBulk = useCallback(async () => {
    if (!bulk) return;
    if (!settings || !bulkContext) return;

    setBulk((current) => (current ? { ...current, busy: true } : current));
    try {
      const outcome = await bulkRunner(bulk.action, selectedDocuments, { ...bulkContext, today });
      setBulk((current) => (current ? { ...current, busy: false, outcome } : current));
      await refreshDocuments();
      push({ tone: 'success', title: outcome.summary });
      if (outcome.done > 0) setSelected(new Set());
    } catch (error) {
      setBulk((current) => (current ? { ...current, busy: false } : current));
      push({
        tone: 'error',
        title: 'That bulk action could not finish',
        description: error instanceof Error ? error.message : '',
      });
    }
  }, [bulk, settings, bulkContext, selectedDocuments, today, refreshDocuments, push]);

  /**
   * Export the selected PDFs.
   *
   * One file per document, named as the file-name pattern would name it. Written
   * through the file adapter, so on a browser that can write into a chosen folder
   * these land silently; otherwise they download one by one.
   */
  const exportSelected = useCallback(
    async (asZip = false) => {
      if (selectedDocuments.length === 0 || !settings) return;
      const finalised = selectedDocuments.filter((d) => d.status !== 'draft');
      if (finalised.length === 0) {
        push({ tone: 'warning', title: 'Nothing to export', description: 'Drafts have no PDF yet.' });
        return;
      }

      const zipFiles: { name: string; data: Uint8Array | string }[] = [];
      for (const document of finalised) {
        try {
          const bundle = await storage().getDocumentBundle(document.id);
          const profile = profiles.find((p) => p.id === document.profileId);
          if (!bundle || !profile) continue;
          // An issued document re-renders on its frozen tax codes, so the
          // exported PDF matches the one the client already has.
          const { result } = await recalculateDocument({
            document: bundle.document,
            lines: bundle.lines,
            payments: bundle.payments,
            taxCodes,
            save: false,
            deriveStatus: false,
          });
          const blob = await renderBundlePdf({
            document: bundle.document,
            lines: bundle.lines,
            payments: bundle.payments,
            result,
            profile,
            client: clients.find((c) => c.id === document.clientId) ?? null,
            template: designTemplates.find((t) => t.id === document.designTemplateId) ?? null,
            taxCodes,
            attachments,
          });
          const name = `${document.number || document.id}.pdf`;
          if (asZip) {
            zipFiles.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
          } else {
            await files().saveAs(name, blob);
          }
        } catch (error) {
          push({
            tone: 'error',
            title: `${document.number || 'A document'} could not be exported`,
            description: error instanceof Error ? error.message : '',
          });
        }
      }

      if (asZip) {
        zipFiles.push({
          name: 'documents.csv',
          data: tableCsv({
            title: 'documents',
            headers: ['Number', 'Type', 'Client', 'Date', 'Total', 'Balance'],
            rows: finalised.map((d) => [
              d.number || d.id,
              d.type,
              clients.find((c) => c.id === d.clientId)?.displayName ?? '',
              d.issueDate,
              toMajorNumber(d.totals.total, d.currency),
              toMajorNumber(d.totals.balance, d.currency),
            ]),
            meta: [],
          }),
        });
        await files().saveAs(`duly-export-${today}.zip`, zipBlob(zipFiles));
      }

      push({
        tone: 'success',
        title: asZip
          ? `${finalised.length} document${finalised.length === 1 ? '' : 's'} zipped`
          : `${finalised.length} PDF${finalised.length === 1 ? '' : 's'} exported`,
      });
    },
    [selectedDocuments, settings, profiles, clients, taxCodes, designTemplates, attachments, push, today],
  );

  /** Delete any document: soft delete, the number stays spent. */
  const confirmDelete = useCallback(async () => {
    if (!deleting) return;
    await removeDocument(deleting.id);
    setDeleting(null);
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(deleting.id);
      return next;
    });
    push({ tone: 'success', title: 'Deleted', description: `${deleting.number} removed from the list.` });
  }, [deleting, removeDocument, push]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6" data-print="hide">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl leading-tight font-semibold tracking-tight text-ink">
            {title}
          </h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {countLabel(rows.length, title.replace(/s$/, '').toLowerCase())}
            {summary.length === 1 && summary[0] && ` · ${money(summary[0].total, summary[0].currency)} total`}
            {summary.length > 1 && ` · ${summary.length} currencies`}
          </p>
        </div>
        <Row>
          {kind === 'invoice' && (
            <Button icon={<Sparkles className="size-3.5" aria-hidden />} onClick={() => setShowAi(true)}>
              AI draft
            </Button>
          )}
          <Button
            icon={<Filter className="size-3.5" aria-hidden />}
            onClick={() => setShowFilters((v) => !v)}
          >
            Filters
            {hasActiveFilters(filters, kind) && (
              <span className="ml-1 size-1.5 rounded-full bg-accent" aria-hidden />
            )}
          </Button>
          <Button
            variant="primary"
            icon={<Plus className="size-4" aria-hidden />}
            onClick={() => navigate(newDocumentRoute(kind))}
          >
            New {kind === 'credit_note' ? 'credit note' : kind.replace('_', ' ')}
          </Button>
        </Row>
      </header>

      {/* ---- saved views ---- */}
      {relevantViews.length > 0 && (
        <Row className="mb-3" gap={1}>
          {relevantViews.map((view) => (
            <Chip
              key={view.id}
              tone={params.get('view') === view.id ? 'accent' : 'neutral'}
              onClick={() => setParams(new URLSearchParams({ view: view.id }), { replace: true })}
              title={view.name}
            >
              {view.name}
            </Chip>
          ))}
        </Row>
      )}

      {/* ---- filters ---- */}
      {showFilters && (
        <Card className="mb-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Search">
              <div className="relative">
                <Search
                  className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint"
                  aria-hidden
                />
                <TextInput
                  placeholder="Number, client, PO…"
                  className="pl-8"
                  defaultValue={filters.search}
                  onChange={(e) => setFilter({ search: e.target.value })}
                />
              </div>
            </Field>

            <Field label="Status">
              <Select
                value={filters.status?.join(',') ?? ''}
                onChange={(e) =>
                  setFilter({
                    status: e.target.value ? (e.target.value.split(',') as DocumentStatus[]) : undefined,
                  })
                }
              >
                <option value="">Any status</option>
                {(
                  [
                    'draft',
                    'finalised',
                    'sent',
                    'partially_paid',
                    'paid',
                    'overdue',
                    'void',
                    'expired',
                    'accepted',
                  ] as DocumentStatus[]
                ).map((s) => (
                  <option key={s} value={s}>
                    {statusDescriptor(s).label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Client">
              <Select
                value={filters.clientId ?? ''}
                onChange={(e) => setFilter({ clientId: e.target.value || undefined })}
              >
                <option value="">Any client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Currency">
              <Select
                value={filters.currency ?? ''}
                onChange={(e) => setFilter({ currency: e.target.value || undefined })}
              >
                <option value="">Any currency</option>
                {[...new Set(documents.map((d) => d.currency))].map((code) => (
                  <option key={code} value={code}>
                    {code} — {getCurrency(code).name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="From">
              <TextInput
                type="date"
                value={filters.from ?? ''}
                onChange={(e) => setFilter({ from: e.target.value })}
              />
            </Field>

            <Field label="To">
              <TextInput
                type="date"
                value={filters.to ?? ''}
                onChange={(e) => setFilter({ to: e.target.value })}
              />
            </Field>

            <Field label="Type" className="sm:col-span-2">
              <Select
                value={filters.type ?? 'all'}
                onChange={(e) => setFilter({ type: e.target.value as ListFilters['type'] })}
              >
                <option value="all">All document types</option>
                {(Object.keys(KIND_TITLES) as DocumentKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_TITLES[k]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Row className="mt-3 justify-between">
            <Checkboxish
              checked={Boolean(filters.balancePositive)}
              onChange={(v) => setFilter({ balancePositive: v })}
              label="Only with an outstanding balance"
            />
            <Button
              size="sm"
              variant="ghost"
              icon={<X className="size-3.5" aria-hidden />}
              onClick={clearFilters}
            >
              Clear filters
            </Button>
          </Row>
        </Card>
      )}

      {/* ---- table ---- */}
      <Card className="overflow-hidden p-0">
        {rows.length === 0 ? (
          <EmptyState
            title={
              hasActiveFilters(filters, kind)
                ? 'Nothing matches those filters'
                : `No ${title.toLowerCase()} yet`
            }
            hint={
              hasActiveFilters(filters, kind)
                ? 'Try widening the date range, or clear the filters.'
                : `Your first ${kind === 'invoice' ? 'invoice' : kind.replace('_', ' ')} takes a moment to set up. Every one after that should take under a minute.`
            }
            action={
              hasActiveFilters(filters, kind) ? (
                <Button onClick={clearFilters}>Clear filters</Button>
              ) : (
                <Button variant="primary" onClick={() => navigate(newDocumentRoute(kind))}>
                  New {kind === 'invoice' ? 'invoice' : kind.replace('_', ' ')}
                </Button>
              )
            }
          />
        ) : (
          <Table>
            <thead className="sticky top-0 z-10 bg-paper-raised">
              <tr>
                <Th width="36px">
                  <input
                    type="checkbox"
                    aria-label={selected.size === rows.length ? 'Clear selection' : 'Select all'}
                    checked={selected.size > 0 && selected.size === rows.length}
                    onChange={toggleAll}
                    className="size-3.5 cursor-pointer accent-[var(--color-accent)]"
                  />
                </Th>
                <Th>Number</Th>
                <Th>Client</Th>
                <Th>Date</Th>
                <Th>Due</Th>
                <Th align="right">Total</Th>
                <Th align="right">Balance</Th>
                <Th>Status</Th>
                <Th width="40px" />
              </tr>
            </thead>
            <tbody>
              {rows.map((doc) => (
                <DocumentRow
                  key={doc.id}
                  doc={doc}
                  clientName={clients.find((c) => c.id === doc.clientId)?.displayName ?? '—'}
                  today={today}
                  settings={settings}
                  selected={selected.has(doc.id)}
                  onToggle={() => toggleRow(doc.id)}
                  onDelete={(d) => setDeleting({ id: d.id, number: d.number || d.draftNumber || 'Draft' })}
                />
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* ---- bulk action bar ---- */}
      {selected.size > 0 && (
        <div className="animate-rise sticky bottom-4 mx-auto mt-4 flex w-fit flex-wrap items-center gap-2 rounded-[10px] border border-rule bg-paper-raised px-3 py-2 shadow-overlay">
          <Badge>{selected.size}</Badge>
          <span className="text-[13px] text-ink">selected</span>
          <div className="mx-1 h-4 w-px bg-rule" aria-hidden />
          <Button
            size="sm"
            icon={<Send className="size-3.5" aria-hidden />}
            onClick={() => request('finalise')}
          >
            Finalise
          </Button>
          <Button
            size="sm"
            icon={<Check className="size-3.5" aria-hidden />}
            onClick={() => request('mark_paid')}
          >
            Mark paid
          </Button>
          <Button
            size="sm"
            icon={<RotateCcw className="size-3.5" aria-hidden />}
            onClick={() => request('refile')}
          >
            Re-file PDFs
          </Button>
          <Button
            size="sm"
            icon={<FileDown className="size-3.5" aria-hidden />}
            onClick={() => void exportSelected()}
          >
            Export PDFs
          </Button>
          <Button
            size="sm"
            icon={<FileDown className="size-3.5" aria-hidden />}
            onClick={() => void exportSelected(true)}
          >
            Export ZIP
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<Ban className="size-3.5" aria-hidden />}
            onClick={() => request('void')}
          >
            Void
          </Button>
          <IconButton label="Clear selection" size="sm" onClick={() => setSelected(new Set())}>
            <X className="size-3.5" aria-hidden />
          </IconButton>
        </div>
      )}

      {bulk && (
        <BulkResultDialog
          action={bulk.action}
          outcome={bulk.outcome ?? null}
          busy={bulk.busy}
          count={selectedDocuments.length}
          body={bulkBodies[bulk.action]}
          confirmLabel={bulkConfirmLabels[bulk.action]}
          danger={bulk.action === 'void'}
          onConfirm={() => void runBulk()}
          onClose={() => setBulk(null)}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        title={`Delete ${deleting?.number ?? 'this document'}?`}
        body={
          deleting?.number && deleting.number !== 'Draft'
            ? 'The number stays spent — it can never be issued again. Void it instead if the invoice might still be paid.'
            : 'The draft is removed from the list.'
        }
        confirmLabel="Delete"
        danger
      />

      {kind === 'invoice' && <AiInvoiceDialog open={showAi} onClose={() => setShowAi(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Row                                                                 */
/* ------------------------------------------------------------------ */

function DocumentRow({
  doc,
  clientName,
  today,
  settings,
  selected,
  onToggle,
  onDelete,
}: {
  doc: Document;
  clientName: string;
  today: string;
  settings: ReturnType<typeof useAppStore.getState>['settings'];
  selected: boolean;
  onToggle: () => void;
  onDelete: (doc: Document) => void;
}) {
  const navigate = useNavigate();
  const status = effectiveStatus(doc, today);
  const descriptor = statusDescriptor(status);
  const due = dueDescription(doc, today);

  return (
    <tr className={cn('transition-colors hover:bg-paper-sunken', selected && 'bg-accent-soft/40')}>
      <Td>
        <input
          type="checkbox"
          aria-label={`Select ${doc.number || doc.draftNumber}`}
          checked={selected}
          onChange={onToggle}
          className="size-3.5 cursor-pointer accent-[var(--color-accent)]"
        />
      </Td>
      <Td>
        <button
          type="button"
          onClick={() => navigate(documentPath(doc))}
          className="text-left font-medium text-ink hover:text-accent hover:underline"
        >
          {doc.number || doc.draftNumber}
        </button>
        {doc.poNumber && <span className="block text-[11px] text-ink-faint">PO {doc.poNumber}</span>}
      </Td>
      <Td>
        <span className="block max-w-48 truncate" title={clientName}>
          {clientName}
        </span>
      </Td>
      <Td className="text-ink-muted">{date(doc.issueDate, settings)}</Td>
      <Td>
        {doc.dueDate ? (
          <div className="flex items-center gap-1.5">
            <span className="text-ink-muted">{date(doc.dueDate, settings)}</span>
            {due && <Chip tone={due.includes('overdue') ? 'overdue' : 'due'}>{due}</Chip>}
          </div>
        ) : (
          <span className="text-ink-faint">—</span>
        )}
      </Td>
      <Td numeric>{money(doc.totals.total, doc.currency)}</Td>
      <Td numeric className={cn(doc.totals.balance > 0 && 'font-medium')}>
        {doc.totals.balance === 0 ? (
          <span className="text-ink-faint">—</span>
        ) : (
          money(doc.totals.balance, doc.currency)
        )}
      </Td>
      <Td>
        <Chip tone={descriptor.tone} title={descriptor.hint}>
          {descriptor.label}
        </Chip>
        {doc.reviewRequired && doc.status === 'draft' && (
          <Chip tone="accent" className="ml-1">
            Review
          </Chip>
        )}
      </Td>
      <Td align="right">
        <Menu
          trigger={
            <IconButton label={`Actions for ${doc.number || doc.draftNumber}`} size="sm">
              <MoreHorizontal className="size-4" aria-hidden />
            </IconButton>
          }
        >
          <MenuItem onClick={() => navigate(documentPath(doc))}>Open</MenuItem>
          <MenuItem
            icon={<Copy className="size-3.5" aria-hidden />}
            onClick={() => navigate(`${documentPath(doc)}?duplicate=1`)}
          >
            Duplicate
          </MenuItem>
          <MenuItem
            icon={<Download className="size-3.5" aria-hidden />}
            onClick={() => navigate(`${documentPath(doc)}?export=pdf`)}
          >
            Export PDF
          </MenuItem>
          <MenuSeparator />
          {doc.type === 'quote' && doc.status !== 'void' && (
            <MenuItem
              icon={<RefreshCw className="size-3.5" aria-hidden />}
              onClick={() => navigate(`/invoices/new?fromQuote=${doc.id}`)}
            >
              Convert to invoice
            </MenuItem>
          )}
          {doc.type === 'invoice' && doc.status !== 'void' && (
            <MenuItem
              icon={<Copy className="size-3.5" aria-hidden />}
              onClick={() => navigate(`/credit-notes/new?forInvoice=${doc.id}`)}
            >
              Create credit note
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem
            danger
            icon={<Trash2 className="size-3.5" aria-hidden />}
            onClick={() => onDelete(doc)}
          >
            Delete
          </MenuItem>
        </Menu>
      </Td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function hasActiveFilters(filters: ListFilters, kind: DocumentKind): boolean {
  return Boolean(
    filters.status?.length ||
    filters.clientId ||
    filters.currency ||
    filters.from ||
    filters.to ||
    filters.search ||
    filters.balancePositive ||
    (filters.type && filters.type !== kind && filters.type !== 'all'),
  );
}

function newDocumentRoute(kind: DocumentKind): string {
  switch (kind) {
    case 'quote':
      return '/quotes/new';
    case 'credit_note':
      return '/credit-notes/new';
    case 'delivery_note':
      return '/delivery-notes/new';
    case 'proforma':
      return '/proformas/new';
    case 'payment_receipt':
      return '/receipts/new';
    default:
      return '/invoices/new';
  }
}

function Checkboxish({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 accent-[var(--color-accent)]"
      />
      {label}
    </label>
  );
}
