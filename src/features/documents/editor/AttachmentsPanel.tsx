/**
 * Attachments on a document.
 *
 * The plan's two destinations: "appended as extra PDF pages or sent as separate email
 * attachments" — a timesheet after the invoice, a receipt as evidence. Both are a
 * per-attachment choice, because a contract belongs in the email and a timesheet
 * belongs in the PDF.
 *
 * Files are read into data URLs and stored on the record, so they travel inside a JSON
 * backup and survive a browser restart with no filesystem permission — the same
 * reasoning as the business logo. That caps the size: a 20 MB scan is not something a
 * single local database row should hold, so the limit is stated rather than discovered.
 */

import { useRef } from 'react';
import { FileText, Paperclip, Trash2 } from 'lucide-react';
import type { Attachment } from '@/core/schemas';
import { attachmentSchema } from '@/core/schemas/crm';
import { newEntity } from '@/core/schemas/common';
import { storage } from '@/adapters';
import { useAppStore } from '@/state/app';
import { Button, Card, Checkbox, EmptyState, IconButton, Tooltip, useToast } from '@/ui/components/base';

const MAX_BYTES = 8 * 1024 * 1024;

function humanSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${bytes} bytes`;
}

export function AttachmentsPanel({
  documentId,
  readOnly,
}: {
  documentId: string;
  /** Finalised documents keep their attachments but do not gain new ones. */
  readOnly?: boolean;
}) {
  const { push } = useToast();
  const attachments = useAppStore((s) => s.attachments);
  const inputRef = useRef<HTMLInputElement>(null);

  const theirs = attachments.filter((a) => a.ownerType === 'document' && a.ownerId === documentId);

  const add = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const db = storage();

    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        push({
          tone: 'warning',
          title: `${file.name} is too large`,
          description: `${humanSize(file.size)}. Attachments are kept inside Duly's own database, so 8 MB is the limit.`,
        });
        continue;
      }

      try {
        const attachment = attachmentSchema.parse(
          newEntity({
            ownerType: 'document',
            ownerId: documentId,
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
            storedPath: await readAsDataUrl(file),
            appendToPdf: false,
            internal: false,
            caption: '',
          }),
        );
        await db.saveAttachment(attachment);
      } catch (error) {
        push({
          tone: 'error',
          title: `${file.name} could not be attached`,
          description: error instanceof Error ? error.message : '',
        });
      }
    }

    await useAppStore.getState().refresh();
    if (inputRef.current) inputRef.current.value = '';
  };

  const setFlag = async (attachment: Attachment, changes: Partial<Attachment>) => {
    await storage().saveAttachment({ ...attachment, ...changes });
    await useAppStore.getState().refresh();
  };

  const remove = async (attachment: Attachment) => {
    await storage().deleteAttachment(attachment.id);
    await useAppStore.getState().refresh();
    push({ tone: 'info', title: `${attachment.fileName} removed` });
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="eyebrow flex items-center gap-1.5">
          <Paperclip className="size-3.5" aria-hidden />
          Attachments
        </h2>
        {!readOnly && (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              capture="environment"
              className="sr-only"
              aria-label="Choose files to attach"
              onChange={(e) => void add(e.target.files)}
            />
            <Button size="sm" onClick={() => inputRef.current?.click()}>
              Attach a file
            </Button>
          </>
        )}
      </div>

      {theirs.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-6" aria-hidden />}
          title="Nothing attached"
          hint="A timesheet after the invoice, or a receipt as evidence. Attachments can go into the PDF after the last page, or be sent separately with the email."
        />
      ) : (
        <ul className="divide-y divide-rule">
          {theirs.map((attachment) => (
            <li key={attachment.id} className="flex flex-wrap items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-ink">{attachment.fileName}</p>
                <p className="text-[11px] text-ink-faint">
                  {humanSize(attachment.sizeBytes)} · {attachment.mimeType}
                </p>
              </div>

              {!readOnly && (
                <>
                  <Tooltip label="PDF append is Phase 5" side="top">
                    <label className="flex items-center gap-1.5 text-[12px] text-ink-muted">
                      <Checkbox
                        checked={attachment.appendToPdf}
                        label="Append to PDF"
                        disabled
                        onChange={() => {}}
                      />
                    </label>
                  </Tooltip>
                  <label className="flex items-center gap-1.5 text-[12px] text-ink-muted">
                    <Checkbox
                      checked={attachment.internal}
                      label="Internal only"
                      hint="Evidence, not shown to the client"
                      onChange={(internal) => void setFlag(attachment, { internal })}
                    />
                  </label>
                  <IconButton label={`Remove ${attachment.fileName}`} onClick={() => void remove(attachment)}>
                    <Trash2 className="size-3.5" aria-hidden />
                  </IconButton>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read'));
    reader.readAsDataURL(file);
  });
}
