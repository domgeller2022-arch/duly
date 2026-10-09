/**
 * The email dialog.
 *
 * The plan's item 4: download the PDF, open the mail app with a merged
 * subject and body, log the send. The web build cannot send on its own — the
 * mailto: link opens the user's mail app with everything on the clipboard, so
 * the only manual step is attaching the file the dialog just saved.
 *
 * The subject and body come from the document's email template (or the
 * client's default), merged with the same fields the preview shows.
 */

import { useEffect, useMemo, useState } from 'react';
import { Download, Mail } from 'lucide-react';
import { useAppStore, useActiveProfile } from '@/state/app';
import { useEditorStore } from './editorStore';
import { platform, files, storage } from '@/adapters';
import { tableBlob, renderBundlePdf, documentTableExport, type ExportFormat } from '@/lib/exports';
import { interpolate, MERGE_FIELDS, buildMergeValues } from '@/core/engines/merge';
import { runAiTask } from '@/lib/ai';
import { emailDraftTask } from '@/lib/aiTasks';
import { Sparkles } from 'lucide-react';
import { documentTypeLabel } from '@/core/engines/numbering';
import { newEntity } from '@/core/schemas/common';
import { Alert, Button, Chip, Dialog, Field, TextInput, TextArea, useToast } from '@/ui/components/base';
import { date, money } from '@/ui/lib/format';

const DEFAULT_SUBJECT = '{invoice.number} from {business.name}';
const DEFAULT_BODY =
  'Hi {client.name},\n\nPlease find {invoice.number} for {invoice.total} attached. Payment is due by {invoice.due_date}.\n\nThank you,\n{business.name}';

