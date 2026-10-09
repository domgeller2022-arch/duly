/**
 * Retainers.
 *
 * The plan's item 3: a recurring prepaid amount or hours; time and expense
 * lines draw down the balance; a low-balance alert when the balance falls
 * under the threshold. The balance is computed, not stored — `consumedMinor`
 * is the record of draw-downs, and amount minus consumed is what shows.
 */

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Retainer } from '@/core/schemas/automation';
import { retainerSchema } from '@/core/schemas/automation';
import { newEntity } from '@/core/schemas/common';
import { useAppStore, useActiveProfile } from '@/state/app';
import {
  Badge,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  CurrencyInput,
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

const CYCLE_LABELS: Record<Retainer['billingCycle'], string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  yearly: 'Yearly',
};

export function RetainersScreen() {
  const { push } = useToast();
  const profile = useActiveProfile();
  const retainers = useAppStore((s) => s.retainers);
  const clients = useAppStore((s) => s.clients);
  const settings = useAppStore((s) => s.settings);
  const today = useAppStore((s) => s.today);
  const saveRetainer = useAppStore((s) => s.saveRetainer);
  const removeRetainer = useAppStore((s) => s.removeRetainer);

  const [draft, setDraft] = useState<Retainer | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const startNew = () => {
    if (!profile) {
      push({ tone: 'warning', title: 'Create a business first' });
      return;
    }
    setDraft(
      retainerSchema.parse({
        ...newEntity({}),
        name: 'Monthly retainer',
        profileId: profile.id,
        startDate: today,
      }),
    );
  };

  const save = async () => {
    if (!draft) return;
    try {
      const parsed = retainerSchema.parse({ ...draft, updatedAt: new Date().toISOString() });
      await saveRetainer(parsed as Retainer);
      push({ tone: 'success', title: 'Retainer saved' });
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
    await removeRetainer(id);
    if (draft?.id === id) setDraft(null);
    setConfirmId(null);
    push({ tone: 'success', title: 'Retainer deleted' });
  };

  const balanceMinor = (retainer: Retainer): number => retainer.amount - retainer.consumedMinor;
  const balanceHours = (retainer: Retainer): number =>
    (Number.parseFloat(retainer.hours) || 0) - (Number.parseFloat(retainer.consumedHours) || 0);

  const lowBalance = (retainer: Retainer): boolean =>
    retainer.status === 'active' &&
    retainer.alertThresholdMinor > 0 &&
    balanceMinor(retainer) <= retainer.alertThresholdMinor;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Retainers"
        subtitle="Prepaid amount or hours. Time and expenses draw the balance down; a low balance raises an alert."
        actions={
          <Button size="sm" icon={<Plus className="size-3.5" aria-hidden />} onClick={startNew}>
            New retainer
          </Button>
        }
      />

      <Panel className="mt-4" flush>
        {retainers.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-ink-muted">No retainers yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Client</Th>
                <Th align="right">Balance</Th>
                <Th align="right">Prepaid</Th>
                <Th>Renews</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {retainers.map((retainer) => {
                const client = clients.find((c) => c.id === retainer.clientId);
                return (
                  <tr
                    key={retainer.id}
                    className="cursor-pointer hover:bg-paper-sunken"
                    onClick={() => setDraft(retainer)}
                  >
                    <Td className="font-medium text-ink">
                      {retainer.name} {retainer.status !== 'active' && <Badge>{retainer.status}</Badge>}
                    </Td>
                    <Td className="text-ink-muted">{client?.displayName ?? '—'}</Td>
                    <Td numeric>
                      <div className="flex items-center justify-end gap-1.5">
                        <span className={lowBalance(retainer) ? 'font-medium text-overdue' : 'font-medium'}>
                          {money(balanceMinor(retainer), retainer.currency)}
                        </span>
                        {lowBalance(retainer) && <Chip tone="overdue">low</Chip>}
                      </div>
                    </Td>
                    <Td numeric className="text-ink-muted">
                      {money(retainer.amount, retainer.currency)}
                      {Number.parseFloat(retainer.hours) > 0 && ` · ${Number.parseFloat(retainer.hours)}h`}
                    </Td>
                    <Td className="text-ink-muted">
                      {retainer.renewsOn ? date(retainer.renewsOn, settings) : '—'}
                    </Td>
                    <Td>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Trash2 className="size-3.5" aria-hidden />}
                        onClick={() => setConfirmId(retainer.id)}
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

      {draft && (
        <Card className="mt-4 p-4">
          <h2 className="mb-3 font-medium text-ink">
            {retainers.some((r) => r.id === draft.id) ? `Edit ${draft.name}` : 'New retainer'}
          </h2>
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <TextInput
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label="Client">
                <Select
                  value={draft.clientId}
                  onChange={(e) => setDraft({ ...draft, clientId: e.target.value })}
                >
                  <option value="">Choose a client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Prepaid amount">
                <CurrencyInput
                  value={draft.amount}
                  currency={draft.currency}
                  onChange={(minor) => setDraft({ ...draft, amount: minor })}
                />
              </Field>
              <Field label="Prepaid hours" hint="For a time-based retainer.">
                <TextInput
                  value={String(Number.parseFloat(draft.hours) || 0)}
                  onChange={(e) => setDraft({ ...draft, hours: String(Number(e.target.value) || 0) })}
                />
              </Field>
              <Field label="Billing cycle">
                <Select
                  value={draft.billingCycle}
                  onChange={(e) =>
                    setDraft({ ...draft, billingCycle: e.target.value as Retainer['billingCycle'] })
                  }
                >
                  {(Object.keys(CYCLE_LABELS) as Retainer['billingCycle'][]).map((cycle) => (
                    <option key={cycle} value={cycle}>
                      {CYCLE_LABELS[cycle]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Start date">
                <TextInput
                  type="date"
                  value={draft.startDate}
                  onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
                />
              </Field>
              <Field label="Renews on">
                <TextInput
                  type="date"
                  value={draft.renewsOn ?? ''}
                  onChange={(e) => setDraft({ ...draft, renewsOn: e.target.value || null })}
                />
              </Field>
              <Field label="Low-balance alert at" hint="0 means no alert.">
                <CurrencyInput
                  value={draft.alertThresholdMinor}
                  currency={draft.currency}
                  onChange={(minor) => setDraft({ ...draft, alertThresholdMinor: minor })}
                />
              </Field>
              <Field label="Status">
                <Select
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value as Retainer['status'] })}
                >
                  {(['active', 'paused', 'expired', 'completed'] as Retainer['status'][]).map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Notes">
              <TextInput
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </Field>
            <p className="text-[13px] text-ink-muted">
              Balance: {money(balanceMinor(draft), draft.currency)}
              {Number.parseFloat(draft.hours) > 0 && ` · ${balanceHours(draft).toFixed(2)} hours left`}
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void save()}>
                Save retainer
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={() => confirmId && void remove(confirmId)}
        title="Delete this retainer?"
        body="Draw-down history on invoices is kept."
        confirmLabel="Delete"
      />
    </div>
  );
}
