/**
 * The aged receivables chart.
 *
 * Horizontal bars rather than a pie: an accountant reads an ageing report by
 * comparing lengths across five buckets, and the longest bar is the one that
 * needs chasing. Every bar is also labelled with the exact figure, so the chart
 * never has to be measured.
 */

import { formatMoney } from '@/core/money/money';
import { cn } from '@/ui/lib/cn';

export interface AgeRow {
  key: string;
  label: string;
  total: number;
  count: number;
}

/** Colour ramp from current to 90+ days: calm through to alarming. */
const RAMP = ['bg-paid', 'bg-accent', 'bg-due', 'bg-overdue/80', 'bg-overdue'] as const;

export function DashboardChart({
  rows,
  currency,
  total,
}: {
  rows: AgeRow[];
  currency: string;
  total: number;
}) {
  const max = Math.max(1, ...rows.map((r) => r.total));

  return (
    <div className="p-4">
      <div className="mb-3 flex h-2.5 w-full overflow-hidden rounded-full bg-paper-sunken">
        {rows.map((row, i) =>
          row.total > 0 ? (
            <div
              key={row.key}
              className={cn('h-full transition-[width] duration-150', RAMP[i])}
              style={{ width: `${(row.total / Math.max(1, total)) * 100}%` }}
              title={`${row.label}: ${formatMoney({ minor: row.total, currency })}`}
            />
          ) : null,
        )}
      </div>

      <ul className="space-y-2">
        {rows.map((row, i) => (
          <li key={row.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
            <div className="flex items-center gap-2">
              <span
                className={cn('size-2 shrink-0 rounded-[2px]', row.total > 0 ? RAMP[i] : 'bg-rule')}
                aria-hidden
              />
              <span className="text-[13px] text-ink">{row.label}</span>
              {row.count > 0 && (
                <span className="text-[11px] text-ink-faint">
                  {row.count} invoice{row.count === 1 ? '' : 's'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {/* The bar itself, so the proportion is readable at a glance. */}
              <div className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-paper-sunken sm:block">
                <div
                  className={cn('h-full rounded-full', row.total > 0 ? RAMP[i] : 'bg-transparent')}
                  style={{ width: `${(row.total / max) * 100}%` }}
                />
              </div>
              <span className="num w-24 text-[13px] font-medium text-ink">
                {formatMoney({ minor: row.total, currency })}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A compact monthly income column chart for the reports screen.
 *
 * Bars rather than a line, because these are discrete months with a value each,
 * and a line would imply interpolation between them that does not exist.
 */
export function IncomeBars({
  data,
  currency,
  height = 160,
}: {
  data: { label: string; value: number }[];
  currency: string;
  height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-1.5" style={{ height }} role="img" aria-label="Income by month">
        {data.map((d) => {
          const pct = (d.value / max) * 100;
          return (
            <div
              key={d.label}
              className="group relative flex min-w-0 flex-1 flex-col items-center justify-end"
            >
              <div
                className="w-full rounded-t-[3px] bg-accent/85 transition-colors group-hover:bg-accent"
                style={{ height: `${Math.max(1, pct)}%` }}
                title={`${d.label}: ${formatMoney({ minor: d.value, currency })}`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5">
        {data.map((d) => (
          <span key={d.label} className="min-w-0 flex-1 truncate text-center text-[10px] text-ink-faint">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Horizontal bars for "income by client" or "income by item". */
export function CategoryBars({
  rows,
  currency,
  limit = 8,
}: {
  rows: { label: string; value: number; detail?: string }[];
  currency: string;
  limit?: number;
}) {
  const top = rows.slice(0, limit);
  const max = Math.max(1, ...top.map((r) => r.value));

  return (
    <ul className="space-y-2.5">
      {top.map((row) => (
        <li key={row.label}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-[13px] text-ink">{row.label}</span>
            <span className="num shrink-0 text-[13px] font-medium text-ink">
              {formatMoney({ minor: row.value, currency })}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-paper-sunken">
            <div
              className="h-full rounded-full bg-accent/85"
              style={{ width: `${(row.value / max) * 100}%` }}
            />
          </div>
          {row.detail && <p className="mt-0.5 text-[11px] text-ink-faint">{row.detail}</p>}
        </li>
      ))}
    </ul>
  );
}