export function EmailDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { push } = useToast();
  const profile = useActiveProfile();
  const clients = useAppStore((s) => s.clients);
  const emailTemplates = useAppStore((s) => s.emailTemplates);
  const designTemplates = useAppStore((s) => s.designTemplates);
  const attachments = useAppStore((s) => s.attachments);
  const taxCodes = useAppStore((s) => s.taxCodes);
  const settings = useAppStore((s) => s.settings);

  const document = useEditorStore((s) => s.document);
  const lines = useEditorStore((s) => s.lines);
  const result = useEditorStore((s) => s.result);
  const payments = useEditorStore((s) => s.payments);

  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [history, setHistory] = useState<
    { id: string; to: string[]; subject: string; sentAt: string | null }[]
  >([]);

  const client = useMemo(() => clients.find((c) => c.id === document?.clientId) ?? null, [clients, document]);

  const mergeValues = useMemo(() => {
    if (!document) return {};
    return buildMergeValues({
      business: { name: profile?.name ?? '', email: profile?.email ?? '' },
      client: client ? { name: client.displayName, email: client.email } : null,
      document: {
        number: document.number || '',
        draftNumber: document.draftNumber ?? '',
        typeLabel: documentTypeLabel(document.type),
        issueDate: date(document.issueDate, settings),
        dueDate: document.dueDate ? date(document.dueDate, settings) : null,
        currency: document.currency,
        total: money(document.totals.total, document.currency),
        balance: money(document.totals.balance, document.currency),
      },
    });
  }, [document, client, profile, settings]);

  /* Prefill from the document's template, then the client's default. */
  useEffect(() => {
    if (!open || !document) return;
    const template =
      emailTemplates.find((t) => t.id === document.emailTemplateId) ??
      emailTemplates.find((t) => t.id === client?.defaultEmailTemplateId) ??
      null;
    setTemplateId(template?.id ?? null);
    setTo(client?.email ?? '');
    setSubject(interpolate(template?.subject || DEFAULT_SUBJECT, mergeValues));
    setBody(interpolate(template?.body || DEFAULT_BODY, mergeValues));
    void storage()
      .listEmailLogs(document.id)
      .then((logs) =>
        setHistory(
          logs
            .filter((l) => l.sentAt !== null)
            .sort((a, b) => (a.sentAt && b.sentAt ? b.sentAt.localeCompare(a.sentAt) : 0))
            .slice(0, 5)
            .map((l) => ({ id: l.id, to: l.to, subject: l.subject, sentAt: l.sentAt })),
        ),
      );
  }, [open, document, client, emailTemplates, mergeValues]);

  if (!document || !result) return null;

  /** Insert a merge field at the end of the body. */
  const insertField = (key: string) => setBody(`${body}${key}`);

  /** The PDF as a blob, so share and save reuse one render. */
  const pdfBlob = async () =>
    renderBundlePdf({
      document,
      lines,
      payments,
      result,
      profile,
      client,
      template: designTemplates.find((t) => t.id === document.designTemplateId) ?? null,
      taxCodes,
      attachments,
    });

  const downloadPdf = async () => {
    try {
      const blob = await pdfBlob();
      await files().saveAs(`${document.number || document.id}.pdf`, blob);
    } catch (error) {
      push({
        tone: 'error',
        title: 'Could not render the PDF',
        description: error instanceof Error ? error.message : '',
      });
    }
  };

  /**
   * The Android share sheet (and macOS/Windows on supporting browsers): one
   * tap shares the PDF to Gmail or anywhere else. A native feature, so there
   * is nothing to install; hidden when the browser has no share sheet.
   */
  const sharePdf = async () => {
    try {
      const blob = await pdfBlob();
      const file = new File([blob], `${document.number || 'document'}.pdf`, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: document.number || 'Document' });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: document.number || 'Document', text: subject });
        return;
      }
      await downloadPdf();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      push({
        tone: 'error',
        title: 'Could not share',
        description: error instanceof Error ? error.message : '',
      });
    }
  };

  const downloadCsv = async () => {
    try {
      const blob = tableBlob(
        documentTableExport({ document, lines, result, clientName: client?.displayName ?? '', money }),
        'csv' as ExportFormat,
      );
      await files().saveAs(`${document.number || document.id}.csv`, blob);
    } catch (error) {
      push({
        tone: 'error',
        title: 'Could not export the CSV',
        description: error instanceof Error ? error.message : '',
      });
    }
  };

  /** Queue the send for a chosen date: the scheduler moves it to ready, Reminders approves it. */
  const scheduleSend = async () => {
    if (!scheduledFor) return;
    try {
      await storage().saveOutbox({
        ...newEntity({}),
        documentId: document.id,
        to: to
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        subject,
        body,
        queuedAt: `${scheduledFor}T09:00:00.000Z`,
        status: 'waiting',
        cc: [],
        bcc: [],
        accountId: useAppStore.getState().profiles.find((p) => p.id === document.profileId)?.sendingEmailAccountId ?? null,
        attachmentNames: [],
        pdfPath: null,
        pdfDataUrl: null,
        attempts: 0,
        lastError: null,
      });
      push({
        tone: 'success',
        title: 'Send queued',
        description: `It will be ready to approve on ${scheduledFor}.`,
      });
      setScheduledFor('');
    } catch (error) {
      push({
        tone: 'error',
        title: 'Could not queue the send',
        description: error instanceof Error ? error.message : '',
      });
    }
  };

  /** Draft with AI: fills the subject and body; the user sends. */
  const draftWithAi = async () => {
    setDrafting(true);
    try {
      const context = [
        `Document: ${document.number || 'draft'} (${documentTypeLabel(document.type)})`,
        `Client: ${client?.displayName ?? 'unknown'}`,
        `Total: ${mergeValues['invoice.total']}`,
        `Balance: ${mergeValues['invoice.balance']}`,
        `Due: ${mergeValues['invoice.dueDate'] || 'no due date'}`,
        `Business: ${mergeValues['business.name']}`,
      ].join('\n');
      const result = await runAiTask(emailDraftTask, { context });
      if (!result.ok || !result.value) {
        push({ tone: 'error', title: 'Could not draft', description: result.error ?? '' });
        return;
      }
      setSubject(result.value.subject);
      setBody(result.value.body);
    } finally {
      setDrafting(false);
    }
  };

  const openMailApp = async () => {
    setSending(true);
    try {
      const recipients = to
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      // A real send goes through the business's sending account, with the
      // rendered PDF attached. On the web the attachment is the PDF the
      // user downloads to attach; on desktop it is the SMTP attachment.
      let pdfPayload: { fileName: string; content: string; mimeType: string }[] = [];
      try {
        const blob = await pdfBlob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error ?? new Error('Could not read the PDF'));
          reader.readAsDataURL(blob);
        });
        pdfPayload = [
          {
            fileName: `${document.number || document.id}.pdf`,
            content: dataUrl,
            mimeType: 'application/pdf',
          },
        ];
      } catch {
        // No PDF, no attachment: the send still goes out.
      }

      const mailResult = await platform().mail.send({
        accountId: useAppStore.getState().profiles.find((p) => p.id === document.profileId)?.sendingEmailAccountId ?? null,
        fromName: profile?.name ?? '',
        fromEmail: profile?.email ?? '',
        to: recipients,
        subject,
        body,
        attachments: pdfPayload,
      });
      await storage().saveEmailLog({
        ...newEntity({}),
        documentId: document.id,
        profileId: profile?.id ?? null,
        to: recipients,
        subject,
        body,
        templateId,
        sentAt: new Date().toISOString(),
        status: mailResult.ok ? 'opened_in_app' : 'failed',
        error: mailResult.error ?? null,
        via: mailResult.via,
        cc: [],
        bcc: [],
        accountId: useAppStore.getState().profiles.find((p) => p.id === document.profileId)?.sendingEmailAccountId ?? null,
        attachmentNames: pdfPayload.map((a) => a.fileName),
        notes: '',
      });
      push({
        tone: mailResult.ok ? 'success' : 'error',
        title: mailResult.ok ? 'Mail app opened' : 'Could not open the mail app',
        description: mailResult.error ?? 'Attach the PDF you downloaded and send.',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={`Email ${document.number || 'draft'}`} size="lg">
      <div className="grid gap-4">
        <Field label="To" hint="Comma-separate multiple recipients.">
          <TextInput
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="accounts@client.example"
          />
        </Field>

        <Field
          label="Subject"
          hint={
            emailTemplates.length > 0
              ? 'From the document email template. Edit below, or change the template in Settings.'
              : 'No email templates yet — this is the default. Create one in Settings.'
          }
        >
          <div className="flex gap-2">
            <TextInput value={subject} onChange={(e) => setSubject(e.target.value)} />
            {settings?.aiEnabled && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Sparkles className="size-3.5" aria-hidden />}
                loading={drafting}
                onClick={() => void draftWithAi()}
              >
                Draft
              </Button>
            )}
          </div>
        </Field>

        <Field label="Body">
          <TextArea rows={7} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>

        <div>
          <p className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase">
            Merge fields
          </p>
          <div className="flex flex-wrap gap-1.5">
            {MERGE_FIELDS.map((field) => (
              <Chip
                key={field.token}
                title={`Insert ${field.description}`}
                onClick={() => insertField(field.token)}
              >
                {field.token}
              </Chip>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            icon={<Download className="size-3.5" aria-hidden />}
            onClick={() => void downloadPdf()}
          >
            Download PDF to attach
          </Button>
          {'canShare' in navigator && (
            <Button size="sm" onClick={() => void sharePdf()}>
              Share PDF
            </Button>
          )}
          <Button size="sm" onClick={() => void downloadCsv()}>
            Download CSV
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<Mail className="size-3.5" aria-hidden />}
            onClick={() => void openMailApp()}
            disabled={sending || !to.trim()}
          >
            Open mail app
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-2 rounded-[8px] border border-rule bg-paper-sunken p-3">
          <Field label="Or schedule this send" inline>
            <TextInput type="date" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
          </Field>
          <Button size="sm" onClick={() => void scheduleSend()} disabled={!scheduledFor}>
            Queue scheduled send
          </Button>
          <p className="w-full text-[12px] text-ink-muted">
            It waits until the date, then appears in Reminders for your approval. Nothing is sent
            automatically.
          </p>
        </div>

        {history.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase">
              Sent to this document
            </p>
            <ul className="space-y-1">
              {history.map((entry) => (
                <li key={entry.id} className="text-[13px] text-ink-muted">
                  {entry.sentAt ? date(entry.sentAt, settings) : ''} — {entry.to.join(', ')} — {entry.subject}
                </li>
              ))}
            </ul>
          </div>
        )}

        <Alert tone="info" title="Nothing is sent without you">
          Duly on the web opens your mail app rather than connecting directly. The subject and body are on
          your clipboard, and every send is logged against this document.
        </Alert>
      </div>
    </Dialog>
  );
}
