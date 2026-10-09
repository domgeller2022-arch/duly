/**
 * Bank statement import review.
 *
 * The plan's item 6: import a statement (CSV, OFX, QIF), auto-match payments
 * to invoices by amount and reference, then review each line — confirm, split
 * or ignore. Nothing is written until a line is confirmed: the parsers and
 * matcher are pure, so a bad paste is visible before it becomes a bad import.
 *
 * "Split" is the amount field on the row: confirming with a smaller amount is
 * a part payment, which is what splitting a bank line against an invoice is.
 */

import { useMemo, useRef, useState } from 'react';
import { Check, FileUp, X } from 'lucide-react';
import { useAppStore } from '@/state/app';
import { storage } from '@/adapters';
import { matchTransactions, parseStatement, type MatchResult } from '@/lib/bankImport';
import { recalculateDocument } from '@/lib/documentService';
import { paymentSchema } from '@/core/schemas/document';
import { newEntity } from '@/core/schemas/common';
import {
  Alert,
  Badge,
  Button,
  Chip,
  Dialog,
  Field,
  Panel,
  Select,
  Table,
  Td,
  TextArea,
  TextInput,
  Th,
  useToast,
} from '@/ui/components/base';
import { PageHeader } from '@/ui/components/layout';
import { date, money } from '@/ui/lib/format';

const STATUS_TONES: Record<MatchResult['status'], 'accent' | 'due' | 'neutral' | 'overdue'> = {
  payment: 'accent',
  duplicate: 'neutral',
  unmatched: 'due',
};

const STATUS_LABELS: Record<MatchResult['status'], string> = {
  payment: 'Payment',
  duplicate: 'Already imported',
  unmatched: 'No match',
};

