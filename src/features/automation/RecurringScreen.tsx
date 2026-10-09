/**
 * Recurring schedules.
 *
 * The plan's item 2: schedules that copy a source document's lines onto a
 * draft every week/fortnight/month, marked "Ready for review" — nothing is
 * finalised or emailed automatically in v1. The schedule form is one card;
 * the interesting part is the next-run preview, which uses the same
 * recurrence engine the scheduler runs, so what you see is what will happen.
 */

import { useMemo, useState } from 'react';
import { Pause, Play, Plus, Trash2 } from 'lucide-react';
import type { RecurringSchedule } from '@/core/schemas/automation';
import { recurringScheduleSchema, FREQUENCIES, RECURRING_END_CONDITIONS } from '@/core/schemas/automation';
import { DOCUMENT_TYPES, type DocumentType } from '@/core/schemas/document';
import { newEntity } from '@/core/schemas/common';
import { nextRunAfter } from '@/core/engines/recurrence';
import { useAppStore } from '@/state/app';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
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

const FREQUENCY_LABELS: Record<RecurringSchedule['frequency'], string> = {
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
  monthly_last_business_day: 'Monthly, last business day',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  yearly: 'Yearly',
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const TYPE_LABELS: Partial<Record<DocumentType, string>> = {
  invoice: 'Invoice',
  quote: 'Quote',
  credit_note: 'Credit note',
  delivery_note: 'Delivery note',
  proforma: 'Pro-forma',
  payment_receipt: 'Receipt',
};

const END_LABELS: Record<RecurringSchedule['endCondition'], string> = {
  never: 'Never ends',
  after_runs: 'After a number of runs',
  on_date: 'On a date',
};

function parseTimeOfDay(raw: string): number {
  const [h, m] = raw.split(':');
  const hours = Math.min(23, Math.max(0, Number(h) || 0));
  const minutes = Math.min(59, Math.max(0, Number(m) || 0));
  return hours * 60 + minutes;
}

function timeOfDayLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function RecurringScreen() {
  const { push } = useToast();
  const schedules = useAppStore((s) => s.recurringSchedules);
  const clients = useAppStore((s) => s.clients);
  const documents = useAppStore((s) => s.documents);
  const today = useAppStore((s) => s.today);
  const profiles = useAppStore((s) => s.profiles);
  const saveRecurringSchedule = useAppStore((s) => s.saveRecurringSchedule);
  const removeRecurringSchedule = useAppStore((s) => s.removeRecurringSchedule);

  const [draft, setDraft] = useState<RecurringSchedule | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const startNew = () => {
    const now = new Date().toISOString();
    const profile = profiles[0];
    if (!profile) {
      push({
        tone: 'warning',
        title: 'Create a business first',
        description: 'A schedule bills from a business.',
      });
      return;
    }
    setDraft(
      recurringScheduleSchema.parse({
        ...newEntity({}),
        createdAt: now,
        updatedAt: now,
        name: 'Monthly retainer',
        profileId: profile.id,
        startDate: today,
        nextRunDate: today,
      }),
    );
  };

  const startEdit = (schedule: RecurringSchedule) => setDraft(schedule);

  const save = async () => {
    if (!draft) return;
    try {
      const parsed = recurringScheduleSchema.parse({ ...draft, updatedAt: new Date().toISOString() });
      await saveRecurringSchedule(parsed as RecurringSchedule);
      push({ tone: 'success', title: 'Schedule saved' });
      setDraft(null);
    } catch (error) {
      push({
        tone: 'error',
        title: 'Could not save',
        description: error instanceof Error ? error.message : '',
      });
    }
  };

  const togglePause = async (schedule: RecurringSchedule) => {
    await saveRecurringSchedule({ ...schedule, paused: !schedule.paused });
  };

  const remove = async (id: string) => {
    await removeRecurringSchedule(id);
    if (draft?.id === id) setDraft(null);
    setConfirmId(null);
    push({ tone: 'success', title: 'Schedule deleted' });
  };

  const patch = (changes: Partial<RecurringSchedule>) => setDraft(draft ? { ...draft, ...changes } : draft);

  /** The next run after today, from the same engine the scheduler uses. */
  const previewNextRun = (schedule: RecurringSchedule): string | null => {
    if (schedule.paused) return null;
    return nextRunAfter(schedule, today);
  };

  const sourceDocuments = useMemo(() => {
    if (!draft?.clientId) return documents;
    return documents.filter((d) => d.clientId === draft.clientId);
  }, [documents, draft?.clientId]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Recurring schedules"
        subtitle="A run copies the source document's lines onto a draft, marked ready for your review. Nothing is finalised or sent automatically."
        actions={
          <Button size="sm" icon={<Plus className="size-3.5" aria-hidden />} onClick={startNew}>
            New schedule
          </Button>
        }
      />

      <Panel className="mt-4" flush>
        {schedules.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-ink-muted">
            No schedules yet. One runs while the app is open, on the app start and every 15 minutes.
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Client</Th>
                <Th>Frequency</Th>
                <Th>Next run</Th>
                <Th>Runs</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {schedules.map((schedule) => {
                const client = clients.find((c) => c.id === schedule.clientId);
                const next = previewNextRun(schedule);
                return (
                  <tr
                    key={schedule.id}
                    className="cursor-pointer hover:bg-paper-sunken"
                    onClick={() => startEdit(schedule)}
                  >
                    <Td className="font-medium text-ink">
                      {schedule.name} {schedule.paused && <Badge>paused</Badge>}
                    </Td>
                    <Td className="text-ink-muted">{client?.displayName ?? '—'}</Td>
                    <Td className="text-ink-muted">{FREQUENCY_LABELS[schedule.frequency]}</Td>
                    <Td className="text-ink-muted">
                      {next ? date(next, useAppStore.getState().settings) : '—'}
                    </Td>
                    <Td className="text-ink-muted">
                      {schedule.runsCompleted}
                      {schedule.endCondition === 'after_runs' ? ` / ${schedule.endAfterRuns}` : ''}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={
                            schedule.paused ? (
                              <Play className="size-3.5" aria-hidden />
                            ) : (
                              <Pause className="size-3.5" aria-hidden />
                            )
                          }
                          onClick={() => void togglePause(schedule)}
                        >
                          {schedule.paused ? 'Resume' : 'Pause'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Trash2 className="size-3.5" aria-hidden />}
                          onClick={() => setConfirmId(schedule.id)}
                        >
                          Delete
                        </Button>
                      </div>
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
            {schedules.some((s) => s.id === draft.id) ? `Edit ${draft.name}` : 'New schedule'}
          </h2>
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <TextInput value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
              </Field>
              <Field label="Document type">
                <Select
                  value={draft.documentType}
                  onChange={(e) => patch({ documentType: e.target.value as DocumentType })}
                >
                  {DOCUMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {TYPE_LABELS[type] ?? type}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Client">
                <Select
                  value={draft.clientId ?? ''}
                  onChange={(e) => patch({ clientId: e.target.value || null })}
                >
                  <option value="">No client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Source document" hint="Its lines are copied onto each new draft.">
                <Select
                  value={draft.sourceDocumentId ?? ''}
                  onChange={(e) => patch({ sourceDocumentId: e.target.value || null })}
                >
                  <option value="">No source</option>
                  {sourceDocuments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.number || d.draftNumber || 'Draft'} — {money(d.totals.total, d.currency)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Frequency">
                <Select
                  value={draft.frequency}
                  onChange={(e) => patch({ frequency: e.target.value as RecurringSchedule['frequency'] })}
                >
                  {FREQUENCIES.map((frequency) => (
                    <option key={frequency} value={frequency}>
                      {FREQUENCY_LABELS[frequency]}
                    </option>
                  ))}
                </Select>
              </Field>
              {draft.frequency === 'weekly' || draft.frequency === 'fortnightly' ? (
                <Field label="Day of week">
                  <Select
                    value={String(draft.dayOfWeek)}
                    onChange={(e) => patch({ dayOfWeek: Number(e.target.value) })}
                  >
                    {WEEKDAYS.map((day, index) => (
                      <option key={day} value={String(index)}>
                        {day}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <Field label="Day of month">
                  <Select
                    value={String(draft.dayOfMonth)}
                    onChange={(e) => patch({ dayOfMonth: Number(e.target.value) })}
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                      <option key={day} value={String(day)}>
                        {day}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Time of day" hint="Runs when the app is open at or after this time.">
                <TextInput
                  value={timeOfDayLabel(draft.timeOfDayMinutes)}
                  onChange={(e) => patch({ timeOfDayMinutes: parseTimeOfDay(e.target.value) })}
                  placeholder="09:00"
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Start date">
                <TextInput
                  type="date"
                  value={draft.startDate}
                  onChange={(e) => patch({ startDate: e.target.value })}
                />
              </Field>
              <Field label="Ends">
                <Select
                  value={draft.endCondition}
                  onChange={(e) =>
                    patch({ endCondition: e.target.value as RecurringSchedule['endCondition'] })
                  }
                >
                  {RECURRING_END_CONDITIONS.map((condition) => (
                    <option key={condition} value={condition}>
                      {END_LABELS[condition]}
                    </option>
                  ))}
                </Select>
              </Field>
              {draft.endCondition === 'after_runs' && (
                <Field label="Number of runs">
                  <TextInput
                    value={String(draft.endAfterRuns)}
                    onChange={(e) => patch({ endAfterRuns: Math.max(1, Number(e.target.value) || 1) })}
                  />
                </Field>
              )}
              {draft.endCondition === 'on_date' && (
                <Field label="End date">
                  <TextInput
                    type="date"
                    value={draft.endOnDate ?? ''}
                    onChange={(e) => patch({ endOnDate: e.target.value || null })}
                  />
                </Field>
              )}
            </div>

            <Field
              label="Notes"
              hint="Carried onto every generated draft. Line-text variables like {month} and {year} resolve on each run."
            >
              <TextInput
                value={draft.notes}
                onChange={(e) => patch({ notes: e.target.value })}
                placeholder="Retainer — {month} {year}"
              />
            </Field>

            <div className="flex flex-wrap items-center gap-4">
              <Switch checked={!draft.paused} onChange={(v) => patch({ paused: !v })} label="Active" />
              <Checkbox
                checked={draft.reviewRequired}
                label="Every run waits for my review"
                disabled
                onChange={() => {}}
              />
            </div>

            <p className="text-[13px] text-ink-muted">
              Next run:{' '}
              {previewNextRun(draft)
                ? date(previewNextRun(draft)!, useAppStore.getState().settings)
                : 'paused'}
            </p>

            <div className="flex gap-2">
              <Button size="sm" onClick={() => void save()}>
                Save schedule
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
        title="Delete this schedule?"
        body="Drafts it already created are kept."
        confirmLabel="Delete"
      />
    </div>
  );
}
