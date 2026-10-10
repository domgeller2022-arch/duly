/**
 * The document header form.
 *
 * Client, dates, terms, currency, tax mode, PO number and reference. Every field
 * is live: picking a client applies their defaults in one go, and changing the
 * issue date or terms recalculates the due date immediately so a stale due date
 * can never be submitted.
 */

import { useMemo } from 'react';
import type { Client, Document } from '@/core/schemas';
import { useAppStore } from '@/state/app';
import { useEditorStore } from './editorStore';
import { dueDateFor } from '@/core/validation/dates';
import { CURRENCIES, getCurrency } from '@/core/money/currencies';
import { Button, Card, CurrencyInput, CurrencySelect, Field, NumberInput, Select, TextInput } from '@/ui/components/base';
import { ALL_TERMS } from './terms';
import { depositAmount } from '@/core/documents';
import { Badge } from '@/ui/components/base';
import { CustomFieldInputs } from '@/ui/components/custom-fields';

export function DocumentHeaderForm({
  document: doc,
  locked,
  onPatch,
  onClientChange,
}: {
  document: Document;
  locked: boolean;
  onPatch: (patch: Partial<Document>) => void;
  onClientChange: (client: Client | null) => void;
}) {
  const clients = useAppStore((s) => s.clients);
  const profiles = useAppStore((s) => s.profiles);
  const settings = useAppStore((s) => s.settings);
  const result = useEditorStore((s) => s.result);
  const customFields = useAppStore((s) => s.customFields);

  const isQuote = doc.type === 'quote';
  const isCreditNote = doc.type === 'credit_note';

  /** Terms that make sense for this document type. */
  const terms = useMemo(() => ALL_TERMS(settings), [settings]);

  const deposit = doc.deposit.enabled ? depositAmount(result?.total ?? 0, doc.deposit) : 0;

  return (
    <Card className="space-y-4">
      {/* ---- business and client ---- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Business" hint="Set in the sidebar switcher">
          <Select
            value={doc.profileId}
            disabled={locked || profiles.length <= 1}
            onChange={(e) => onPatch({ profileId: e.target.value })}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Client"
          required={!isQuote}
          hint={!locked && doc.clientId ? 'Changing the client applies their defaults' : undefined}
        >
          <Select
            value={doc.clientId ?? ''}
            disabled={locked}
            onChange={(e) => onClientChange(clients.find((c) => c.id === e.target.value) ?? null)}
          >
            <option value="">No client yet</option>
            {clients
              .filter((c) => !c.archived)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
          </Select>
        </Field>
      </div>

      {/* ---- dates and terms ---- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Issue date" required>
          <TextInput
            type="date"
            value={doc.issueDate}
            disabled={locked}
            onChange={(e) => {
              const issueDate = e.target.value;
              // The due date follows the issue date and terms, always.
              onPatch({ issueDate, dueDate: dueDateFor(issueDate, doc.termsId, terms) });
            }}
          />
        </Field>

        <Field label="Payment terms" required={!isQuote}>
          <Select
            value={doc.termsId}
            disabled={locked}
            onChange={(e) => {
              const termsId = e.target.value;
              onPatch({ termsId, dueDate: dueDateFor(doc.issueDate, termsId, terms) });
            }}
          >
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={isQuote ? 'Valid until' : 'Due date'}>
          {isQuote ? (
            <TextInput
              type="date"
              value={doc.quoteValidUntil ?? ''}
              disabled={locked}
              onChange={(e) => onPatch({ quoteValidUntil: e.target.value })}
            />
          ) : (
            <TextInput
              type="date"
              value={doc.dueDate ?? ''}
              disabled={locked || isCreditNote}
              onChange={(e) => onPatch({ dueDate: e.target.value })}
            />
          )}
        </Field>

        <Field label="Currency" required>
          <CurrencySelect
            value={doc.currency}
            disabled={locked}
            onChange={(currency: string) => onPatch({ currency })}
            options={CURRENCIES.map((c) => ({ code: c.code, name: c.name }))}
          />
        </Field>
      </div>

      {/* ---- tax mode, PO, reference ---- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field
          label="Pricing"
          hint={
            doc.taxMode === 'inclusive'
              ? 'Listed prices contain GST, which is extracted at 1/11'
              : 'GST is added on top of the listed prices'
          }
        >
          <Select
            value={doc.taxMode}
            disabled={locked}
            onChange={(e) => onPatch({ taxMode: e.target.value as 'exclusive' | 'inclusive' })}
          >
            <option value="exclusive">Exclusive of GST</option>
            <option value="inclusive">Inclusive of GST</option>
          </Select>
        </Field>

        <Field label="PO number">
          <TextInput
            value={doc.poNumber}
            disabled={locked}
            placeholder="Client's purchase order"
            onChange={(e) => onPatch({ poNumber: e.target.value })}
          />
        </Field>

        <Field label="Reference" hint="Your own reference, e.g. a job number">
          <TextInput
            value={doc.reference}
            disabled={locked}
            onChange={(e) => onPatch({ reference: e.target.value })}
          />
        </Field>
      </div>

      {/* ---- default tax code ---- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Default tax code" hint="Applies to lines that do not set their own">
          <Select
            value={doc.taxCodeId ?? ''}
            disabled={locked}
            onChange={(e) => onPatch({ taxCodeId: e.target.value || null })}
          >
            <option value="">GST (10%)</option>
            <DefaultTaxOptions />
          </Select>
        </Field>

        <Field label="Design template">
          <TemplateSelect
            value={doc.designTemplateId}
            disabled={locked}
            onChange={(designTemplateId) => onPatch({ designTemplateId })}
          />
        </Field>
      </div>

      {/* ---- deposit ---- */}
      {!isQuote && !isCreditNote && (
        <div className="rounded-[8px] border border-rule bg-paper-sunken/50 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium text-ink">Request a deposit</p>
              <p className="text-[12px] text-ink-muted">
                A percentage or a fixed amount, shown on the document as due on acceptance.
              </p>
            </div>
            <DepositToggle
              enabled={doc.deposit.enabled}
              disabled={locked}
              onChange={(enabled) => onPatch({ deposit: { ...doc.deposit, enabled } })}
            />
          </div>

          {doc.deposit.enabled && (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Kind">
                <Select
                  value={doc.deposit.kind}
                  disabled={locked}
                  onChange={(e) =>
                    onPatch({ deposit: { ...doc.deposit, kind: e.target.value as 'percent' | 'fixed' } })
                  }
                >
                  <option value="percent">Percentage of the total</option>
                  <option value="fixed">Fixed amount</option>
                </Select>
              </Field>

              <Field label={doc.deposit.kind === 'percent' ? 'Percentage' : 'Amount'}>
                {doc.deposit.kind === 'percent' ? (
                  <NumberInput
                    value={doc.deposit.value}
                    disabled={locked}
                    ariaLabel="Deposit percentage"
                    onChange={(value) => onPatch({ deposit: { ...doc.deposit, value } })}
                  />
                ) : (
                  // CurrencyInput keeps the typed draft while the user is in
                  // the field, so "12." survives long enough to become "12.50"
                  // — the raw input rounded every keystroke back to "12".
                  <CurrencyInput
                    value={Number(doc.deposit.value) || 0}
                    currency={doc.currency}
                    disabled={locked}
                    ariaLabel="Deposit amount"
                    onChange={(minor) => onPatch({ deposit: { ...doc.deposit, value: String(minor) } })}
                  />
                )}
              </Field>

              <Field label="Deposit due">
                <div className="flex h-9 items-center rounded-[8px] border border-rule bg-paper-raised px-3 text-[13px]">
                  {deposit > 0 ? (
                    <Badge className="bg-accent-soft text-accent">
                      {getCurrency(doc.currency).symbol}
                      {(deposit / Math.pow(10, getCurrency(doc.currency).decimals)).toFixed(
                        getCurrency(doc.currency).decimals,
                      )}
                    </Badge>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </div>
              </Field>

              <Field label="Deposit paid">
                <DepositPaidToggle
                  paid={doc.deposit.paid}
                  disabled={locked}
                  onChange={(paid) =>
                    onPatch({
                      deposit: {
                        ...doc.deposit,
                        paid,
                        paidAmount: paid ? deposit : 0,
                      },
                    })
                  }
                />
              </Field>
            </div>
          )}
        </div>
      )}

      {/* ---- custom fields ---- */}
      <CustomFieldInputs
        fields={customFields.filter((f) => f.entity === 'document')}
        values={doc.customFields}
        disabled={locked}
        onChange={(key, value) => onPatch({ customFields: { ...doc.customFields, [key]: value } })}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

function DefaultTaxOptions() {
  const taxCodes = useAppStore((s) => s.taxCodes);
  return (
    <>
      {taxCodes
        .filter((c) => c.active && c.id !== 'tax_gst')
        .map((c) => (
          <option key={c.id} value={c.id}>
            {c.label ? `${c.name} (${c.label})` : c.name}
          </option>
        ))}
    </>
  );
}

function TemplateSelect({
  value,
  disabled,
  onChange,
}: {
  value: string | null;
  disabled: boolean;
  onChange: (id: string | null) => void;
}) {
  const templates = useAppStore((s) => s.designTemplates);
  return (
    <Select value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Studio (default)</option>
      {templates.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </Select>
  );
}

function DepositToggle({
  enabled,
  disabled,
  onChange,
}: {
  enabled: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Button
      size="sm"
      variant={enabled ? 'primary' : 'secondary'}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
    >
      {enabled ? 'On' : 'Off'}
    </Button>
  );
}

function DepositPaidToggle({
  paid,
  disabled,
  onChange,
}: {
  paid: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Button
      size="sm"
      variant={paid ? 'primary' : 'secondary'}
      disabled={disabled}
      onClick={() => onChange(!paid)}
    >
      {paid ? 'Received' : 'Not yet'}
    </Button>
  );
}
