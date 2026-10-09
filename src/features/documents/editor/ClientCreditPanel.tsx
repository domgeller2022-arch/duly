/**
 * Client credit on a draft.
 *
 * "Overpayments, tips and credit notes become a credit balance that can be applied
 * to the next invoice." Overpayments already become credit — the recording path
 * writes a credit row — and this is the other half: spending it.
 *
 * Credit is applied to a *draft* only. Once a document is finalised its balance is a
 * fact the client has already been told; changing it afterwards would be the exact
 * kind of quiet edit the lock exists to prevent. A client who wants the difference
 * back gets a refund or a credit note, which is on the record.
 */

import { useState } from 'react';
import { PiggyBank } from 'lucide-react';
import { useEditorStore } from './editorStore';
import { money } from '@/ui/lib/format';
import { Alert, Button, Card, CurrencyInput, Field, Switch } from '@/ui/components/base';

export function ClientCreditPanel() {
  const document = useEditorStore((s) => s.document);
  const result = useEditorStore((s) => s.result);
  const client = useEditorStore((s) => s.client);
  const unappliedCredit = useEditorStore((s) => s.unappliedCredit);
  const applyCredit = useEditorStore((s) => s.applyCredit);

  const [open, setOpen] = useState(false);

  if (!client || !document) return null;

  const available = unappliedCredit();
  const currency = document.currency;
  const applied = document.clientCreditApplied;
  const locked = document.status !== 'draft';

  if (available <= 0 && applied <= 0) return null;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <PiggyBank className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
          <div>
            <p className="text-[13px] font-medium text-ink">Client credit</p>
            <p className="mt-0.5 text-[12px] text-ink-muted">
              {applied > 0
                ? `${money(applied, currency)} of credit has been applied to this document.`
                : `${money(available, currency)} held for ${client.displayName}, from an overpayment or a returned credit note.`}
            </p>
          </div>
        </div>

        {!locked && applied === 0 && available > 0 && (
          <Button size="sm" variant={open ? 'quiet' : 'secondary'} onClick={() => setOpen((v) => !v)}>
            {open ? 'Cancel' : `Apply ${money(Math.min(available, result?.total ?? 0), currency)}`}
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-rule pt-3">
          <ApplyForm
            available={available}
            total={result?.total ?? 0}
            currency={currency}
            onApply={(minor) => {
              applyCredit(minor);
              setOpen(false);
            }}
          />

          {available > (result?.total ?? 0) && (
            <Alert tone="info">
              Only {money(result?.total ?? 0, currency)} of the credit can be used here — an invoice cannot be
              reduced below zero. The rest stays available for the next one.
            </Alert>
          )}
        </div>
      )}

      {locked && applied > 0 && (
        <p className="mt-2 text-[12px] text-ink-faint">
          Credit is applied to drafts only. This document is finalised, so its balance is fixed.
        </p>
      )}
    </Card>
  );
}

function ApplyForm({
  available,
  total,
  currency,
  onApply,
}: {
  available: number;
  total: number;
  currency: string;
  onApply: (minor: number) => void;
}) {
  const [amount, setAmount] = useState(Math.min(available, total));
  const [all, setAll] = useState(true);

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Credit to apply" hint={`Up to ${money(Math.min(available, total), currency)}`}>
          <CurrencyInput
            value={amount}
            currency={currency}
            onChange={(minor) => {
              setAmount(minor);
              setAll(false);
            }}
          />
        </Field>

        <div className="flex items-end pb-1.5">
          <Switch
            checked={all}
            label="Use everything available"
            onChange={(checked) => {
              setAll(checked);
              if (checked) setAmount(Math.min(available, total));
            }}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant="primary" disabled={amount <= 0} onClick={() => onApply(amount)}>
          Take {money(amount, currency)} off this invoice
        </Button>
      </div>
    </>
  );
}
