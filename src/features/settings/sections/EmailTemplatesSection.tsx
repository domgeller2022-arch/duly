/**
 * Email templates.
 *
 * The plan's item 5: templates with merge fields and a preview. The tokens are
 * the single-brace `{client.name}` form the merge engine resolves, and the
 * preview interpolates with sample values so a template shows exactly what a
 * send would produce — including typos, which stay visible on purpose.
 */

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { EmailTemplate } from '@/core/schemas';
import { emailTemplateSchema, EMAIL_PURPOSES } from '@/core/schemas/template';
import { newEntity } from '@/core/schemas/common';
import { interpolate, MERGE_FIELDS, buildMergeValues } from '@/core/engines/merge';
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
  Table,
  Td,
  TextArea,
  TextInput,
  Th,
  useToast,
} from '@/ui/components/base';

const PURPOSE_LABELS: Record<EmailTemplate['purpose'], string> = {
  send: 'Sending an invoice',
  reminder_before: 'Reminder before due',
  reminder_due: 'Reminder on due date',
  reminder_after: 'Reminder after due',
  statement: 'Statement',
  receipt: 'Receipt',
  quote: 'Quote',
  late_fee: 'Late fee',
};

/** Sample values so the preview reads like a real send. */
const SAMPLE_VALUES = buildMergeValues({
  business: { name: 'Acme Pty Ltd', email: 'billing@acme.example' },
  client: { name: 'Client Pty Ltd', email: 'accounts@client.example' },
  document: {
    number: 'INV-2026-0001',
    typeLabel: 'Tax Invoice',
    issueDate: '6 Oct 2026',
    dueDate: '5 Nov 2026',
    currency: 'AUD',
    total: '$1,870.00',
    balance: '$1,870.00',
  },
});

