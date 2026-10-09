/**
 * Time tracking.
 *
 * The plan's item 1: a start/stop timer and manual entries per client and
 * project, a billable flag and rate, and "Invoice unbilled time" — the one
 * action that turns a month of tracked time (plus the billable expenses, if
 * the checkbox is on) into a correct draft invoice.
 *
 * The timer is one entry with `timerStartedAt`: start stamps the epoch time,
 * stop converts the elapsed milliseconds into the 4-decimal hours the schema
 * stores. One timer at a time — starting one stops another, because a person
 * is only ever working on one thing.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Pause, Play, Plus, Trash2 } from 'lucide-react';
import { useAppStore } from '@/state/app';
import { storage } from '@/adapters';
import {
  unbilledTimeGroups,
  timeLinesFromGroups,
  expenseLines,
  markTimeInvoiced,
  drawDownRetainers,
  type TimeGrouping,
} from '@/lib/timeBilling';
import { createDocument } from '@/core/documents';
import { applyTotals, calculate } from '@/core/calc/calculate';
import { timeEntrySchema } from '@/core/schemas/automation';
import { newEntity } from '@/core/schemas/common';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Chip,
  ConfirmDialog,
  Field,
  Panel,
  Select,
  Table,
  Td,
  TextInput,
  Th,
  useToast,
} from '@/ui/components/base';
import { PageHeader } from '@/ui/components/layout';
import { date, money } from '@/ui/lib/format';

export function TimeTrackingScreen() {
  const { push } = useToast();
  const navigate = useNavigate();
  const timeEntries = useAppStore((s) => s.timeEntries);
  const projects = useAppStore((s) => s.projects);
  const clients = useAppStore((s) => s.clients);
  const expenses = useAppStore((s) => s.expenses);
  const profiles = useAppStore((s) => s.profiles);
  const settings = useAppStore((s) => s.settings);
  const today = useAppStore((s) => s.today);
  const taxCodes = useAppStore((s) => s.taxCodes);
  const saveTimeEntry = useAppStore((s) => s.saveTimeEntry);
  const removeTimeEntry = useAppStore((s) => s.removeTimeEntry);
  const refresh = useAppStore((s) => s.refresh);

  const [draft, setDraft] = useState<null | {
    clientId: string;
    projectId: string;
    description: string;
    date: string;
  }>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [invoiceClientId, setInvoiceClientId] = useState('');
  const [grouping, setGrouping] = useState<TimeGrouping>('project');
  const [includeExpenses, setIncludeExpenses] = useState(true);
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(Date.now());

  /** The running entry ticks every second so the elapsed time is live. */
  const running = useMemo(() => timeEntries.find((e) => e.timerStartedAt > 0) ?? null, [timeEntries]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const runningHours = running ? (now - running.timerStartedAt) / 3_600_000 : 0;

  const startTimer = async () => {
    if (!profiles[0]) {
      push({ tone: 'warning', title: 'Create a business first' });
      return;
    }
    // Starting one stops another: only one timer runs at a time.
    if (running) await stopTimer();

    const clientId = draft?.clientId || clients[0]?.id || null;
    const entry = timeEntrySchema.parse(
      newEntity({
        clientId,
        projectId: draft?.projectId || null,
        date: today,
        hours: '0',
        description: draft?.description || '',
        timerStartedAt: Date.now(),
      }),
    );
    await saveTimeEntry(entry);
    push({ tone: 'success', title: 'Timer started' });
  };

  const stopTimer = async () => {
    if (!running) return;
    const hours = Math.max(0, (Date.now() - running.timerStartedAt) / 3_600_000);
    await saveTimeEntry({ ...running, hours: hours.toFixed(4), timerStartedAt: 0 });
    push({ tone: 'success', title: `Timer stopped — ${hours.toFixed(2)} hours` });
  };

  const addManual = async () => {
    if (!draft) return;
    const entry = timeEntrySchema.parse(
      newEntity({
        clientId: draft.clientId || null,
        projectId: draft.projectId || null,
        date: draft.date,
        hours: '0',
        description: draft.description,
        timerStartedAt: 0,
      }),
    );
    await saveTimeEntry(entry);
    setDraft(null);
  };

  const remove = async (id: string) => {
    await removeTimeEntry(id);
    setConfirmId(null);
    push({ tone: 'success', title: 'Entry deleted' });
  };

  /**
   * The plan's acceptance: a month of tracked time plus the billable expenses
   * becomes a correct invoice in one action.
   */
  const invoiceUnbilled = async () => {
    const profile = profiles[0];
    if (!profile || !invoiceClientId) {
      push({ tone: 'warning', title: 'Pick a client to bill' });
      return;
    }
    setCreating(true);
    try {
      const clientEntries = timeEntries.filter((e) => e.clientId === invoiceClientId);
      const groups = unbilledTimeGroups(clientEntries, projects, grouping);
      const clientExpenses = includeExpenses
        ? expenses.filter((x) => x.clientId === invoiceClientId && x.billable && !x.invoicedOnDocumentId)
        : [];
      if (groups.length === 0 && clientExpenses.length === 0) {
        push({
          tone: 'warning',
          title: 'Nothing unbilled',
          description: 'No billable time or expenses for this client.',
        });
        setCreating(false);
        return;
      }

      const client = clients.find((c) => c.id === invoiceClientId) ?? null;
      const settingsValue = settings ?? (await storage().getSettings());
      const { document } = createDocument({
        type: 'invoice',
        profile,
        settings: settingsValue,
        client,
        today,
      });

      const timeLines = timeLinesFromGroups(groups, projects, document.id, document.taxCodeId);
      const expenseLinesToAdd = expenseLines(clientExpenses, document.id, document.taxCodeId);
      const allLines = [...timeLines, ...expenseLinesToAdd];

      const result = calculate({ document, lines: allLines, payments: [], taxCodes });
      const withTotals = applyTotals({ ...document }, result);
      await storage().saveDocument(withTotals, allLines);

      // Mark the billed entries, so they never bill twice.
      const lineIdByEntry = new Map<string, string>();
      for (const group of groups) {
        for (const entry of group.entries) {
          const line = timeLines.find((l) => l.description === group.label);
          if (line) lineIdByEntry.set(entry.id, line.id);
        }
      }
      for (const marked of markTimeInvoiced(clientEntries, document.id, lineIdByEntry)) {
        await storage().saveTimeEntry(marked);
      }
      for (const expense of clientExpenses) {
        await storage().saveExpense({
          ...expense,
          invoicedOnDocumentId: document.id,
          updatedAt: new Date().toISOString(),
        });
      }

      // The retainer draws down by exactly what was billed: the time and
      // expense lines' gross, and the hours for a time-based retainer.
      if (invoiceClientId) {
        const drawnMinor = [...timeLines, ...expenseLinesToAdd].reduce((acc, line) => {
          const computed = result.lines.get(line.id);
          return acc + Math.max(0, computed?.gross ?? 0);
        }, 0);
        const drawnHours = groups.reduce((acc, group) => acc + group.hours, 0);
        await drawDownRetainers({ clientId: invoiceClientId, minor: drawnMinor, hours: drawnHours });
      }

      await refresh();
      push({
        tone: 'success',
        title: 'Draft invoice created',
        description: `${timeLines.length} time line(s), ${expenseLinesToAdd.length} expense line(s). Ready for your review.`,
      });
      navigate(`/invoices/${document.id}`);
    } catch (error) {
      push({
        tone: 'error',
        title: 'Could not create the invoice',
        description: error instanceof Error ? error.message : '',
      });
    } finally {
      setCreating(false);
    }
  };

  const unbilledForClient = useMemo(() => {
    if (!invoiceClientId) return { groups: [], expenses: 0 };
    return {
      groups: unbilledTimeGroups(
        timeEntries.filter((e) => e.clientId === invoiceClientId),
        projects,
        grouping,
      ),
      expenses: expenses.filter(
        (x) => x.clientId === invoiceClientId && x.billable && !x.invoicedOnDocumentId,
      ).length,
    };
  }, [invoiceClientId, timeEntries, projects, grouping, expenses]);

  const unbilledAmount = unbilledForClient.groups.reduce((acc, g) => acc + g.amountMinor, 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Time"
        subtitle="Start and stop a timer, or add entries by hand. Billable time and expenses become a draft invoice in one action."
      />

      {/* ---- timer ---- */}
      <Card className="mt-4 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-40">
            <p className="text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase">Timer</p>
            <p className="num font-display text-2xl font-semibold text-ink">
              {running
                ? `${Math.floor(runningHours)}:${String(Math.floor((runningHours % 1) * 60)).padStart(2, '0')}`
                : '0:00'}
            </p>
            {running && (
              <p className="text-[12px] text-ink-muted">
                {running.description || 'Untitled'} · started{' '}
                {date(new Date(running.timerStartedAt).toISOString(), settings)}
              </p>
            )}
          </div>
          {running ? (
            <Button
              size="sm"
              icon={<Pause className="size-3.5" aria-hidden />}
              onClick={() => void stopTimer()}
            >
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              icon={<Play className="size-3.5" aria-hidden />}
              onClick={() => void startTimer()}
            >
              Start timer
            </Button>
          )}
          {running && running.description === '' && (
            <Field label="What are you working on?" inline>
              <TextInput
                value={draft?.description ?? ''}
                onChange={(e) =>
                  setDraft({
                    clientId: draft?.clientId ?? '',
                    projectId: draft?.projectId ?? '',
                    description: e.target.value,
                    date: today,
                  })
                }
              />
            </Field>
          )}
        </div>
      </Card>

      {/* ---- invoice unbilled ---- */}
      <Card className="mt-4 p-4">
        <h2 className="mb-3 font-medium text-ink">Invoice unbilled time</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Client">
            <Select value={invoiceClientId} onChange={(e) => setInvoiceClientId(e.target.value)}>
              <option value="">Choose a client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Group lines by">
            <Select value={grouping} onChange={(e) => setGrouping(e.target.value as TimeGrouping)}>
              <option value="project">Project</option>
              <option value="date">Date</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <Checkbox
              checked={includeExpenses}
              label="Include billable expenses"
              onChange={setIncludeExpenses}
            />
          </div>
        </div>
        {invoiceClientId && (
          <p className="mt-3 text-[13px] text-ink-muted">
            {unbilledForClient.groups.length} group(s), {unbilledForClient.expenses} expense(s) — unbilled
            time {money(unbilledAmount, settings?.defaultCurrency ?? 'AUD')} at project rates.
          </p>
        )}
        <Button
          size="sm"
          className="mt-3"
          icon={<FileText className="size-3.5" aria-hidden />}
          onClick={() => void invoiceUnbilled()}
          disabled={creating || !invoiceClientId}
        >
          Create draft invoice
        </Button>
      </Card>

      {/* ---- entries ---- */}
      <Panel
        className="mt-4"
        title="Entries"
        description="Billable entries with no invoice are unbilled. The rate is the entry's override, else the project's."
        actions={
          <Button
            size="sm"
            icon={<Plus className="size-3.5" aria-hidden />}
            onClick={() => setDraft({ clientId: '', projectId: '', description: '', date: today })}
          >
            Add entry
          </Button>
        }
        flush
      >
        {draft && (
          <div className="border-b border-rule p-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Client">
                <Select
                  value={draft.clientId}
                  onChange={(e) => setDraft({ ...draft, clientId: e.target.value })}
                >
                  <option value="">No client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Project">
                <Select
                  value={draft.projectId}
                  onChange={(e) => setDraft({ ...draft, projectId: e.target.value })}
                >
                  <option value="">No project</option>
                  {projects
                    .filter((p) => !draft.clientId || p.clientId === draft.clientId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Date">
                <TextInput
                  type="date"
                  value={draft.date}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                />
              </Field>
              <Field label="Description">
                <TextInput
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </Field>
            </div>
            <Button size="sm" className="mt-3" onClick={() => void addManual()}>
              Add entry
            </Button>
          </div>
        )}
        {timeEntries.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-ink-muted">
            No entries yet. Start the timer or add one by hand.
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Description</Th>
                <Th>Project</Th>
                <Th align="right">Hours</Th>
                <Th align="right">Rate</Th>
                <Th>Billable</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {timeEntries.map((entry) => {
                const project = projects.find((p) => p.id === entry.projectId);
                const rate = entry.rateOverride ?? project?.hourlyRate ?? 0;
                return (
                  <tr key={entry.id}>
                    <Td className="whitespace-nowrap text-ink-muted">{date(entry.date, settings)}</Td>
                    <Td>
                      {entry.description || '—'}
                      {entry.timerStartedAt > 0 && (
                        <Chip tone="accent" className="ml-1.5">
                          running
                        </Chip>
                      )}
                      {entry.invoicedOnDocumentId && (
                        <Chip tone="neutral" className="ml-1.5">
                          invoiced
                        </Chip>
                      )}
                    </Td>
                    <Td className="text-ink-muted">{project?.name ?? '—'}</Td>
                    <Td numeric>{Number.parseFloat(entry.hours).toFixed(2)}</Td>
                    <Td numeric className="text-ink-muted">
                      {rate > 0 ? money(rate, settings?.defaultCurrency ?? 'AUD') : '—'}
                    </Td>
                    <Td>
                      {entry.billable ? <Badge>billable</Badge> : <span className="text-ink-faint">—</span>}
                    </Td>
                    <Td>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Trash2 className="size-3.5" aria-hidden />}
                        onClick={() => setConfirmId(entry.id)}
                      >
                        Delete
                      </Button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>

      <ConfirmDialog
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={() => confirmId && void remove(confirmId)}
        title="Delete this entry?"
        body="Invoiced entries are marked, so deleting one does not change an invoice."
        confirmLabel="Delete"
      />
    </div>
  );
}
