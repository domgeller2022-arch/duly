/**
 * The automation log.
 *
 * The plan's acceptance: "the automation log explains each action". Every
 * scheduler action writes a plain-English sentence — what happened, to what,
 * and whether the user needs to do anything — so this screen is a filter and
 * a table over that log rather than anything cleverer.
 */

import { useMemo, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useAppStore } from '@/state/app';
import { Button, Chip, Panel, Select, Table, Td, Th } from '@/ui/components/base';
import { PageHeader } from '@/ui/components/layout';
import { date, relative } from '@/ui/lib/format';
import type { AutomationLogEntry } from '@/core/schemas/automation';

const CATEGORY_LABELS: Record<AutomationLogEntry['category'], string> = {
  recurring: 'Recurring',
  overdue: 'Overdue',
  reminder: 'Reminder',
  late_fee: 'Late fee',
  quote_expiry: 'Quote expiry',
  scheduled_send: 'Scheduled send',
  rules: 'Rules',
  ai: 'AI',
  backup: 'Backup',
  pdf: 'PDF',
  bank_match: 'Bank match',
  system: 'System',
};

const CATEGORY_TONES: Partial<
  Record<AutomationLogEntry['category'], 'accent' | 'due' | 'overdue' | 'neutral'>
> = {
  recurring: 'accent',
  overdue: 'overdue',
  late_fee: 'overdue',
  quote_expiry: 'due',
  reminder: 'due',
  scheduled_send: 'accent',
  ai: 'neutral',
};

export function AutomationLogScreen() {
  const automationLog = useAppStore((s) => s.automationLog);
  const settings = useAppStore((s) => s.settings);
  const today = useAppStore((s) => s.today);
  const refresh = useAppStore((s) => s.refresh);
  const [category, setCategory] = useState<string>('all');
  const [onlyAttention, setOnlyAttention] = useState(false);

  const entries = useMemo(() => {
    let rows = automationLog;
    if (category !== 'all') rows = rows.filter((e) => e.category === category);
    if (onlyAttention) rows = rows.filter((e) => e.needsAttention);
    return rows;
  }, [automationLog, category, onlyAttention]);

  const attentionCount = useMemo(() => automationLog.filter((e) => e.needsAttention).length, [automationLog]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Automation log"
        subtitle="Everything the automation did, in plain English. Newest first."
        actions={
          <Button
            size="sm"
            icon={<RefreshCw className="size-3.5" aria-hidden />}
            onClick={() => void refresh()}
          >
            Refresh
          </Button>
        }
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="max-w-48">
          <option value="all">All categories</option>
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Select>
        {attentionCount > 0 && (
          <Chip tone={onlyAttention ? 'accent' : 'neutral'} onClick={() => setOnlyAttention(!onlyAttention)}>
            <AlertCircle className="size-3" aria-hidden /> {attentionCount} need
            {attentionCount === 1 ? 's' : ''} attention
          </Chip>
        )}
      </div>

      <Panel className="mt-4" flush>
        {entries.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-ink-muted">
            {automationLog.length === 0
              ? 'Nothing yet. The automation runs when the app opens and every 15 minutes.'
              : 'No entries match this filter.'}
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Category</Th>
                <Th>What happened</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <Td className="whitespace-nowrap text-ink-muted">
                    {date(entry.ranAt, settings)} · {relative(entry.ranAt, today)}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <Chip tone={CATEGORY_TONES[entry.category] ?? 'neutral'}>
                        {CATEGORY_LABELS[entry.category]}
                      </Chip>
                      {entry.needsAttention && <Chip tone="overdue">Needs attention</Chip>}
                    </div>
                  </Td>
                  <Td>
                    <p className="text-[13px] text-ink">{entry.message}</p>
                    {entry.detail && <p className="mt-0.5 text-[12px] text-ink-muted">{entry.detail}</p>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <p className="mt-3 text-[12px] text-ink-faint">
        Showing {entries.length} of {automationLog.length} entries.
        {settings?.automationEnabled === false && ' Automation is currently off in Settings → Automation.'}
      </p>
    </div>
  );
}
