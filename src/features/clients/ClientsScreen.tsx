/**
 * The client list.
 *
 * Sorted by name, because a client list is a lookup rather than a ledger. Each row
 * carries the figures that matter when picking who to invoice: lifetime billed,
 * what they still owe, and how long they have historically taken to pay — the last
 * one is the useful signal for chasing.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Plus, Upload, Users } from 'lucide-react';
import { useAppStore } from '@/state/app';
import { clientStatsById, daysToPayLabel } from '@/core/crm';
import { countLabel, date, money } from '@/ui/lib/format';
import { Button, Card, Chip, Table, Td, Th, useToast } from '@/ui/components/base';
import { FilterBar, PageHeader } from '@/ui/components/layout';
import { EmptyState } from '@/ui/components/base';
import { formatAbn } from '@/core/validation/abn';
import { CsvImportDialog } from '@/features/import/CsvImportDialog';
import { clientsToCsv } from '@/lib/import';
import { files } from '@/adapters';

export function ClientsScreen() {
  const navigate = useNavigate();
  const { push } = useToast();
  const clients = useAppStore((s) => s.clients);
  const documents = useAppStore((s) => s.documents);
  const payments = useAppStore((s) => s.payments);
  const settings = useAppStore((s) => s.settings);
  const profiles = useAppStore((s) => s.profiles);
  const activeProfileId = useAppStore((s) => s.activeProfileId);
  const today = useAppStore((s) => s.today);

  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [importing, setImporting] = useState(false);

  /**
   * Per-client figures.
   *
   * `clientStatsById` is the same code the client detail screen uses, so a figure
   * here and the same figure there cannot drift.
   */
  const stats = useMemo(
    () => clientStatsById({ documents, payments, profileId: activeProfileId, today }),
    [documents, payments, activeProfileId, today],
  );

  const exportCsv = async () => {
    await files().saveAs('duly-clients.csv', clientsToCsv(rows));
    push({ tone: 'success', title: 'Clients exported', description: `${rows.length} rows as CSV.` });
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients
      .filter((client) => (showArchived ? true : !client.archived))
      .filter((client) => {
        if (!q) return true;
        return (
          client.displayName.toLowerCase().includes(q) ||
          client.email.toLowerCase().includes(q) ||
          client.taxId.replace(/\D/g, '').includes(q) ||
          client.tags.some((t) => t.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [clients, search, showArchived]);

  const currency =
    profiles.find((p) => p.id === activeProfileId)?.defaultCurrency ?? settings?.defaultCurrency ?? 'AUD';

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6" data-print="hide">
      <PageHeader
        title="Clients"
        subtitle={countLabel(rows.length, 'client')}
        actions={
          <>
            <Button icon={<Upload className="size-3.5" aria-hidden />} onClick={() => setImporting(true)}>
              Import
            </Button>
            <Button
              icon={<Download className="size-3.5" aria-hidden />}
              disabled={rows.length === 0}
              onClick={() => void exportCsv()}
            >
              Export
            </Button>
            <Button
              variant="primary"
              icon={<Plus className="size-4" aria-hidden />}
              onClick={() => navigate('/clients/new')}
            >
              New client
            </Button>
          </>
        }
        className="mb-4"
      />

      <FilterBar search={search} onSearch={setSearch} placeholder="Name, email, ABN or tag" className="mb-3">
        <Button
          size="sm"
          variant={showArchived ? 'quiet' : 'ghost'}
          onClick={() => setShowArchived((v) => !v)}
        >
          {showArchived ? 'Hiding archived' : 'Include archived'}
        </Button>
      </FilterBar>

      <Card className="overflow-hidden p-0">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Users className="size-7" aria-hidden />}
            title={search ? 'No clients match that search' : 'No clients yet'}
            hint={
              search
                ? 'Try a different name, or the ABN without its spaces.'
                : 'Add a client once, and every later invoice for them starts pre-filled with their details and defaults.'
            }
            action={
              search ? (
                <Button onClick={() => setSearch('')}>Clear search</Button>
              ) : (
                <Button variant="primary" onClick={() => navigate('/clients/new')}>
                  New client
                </Button>
              )
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Client</Th>
                <Th>Contact</Th>
                <Th>Terms</Th>
                <Th align="right">Lifetime billed</Th>
                <Th align="right">Outstanding</Th>
                <Th>Last invoiced</Th>
                <Th align="right">Avg days to pay</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((client) => {
                const stat = stats.get(client.id);
                return (
                  <tr
                    key={client.id}
                    className="cursor-pointer transition-colors hover:bg-paper-sunken"
                    onClick={() => navigate(`/clients/${client.id}`)}
                  >
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink">{client.displayName}</span>
                        {client.archived && <Chip tone="muted">Archived</Chip>}
                        {client.tags.slice(0, 2).map((tag) => (
                          <Chip key={tag} tone="neutral">
                            {tag}
                          </Chip>
                        ))}
                      </div>
                      {client.taxId && (
                        <span className="text-[11px] text-ink-faint">ABN {formatAbn(client.taxId)}</span>
                      )}
                    </Td>
                    <Td className="text-ink-muted">
                      <span className="block truncate">{client.email || '—'}</span>
                      {client.phone && <span className="text-[11px]">{client.phone}</span>}
                    </Td>
                    <Td className="text-ink-muted">
                      {termsLabel(client.defaultTermsId)}
                      {client.defaultCurrency !== currency && (
                        <span className="block text-[11px] text-ink-faint">
                          Bills in {client.defaultCurrency}
                        </span>
                      )}
                    </Td>
                    <Td numeric className="font-medium">
                      {stat ? money(stat.lifetimeBilled, currency) : '—'}
                      {stat && stat.invoiceCount > 0 && (
                        <span className="block text-[11px] font-normal text-ink-faint">
                          {stat.invoiceCount} invoice{stat.invoiceCount === 1 ? '' : 's'}
                        </span>
                      )}
                    </Td>
                    <Td numeric>
                      {stat && stat.outstanding > 0 ? (
                        <span className="font-medium text-overdue">{money(stat.outstanding, currency)}</span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </Td>
                    <Td className="text-ink-muted">
                      {stat?.lastInvoicedAt ? date(stat.lastInvoicedAt, settings) : 'Never'}
                    </Td>
                    <Td numeric className="text-ink-muted">
                      {daysToPayLabel(stat?.averageDaysToPay ?? null)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {rows.length > 0 && (
        <p className="mt-3 text-[11px] text-ink-faint">
          Click any client to see their invoices, contacts and payment history.
        </p>
      )}

      {importing && <CsvImportDialog entity="client" onClose={() => setImporting(false)} />}
    </div>
  );
}

function termsLabel(termsId: string): string {
  const labels: Record<string, string> = {
    due_on_receipt: 'Due on receipt',
    net_7: 'Net 7',
    net_14: 'Net 14',
    net_30: 'Net 30',
    net_60: 'Net 60',
    end_next_month: 'End of next month',
  };
  return labels[termsId] ?? termsId.replace('_', ' ');
}
