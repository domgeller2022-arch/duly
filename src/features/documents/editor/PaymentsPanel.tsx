/**
 * Recording payments.
 *
 * A payment reduces the balance and updates the status automatically. Full
 * payment marks the document paid; a part payment marks it part paid; an
 * overpayment leaves a negative balance, which the client-credit flow then offers
 * to carry forward.
 *
 * Payments on a finalised document are records, not edits: the invoice itself
 * never changes, which is what keeps the audit trail honest.
 */

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Document, Payment } from '@/core/schemas';
import { calculate } from '@/core/calc/calculate';
import { paymentSchema } from '@/core/schemas/document';
import { clientCreditSchema } from '@/core/schemas/document';
import { newEntity } from '@/core/schemas/common';
import { storage } from '@/adapters';
import { useAppStore, useActiveProfile } from '@/state/app';
import { useEditorStore } from './editorStore';
import { PAYMENT_METHOD_LABELS } from '@/ui/lib/format';
import {
  Alert,
  Button,
  Card,
  CurrencyInput,
  Dialog,
  Field,
  Select,
  TextInput,
  useToast,
} from '@/ui/components/base';
import { money } from '@/ui/lib/format';
import { dueDateFor } from '@/core/validation/dates';
import { deriveDocumentStatus } from '@/core/documents';
import { refileDocument } from '@/lib/finalise';

