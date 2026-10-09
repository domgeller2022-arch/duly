/**
 * Expenses.
 *
 * The plan's item 2: supplier, date, amount, GST, category and receipt photo;
 * mark billable; add to an invoice with optional markup. "Invoice unbilled"
 * from the Time screen collects the billable ones in one action; here the
 * form is the record and the markup is per expense.
 *
 * The receipt photo is an attachment owned by the expense (the schema's
 * ownerType already has 'expense'), stored as a data URL like every other
 * attachment — 8 MB is the limit.
 */

import { useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useAppStore, useActiveProfile } from '@/state/app';
import { storage } from '@/adapters';
import { expenseSchema } from '@/core/schemas/automation';
import { runAiTask } from '@/lib/ai';
import { receiptScanTask } from '@/lib/aiTasks';
import { Sparkles } from 'lucide-react';
import { attachmentSchema } from '@/core/schemas/crm';
import { newEntity } from '@/core/schemas/common';
import { parseAmountToMinor } from '@/core/money/money';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Chip,
  ConfirmDialog,
  CurrencyInput,
  Field,
  Panel,
  Select,
  Switch,
  Table,
  Td,
  TextInput,
  Th,
  useToast,
} from '@/ui/components/base';
import { PageHeader } from '@/ui/components/layout';
import { date, money } from '@/ui/lib/format';

const CATEGORIES = ['Materials', 'Subcontractor', 'Travel', 'Software', 'Equipment', 'Other'];