export function BankImportScreen() {
  const { push } = useToast();
  const documents = useAppStore((s) => s.documents);
  const payments = useAppStore((s) => s.payments);
  const clients = useAppStore((s) => s.clients);
  const settings = useAppStore((s) => s.settings);
  const today = useAppStore((s) => s.today);
  const refreshDocuments = useAppStore((s) => s.refreshDocuments);

  const fileRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<MatchResult[]>([]);
  const [statement, setStatement] = useState('');
  const [confirming, setConfirming] = useState<MatchResult | null>(null);
  const [confirmAmount, setConfirmAmount] = useState('');
  const [confirmDate, setConfirmDate] = useState('');
  const [ignored, setIgnored] = useState<Set<string>>(new Set());

  const openInvoices = useMemo(
    () =>
      documents.filter(
        (d) => d.type === 'invoice' && d.status !== 'draft' && d.status !== 'void' && d.totals.balance > 0,
      ),
    [documents],
  );

  const visible = useMemo(
    () =>
      results.filter(
        (r) => !ignored.has(r.transaction.externalId + r.transaction.date + r.transaction.amountMinor),
      ),
    [results, ignored],
  );

  const parse = (text: string) => {
    const transactions = parseStatement(text);
    if (transactions.length === 0) {
      push({
        tone: 'warning',
        title: 'No transactions found',
        description: 'Check the statement — a CSV needs a Date column and an Amount or Debit/Credit column.',
      });
      return;
    }
    setResults(matchTransactions(transactions, documents, payments));
    push({
      tone: 'success',
      title: `${transactions.length} transaction${transactions.length === 1 ? '' : 's'} read`,
      description: 'Nothing is written until you confirm a line.',
    });
  };

  const chooseFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => parse(String(reader.result ?? ''));
    reader.readAsText(file);
  };

  /** Confirm: save the payment, recompute the status, save the document. */
  const confirm = async () => {
    const target = confirming;
    if (!target) return;
    const invoice = documents.find((d) => d.id === target.invoiceId) ?? null;
    const amountMinor = Math.round((Number.parseFloat(confirmAmount) || 0) * 100);
    if (!invoice || amountMinor <= 0) {
      push({ tone: 'warning', title: 'Pick an invoice and an amount first' });
      return;
    }

    try {
      const db = storage();
      const payment = paymentSchema.parse(
        newEntity({
          documentId: invoice.id,
          date: confirmDate || target.transaction.date,
          amount: amountMinor,
          method: 'bank_transfer',
          reference: target.transaction.reference || target.transaction.description,
          note: `Imported from ${target.transaction.source.toUpperCase()} statement`,
          isDeposit: false,
          bankTransactionId: target.transaction.externalId || null,
        }),
      );
      await db.savePayment(payment);

      // One recalculate-and-save: the stored totals and the status follow the
      // payment in, together, on the snapshot's codes for an issued document.
      await recalculateDocument({ document: invoice, today });
      await refreshDocuments();

      setIgnored((prev) => new Set(prev).add(keyOf(target)));
      setConfirming(null);
      push({
        tone: 'success',
        title: `Payment recorded on ${invoice.number || 'draft'}`,
        description: amountMinor < invoice.totals.balance ? 'A part payment — the balance still shows.' : '',
      });
    } catch (error) {
      push({
        tone: 'error',
        title: 'Could not record the payment',
        description: error instanceof Error ? error.message : '',
      });
    }
  };

  const keyOf = (result: MatchResult): string =>
    result.transaction.externalId + result.transaction.date + result.transaction.amountMinor;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Bank import"
        subtitle="Match statement lines to invoices by amount and reference. Nothing is written until you confirm a line."
      />

      <div className="mt-4 grid gap-3">
        <Field
          label="Paste a statement"
          hint="CSV, OFX or QIF — the format is detected. A CSV needs Date and Amount (or Debit/Credit) columns."
        >
          <TextArea
            rows={4}
            monospace
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            placeholder="Date,Description,Amount\n2026-10-02,ACME PTY LTD INV-2026-0001,1870.00"
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => parse(statement)} disabled={!statement.trim()}>
            Match transactions
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<FileUp className="size-3.5" aria-hidden />}
            onClick={() => fileRef.current?.click()}
          >
            Choose a file
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.ofx,.qif,.txt"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && chooseFile(e.target.files[0])}
          />
          {results.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setResults([]);
                setStatement('');
                setIgnored(new Set());
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {results.length > 0 && (
        <Panel
          className="mt-4"
          title="Review"
          description={`${visible.length} of ${results.length} lines remaining`}
          flush
        >
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Description</Th>
                <Th align="right">Amount</Th>
                <Th>Status</Th>
                <Th>Invoice</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {visible.map((result) => {
                const invoice = documents.find((d) => d.id === result.invoiceId);
                return (
                  <tr key={keyOf(result)}>
                    <Td className="whitespace-nowrap text-ink-muted">
                      {date(result.transaction.date, settings)}
                    </Td>
                    <Td className="max-w-64 truncate">
                      {result.transaction.description || '—'}
                      {result.transaction.reference && (
                        <span className="ml-1 text-[12px] text-ink-faint">
                          {result.transaction.reference}
                        </span>
                      )}
                    </Td>
                    <Td
                      numeric
                      className={result.transaction.amountMinor > 0 ? 'text-ink' : 'text-ink-faint'}
                    >
                      {money(result.transaction.amountMinor, settings?.defaultCurrency ?? 'AUD')}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <Chip tone={STATUS_TONES[result.status]}>{STATUS_LABELS[result.status]}</Chip>
                        {result.status === 'payment' && result.confidence === 'medium' && (
                          <Badge>suggested</Badge>
                        )}
                      </div>
                    </Td>
                    <Td className="text-ink-muted">{invoice?.number || '—'}</Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          icon={<Check className="size-3.5" aria-hidden />}
                          disabled={result.status === 'duplicate' || openInvoices.length === 0}
                          onClick={() => {
                            setConfirming(result);
                            setConfirmAmount((result.transaction.amountMinor / 100).toFixed(2));
                            setConfirmDate(result.transaction.date);
                          }}
                        >
                          Confirm
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<X className="size-3.5" aria-hidden />}
                          onClick={() => setIgnored((prev) => new Set(prev).add(keyOf(result)))}
                        >
                          Ignore
                        </Button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Panel>
      )}

      {results.length === 0 && (
        <Alert tone="info" title="How matching works" className="mt-4">
          A line matches an invoice when its description or reference contains the invoice number and the
          amount equals the balance. Otherwise, exactly one open invoice with the same balance is suggested.
          Confirming a smaller amount records a part payment — that is the split.
        </Alert>
      )}

      <Dialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title="Confirm payment"
        size="sm"
      >
        <div className="grid gap-3">
          <Field label="Invoice">
            <Select
              value={confirming?.invoiceId ?? openInvoices[0]?.id ?? ''}
              onChange={(e) =>
                setConfirming((prev) =>
                  prev ? { ...prev, invoiceId: e.target.value || null, confidence: prev.confidence } : prev,
                )
              }
            >
              {openInvoices.map((invoice) => (
                <option key={invoice.id} value={invoice.id}>
                  {invoice.number || 'Draft'} — balance {money(invoice.totals.balance, invoice.currency)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount" hint="A smaller amount records a part payment.">
            <TextInput
              type="number"
              step="0.01"
              value={confirmAmount}
              onChange={(e) => setConfirmAmount(e.target.value)}
            />
          </Field>
          <Field label="Date">
            <TextInput type="date" value={confirmDate} onChange={(e) => setConfirmDate(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void confirm()}>
              Record payment
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
          </div>
        </div>
      </Dialog>

      <p className="mt-3 text-[12px] text-ink-faint">
        {openInvoices.length} open invoice{openInvoices.length === 1 ? '' : 's'} · {payments.length} payment
        {payments.length === 1 ? '' : 's'} recorded
        {clients.length === 0 && ' · create a client to match payments'}
      </p>
      <p className="mt-1 text-[12px] text-ink-faint">As at {date(today, settings)}.</p>
    </div>
  );
}