export function PaymentsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { push } = useToast();
  const profile = useActiveProfile();
  const settings = useAppStore((s) => s.settings);
  const clients = useAppStore((s) => s.clients);
  const refreshDocuments = useAppStore((s) => s.refreshDocuments);

  const document = useEditorStore((s) => s.document);
  const payments = useEditorStore((s) => s.payments);
  const result = useEditorStore((s) => s.result);
  const reload = useEditorStore((s) => s.reload);

  const today = useAppStore((s) => s.today);
  const client = clients.find((c) => c.id === document?.clientId) ?? null;
  const currency = document?.currency ?? profile?.defaultCurrency ?? 'AUD';
  const outstanding = result?.balance ?? 0;

  const [amount, setAmount] = useState(outstanding);
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<Payment['method']>('bank_transfer');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [isDeposit, setIsDeposit] = useState(false);
  const [saving, setSaving] = useState(false);
  /** The payment being corrected, and the id it will be replaced by. */
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [replacing, setReplacing] = useState<string | null>(null);

  // Default to paying the whole balance, but let a smaller figure through.
  useEffect(() => {
    if (open) {
      setAmount(Math.max(0, outstanding));
      setDate(today);
      setMethod('bank_transfer');
      setReference('');
      setNote('');
      setIsDeposit(false);
      setEditingPayment(null);
      setReplacing(null);
    }
  }, [open, outstanding, today]);

  const amountMinor = amount;
  const over = amountMinor > outstanding && outstanding >= 0;

  const record = async () => {
    if (!document || amountMinor <= 0) return;
    setSaving(true);

    try {
      const db = storage();
      const payment = paymentSchema.parse(
        newEntity({
          documentId: document.id,
          date,
          amount: amountMinor,
          method,
          reference,
          note,
          isDeposit,
        }),
      );

      // When correcting, the replacement is written before the original is removed,
      // so a failure half way leaves both payments rather than none.
      if (replacing) await commitEdit(payment);
      else await db.savePayment(payment);

      // A payment recorded against a deposit moves the due date: the balance now
      // falls due on the deposit terms rather than the original invoice date.
      const nextDocument =
        isDeposit && document.deposit.enabled && !document.deposit.paid
          ? {
              ...document,
              deposit: { ...document.deposit, paid: true, paidAmount: amountMinor },
              dueDate: document.deposit.balanceDueDate ?? dueDateFor(date, document.termsId),
            }
          : document;

      // The status follows the balance. This is the only place a payment changes a
      // document's status, so an invoice cannot be left showing "Final" after it has
      // been part-paid or settled.
      const resultAfter = calculate({
        document: nextDocument,
        lines: useEditorStore.getState().lines,
        payments: [...useEditorStore.getState().payments, payment],
        taxCodes: useEditorStore.getState().taxCodes,
      });
      const status = deriveDocumentStatus({
        document: nextDocument,
        balance: resultAfter.balance,
        today: date,
      });

      const settled: Document = { ...nextDocument, status };
      await db.saveDocument(settled);
      await refreshDocuments();
      await reload();

      // The PAID stamp changes what should print, so the filed PDF is rewritten
      // when the setting is on. A failure here does not undo the payment.
      if (settled.lastPdfPath && settings?.refileOnPayment) {
        try {
          await refileDocument({
            document: settled,
            lines: useEditorStore.getState().lines,
            payments: [...useEditorStore.getState().payments, payment],
            result: resultAfter,
            profile: profile!,
            client,
            taxCodes: useEditorStore.getState().taxCodes,
            template:
              useAppStore.getState().designTemplates.find((t) => t.id === settled.designTemplateId) ?? null,
            settings: settings!,
          });
        } catch {
          push({
            tone: 'warning',
            title: 'The PDF could not be re-written',
            description: 'The payment is recorded. Re-file the PDF from the list when you like.',
          });
        }
      }

      // An overpayment becomes client credit rather than disappearing.
      if (over && outstanding >= 0) {
        const credit = clientCreditSchema.parse(
          newEntity({
            clientId: nextDocument.clientId ?? '',
            amount: amountMinor - outstanding,
            currency,
            source: 'payment',
            sourceDocumentId: document.id,
            date,
            note: `Overpayment against ${document.number}`,
          }),
        );
        if (nextDocument.clientId) {
          await db.saveClientCredit(credit);
          push({
            tone: 'info',
            title: 'Credit balance recorded',
            description: `${money(amountMinor - outstanding, currency)} can be applied to the next invoice.`,
          });
        }
      }

      if (!replacing) {
        onClose();
      } else {
        setAmount(Math.max(0, outstanding));
        setReference('');
        setNote('');
        setIsDeposit(false);
      }
      push({
        tone: 'success',
        title: replacing ? 'Payment corrected' : 'Payment recorded',
        description:
          status === 'paid'
            ? 'This document is now paid in full.'
            : status === 'partially_paid'
              ? `${money(resultAfter.balance, currency)} still outstanding.`
              : `${money(outstanding - amountMinor, currency)} still outstanding.`,
      });
    } catch (error) {
      push({
        tone: 'error',
        title: 'The payment could not be recorded',
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  /**
   * Correct a payment.
   *
   * A payment is a *record*, so it is never edited in place — a wrong payment is
   * deleted and re-recorded. Editing one silently would leave the audit trail
   * showing a payment nobody made. So the "edit" button pre-fills the form and the
   * user saves a replacement; the original is removed once the new one is written.
   */
  const startEdit = (payment: Payment) => {
    setAmount(payment.amount);
    setDate(payment.date);
    setMethod(payment.method);
    setReference(payment.reference);
    setNote(payment.note);
    setIsDeposit(payment.isDeposit);
    setReplacing(payment.id);
    setEditingPayment(payment);
  };

  const remove = async (payment: Payment) => {
    if (!document) return;
    const db = storage();
    await db.deletePayment(payment.id);
    await db.saveDocument({ ...document });
    await refreshDocuments();
    await reload();
    setEditingPayment(null);
    setReplacing(null);
    push({ tone: 'info', title: 'Payment removed' });
  };

  /** Replace the payment being corrected, once the replacement exists. */
  const commitEdit = async (replacement: Payment) => {
    const db = storage();
    if (!document) return;
    if (replacing) await db.deletePayment(replacing);
    await db.savePayment(replacement);
    await db.saveDocument(document);
    await refreshDocuments();
    await reload();
    setReplacing(null);
    setEditingPayment(null);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editingPayment ? 'Correct this payment' : 'Record a payment'}
      description={
        document
          ? `${document.number || document.draftNumber} · ${clients.find((c) => c.id === document.clientId)?.displayName ?? 'No client'}`
          : undefined
      }
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void record()}
            loading={saving}
            disabled={amountMinor <= 0}
          >
            {replacing
              ? `Save ${money(amountMinor, currency)}`
              : `Record ${amountMinor > 0 ? money(amountMinor, currency) : 'payment'}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {editingPayment && (
          <Alert tone="info" title="Correcting a payment">
            The original is removed and this one is recorded in its place, so the audit trail never shows a
            payment nobody made.
          </Alert>
        )}

        <Card className="bg-paper-sunken/50">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="text-ink-muted">Total</span>
            <span className="num font-medium text-ink">{money(result?.total ?? 0, currency)}</span>
          </div>
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="text-ink-muted">Already paid</span>
            <span className="num font-medium text-ink">{money(result?.paid ?? 0, currency)}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between border-t border-rule pt-1 text-[13px]">
            <span className="font-medium text-ink">Outstanding</span>
            <span className="num font-semibold text-ink">{money(outstanding, currency)}</span>
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount" required>
            <CurrencyInput value={amountMinor} onChange={setAmount} currency={currency} allowNegative />
          </Field>

          <Field label="Date" required>
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>

          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value as Payment['method'])}>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Reference" hint="Cheque number, transfer reference…">
            <TextInput value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>

        <Field label="Note">
          <TextInput
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything worth remembering"
          />
        </Field>

        {document?.deposit.enabled && (
          <label className="flex cursor-pointer items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={isDeposit}
              onChange={(e) => {
                setIsDeposit(e.target.checked);
                if (e.target.checked) {
                  const depositDue = document.deposit.enabled
                    ? Math.round(outstanding * (Number(document.deposit.value) / 100))
                    : outstanding;
                  setAmount(depositDue);
                }
              }}
              className="size-3.5 accent-[var(--color-accent)]"
            />
            This is the requested deposit
          </label>
        )}

        {over && (
          <Alert tone="info" title="This is more than the outstanding balance">
            The {money(amountMinor - outstanding, currency)} difference will be recorded as client credit and
            offered on the next invoice.
          </Alert>
        )}

        {/* ---- existing payments ---- */}
        {payments.length > 0 && (
          <div>
            <h3 className="eyebrow mb-1.5">Already recorded</h3>
            <ul className="sheet divide-y divide-rule">
              {payments.map((payment) => (
                <li key={payment.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[13px] text-ink">
                      {payment.date} · {PAYMENT_METHOD_LABELS[payment.method]}
                    </p>
                    {payment.reference && <p className="text-[11px] text-ink-faint">{payment.reference}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="num text-[13px] font-medium text-ink">
                      {money(payment.amount, currency)}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => startEdit(payment)}
                      aria-label={`Correct the payment of ${money(payment.amount, currency)}`}
                    >
                      Correct
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => void remove(payment)}
                      aria-label="Remove this payment"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-ink-faint">
          A payment never changes the invoice itself — it reduces the balance, and the document's status
          updates to match. The record stays in the audit trail either way.
          {settings?.refileOnPayment &&
            ' Because "stamp PAID on PDF" is on, the PDF will be re-written with a PAID stamp.'}
        </p>
      </div>
    </Dialog>
  );
}