/** Read a file as a data URL for storage. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

export function ExpensesScreen() {
  const { push } = useToast();
  const profile = useActiveProfile();
  const expenses = useAppStore((s) => s.expenses);
  const clients = useAppStore((s) => s.clients);
  const projects = useAppStore((s) => s.projects);
  const attachments = useAppStore((s) => s.attachments);
  const settings = useAppStore((s) => s.settings);
  const today = useAppStore((s) => s.today);
  const saveExpense = useAppStore((s) => s.saveExpense);
  const removeExpense = useAppStore((s) => s.removeExpense);

  const [draft, setDraft] = useState<null | {
    id?: string;
    supplier: string;
    description: string;
    date: string;
    amountMinor: number;
    gstMinor: number;
    category: string;
    clientId: string;
    projectId: string;
    billable: boolean;
    markupPercent: string;
    receiptFile: File | null;
  }>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const scanReceiptRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);

  const startNew = () =>
    setDraft({
      supplier: '',
      description: '',
      date: today,
      amountMinor: 0,
      gstMinor: 0,
      category: 'Materials',
      clientId: '',
      projectId: '',
      billable: true,
      markupPercent: '0',
      receiptFile: null,
    });

  const startEdit = (expense: (typeof expenses)[number]) =>
    setDraft({
      id: expense.id,
      supplier: expense.supplier,
      description: expense.description,
      date: expense.date,
      amountMinor: expense.amount,
      gstMinor: expense.gstAmount,
      category: expense.category || 'Other',
      clientId: expense.clientId ?? '',
      projectId: expense.projectId ?? '',
      billable: expense.billable,
      markupPercent: expense.markupPercent,
      receiptFile: null,
    });

  /**
   * Receipt capture (vision): a photo through the AI task fills the form.
   * The photo itself stays as the draft's receipt, so saving attaches it.
   */
  const scanReceipt = async (file: File) => {
    setScanning(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const result = await runAiTask(receiptScanTask, { images: [base64], hint: 'Read this receipt.' });
      if (!result.ok || !result.value) {
        push({ tone: 'error', title: 'Could not read the receipt', description: result.error ?? '' });
        return;
      }
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              supplier: result.value!.supplier || prev.supplier,
              description: result.value!.description || prev.description,
              date: /^\d{4}-\d{2}-\d{2}$/.test(result.value!.date) ? result.value!.date : prev.date,
              amountMinor:
                parseAmountToMinor(result.value!.amountDollars, settings?.defaultCurrency ?? 'AUD') || prev.amountMinor,
              gstMinor:
                parseAmountToMinor(result.value!.gstDollars, settings?.defaultCurrency ?? 'AUD') || prev.gstMinor,
              category: result.value!.category || prev.category,
              receiptFile: file,
            }
          : prev,
      );
      push({ tone: 'success', title: 'Receipt read', description: 'Check the fields, then save.' });
    } finally {
      setScanning(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    try {
      const record = expenseSchema.parse(
        newEntity({
          clientId: draft.clientId || null,
          projectId: draft.projectId || null,
          date: draft.date,
          supplier: draft.supplier,
          description: draft.description,
          amount: draft.amountMinor,
          currency: settings?.defaultCurrency ?? 'AUD',
          gstAmount: draft.gstMinor,
          category: draft.category,
          billable: draft.billable,
          markupPercent: draft.markupPercent,
          taxCodeId: null,
          receiptAttachmentId: null,
          invoicedOnDocumentId: null,
          paymentMethod: '',
          id: draft.id ?? newEntity({}).id,
        }),
      );
      await saveExpense(record as (typeof expenses)[number]);

      if (draft.receiptFile) {
        const attachment = attachmentSchema.parse(
          newEntity({
            ownerType: 'expense',
            ownerId: record.id,
            fileName: draft.receiptFile.name,
            mimeType: draft.receiptFile.type || 'application/octet-stream',
            sizeBytes: draft.receiptFile.size,
            storedPath: await readAsDataUrl(draft.receiptFile),
            appendToPdf: false,
            internal: true,
            caption: '',
          }),
        );
        await storage().saveAttachment(attachment);
        await storage().saveExpense({
          ...record,
          receiptAttachmentId: attachment.id,
          updatedAt: new Date().toISOString(),
        } as (typeof expenses)[number]);
      }

      push({ tone: 'success', title: 'Expense saved' });
      setDraft(null);
    } catch (error) {
      push({
        tone: 'error',
        title: 'Could not save',
        description: error instanceof Error ? error.message : '',
      });
    }
  };

  const remove = async (id: string) => {
    await removeExpense(id);
    setConfirmId(null);
    push({ tone: 'success', title: 'Expense deleted' });
  };

  const toggleBillable = async (expense: (typeof expenses)[number]) => {
    await saveExpense({
      ...expense,
      billable: !expense.billable,
      updatedAt: new Date().toISOString(),
    } as (typeof expenses)[number]);
  };

  const receiptFor = (expense: (typeof expenses)[number]) =>
    attachments.find((a) => a.id === expense.receiptAttachmentId);

  const totals = useMemo(
    () => ({
      count: expenses.length,
      unbilled: expenses
        .filter((x) => x.billable && !x.invoicedOnDocumentId)
        .reduce((acc, x) => acc + x.amount, 0),
    }),
    [expenses],
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Expenses"
        subtitle="Supplier, amount, GST and a receipt photo. Billable ones can be marked up and invoiced."
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              icon={<Sparkles className="size-3.5" aria-hidden />}
              onClick={() => scanReceiptRef.current?.click()}
            >
              Scan receipt
            </Button>
            <input
              ref={scanReceiptRef}
              type="file"
              accept="image/png,image/jpeg"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (!draft) startNew();
                void scanReceipt(file);
              }}
            />
            <Button size="sm" icon={<Plus className="size-3.5" aria-hidden />} onClick={startNew}>
              Add expense
            </Button>
          </>
        }
      />

      {draft && (
        <Card className="mt-4 p-4">
          <h2 className="mb-3 font-medium text-ink">{draft.id ? 'Edit expense' : 'New expense'}</h2>
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Supplier">
                <TextInput
                  value={draft.supplier}
                  onChange={(e) => setDraft({ ...draft, supplier: e.target.value })}
                />
              </Field>
              <Field label="Description">
                <TextInput
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </Field>
              <Field label="Date">
                <TextInput
                  type="date"
                  value={draft.date}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                />
              </Field>
              <Field label="Category">
                <Select
                  value={draft.category}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                >
                  {CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={`Amount (${settings?.defaultCurrency ?? 'AUD'})`}>
                <CurrencyInput
                  value={draft.amountMinor}
                  currency={settings?.defaultCurrency ?? 'AUD'}
                  onChange={(minor) => setDraft({ ...draft, amountMinor: minor })}
                />
              </Field>
              <Field label="GST on the expense" hint="The GST you can claim back.">
                <CurrencyInput
                  value={draft.gstMinor}
                  currency={settings?.defaultCurrency ?? 'AUD'}
                  onChange={(minor) => setDraft({ ...draft, gstMinor: minor })}
                />
              </Field>
              <Field label="Client">
                <Select
                  value={draft.clientId}
                  onChange={(e) => setDraft({ ...draft, clientId: e.target.value, projectId: '' })}
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
              <Field label="Markup % when invoiced">
                <TextInput
                  value={draft.markupPercent}
                  onChange={(e) => setDraft({ ...draft, markupPercent: e.target.value })}
                  placeholder="0"
                />
              </Field>
              <Field label="Receipt photo" hint="PNG, JPEG or PDF. Kept inside Duly's database.">
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,application/pdf"
                    capture="environment"
                    onChange={(e) => setDraft({ ...draft, receiptFile: e.target.files?.[0] ?? null })}
                    className="w-full text-[13px]"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Sparkles className="size-3.5" aria-hidden />}
                    loading={scanning}
                    disabled={!draft.receiptFile}
                    onClick={() => draft.receiptFile && void scanReceipt(draft.receiptFile)}
                  >
                    Scan
                  </Button>
                </div>
              </Field>
            </div>
            <Switch
              checked={draft.billable}
              onChange={(v) => setDraft({ ...draft, billable: v })}
              label="Billable"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void save()}>
                Save expense
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Panel
        className="mt-4"
        title="Expenses"
        description={`${totals.count} expense(s) — unbilled billable ${money(totals.unbilled, settings?.defaultCurrency ?? 'AUD')}`}
        flush
      >
        {expenses.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-ink-muted">No expenses yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Supplier</Th>
                <Th>Category</Th>
                <Th align="right">Amount</Th>
                <Th align="right">GST</Th>
                <Th>Billable</Th>
                <Th>Receipt</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {expenses.map((expense) => (
                <tr
                  key={expense.id}
                  className="cursor-pointer hover:bg-paper-sunken"
                  onClick={() => startEdit(expense)}
                >
                  <Td className="whitespace-nowrap text-ink-muted">{date(expense.date, settings)}</Td>
                  <Td>
                    <span className="font-medium text-ink">{expense.supplier || '—'}</span>
                    <span className="ml-1.5 text-[12px] text-ink-muted">{expense.description}</span>
                    {expense.invoicedOnDocumentId && (
                      <Chip tone="neutral" className="ml-1.5">
                        invoiced
                      </Chip>
                    )}
                  </Td>
                  <Td className="text-ink-muted">{expense.category || '—'}</Td>
                  <Td numeric>{money(expense.amount, expense.currency)}</Td>
                  <Td numeric className="text-ink-muted">
                    {expense.gstAmount > 0 ? money(expense.gstAmount, expense.currency) : '—'}
                  </Td>
                  <Td>
                    <Checkbox
                      checked={expense.billable}
                      label=""
                      onChange={() => void toggleBillable(expense)}
                    />
                  </Td>
                  <Td>
                    {receiptFor(expense) ? <Badge>photo</Badge> : <span className="text-ink-faint">—</span>}
                  </Td>
                  <Td>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 className="size-3.5" aria-hidden />}
                      onClick={() => setConfirmId(expense.id)}
                    >
                      Delete
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <ConfirmDialog
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={() => confirmId && void remove(confirmId)}
        title="Delete this expense?"
        body="Invoiced expenses keep their link; the invoice line stays."
        confirmLabel="Delete"
      />

      <p className="mt-3 text-[12px] text-ink-faint">
        Markup applies when the expense is invoiced —{' '}
        {profile?.name ? `billed from ${profile.name}` : 'no business yet'}.
      </p>
    </div>
  );
}
