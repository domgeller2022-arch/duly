/**
 * The bulk-action dialog.
 *
 * Two jobs in one dialog, because the same confirmation has to do both: get the
 * user's agreement before anything is written, and then report exactly what happened.
 * Reporting is the part that matters — "20 selected, 18 finalised, 2 skipped" with
 * the two named is a result somebody can act on, and a silent partial failure is not.
 */

import type { Document } from '@/core/schemas';
import type { BulkOutcome } from '@/lib/bulk';
import { Alert, Button, Dialog } from '@/ui/components/base';

export type BulkAction = 'finalise' | 'mark_paid' | 'void' | 'refile';

export interface BulkRequest {
  action: BulkAction;
  busy: boolean;
  outcome: BulkOutcome | null;
}

export const bulkTitles: Record<BulkAction, (count: number) => string> = {
  finalise: (n) => `Finalise ${n} document${n === 1 ? '' : 's'}?`,
  mark_paid: (n) => `Mark ${n} document${n === 1 ? '' : 's'} as paid?`,
  void: (n) => `Void ${n} document${n === 1 ? '' : 's'}?`,
  refile: (n) => `Rewrite ${n} PDF${n === 1 ? '' : 's'}?`,
};

export const bulkConfirmLabels: Record<BulkAction, string> = {
  finalise: 'Finalise them',
  mark_paid: 'Mark them paid',
  void: 'Void them',
  refile: 'Rewrite them',
};

export const bulkBodies: Record<BulkAction, string> = {
  finalise:
    'Finalising locks each document and assigns its final number. They cannot be edited afterwards — changes are made with a credit note. Each one goes through the same checks and the same number reservation as submitting it on its own.',
  mark_paid:
    'This sets the status and clears the balance. It deliberately records no payment, because the date and method of money that arrived are facts only you know. Use “Record payment” on each document if you want them in the payment history.',
  void: 'Voided documents are kept for the audit trail rather than deleted. They cannot be edited afterwards, and their numbers are never reused.',
  refile:
    'Each PDF is rendered again with its current stamp and written back over the file already on disk. Documents that have never been filed are skipped.',
};

/** Pick the action's function, so the screen does not grow a switch per action. */
export function bulkRunner(
  action: BulkAction,
  documents: Document[],
  context: import('@/lib/bulk').BulkContext & { today: string },
) {
  switch (action) {
    case 'finalise':
      return import('@/lib/bulk').then((m) => m.bulkFinalise(documents, context));
    case 'mark_paid':
      return import('@/lib/bulk').then((m) => m.bulkMarkPaid(documents, context.today));
    case 'void':
      return import('@/lib/bulk').then((m) =>
        m.bulkVoid(documents, 'Voided from the documents list', new Date().toISOString()),
      );
    case 'refile':
      return import('@/lib/bulk').then((m) => m.bulkRefile(documents, context));
  }
}

export function BulkResultDialog({
  action,
  outcome,
  busy,
  count,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  action: BulkAction;
  outcome: BulkOutcome | null;
  busy: boolean;
  /** How many documents are selected, for the confirmation title. */
  count: number;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const title = bulkTitles[action](count);
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      persistent={busy}
      title={outcome ? 'Done' : title}
      description={outcome ? undefined : body}
      footer={
        outcome ? (
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </>
        )
      }
    >
      {!outcome && (
        <p className="text-[13px] leading-relaxed text-ink-muted">
          {body} Each document is handled on its own, so one that cannot be finalised does not stop the rest.
        </p>
      )}

      {outcome && (
        <div className="space-y-3">
          <Alert tone={outcome.done > 0 ? 'success' : 'warning'}>{outcome.summary}</Alert>

          {outcome.skipped.length > 0 && (
            <div>
              <p className="mb-1 text-[13px] font-medium text-ink">Skipped {outcome.skipped.length}</p>
              <ul className="divide-y divide-rule rounded-[8px] border border-rule">
                {outcome.skipped.map(({ document, reason }) => (
                  <li key={document.id} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                    <span className="truncate font-mono text-[12px] text-ink">
                      {document.number || document.draftNumber || document.id.slice(0, 8)}
                    </span>
                    <span className="shrink-0 text-[12px] text-ink-muted">{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {outcome.errors.length > 0 && (
            <Alert tone="error" title={`${outcome.errors.length} could not be completed`}>
              <ul className="mt-1 space-y-0.5">
                {outcome.errors.map((error, i) => (
                  <li key={i} className="text-[12px]">
                    {error}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
        </div>
      )}
    </Dialog>
  );
}

export { bulkTitles as titlesFor, bulkBodies as bodiesFor };
