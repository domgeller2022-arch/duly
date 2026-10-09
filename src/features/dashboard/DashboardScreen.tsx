/**
 * The dashboard.
 *
 * What someone opening Duly needs to see first: how much is outstanding, what is
 * overdue, what needs submitting, and what is due next. Six tiles, an aged
 * receivables bar, and the four lists that actually drive work.
 */

import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileText,
  Plus,
  Receipt,
  TrendingUp,
} from 'lucide-react';
import type { Document } from '@/core/schemas';
import { useAppStore, useActiveProfile } from '@/state/app';
import {
  compactMoney,
  countLabel,
  date,
  dueDescription,
  effectiveStatus,
  money,
  moneyWithCode,
  statusDescriptor,
} from '@/ui/lib/format';
import { AGE_BUCKETS, ageBucket } from '@/lib/automation/overdue';
import { Badge, Button, Card, Chip, EmptyState, Panel, Row, Table, Td, Th } from '@/ui/components/base';
import { cn } from '@/ui/lib/cn';
import { DashboardChart } from './DashboardChart';

export function DashboardScreen() {
  const navigate = useNavigate();
  const profile = useActiveProfile();
  const settings = useAppStore((s) => s.settings);
  const documents = useAppStore((s) => s.documents);
  const payments = useAppStore((s) => s.payments);
  const clients = useAppStore((s) => s.clients);
  const reminders = useAppStore((s) => s.reminders);
  const schedules = useAppStore((s) => s.recurringSchedules);
  const automationLog = useAppStore((s) => s.automationLog);
  const today = useAppStore((s) => s.today);

  const currency = profile?.defaultCurrency ?? settings?.defaultCurrency ?? 'AUD';
  const symbol = currency === 'AUD' || currency === 'NZD' || currency === 'USD' ? '$' : currency;

  const scoped = useMemo(
    () => documents.filter((d) => d.profileId === profile?.id && !d.deletedAt),
    [documents, profile?.id],
  );

  const tiles = useMemo(() => {
    const invoices = scoped.filter((d) => d.type === 'invoice');

    const outstanding = invoices
      .filter((d) => d.status !== 'void' && d.status !== 'draft' && d.totals.balance > 0)
      .reduce((acc, d) => acc + d.totals.balance, 0);

    const overdueDocs = invoices.filter((d) => effectiveStatus(d, today) === 'overdue');
    const overdueTotal = overdueDocs.reduce((acc, d) => acc + Math.max(0, d.totals.balance), 0);

    const monthStart = `${today.slice(0, 7)}-01`;
    // Money actually received this month: payments are their own records,
    // so "paid" is when the money landed, not the invoice's last touch.
    const paidThisMonth = payments
      .filter((p) => {
        const doc = scoped.find((d) => d.id === p.documentId);
        return doc && p.date >= monthStart;
      })
      .reduce((acc, p) => acc + p.amount, 0);
    const paidThisMonthCount = new Set(
      payments.filter((p) => {
        const doc = scoped.find((d) => d.id === p.documentId);
        return doc && p.date >= monthStart;
      }).map((p) => p.documentId),
    ).size;

    const drafts = scoped.filter((d) => d.type === 'invoice' && d.status === 'draft');
    const reviewRequired = scoped.filter((d) => d.reviewRequired && d.status === 'draft');

    const overdueQuotes = scoped.filter((d) => d.type === 'quote' && effectiveStatus(d, today) === 'expired');

    return {
      outstanding,
      outstandingCount: invoices.filter(
        (d) => d.status !== 'void' && d.status !== 'draft' && d.totals.balance > 0,
      ).length,
      overdueTotal,
      overdueCount: overdueDocs.length,
      paidThisMonth,
      paidThisMonthCount,
      drafts,
      reviewRequired,
      overdueQuotes,
    };
  }, [scoped, today, payments]);

  /** Aged receivables, by days past due. */
  const aged = useMemo(() => {
    const buckets = new Map<string, { total: number; count: number }>();
    for (const bucket of AGE_BUCKETS) buckets.set(bucket.key, { total: 0, count: 0 });

    for (const doc of scoped) {
      if (doc.type !== 'invoice') continue;
      if (doc.status === 'void' || doc.status === 'draft') continue;
      if (doc.totals.balance <= 0) continue;
      const key = ageBucket(doc.dueDate, today);
      const entry = buckets.get(key)!;
      entry.total += doc.totals.balance;
      entry.count += 1;
    }

    const grand = [...buckets.values()].reduce((acc, b) => acc + b.total, 0);
    return { rows: AGE_BUCKETS.map((b) => ({ ...b, ...buckets.get(b.key)! })), grand };
  }, [scoped, today]);

  /** Upcoming due dates, nearest first. */
  const upcoming = useMemo(
    () =>
      scoped
        .filter(
          (d) =>
            d.type === 'invoice' &&
            d.dueDate &&
            d.totals.balance > 0 &&
            !['void', 'paid', 'draft'].includes(d.status),
        )
        .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
        .slice(0, 6),
    [scoped],
  );

  const pendingReminders = reminders.filter((r) => r.status === 'pending');
  const dueSchedules = schedules.filter((s) => !s.paused && s.nextRunDate).slice(0, 5);

  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.displayName ?? 'No client';

  if (!profile) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <EmptyState
          icon={<Receipt className="size-8" aria-hidden />}
          title="No business set up yet"
          hint="Add your business details first — your ABN, logo and payment details appear on every document you create."
          action={
            <Button variant="primary" onClick={() => navigate('/setup')}>
              Set up my business
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6" data-print="hide">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl leading-tight font-semibold tracking-tight text-ink">
            Dashboard
          </h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {profile.name} · {today.split('-').reverse().join('/')}
          </p>
        </div>
        <Row>
          <Button
            variant="primary"
            icon={<Plus className="size-4" aria-hidden />}
            onClick={() => navigate('/invoices/new')}
          >
            New invoice
          </Button>
          <Button icon={<FileText className="size-4" aria-hidden />} onClick={() => navigate('/quotes/new')}>
            New quote
          </Button>
        </Row>
      </header>

      {/* ---- tiles ---- */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Outstanding"
          value={compactMoney(tiles.outstanding, currency, symbol)}
          sub={countLabel(tiles.outstandingCount, 'invoice')}
          icon={<TrendingUp className="size-4" aria-hidden />}
          tone="accent"
          onClick={() => navigate('/invoices?view=view_outstanding')}
        />
        <Tile
          label="Overdue"
          value={compactMoney(tiles.overdueTotal, currency, symbol)}
          sub={countLabel(tiles.overdueCount, 'invoice')}
          icon={<AlertTriangle className="size-4" aria-hidden />}
          tone={tiles.overdueCount > 0 ? 'overdue' : 'muted'}
          onClick={() => navigate('/invoices?view=view_overdue')}
        />
        <Tile
          label="Paid this month"
          value={compactMoney(tiles.paidThisMonth, currency, symbol)}
          sub={
            tiles.paidThisMonthCount > 0
              ? `${countLabel(tiles.paidThisMonthCount, 'invoice')} settled`
              : 'Nothing yet'
          }
          icon={<CheckCircle2 className="size-4" aria-hidden />}
          tone={tiles.paidThisMonth > 0 ? 'paid' : 'muted'}
          onClick={() => navigate('/invoices?view=view_paid')}
        />
        <Tile
          label="Drafts to submit"
          value={String(tiles.drafts.length)}
          sub={
            tiles.reviewRequired.length > 0
              ? `${tiles.reviewRequired.length} from a schedule`
              : 'Waiting on you'
          }
          icon={<FileText className="size-4" aria-hidden />}
          tone={tiles.drafts.length > 0 ? 'due' : 'muted'}
          onClick={() => navigate('/invoices?view=view_drafts')}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* ---- aged receivables ---- */}
          <Panel
            title="Aged receivables"
            description={`${moneyWithCode(aged.grand, currency)} outstanding across all invoices`}
            flush
          >
            {aged.grand === 0 ? (
              <EmptyState title="Nothing outstanding" hint="Every invoice is settled." />
            ) : (
              <DashboardChart rows={aged.rows} currency={currency} total={aged.grand} />
            )}
          </Panel>

          {/* ---- overdue ---- */}
          <Panel
            title="Overdue"
            description="Past the due date with a balance outstanding"
            actions={
              tiles.overdueCount > 0 && (
                <Button size="sm" variant="ghost" onClick={() => navigate('/invoices?view=view_overdue')}>
                  See all <ArrowRight className="size-3.5" aria-hidden />
                </Button>
              )
            }
            flush
          >
            {overdueList(scoped, clients, today).length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 className="size-6" aria-hidden />}
                title="Nothing overdue"
                hint="Every past invoice has been paid."
              />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Invoice</Th>
                    <Th>Client</Th>
                    <Th>Due</Th>
                    <Th align="right">Balance</Th>
                  </tr>
                </thead>
                <tbody>
                  {overdueList(scoped, clients, today)
                    .slice(0, 6)
                    .map((doc) => (
                      <tr key={doc.id} className="transition-colors hover:bg-paper-sunken">
                        <Td>
                          <Link to={`/invoices/${doc.id}`} className="font-medium text-ink hover:text-accent">
                            {doc.number || doc.draftNumber}
                          </Link>
                        </Td>
                        <Td className="text-ink-muted">{clientName(doc.clientId)}</Td>
                        <Td>
                          <div className="flex items-center gap-1.5">
                            <span className="text-ink-muted">{date(doc.dueDate, settings)}</span>
                            <Chip tone="overdue">{dueDescription(doc, today)}</Chip>
                          </div>
                        </Td>
                        <Td numeric className="font-medium">
                          {money(doc.totals.balance, doc.currency)}
                        </Td>
                      </tr>
                    ))}
                </tbody>
              </Table>
            )}
          </Panel>

          {/* ---- drafts ---- */}
          <Panel
            title="Drafts awaiting submit"
            description="These have no number yet and nothing has been sent"
            actions={
              tiles.drafts.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => navigate('/invoices?view=view_drafts')}>
                  See all <ArrowRight className="size-3.5" aria-hidden />
                </Button>
              )
            }
            flush
          >
            {tiles.drafts.length === 0 ? (
              <EmptyState title="No drafts" hint="Everything has been submitted." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Client</Th>
                    <Th>Issue date</Th>
                    <Th align="right">Total</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {tiles.drafts.slice(0, 6).map((doc) => (
                    <tr key={doc.id} className="transition-colors hover:bg-paper-sunken">
                      <Td className="font-medium">{clientName(doc.clientId)}</Td>
                      <Td className="text-ink-muted">{date(doc.issueDate, settings)}</Td>
                      <Td numeric>{money(doc.totals.total, doc.currency)}</Td>
                      <Td align="right">
                        <div className="flex items-center justify-end gap-1.5">
                          {doc.reviewRequired && <Chip tone="accent">From a schedule</Chip>}
                          {doc.reviewRequired && doc.fromScheduleId && (
                            <Chip tone="due">Ready for review</Chip>
                          )}
                          <Button size="sm" onClick={() => navigate(`/invoices/${doc.id}`)}>
                            Open
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>

        {/* ---- right column ---- */}
        <div className="space-y-5">
          <Panel title="Due soon" description="Nearest due dates" flush>
            {upcoming.length === 0 ? (
              <EmptyState
                icon={<Clock className="size-6" aria-hidden />}
                title="Nothing due"
                hint="No outstanding balances."
              />
            ) : (
              <ul className="divide-y divide-rule">
                {upcoming.map((doc) => {
                  const due = dueDescription(doc, today);
                  return (
                    <li key={doc.id}>
                      <Link
                        to={`/invoices/${doc.id}`}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-paper-sunken"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-ink">
                            {clientName(doc.clientId)}
                          </p>
                          <p className="text-[11px] text-ink-muted">Due {date(doc.dueDate, settings)}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="num text-[13px] font-medium text-ink">
                            {money(doc.totals.balance, doc.currency)}
                          </p>
                          {due && <Chip tone={due.includes('overdue') ? 'overdue' : 'due'}>{due}</Chip>}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel
            title="Reminders to approve"
            description="Queued by the reminder engine — nothing is sent without you"
            actions={
              pendingReminders.length > 0 && (
                <Badge className="bg-due-soft text-due">{pendingReminders.length}</Badge>
              )
            }
          >
            {pendingReminders.length === 0 ? (
              <p className="text-[13px] text-ink-muted">
                Nothing waiting. Reminders appear here before anything is sent.
              </p>
            ) : (
              <ul className="space-y-2">
                {pendingReminders.slice(0, 4).map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] text-ink">{r.subject}</p>
                      <p className="text-[11px] text-ink-muted">{date(r.scheduledFor, settings)}</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => navigate('/reminders')}>
                      Review
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Next recurring runs"
            description="Each run creates a draft for review"
            actions={
              <Button size="sm" variant="ghost" onClick={() => navigate('/recurring')}>
                Manage
              </Button>
            }
          >
            {dueSchedules.length === 0 ? (
              <EmptyState
                icon={<CalendarClock className="size-6" aria-hidden />}
                title="No schedules"
                hint="A schedule turns one invoice into a draft every week, month or quarter."
                action={
                  <Button size="sm" onClick={() => navigate('/recurring')}>
                    New schedule
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-2">
                {dueSchedules.map((schedule) => (
                  <li key={schedule.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[13px] text-ink">{schedule.name}</span>
                    <span className="shrink-0 text-[11px] text-ink-muted">
                      {date(schedule.nextRunDate, settings)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {automationLog.length > 0 && (
            <Panel
              title="Recent activity"
              description="Everything Duly did on its own"
              actions={
                <Button size="sm" variant="ghost" onClick={() => navigate('/automation-log')}>
                  All
                </Button>
              }
            >
              <ul className="space-y-2.5">
                {automationLog.slice(0, 5).map((entry) => (
                  <li key={entry.id} className="flex items-start gap-2">
                    {entry.needsAttention ? (
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-due" aria-hidden />
                    ) : (
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-paid" aria-hidden />
                    )}
                    <div className="min-w-0">
                      <p className="text-[12px] leading-snug text-ink">{entry.message}</p>
                      <p className="text-[10px] text-ink-faint">
                        {new Date(entry.ranAt).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tile                                                                */
/* ------------------------------------------------------------------ */

function Tile({
  label,
  value,
  sub,
  icon,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  tone: 'accent' | 'overdue' | 'paid' | 'due' | 'muted';
  onClick?: () => void;
}) {
  const toneClass = {
    accent: 'text-accent',
    overdue: 'text-overdue',
    paid: 'text-paid',
    due: 'text-due',
    muted: 'text-ink-faint',
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'sheet group flex flex-col gap-1 p-4 text-left transition-colors',
        onClick && 'hover:border-rule-strong hover:bg-paper-raised',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow">{label}</span>
        <span className={cn('shrink-0 opacity-70', toneClass)}>{icon}</span>
      </div>
      <span className={cn('font-display text-2xl leading-tight font-semibold tabular-nums', toneClass)}>
        {value}
      </span>
      {sub && <span className="text-[12px] text-ink-muted">{sub}</span>}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Overdue invoices, most overdue first. */
function overdueList(
  documents: Document[],
  clients: { id: string; displayName: string }[],
  today: string,
): Document[] {
  void clients;
  return documents
    .filter((d) => d.type === 'invoice' && effectiveStatus(d, today) === 'overdue' && d.totals.balance > 0)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
}

export { statusDescriptor };
export { Card };
