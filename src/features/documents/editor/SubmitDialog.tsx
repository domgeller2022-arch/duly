/**
 * The submit dialog.
 *
 * The last thing between a draft and a document a client can rely on, so it is
 * where everything that could go wrong is checked before anything is written:
 *
 *  - the ATO compliance checks, worst first, each naming the rule it comes from
 *  - the number that will be assigned, and the pattern that produced it
 *  - the path the PDF will be written to
 *  - whether to email it now
 *
 * Submitting reserves the number inside a transaction and freezes a tax snapshot,
 * then writes the PDF to the output folder. If the PDF cannot be written the
 * document is still finalised — the number matters more, and the file can be
 * written again from the list.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, FileCheck2, FolderTree, Hash, Mail } from 'lucide-react';
import type { ComplianceCheck } from '@/core/validation/compliance';
import { countBySeverity, summarise } from '@/core/validation/compliance';
import { useAppStore, useActiveProfile } from '@/state/app';
import { useEditorStore } from './editorStore';
import { clientCodeFor, finaliseDocument, outputPathFor, patternFor } from '@/lib/finalise';
import { renderBundlePdf } from '@/lib/exports';
import { files, platform } from '@/adapters';
import { nextCounterValue, previewNumber, shouldReset } from '@/core/engines/numbering';
import { Alert, Button, Checkbox, Dialog, useToast } from '@/ui/components/base';

export function SubmitDialog({
  open,
  onClose,
  compliance,
}: {
  open: boolean;
  onClose: () => void;
  compliance: ComplianceCheck[];
}) {
  const navigate = useNavigate();
  const { push } = useToast();
  const profile = useActiveProfile();
  const settings = useAppStore((s) => s.settings);
  const clients = useAppStore((s) => s.clients);
  const refreshDocuments = useAppStore((s) => s.refreshDocuments);

  const document = useEditorStore((s) => s.document);
  const lines = useEditorStore((s) => s.lines);
  const result = useEditorStore((s) => s.result);
  const payments = useEditorStore((s) => s.payments);
  const reload = useEditorStore((s) => s.reload);

  const [emailNow, setEmailNow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);

  const counts = countBySeverity(compliance);
  const blocking = counts.block > 0;

  const client = useMemo(
    () => clients.find((c) => c.id === document?.clientId) ?? null,
    [clients, document?.clientId],
  );

  /* ---- the number that will be assigned, previewed from the real sequence ---- */

  const nextNumber = useMemo(() => {
    if (!document || !profile) return '';
    const sequence = useAppStore
      .getState()
      .numberSequences.find((s) => s.profileId === profile.id && s.documentType === document.type);
    // No sequence yet: the reservation will create one starting at 1 with the
    // default pattern. With one: the counter it actually holds, rolled over
    // when the document's issue date crosses the sequence's period.
    const pattern = sequence?.pattern ?? patternFor(document.type);
    const value = sequence
      ? nextCounterValue(
          sequence,
          shouldReset(sequence, document.issueDate, settings?.financialYearStartMonth ?? 7),
        )
      : 1;
    return previewNumber(
      pattern,
      {
        date: document.issueDate,
        documentType: document.type,
        clientCode: clientCodeFor(client),
        profileCode: profile?.code || undefined,
      },
      value,
    );
  }, [document, client, profile, settings]);

  /* ---- the path the PDF will land in ---- */

  useEffect(() => {
    if (!open || !settings || !document || !profile) {
      setOutputPath(null);
      return;
    }
    setOutputPath(
      outputPathFor(settings, document, client, nextNumber || document.draftNumber || 'UNNUMBERED', profile),
    );
  }, [open, settings, document, client, nextNumber, profile]);

  const canAutoFile = settings?.autoFileOnSubmit ?? false;
  const hasFolder = Boolean(settings?.outputFolderName);

  /* ---------------------------------------------------------------- */

  const submit = async () => {
    if (!document || !profile || !result || !settings) return;
    setSubmitting(true);
    setPathError(null);

    try {
      const outcome = await finaliseDocument({
        document,
        lines,
        payments,
        result,
        profile,
        client,
        taxCodes: useEditorStore.getState().taxCodes,
        template:
          useAppStore.getState().designTemplates.find((t) => t.id === document.designTemplateId) ?? null,
        settings,
      });

      await refreshDocuments();
      await reload();

      if (outcome.pdfError) setPathError(outcome.pdfError);

      onClose();

      push({
        tone: outcome.pdfError ? 'warning' : 'success',
        title: `${outcome.number} submitted`,
        description: outcome.pdfPath
          ? `Written to ${outcome.pdfPath}`
          : 'No PDF was written — export it whenever you like.',
      });

      // What submit does next: the setting decides. The default is nothing —
      // the document is in the list. download_pdf renders and downloads;
      // open_email opens the mailbox of choice with the details merged.
      if (settings.onSubmitAction === 'download_pdf' && !outcome.pdfPath) {
        try {
          const blob = await renderBundlePdf({
            document: outcome.document,
            lines,
            payments,
            result,
            profile,
            client,
            template:
              useAppStore.getState().designTemplates.find((t) => t.id === outcome.document.designTemplateId) ?? null,
            taxCodes: useEditorStore.getState().taxCodes,
          });
          await files().saveAs(`${outcome.document.number || outcome.document.id}.pdf`, blob);
        } catch (error) {
          push({
            tone: 'error',
            title: 'Could not download the PDF',
            description: error instanceof Error ? error.message : '',
          });
        }
      }
      if (settings.onSubmitAction === 'open_email') {
        await platform().mail.openInMailApp({
          to: client?.email ? [client.email] : [],
          subject: `${outcome.document.number || outcome.document.id} from ${profile.name}`,
          body: `Hi ${client?.displayName ?? ''},\n\nPlease find ${outcome.document.number || 'the invoice'} for ${outcome.document.totals.total / 100} attached.\n\nThank you,\n${profile.name}`,
        });
      }
      if (emailNow) navigate(`${documentRouteFor(outcome.document)}?email=1`);
    } catch (error) {
      push({
        tone: 'error',
        title: 'The document could not be submitted',
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      persistent={submitting}
      title="Submit this document"
      description={summarise(compliance)}
      size="lg"
      footer={
        <>
          <Button onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            loading={submitting}
            disabled={blocking || !document || lines.length === 0}
            icon={
              blocking ? (
                <AlertTriangle className="size-3.5" aria-hidden />
              ) : (
                <FileCheck2 className="size-3.5" aria-hidden />
              )
            }
          >
            {blocking ? 'Fix the issues first' : `Submit as ${nextNumber}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* ---- what is about to happen ---- */}
        <div className="grid grid-cols-1 gap-3 rounded-[8px] border border-rule bg-paper-sunken/50 p-3 sm:grid-cols-2">
          <div>
            <p className="eyebrow flex items-center gap-1.5">
              <Hash className="size-3" aria-hidden />
              Final number
            </p>
            <p className="mt-1 font-display text-[15px] font-semibold text-ink">{nextNumber}</p>
            <p className="text-[11px] text-ink-muted">Reserved now, and never issued again.</p>
          </div>
          <div>
            <p className="eyebrow flex items-center gap-1.5">
              <FolderTree className="size-3" aria-hidden />
              PDF location
            </p>
            <p className="mt-1 truncate text-[13px] text-ink" title={outputPath ?? undefined}>
              {outputPath ?? '—'}
            </p>
            <p className="text-[11px] text-ink-muted">
              {!hasFolder
                ? 'No output folder chosen yet — the PDF will not be written automatically.'
                : canAutoFile
                  ? `Written automatically into ${settings?.outputFolderName}.`
                  : 'Auto-file is switched off in Settings.'}
            </p>
          </div>
        </div>

        {/* ---- compliance ---- */}
        {compliance.length === 0 ? (
          <Alert tone="success" title="All checks passed">
            Everything the ATO requires for this document is present.
          </Alert>
        ) : (
          <div className="space-y-2">
            {compliance.map((check) => (
              <ComplianceRow key={check.id} check={check} />
            ))}
          </div>
        )}

        {pathError && <Alert tone="warning">{pathError}</Alert>}

        {/* ---- email now ---- */}
        {!blocking && (
          <div className="rounded-[8px] border border-rule p-3">
            <Checkbox
              checked={emailNow}
              onChange={setEmailNow}
              label={
                <span className="flex items-center gap-1.5">
                  <Mail className="size-3.5" aria-hidden />
                  Take me to the email screen afterwards
                </span>
              }
              hint="Duly will open your mail app with the PDF ready to attach. Nothing is sent without you."
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Compliance row                                                      */
/* ------------------------------------------------------------------ */

function ComplianceRow({ check }: { check: ComplianceCheck }) {
  const tone =
    check.severity === 'block'
      ? 'border-overdue/30 bg-overdue-soft'
      : check.severity === 'warn'
        ? 'border-due/30 bg-due-soft'
        : 'border-rule bg-paper-sunken/50';

  const badge =
    check.severity === 'block' ? (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-overdue">
        <AlertTriangle className="size-3" aria-hidden />
        Must fix
      </span>
    ) : check.severity === 'warn' ? (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-due">
        <AlertTriangle className="size-3" aria-hidden />
        Warning
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-muted">
        <Check className="size-3" aria-hidden />
        Note
      </span>
    );

  return (
    <div className={`rounded-[8px] border p-3 ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink">{check.title}</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">{check.detail}</p>
          {check.remedy && <p className="mt-1 text-[12px] text-ink-muted">→ {check.remedy}</p>}
        </div>
        <span className="shrink-0">{badge}</span>
      </div>
      <p className="mt-2 border-t border-current/10 pt-1.5 text-[11px] italic text-ink-faint">{check.rule}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function documentRouteFor(doc: { id: string; type: string }): string {
  switch (doc.type) {
    case 'quote':
      return `/quotes/${doc.id}`;
    case 'credit_note':
      return `/credit-notes/${doc.id}`;
    default:
      return `/invoices/${doc.id}`;
  }
}
