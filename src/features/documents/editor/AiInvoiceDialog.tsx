/**
 * AI invoice entry — the plan's first-wave feature and the acceptance.
 *
 * "Bill Acme 3 days consulting at $1,200/day" becomes a correct draft: the
 * sentence goes through the pipeline, the parsed result shows as an editable
 * review form, and Accept creates the draft — never a finalised document,
 * never a send, never a payment. The user can edit every field before
 * accepting, which is the plan's item 4: review as edit, not a rubber stamp.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Trash2, Plus } from 'lucide-react';
import { useAppStore, useActiveProfile } from '@/state/app';
import { runAiTask, aiRequestPreview } from '@/lib/ai';
import { invoiceEntryTask, type InvoiceEntryResult } from '@/lib/aiTasks';
import { createDocument } from '@/core/documents';
import { recalculateDocument } from '@/lib/documentService';
import { addDaysIso } from '@/core/validation/dates';
import { newClient } from '@/core/schemas/crm';
import { newEntity } from '@/core/schemas/common';
import { Alert, Button, Dialog, Field, Select, TextInput, useToast } from '@/ui/components/base';
import { money } from '@/ui/lib/format';

export function AiInvoiceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { push } = useToast();
  const navigate = useNavigate();
  const profile = useActiveProfile();
  const clients = useAppStore((s) => s.clients);
  const taxCodes = useAppStore((s) => s.taxCodes);
  const settings = useAppStore((s) => s.settings);
  const today = useAppStore((s) => s.today);
  const saveClient = useAppStore((s) => s.saveClient);

  const [instruction, setInstruction] = useState('');
  const [parsed, setParsed] = useState<InvoiceEntryResult | null>(null);
  const [clientId, setClientId] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  const aiOff = settings?.aiEnabled === false;

  // The plan's "show what will be sent": the exact system + prompt the run
  // would send, built by the same functions, so it cannot drift.
  const preview = settings ? aiRequestPreview(invoiceEntryTask, { instruction }, settings) : null;

  const run = async () => {
    if (!instruction.trim()) return;
    setRunning(true);
    setError('');
    setParsed(null);
    try {
      const result = await runAiTask(invoiceEntryTask, { instruction });
      if (!result.ok || !result.value) {
        setError(result.error ?? 'The draft could not be produced.');
        return;
      }
      setParsed(result.value);
      // The client the parse names, matched case-insensitively.
      const existing = clients.find(
        (c) => c.displayName.toLowerCase() === result.value!.clientName.toLowerCase(),
      );
      setClientId(existing?.id ?? '');
    } finally {
      setRunning(false);
    }
  };

  const totalMinor = useMemo(() => {
    if (!parsed) return 0;
    return parsed.lines.reduce(
      (acc, line) => acc + Math.round((Number.parseFloat(line.quantity) || 0) * line.unitPriceDollars * 100),
      0,
    );
  }, [parsed]);

  /** Accept: the client the parse names is created when new, then the draft. */
  const accept = async () => {
    if (!parsed || !profile) return;
    try {
      let client = clients.find((c) => c.id === clientId) ?? null;
      if (!client) {
        client = newClient({ displayName: parsed.clientName });
        await saveClient(client);
      }

      const settingsValue = settings ?? (await (await import('@/adapters')).storage().getSettings());
      const { document } = createDocument({
        type: 'invoice',
        profile,
        settings: settingsValue,
        client,
        today,
      });

      // A document line shape from the parse; documentId set now.
      const { documentLineSchema } = await import('@/core/schemas/document');
      const parsedLines = parsed.lines.map((line) =>
        documentLineSchema.parse({
          ...newEntity({}),
          documentId: document.id,
          type: 'item',
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          unitPrice: Math.round(line.unitPriceDollars * 100),
        }),
      );

      await recalculateDocument({
        document,
        // The reviewed due days, when the parse or the user set them —
        // the field used to be collected and then ignored.
        documentPatch:
          parsed.dueDays !== null && parsed.dueDays !== undefined
            ? { dueDate: addDaysIso(document.issueDate, parsed.dueDays) }
            : undefined,
        lines: parsedLines,
        taxCodes,
        deriveStatus: false,
      });

      await useAppStore.getState().refresh();
      onClose();
      push({
        tone: 'success',
        title: 'Draft created',
        description: 'Ready for your review. Nothing has been submitted.',
      });
      navigate(`/invoices/${document.id}`);
    } catch (err) {
      push({
        tone: 'error',
        title: 'Could not create the draft',
        description: err instanceof Error ? err.message : '',
      });
    }
  };

  const patchLine = (index: number, changes: Partial<InvoiceEntryResult['lines'][number]>) => {
    if (!parsed) return;
    setParsed({
      ...parsed,
      lines: parsed.lines.map((line, i) => (i === index ? { ...line, ...changes } : line)),
    });
  };

  return (
    <Dialog open={open} onClose={onClose} title="Draft an invoice from plain language" size="lg">
      <div className="grid gap-4">
        {aiOff && (
          <Alert tone="warning" title="AI is switched off">
            Turn it on in Settings → AI. Every screen works without it.
          </Alert>
        )}

        <Field
          label="What should Duly bill?"
          hint='For example: "Bill Acme 3 days consulting at $1,200/day".'
        >
          <div className="flex gap-2">
            <TextInput
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !running && void run()}
              placeholder="Bill Acme 3 days consulting at $1,200/day"
            />
            <Button
              size="sm"
              variant="primary"
              icon={<Sparkles className="size-3.5" aria-hidden />}
              onClick={() => void run()}
              disabled={running || !instruction.trim() || aiOff}
            >
              {running ? 'Reading…' : 'Draft'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowPreview((v) => !v)}
              disabled={aiOff || !instruction.trim()}
            >
              {showPreview ? 'Hide request' : 'Show what will be sent'}
            </Button>
          </div>
        </Field>

        {showPreview && preview && (
          <Alert tone="info" title="This is exactly what will be sent">
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[12px] text-ink-muted">
              {`model: ${preview.model || '(the endpoint default)'}\nimages: ${preview.images}\n\n— system —\n${preview.system}\n\n— prompt —\n${preview.prompt}`}
            </pre>
          </Alert>
        )}

        {error && (
          <Alert tone="error" title="Could not produce a draft">
            {error}
          </Alert>
        )}

        {parsed && (
          <div className="grid gap-3 rounded-[8px] border border-rule bg-paper-sunken p-3">
            <p className="text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase">
              Review — edit anything before accepting
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Client">
                <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">{parsed.clientName} (new client)</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Due (days from issue)">
                <TextInput
                  value={parsed.dueDays === null ? '' : String(parsed.dueDays)}
                  onChange={(e) =>
                    setParsed({
                      ...parsed,
                      dueDays: e.target.value ? Math.max(0, Number(e.target.value)) : null,
                    })
                  }
                  placeholder="Leave blank for the default terms"
                />
              </Field>
            </div>
            <div className="grid gap-2">
              {parsed.lines.map((line, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <TextInput
                    value={line.description}
                    onChange={(e) => patchLine(index, { description: e.target.value })}
                    className="min-w-48 flex-1"
                  />
                  <TextInput
                    value={line.quantity}
                    onChange={(e) => patchLine(index, { quantity: e.target.value })}
                    className="max-w-20"
                    aria-label="Quantity"
                  />
                  <TextInput
                    value={line.unit}
                    onChange={(e) => patchLine(index, { unit: e.target.value })}
                    className="max-w-24"
                    aria-label="Unit"
                  />
                  <TextInput
                    value={String(line.unitPriceDollars)}
                    onChange={(e) => patchLine(index, { unitPriceDollars: Number(e.target.value) || 0 })}
                    className="max-w-28"
                    aria-label="Unit price"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 className="size-3.5" aria-hidden />}
                    disabled={parsed.lines.length === 1}
                    onClick={() =>
                      setParsed({ ...parsed, lines: parsed.lines.filter((_, i) => i !== index) })
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="ghost"
                icon={<Plus className="size-3.5" aria-hidden />}
                onClick={() =>
                  setParsed({
                    ...parsed,
                    lines: [
                      ...parsed.lines,
                      { description: '', quantity: '1', unit: 'each', unitPriceDollars: 0 },
                    ],
                  })
                }
              >
                Add line
              </Button>
            </div>
            <p className="text-[13px] text-ink-muted">Total: {money(totalMinor, 'AUD')} before tax.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" onClick={() => void accept()} disabled={!parsed.clientName}>
                Accept and create draft
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setParsed(null)}>
                Discard
              </Button>
            </div>
          </div>
        )}

        <Alert tone="info" title="AI never submits">
          The draft is created for your review. Nothing is finalised, sent or recorded until you do it.
        </Alert>
      </div>
    </Dialog>
  );
}