export function EmailTemplatesSection() {
  const { push } = useToast();
  const templates = useAppStore((s) => s.emailTemplates);
  const saveEmailTemplate = useAppStore((s) => s.saveEmailTemplate);
  const removeEmailTemplate = useAppStore((s) => s.removeEmailTemplate);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EmailTemplate | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const existing = useMemo(() => templates.find((t) => t.id === editingId) ?? null, [templates, editingId]);

  const startNew = () => {
    const now = new Date().toISOString();
    const fresh = emailTemplateSchema.parse({ ...newEntity({}), createdAt: now, updatedAt: now });
    setDraft(fresh);
    setEditingId(fresh.id);
  };

  const startEdit = (template: EmailTemplate) => {
    setDraft(template);
    setEditingId(template.id);
  };

  const save = async () => {
    if (!draft) return;
    try {
      const parsed = emailTemplateSchema.parse({ ...draft, updatedAt: new Date().toISOString() });
      await saveEmailTemplate(parsed as EmailTemplate);
      push({ tone: 'success', title: 'Template saved' });
      setDraft(null);
      setEditingId(null);
    } catch (error) {
      push({
        tone: 'error',
        title: 'Could not save',
        description: error instanceof Error ? error.message : '',
      });
    }
  };

  const remove = async (id: string) => {
    await removeEmailTemplate(id);
    if (editingId === id) {
      setDraft(null);
      setEditingId(null);
    }
    setConfirmId(null);
    push({ tone: 'success', title: 'Template deleted' });
  };

  const patch = (changes: Partial<EmailTemplate>) => setDraft(draft ? { ...draft, ...changes } : draft);

  return (
    <div className="grid gap-4">
      <Panel
        title="Email templates"
        description="Subject and body for each purpose. The document's email template is used when you email an invoice; the client's default wins when it has one."
        actions={
          <Button size="sm" icon={<Plus className="size-3.5" aria-hidden />} onClick={startNew}>
            New template
          </Button>
        }
        flush
      >
        {templates.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-ink-muted">
            No templates yet — emails use a built-in default.
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Purpose</Th>
                <Th>Subject</Th>
                <Th>Attachments</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr
                  key={template.id}
                  className="cursor-pointer hover:bg-paper-sunken"
                  onClick={() => startEdit(template)}
                >
                  <Td className="font-medium text-ink">
                    {template.name} {template.builtin && <Badge>built-in</Badge>}
                  </Td>
                  <Td className="text-ink-muted">{PURPOSE_LABELS[template.purpose]}</Td>
                  <Td className="max-w-64 truncate text-ink-muted">{template.subject || '—'}</Td>
                  <Td className="text-ink-muted">{template.attachPdf ? 'PDF' : '—'}</Td>
                  <Td>
                    {!template.builtin && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Trash2 className="size-3.5" aria-hidden />}
                        onClick={() => setConfirmId(template.id)}
                      >
                        Delete
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      {draft && existing === null && editingId !== null && (
        <Card className="p-4">
          <h2 className="mb-3 font-medium text-ink">New template</h2>
          <EmailTemplateForm draft={draft} patch={patch} />
          <PreviewCard
            subject={interpolate(draft.subject, SAMPLE_VALUES)}
            body={interpolate(draft.body, SAMPLE_VALUES)}
          />
          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={() => void save()}>
              Save template
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(null);
                setEditingId(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {draft && existing !== null && (
        <Card className="p-4">
          <h2 className="mb-3 font-medium text-ink">Edit {draft.name}</h2>
          <EmailTemplateForm draft={draft} patch={patch} />
          <PreviewCard
            subject={interpolate(draft.subject, SAMPLE_VALUES)}
            body={interpolate(draft.body, SAMPLE_VALUES)}
          />
          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={() => void save()}>
              Save template
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(null);
                setEditingId(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={() => confirmId && void remove(confirmId)}
        title="Delete this template?"
        body="Documents using it fall back to the built-in default."
        confirmLabel="Delete"
      />

      <Card className="p-4">
        <h2 className="mb-3 font-medium text-ink">Merge fields</h2>
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {MERGE_FIELDS.map((field) => (
            <p key={field.token} className="text-[13px] text-ink-muted">
              <code className="rounded bg-paper-sunken px-1.5 py-0.5 font-mono text-[12px] text-ink">
                {field.token}
              </code>{' '}
              {field.description}
            </p>
          ))}
        </div>
      </Card>
    </div>
  );
}

function EmailTemplateForm({
  draft,
  patch,
}: {
  draft: EmailTemplate;
  patch: (changes: Partial<EmailTemplate>) => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <TextInput value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
        </Field>
        <Field label="Purpose">
          <Select
            value={draft.purpose}
            onChange={(e) => patch({ purpose: e.target.value as EmailTemplate['purpose'] })}
          >
            {EMAIL_PURPOSES.map((purpose) => (
              <option key={purpose} value={purpose}>
                {PURPOSE_LABELS[purpose]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From name">
          <TextInput
            value={draft.fromName}
            onChange={(e) => patch({ fromName: e.target.value })}
            placeholder="Acme Pty Ltd"
          />
        </Field>
        <Field label="Reply-to">
          <TextInput
            value={draft.replyTo}
            onChange={(e) => patch({ replyTo: e.target.value })}
            placeholder="billing@acme.example"
          />
        </Field>
      </div>
      <Field label="Subject">
        <TextInput
          value={draft.subject}
          onChange={(e) => patch({ subject: e.target.value })}
          placeholder="{invoice.number} from {business.name}"
        />
      </Field>
      <Field label="Body">
        <TextArea rows={6} value={draft.body} onChange={(e) => patch({ body: e.target.value })} />
      </Field>
      <div className="flex flex-wrap gap-4">
        <Checkbox
          checked={draft.attachPdf}
          label="Attach the PDF"
          onChange={(v) => patch({ attachPdf: v })}
        />
        <Checkbox
          checked={draft.attachDocuments}
          label="Attach documents (timesheets, receipts)"
          onChange={(v) => patch({ attachDocuments: v })}
        />
      </div>
    </div>
  );
}

function PreviewCard({ subject, body }: { subject: string; body: string }) {
  return (
    <div className="mt-4 rounded-[8px] border border-rule bg-paper-sunken p-3">
      <p className="text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase">Preview</p>
      <p className="mt-2 text-[13px] font-medium text-ink">{subject || '(no subject)'}</p>
      <p className="mt-1 whitespace-pre-wrap text-[13px] text-ink-muted">{body || '(empty)'}</p>
    </div>
  );
}
