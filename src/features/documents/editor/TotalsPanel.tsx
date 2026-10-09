/**
 * The totals panel.
 *
 * Every figure comes from the calculation engine, recomputed on every edit — the
 * cached totals on the record are never read for display. The identity the panel
 * maintains, and the one a client checks on the printed invoice, is:
 *
 *     Subtotal + Discount + GST = Total
 *
 * The tax breakdown is shown whenever a document mixes taxable and zero-rated
 * lines, because the ATO requires the document to show which items are taxable.
 */

import { AlertCircle, Info } from 'lucide-react';
import { useEditorStore } from './editorStore';
import { depositAmount } from '@/core/documents';
import { formatMoney } from '@/core/money/money';
import { Card } from '@/ui/components/base';
import { date } from '@/ui/lib/format';
import { useAppStore } from '@/state/app';
import { cn } from '@/ui/lib/cn';

export function TotalsPanel() {
  const document = useEditorStore((s) => s.document);
  const result = useEditorStore((s) => s.result);
  const settings = useAppStore((s) => s.settings);

  if (!document || !result) return null;

  const currency = document.currency;
  const showBreakdown = result.taxGroups.length > 0;
  const showMarkerKey = result.hasMixedTaxability && result.markerCodes.length > 0;
  const deposit = depositAmount(result.total, document.deposit);
  const gstRegistered = document.taxSnapshot?.gstRegistered;
  const inclusive = document.taxMode === 'inclusive';

  return (
    <Card>
      <div className="ml-auto w-full max-w-sm space-y-1.5">
        {/* ---- subtotal ---- */}
        <Row label="Subtotal" value={formatMoney({ minor: result.subtotal, currency })} />

        {/* ---- discount ---- */}
        {result.discount !== 0 && (
          <Row
            label={result.discount < 0 ? 'Discount' : 'Surcharge'}
            value={formatMoney({ minor: result.discount, currency })}
            tone={result.discount < 0 ? 'paid' : 'due'}
          />
        )}

        {/* ---- tax ---- */}
        {showBreakdown &&
          result.taxGroups.map((group) => (
            <div key={group.taxCodeId} className="space-y-1">
              {result.taxGroups.length > 1 && (
                <Row
                  label={
                    <span className="flex items-center gap-1.5">
                      {gstRegistered && group.taxCodeId === 'tax_gst' ? 'GST' : group.name}
                      {group.needsMarker && <span className="text-due">*</span>}
                      {result.taxGroups.length > 1 && (
                        <span className="text-[11px] text-ink-faint">({group.rateLabel})</span>
                      )}
                    </span>
                  }
                  value={formatMoney({ minor: group.tax, currency })}
                  muted={!group.taxable}
                />
              )}
            </div>
          ))}

        {/* A single tax code still needs its row, just without the group label. */}
        {showBreakdown && result.taxGroups.length === 1 && result.tax !== 0 && (
          <Row
            label={gstRegistered === false ? 'Tax' : 'GST'}
            value={formatMoney({ minor: result.tax, currency })}
          />
        )}

        {/* ---- total ---- */}
        <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-rule pt-2">
          <span className="font-display text-[15px] font-semibold text-ink">Total</span>
          <span className="font-display text-lg font-semibold tabular-nums text-ink">
            {formatMoney({ minor: result.total, currency })}
          </span>
        </div>

        {inclusive && result.tax !== 0 && (
          <Row
            label="Total including GST"
            value={formatMoney({ minor: result.total, currency })}
            muted
            small
          />
        )}

        {/* ---- payments ---- */}
        {result.paid !== 0 && (
          <Row label="Amount paid" value={formatMoney({ minor: result.paid, currency })} tone="paid" />
        )}

        {/* ---- credit ---- */}
        {result.creditApplied > 0 && (
          <Row
            label="Credit applied"
            value={formatMoney({ minor: -result.creditApplied, currency })}
            tone="paid"
          />
        )}

        {/* ---- balance ---- */}
        <div
          className={cn(
            'mt-1 flex items-baseline justify-between gap-4 border-t border-rule pt-2',
            result.balance < 0 && 'text-paid',
            result.balance > 0 && document.status !== 'draft' && 'text-overdue',
          )}
        >
          <span className="text-[13px] font-medium text-ink">
            {result.balance <= 0 ? 'Balance' : 'Balance due'}
          </span>
          <span className="num text-[15px] font-semibold">
            {formatMoney({ minor: result.balance, currency })}
          </span>
        </div>

        {/* ---- deposit ---- */}
        {document.deposit.enabled && (
          <>
            <Row
              label={document.deposit.paid ? 'Deposit received' : document.deposit.label}
              value={formatMoney({ minor: document.deposit.paid ? deposit : deposit, currency })}
              tone={document.deposit.paid ? 'paid' : 'due'}
            />
            {!document.deposit.paid && deposit < result.total && (
              <Row
                label="Balance on delivery"
                value={formatMoney({ minor: result.total - deposit, currency })}
                muted
                small
              />
            )}
          </>
        )}

        {/* ---- AUD equivalent ---- */}
        {result.audEquivalent !== null && (
          <Row
            label={`AUD equivalent`}
            value={formatMoney({ minor: result.audEquivalent, currency: 'AUD' })}
            muted
            small
          />
        )}
      </div>

      {/* ---- tax marker key ---- */}
      {showMarkerKey && (
        <p className="mt-3 flex items-start gap-1.5 border-t border-rule pt-2 text-[11px] leading-relaxed text-ink-muted">
          <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>
            * {result.markerCodes.map((m) => m.label ?? m.name).join(' · ')}. GST applies to the remaining
            lines.
          </span>
        </p>
      )}

      {/* ---- an unregistered business ---- */}
      {gstRegistered === false && result.tax === 0 && (
        <p className="mt-3 flex items-start gap-1.5 border-t border-rule pt-2 text-[11px] text-ink-muted">
          <AlertCircle className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>No GST has been charged, because this business is not registered.</span>
        </p>
      )}

      {/* ---- due date ---- */}
      {document.dueDate && result.balance > 0 && (
        <p className="mt-2 text-[11px] text-ink-muted">
          Due {date(document.dueDate, settings)}
          {result.balance > 0 && document.status !== 'draft' && (
            <>
              {' · '}
              {result.balance >= 0 ? 'outstanding' : 'in credit'}
            </>
          )}
        </p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Row                                                                 */
/* ------------------------------------------------------------------ */

function Row({
  label,
  value,
  tone,
  muted,
  small,
}: {
  label: React.ReactNode;
  value: string;
  tone?: 'paid' | 'due' | 'overdue';
  muted?: boolean;
  small?: boolean;
}) {
  const toneClass =
    tone === 'paid' ? 'text-paid' : tone === 'due' ? 'text-due' : tone === 'overdue' ? 'text-overdue' : '';

  return (
    <div className={cn('flex items-baseline justify-between gap-4', small && 'text-[12px]')}>
      <span className={cn('text-ink', muted ? 'text-ink-muted' : 'text-[13px]')}>{label}</span>
      <span className={cn('num font-medium text-ink', toneClass)}>{value}</span>
    </div>
  );
}
