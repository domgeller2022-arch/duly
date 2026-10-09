/**
 * The reminder queue.
 *
 * The plan's item 3: reminders are "queued for your approval in v1". A queued
 * reminder was built by the reminder engine with its subject and body already
 * merged; approving it opens the mail app and logs the send. Dismissing it
 * marks it so the same reminder never queues twice (the dedupe key sees the
 * dismissal).
 *
 * Ready outbox entries — scheduled sends whose date has arrived — are approved
 * from here too, which is the plan's item 4.
 */

import { useMemo } from 'react';
import { Check, Mail, X } from 'lucide-react';
import { useAppStore } from '@/state/app';
import { platform } from '@/adapters';
import { newEntity } from '@/core/schemas/common';
import { Button, Card, Chip, EmptyState, Panel, Table, Td, Th, useToast } from '@/ui/components/base';
import { PageHeader } from '@/ui/components/layout';
import { date, money, relative } from '@/ui/lib/format';

export function RemindersScreen() {
  const { push } = useToast();
  const reminders = useAppStore((s) => s.reminders);
  const documents = useAppStore((s) => s.documents);
  const clients = useAppStore((s) => s.clients);
  const outbox = useAppStore((s) => s.outbox);
  const settings = useAppStore((s) => s.settings);
  const today = useAppStore((s) => s.today);
  const saveReminder = useAppStore((s) => s.saveReminder);
  const saveOutboxEntry = useAppStore((s) => s.saveOutboxEntry);

  const pending = useMemo(
    () =>
      reminders
        .filter((r) => r.status === 'pending')
        .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor)),
    [reminders],
  );

  const readySends = useMemo(
    () =>
      outbox.filter((entry) => entry.status === 'ready').sort((a, b) => a.queuedAt.localeCompare(b.queuedAt)),
    [outbox],
  );

  const sentHistory = useMemo(
    () =>
      outbox
        .filter((entry) => entry.status === 'sent' || entry.status === 'failed')
        .sort((a, b) => b.queuedAt.localeCompare(a.queuedAt))
        .slice(0, 10),
    [outbox],
  );

  /** Approve: open the mail app with the merged subject/body, log the send. */
  const approve = async (reminderId: string) => {
    const reminder = reminders.find((r) => r.id === reminderId);
    if (!reminder) return;
    const document = documents.find((d) => d.id === reminder.documentId);
    const client = clients.find((c) => c.id === document?.clientId) ?? null;
    const to = client?.email ? [client.email] : [];

    const result = await platform().mail.send({
      accountId: null,
      fromName: '',
      fromEmail: '',
      to,
      subject: reminder.subject,
      body: reminder.body,
      attachments: [],
    });

    await saveReminder({
      ...reminder,
      status: result.ok ? 'sent' : 'failed',
      approvedAt: new Date().toISOString(),
      sentAt: result.ok ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
    });

    await saveOutboxEntry({
      ...newEntity({}),
      documentId: reminder.documentId,
      to,
      subject: reminder.subject,
      body: reminder.body,
      queuedAt: new Date().toISOString(),
      status: result.ok ? 'sent' : 'failed',
      lastError: result.error ?? null,
      cc: [],
      bcc: [],
      accountId: null,
      attachmentNames: [],
      pdfPath: null,
      pdfDataUrl: null,
      attempts: 0,
      updatedAt: new Date().toISOString(),
    });

    push({
      tone: result.ok ? 'success' : 'error',
      title: result.ok ? 'Mail app opened' : 'Could not open the mail app',
      description: result.error ?? 'The reminder is marked as sent.',
    });
  };

  const dismiss = async (reminderId: string) => {
    const reminder = reminders.find((r) => r.id === reminderId);
    if (!reminder) return;
    await saveReminder({
      ...reminder,
      status: 'dismissed',
      approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    push({ tone: 'success', title: 'Reminder dismissed' });
  };

  /** Approve a scheduled send whose date has arrived. Retry on a failed one. */
  const sendReady = async (entryId: string) => {
    const entry = outbox.find((o) => o.id === entryId);
    if (!entry) return;
    const result = await platform().mail.send({
      accountId: null,
      fromName: '',
      fromEmail: '',
      to: entry.to,
      subject: entry.subject,
      body: entry.body,
      attachments: [],
    });
    await saveOutboxEntry({
      ...entry,
      status: result.ok ? 'sent' : 'failed',
      attempts: entry.attempts + 1,
      lastError: result.error ?? null,
      queuedAt: result.ok ? entry.queuedAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    push({
      tone: result.ok ? 'success' : 'error',
      title: result.ok ? 'Mail app opened' : 'Could not open the mail app',
      description: result.error ?? 'The send is marked as sent.',
    });
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader title="Reminders" subtitle="Queued for your approval. Nothing is sent without you." />

      <Panel
        className="mt-4"
        title="Scheduled sends"
        description="Finalised documents queued to email on a chosen date. Approve once the date has arrived."
        flush
      >
        {readySends.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-ink-muted">
            {outbox.length === 0 ? 'Nothing scheduled.' : 'No scheduled sends are due yet.'}
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Document</Th>
                <Th>To</Th>
                <Th>Subject</Th>
                <Th>Queued</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {readySends.map((entry) => {
                const document = documents.find((d) => d.id === entry.documentId);
                return (
                  <tr key={entry.id}>
                    <Td className="font-medium">{document?.number || '—'}</Td>
                    <Td className="text-ink-muted">{entry.to.join(', ') || '—'}</Td>
                    <Td className="max-w-64 truncate text-ink-muted">{entry.subject}</Td>
                    <Td className="whitespace-nowrap text-ink-muted">{relative(entry.queuedAt, today)}</Td>
                    <Td>
                      <Button
                        size="sm"
                        icon={<Mail className="size-3.5" aria-hidden />}
                        onClick={() => void sendReady(entry.id)}
                      >
                        Send
                      </Button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>

      <Panel
        className="mt-4"
        title="Waiting for approval"
        description="Built by the reminder engine. Approve to open your mail app; dismiss to skip this one."
        flush
      >
        {pending.length === 0 ? (
          <EmptyState
            title="Nothing waiting"
            hint="Reminders appear when an invoice passes its due date. The engine runs on app start and every 15 minutes."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Document</Th>
                <Th>Amount</Th>
                <Th>Due</Th>
                <Th>Subject</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {pending.map((reminder) => {
                const document = documents.find((d) => d.id === reminder.documentId);
                const due = document?.dueDate ?? null;
                return (
                  <tr key={reminder.id}>
                    <Td className="font-medium">{document?.number || '—'}</Td>
                    <Td numeric>{document ? money(document.totals.balance, document.currency) : '—'}</Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        {due && <span className="text-ink-muted">{date(due, settings)}</span>}
                        {due && due < today && <Chip tone="overdue">overdue</Chip>}
                      </div>
                    </Td>
                    <Td className="max-w-64 truncate text-ink-muted">{reminder.subject}</Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          icon={<Check className="size-3.5" aria-hidden />}
                          onClick={() => void approve(reminder.id)}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<X className="size-3.5" aria-hidden />}
                          onClick={() => void dismiss(reminder.id)}
                        >
                          Dismiss
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

      {sentHistory.length > 0 && (
        <Card className="mt-4 p-4">
          <h2 className="mb-3 font-medium text-ink">Recently sent</h2>
          <ul className="space-y-1">
            {sentHistory.map((entry) => {
              const document = documents.find((d) => d.id === entry.documentId);
              return (
                <li key={entry.id} className="text-[13px] text-ink-muted">
                  {date(entry.queuedAt, settings)} — {document?.number || '—'} —{' '}
                  {entry.to.join(', ') || 'no recipient'}
                  {entry.status === 'failed' && <Chip tone="overdue">failed</Chip>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
