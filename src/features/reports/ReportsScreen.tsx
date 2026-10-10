/**
 * Reports: aged receivables, income, and the GST summary.
 *
 * The plan's item 8. Each report is one computation over the stored documents
 * and payments, with a CSV export — "reports export" is a Phase 6 item, and
 * the same table that reads well on screen reads well as a CSV.
 *
 * Aged receivables reuse the dashboard's buckets, so the dashboard tile and
 * this report can never disagree.
 */

import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { useAppStore } from '@/state/app';
import { files } from '@/adapters';
import { AGE_BUCKETS, ageBucket } from '@/lib/automation/overdue';
import { tableCsv } from '@/lib/exports';
import { runAiTask, redactForAi } from '@/lib/ai';
import { askDataTask } from '@/lib/aiTasks';
import { Sparkles } from 'lucide-react';
import { Alert, Button, Panel, Select, Table, Td, TextInput, Th, useToast } from '@/ui/components/base';
import { PageHeader } from '@/ui/components/layout';
import { compactMoney, money, moneyWithCode } from '@/ui/lib/format';

type Report = 'aged' | 'income' | 'gst';

const REPORT_LABELS: Record<Report, string> = {
  aged: 'Aged receivables',
  income: 'Income',
  gst: 'GST summary',
};

/** The last `count` month keys, oldest first: 2025-11 … 2026-10. */
function monthKeys(today: string, count: number): string[] {
  const [y, m] = today.split('-').map(Number);
  const keys: string[] = [];
  let year = y;
  let month = m;
  for (let i = 0; i < count; i++) {
    keys.unshift(`${year}-${String(month).padStart(2, '0')}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return keys;
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[m - 1]} ${y}`;
}

/** Quarter key for an ISO date: 2026-Q4. */
function quarterKey(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

export function ReportsScreen() {
  const { push } = useToast();
  const documents = useAppStore((s) => s.documents);
  const payments = useAppStore((s) => s.payments);
  const clients = useAppStore((s) => s.clients);
  const profiles = useAppStore((s) => s.profiles);
  const activeProfileId = useAppStore((s) => s.activeProfileId);
  const settings = useAppStore((s) => s.settings);
  const today = useAppStore((s) => s.today);
  const [report, setReport] = useState<Report>('aged');

  // The business selected in the switcher, not the first one in the list:
  // summing (or scoping to) the wrong business is a silently wrong report.
  const profile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? null;
  const currency = profile?.defaultCurrency ?? settings?.defaultCurrency ?? 'AUD';
  const symbol = currency === 'AUD' || currency === 'NZD' || currency === 'USD' ? '$' : currency;

  /**
   * The active business's issued invoices, in the currency the report
   * presents — summing dollars and yen into one figure is not a report.
   */
  const invoices = useMemo(
    () =>
      documents.filter(
        (d) =>
          d.type === 'invoice' &&
          d.status !== 'draft' &&
          d.status !== 'void' &&
          d.profileId === profile?.id &&
          d.currency === currency,
      ),
    [documents, profile?.id, currency],
  );

  /** Issued credit notes, scoped the same way: money coming back off. */
  const creditNotes = useMemo(
    () =>
      documents.filter(
        (d) =>
          d.type === 'credit_note' &&
          d.status !== 'draft' &&
          d.status !== 'void' &&
          d.profileId === profile?.id &&
          d.currency === currency,
      ),
    [documents, profile?.id, currency],
  );

  /* ---- aged receivables, per client ---- */
  const aged = useMemo(() => {
    const buckets = new Map<string, { total: number; count: number }>();
    for (const bucket of AGE_BUCKETS) buckets.set(bucket.key, { total: 0, count: 0 });

    const perClient = new Map<string, { total: number; count: number; buckets: Map<string, number> }>();
    for (const doc of invoices) {
      if (doc.totals.balance <= 0) continue;
      const key = ageBucket(doc.dueDate, today);
      const entry = buckets.get(key)!;
      entry.total += doc.totals.balance;
      entry.count += 1;

      const clientId = doc.clientId ?? '';
      const clientEntry = perClient.get(clientId) ?? {
        total: 0,
        count: 0,
        buckets: new Map<string, number>(AGE_BUCKETS.map((b) => [b.key, 0])),
      };
      clientEntry.total += doc.totals.balance;
      clientEntry.count += 1;
      clientEntry.buckets.set(key, (clientEntry.buckets.get(key) ?? 0) + doc.totals.balance);
      perClient.set(clientId, clientEntry);
    }

    const grand = [...buckets.values()].reduce((acc, b) => acc + b.total, 0);
    return {
      rows: AGE_BUCKETS.map((b) => ({ ...b, ...buckets.get(b.key)! })),
      perClient: [...perClient.entries()].sort((a, b) => b[1].total - a[1].total),
      grand,
    };
  }, [invoices, today]);

  /* ---- income: invoiced and paid per month, last 12 months ---- */
  const income = useMemo(() => {
    const keys = monthKeys(today, 12);
    const invoiced = new Map<string, number>(keys.map((k) => [k, 0]));
    const paid = new Map<string, number>(keys.map((k) => [k, 0]));

    for (const doc of invoices) {
      const key = doc.issueDate.slice(0, 7);
      if (invoiced.has(key)) invoiced.set(key, (invoiced.get(key) ?? 0) + doc.totals.total);
    }
    // Receipts count against the month the money landed, and only for the
    // invoices this report is about.
    const invoiceIds = new Set(invoices.map((d) => d.id));
    for (const payment of payments) {
      if (!invoiceIds.has(payment.documentId)) continue;
      const key = payment.date.slice(0, 7);
      if (paid.has(key)) paid.set(key, (paid.get(key) ?? 0) + payment.amount);
    }

    return keys.map((key) => ({ key, invoiced: invoiced.get(key) ?? 0, paid: paid.get(key) ?? 0 }));
  }, [invoices, payments, today]);

  /* ---- GST: tax total per quarter, last 4 quarters ---- */
  const gst = useMemo(() => {
    const keys = new Map<string, { tax: number; invoiced: number; count: number }>();
    const current = quarterKey(today);
    const currentYear = Number(current.split('-')[0]);
    const currentQ = Number(current.split('-Q')[1]);
    for (let i = 0; i < 4; i++) {
      let year = currentYear;
      let q = currentQ - i;
      if (q <= 0) {
        q += 4;
        year -= 1;
      }
      keys.set(`${year}-Q${q}`, { tax: 0, invoiced: 0, count: 0 });
    }

    for (const doc of invoices) {
      const key = quarterKey(doc.issueDate);
      const entry = keys.get(key);
      if (!entry) continue;
      // gstPayable is the GST-coded lines only — a custom-rate code is not
      // GST collected, whatever the BAS says next.
      entry.tax += doc.totals.gstPayable;
      entry.invoiced += doc.totals.total;
      entry.count += 1;
    }
    for (const note of creditNotes) {
      const key = quarterKey(note.issueDate);
      const entry = keys.get(key);
      if (!entry) continue;
      // A credit note takes GST back off the quarter it was issued in.
      entry.tax += note.totals.gstPayable;
      entry.invoiced += note.totals.total;
    }

    return [...keys.entries()]
      .map(([key, entry]) => ({ key, ...entry }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [invoices, creditNotes, today]);

  const gstLabel = (key: string): string => key.replace('-Q', ' Q');

  /** The read-only context ask-your-data answers from: the report numbers,
   *  redacted per the switch before it can reach a cloud model. */
  const askDataContext = useMemo(() => {
    const raw = [
      `Outstanding: ${money(aged.grand, currency)} across ${aged.perClient.length} client(s).`,
      ...aged.perClient.slice(0, 5).map(([clientId, entry]) => {
        const name = clients.find((c) => c.id === clientId)?.displayName ?? 'No client';
        return `  ${name} owes ${money(entry.total, currency)}.`;
      }),
      `Invoiced last 12 months: ${money(
        income.reduce((acc, r) => acc + r.invoiced, 0),
        currency,
      )}; received ${money(
        income.reduce((acc, r) => acc + r.paid, 0),
        currency,
      )}.`,
      ...gst.map(
        (row) =>
          `  ${row.key}: ${money(row.tax, currency)} GST on ${money(row.invoiced, currency)} invoiced.`,
      ),
    ].join('\n');
    // The redaction switch covers exactly this: incidental context on its way
    // to somebody else's server. The invoice-entry instruction and the
    // receipt photo are the user's own request and cannot be redacted
    // without destroying it.
    return settings?.aiRedact ? redactForAi(raw, clients.map((c) => c.displayName)) : raw;
  }, [aged, income, gst, clients, currency, settings?.aiRedact]);

  const download = () => {
    if (report === 'aged') {
      const csv = tableCsv({
        title: 'aged-receivables',
        headers: ['Client', ...AGE_BUCKETS.map((b) => b.label), 'Total'],
        rows: aged.perClient.map(([clientId, entry]) => [
          clients.find((c) => c.id === clientId)?.displayName ?? 'No client',
          ...AGE_BUCKETS.map((b) => entry.buckets.get(b.key) ?? 0),
          entry.total,
        ]),
        meta: [
          ['As at', today],
          ['Outstanding', moneyWithCode(aged.grand, currency)],
        ],
      });
      void downloadCsv(`aged-receivables-${today}.csv`, csv);
    } else if (report === 'income') {
      const csv = tableCsv({
        title: 'income',
        headers: ['Month', 'Invoiced', 'Received'],
        rows: income.map((row) => [monthLabel(row.key), row.invoiced, row.paid]),
        meta: [['Year to', monthLabel(today.slice(0, 7))]],
      });
      void downloadCsv(`income-${today}.csv`, csv);
    } else {
      const csv = tableCsv({
        title: 'gst-summary',
        headers: ['Quarter', 'Invoices', 'Invoiced', 'GST collected'],
        rows: gst.map((row) => [gstLabel(row.key), row.count, row.invoiced, row.tax]),
        meta: [['As at', today]],
      });
      void downloadCsv(`gst-summary-${today}.csv`, csv);
    }
  };

  const downloadCsv = async (name: string, csv: string) => {
    try {
      await files().saveAs(name, new Blob([csv], { type: 'text/csv' }));
    } catch (error) {
      push({
        tone: 'error',
        title: 'Could not export',
        description: error instanceof Error ? error.message : '',
      });
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Reports"
        subtitle="Aged receivables, income and GST, computed from what is stored. Nothing leaves the app unless you export it."
        actions={
          <Button size="sm" icon={<Download className="size-3.5" aria-hidden />} onClick={download}>
            Download CSV
          </Button>
        }
      />

      <AskDataPanel context={askDataContext} aiEnabled={settings?.aiEnabled === false ? false : true} />

      <div className="mt-4">
        <Select value={report} onChange={(e) => setReport(e.target.value as Report)} className="max-w-56">
          {Object.entries(REPORT_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      {report === 'aged' && (
        <>
          <Panel
            className="mt-4"
            title="Aged receivables"
            description={`${moneyWithCode(aged.grand, currency)} outstanding`}
            flush
          >
            <Table>
              <thead>
                <tr>
                  <Th>Client</Th>
                  {AGE_BUCKETS.map((b) => (
                    <Th key={b.key} align="right">
                      {b.label}
                    </Th>
                  ))}
                  <Th align="right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {aged.perClient.map(([clientId, entry]) => (
                  <tr key={clientId}>
                    <Td className="font-medium">
                      {clients.find((c) => c.id === clientId)?.displayName ?? 'No client'}
                    </Td>
                    {AGE_BUCKETS.map((b) => {
                      const value = entry.buckets.get(b.key) ?? 0;
                      return (
                        <Td
                          key={b.key}
                          numeric
                          className={value > 0 && b.key !== 'current' ? 'text-overdue' : ''}
                        >
                          {value > 0 ? compactMoney(value, currency, symbol) : '—'}
                        </Td>
                      );
                    })}
                    <Td numeric className="font-medium">
                      {compactMoney(entry.total, currency, symbol)}
                    </Td>
                  </tr>
                ))}
                {aged.perClient.length === 0 && (
                  <tr>
                    <Td colSpan={AGE_BUCKETS.length + 2}>Nothing outstanding.</Td>
                  </tr>
                )}
              </tbody>
            </Table>
          </Panel>
          <Panel className="mt-4" title="By bucket" flush>
            <Table>
              <thead>
                <tr>
                  <Th>Bucket</Th>
                  <Th align="right">Invoices</Th>
                  <Th align="right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {aged.rows.map((row) => (
                  <tr key={row.key}>
                    <Td>{row.label}</Td>
                    <Td numeric>{row.count}</Td>
                    <Td numeric>{money(row.total, currency)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        </>
      )}

      {report === 'income' && (
        <Panel className="mt-4" title="Income" description="Invoiced and received, last 12 months" flush>
          <Table>
            <thead>
              <tr>
                <Th>Month</Th>
                <Th align="right">Invoiced</Th>
                <Th align="right">Received</Th>
              </tr>
            </thead>
            <tbody>
              {income.map((row) => (
                <tr key={row.key}>
                  <Td>{monthLabel(row.key)}</Td>
                  <Td numeric>{row.invoiced > 0 ? money(row.invoiced, currency) : '—'}</Td>
                  <Td numeric>{row.paid > 0 ? money(row.paid, currency) : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}

      {report === 'gst' && (
        <Panel
          className="mt-4"
          title="GST summary"
          description="Collected per quarter, from finalised invoices"
          flush
        >
          <Table>
            <thead>
              <tr>
                <Th>Quarter</Th>
                <Th align="right">Invoices</Th>
                <Th align="right">Invoiced</Th>
                <Th align="right">GST collected</Th>
              </tr>
            </thead>
            <tbody>
              {gst.map((row) => (
                <tr key={row.key}>
                  <Td>{gstLabel(row.key)}</Td>
                  <Td numeric>{row.count}</Td>
                  <Td numeric>{row.invoiced > 0 ? money(row.invoiced, currency) : '—'}</Td>
                  <Td numeric>{row.tax > 0 ? money(row.tax, currency) : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </div>
  );
}

/**
 * Ask-your-data: the plan's first-wave feature. The read-only report context
 * (aged receivables, income, GST) is put in the prompt, and the AI answers
 * from ONLY that — there are no write tools, so a question can never change
 * anything.
 */
function AskDataPanel({ context, aiEnabled }: { context: string; aiEnabled: boolean }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const ask = async () => {
    if (!question.trim()) return;
    setRunning(true);
    setError('');
    setAnswer('');
    try {
      const result = await runAiTask(askDataTask, { context, question });
      if (!result.ok || !result.value) {
        setError(result.error ?? 'No answer.');
        return;
      }
      setAnswer(result.value.answer);
    } finally {
      setRunning(false);
    }
  };

  if (!aiEnabled) return null;

  return (
    <Panel
      className="mt-4"
      title="Ask your data"
      description="Answers from the reports on this screen only. Read-only — a question can never change anything."
    >
      <div className="grid gap-3">
        <div className="flex gap-2">
          <TextInput
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !running && void ask()}
            placeholder="Who owes me the most?"
          />
          <Button
            size="sm"
            variant="primary"
            icon={<Sparkles className="size-3.5" aria-hidden />}
            onClick={() => void ask()}
            disabled={running || !question.trim()}
          >
            {running ? 'Reading…' : 'Ask'}
          </Button>
        </div>
        {error && (
          <Alert tone="error" title="Could not answer">
            {error}
          </Alert>
        )}
        {answer && (
          <div className="rounded-[8px] border border-rule bg-paper-sunken p-3">
            <p className="text-[13px] text-ink">{answer}</p>
          </div>
        )}
      </div>
    </Panel>
  );
}
