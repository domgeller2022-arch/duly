/**
 * Custom fields.
 *
 * The plan asks for extra fields on clients, items and documents — text, number,
 * date, dropdown — "available as merge fields on templates". Each field gets a
 * stable `key` that becomes its merge token, and the key is generated once and
 * never changed, because a token that changes means every email template using it
 * silently stops resolving.
 *
 * Deleting a field does not delete the values already stored on records: the record
 * keeps an orphan key, which is harmless and would otherwise destroy data the user
 * can still read in an export.
 */

import { useMemo, useState } from 'react';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import type { CustomField } from '@/core/schemas';
import { customFieldSchema } from '@/core/schemas/crm';
import { newEntity } from '@/core/schemas/common';
import { customFieldTokens, slugifyKey } from '@/core/engines/merge';
import { useAppStore } from '@/state/app';
import {
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

const ENTITY_LABELS: Record<CustomField['entity'], string> = {
  client: 'Clients',
  item: 'Items',
  document: 'Documents',
};

const TYPE_LABELS: Record<CustomField['type'], string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  select: 'Dropdown',
  multiselect: 'Multiple choice',
  checkbox: 'Yes / no',
};

const NEEDS_OPTIONS: CustomField['type'][] = ['select', 'multiselect'];

export function CustomFieldsSection() {
  const { push } = useToast();
  const fields = useAppStore((s) => s.customFields);
  const saveCustomField = useAppStore((s) => s.saveCustomField);
  const removeCustomField = useAppStore((s) => s.removeCustomField);

  const [entity, setEntity] = useState<CustomField['entity']>('client');
  const [deleting, setDeleting] = useState<CustomField | null>(null);

  const visible = useMemo(
    () =>
      fields
        .filter((f) => f.entity === entity)
        .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)),
    [fields, entity],
  );

  const tokens = useMemo(() => customFieldTokens(visible), [visible]);

  const add = async () => {
    const nextOrder = (visible.at(-1)?.displayOrder ?? 0) + 10;
    const field = customFieldSchema.parse(
      newEntity({ entity, name: 'New field', key: '', type: 'text', displayOrder: nextOrder }),
    );
    // The key is what the merge token is built from, so it is fixed at creation and
    // derived from the name rather than from the id.
    field.key = uniqueKey(`${slugifyKey(field.name)}`, fields);
    await saveCustomField(field);
  };

  const remove = async () => {
    if (!deleting) return;
    await removeCustomField(deleting.id);
    setDeleting(null);
    push({
      tone: 'info',
      title: 'Field removed',
      description: 'Values already entered are kept on the records, just no longer shown.',
    });
  };

  const reorder = async (field: CustomField, direction: -1 | 1) => {
    const index = visible.findIndex((f) => f.id === field.id);
    const swap = visible[index + direction];
    if (!swap) return;
    await saveCustomField({ ...field, displayOrder: swap.displayOrder });
    await saveCustomField({ ...swap, displayOrder: field.displayOrder });
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Show fields for" className="w-48">
            <Select value={entity} onChange={(e) => setEntity(e.target.value as CustomField['entity'])}>
              {(Object.keys(ENTITY_LABELS) as CustomField['entity'][]).map((id) => (
                <option key={id} value={id}>
                  {ENTITY_LABELS[id]}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            variant="primary"
            icon={<Plus className="size-3.5" aria-hidden />}
            onClick={() => void add()}
          >
            Add a field
          </Button>
        </div>
        <p className="mt-2 text-[12px] text-ink-muted">
          A field appears on the {entity} form, and on the {entity} editor. Turn on “Print on documents” and
          it also appears in the document's extra details block.
        </p>
      </Card>

      <Panel
        title={`${ENTITY_LABELS[entity]} fields`}
        description="Values are stored on each record as plain text; the type here decides how they are entered."
        flush
      >
        {visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-ink-muted">
            No custom fields yet. “{ENTITY_LABELS[entity]}” works perfectly well without them.
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th width="3rem" />
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Options</Th>
                <Th align="center">Required</Th>
                <Th align="center">Print</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {visible.map((field, index) => (
                <tr key={field.id}>
                  <Td>
                    <span className="flex items-center gap-0.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={index === 0}
                        onClick={() => void reorder(field, -1)}
                        aria-label={`Move ${field.name} up`}
                      >
                        <GripVertical className="size-3.5" aria-hidden />
                      </Button>
                    </span>
                  </Td>
                  <Td>
                    <TextInput
                      inputSize="sm"
                      value={field.name}
                      aria-label={`Name of field ${index + 1}`}
                      onChange={(e) => void saveCustomField({ ...field, name: e.target.value })}
                    />
                    <p className="mt-0.5 font-mono text-[11px] text-ink-faint">
                      {'{'}
                      {entity}.custom.{field.key}
                      {'}'}
                    </p>
                  </Td>
                  <Td>
                    <Select
                      plain
                      inputSize="sm"
                      aria-label={`Type of ${field.name}`}
                      value={field.type}
                      onChange={(e) =>
                        void saveCustomField({ ...field, type: e.target.value as CustomField['type'] })
                      }
                    >
                      {(Object.keys(TYPE_LABELS) as CustomField['type'][]).map((id) => (
                        <option key={id} value={id}>
                          {TYPE_LABELS[id]}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td>
                    {NEEDS_OPTIONS.includes(field.type) ? (
                      <TextInput
                        inputSize="sm"
                        placeholder="Low, Normal, High"
                        value={field.options.join(', ')}
                        aria-label={`Options for ${field.name}`}
                        onChange={(e) =>
                          void saveCustomField({
                            ...field,
                            options: e.target.value
                              .split(',')
                              .map((o) => o.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </Td>
                  <Td align="center">
                    <Checkbox
                      checked={field.required}
                      label=""
                      ariaLabel={`${field.name} is required`}
                      onChange={(v) => void saveCustomField({ ...field, required: v })}
                    />
                  </Td>
                  <Td align="center">
                    <Switch
                      checked={field.showOnPdf}
                      label=""
                      ariaLabel={`Print ${field.name} on documents`}
                      className="justify-center"
                      onChange={(v) => void saveCustomField({ ...field, showOnPdf: v })}
                    />
                  </Td>
                  <Td align="right">
                    <Button
                      size="sm"
                      variant="danger"
                      icon={<Trash2 className="size-3.5" aria-hidden />}
                      onClick={() => setDeleting(field)}
                    >
                      Remove
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      {tokens.length > 0 && (
        <Card>
          <h3 className="eyebrow">Merge fields</h3>
          <p className="-mt-1 mb-2 text-[12px] text-ink-muted">
            These are the tokens your email templates can use. Click one to copy it.
          </p>
          <ul className="flex flex-wrap gap-2">
            {tokens.map((token) => (
              <li key={token.token}>
                <button
                  type="button"
                  title={token.description}
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(token.token)
                      .then(() => push({ tone: 'success', title: 'Copied', description: token.token }))
                      .catch(() => undefined);
                  }}
                  className="rounded-[6px] bg-paper-sunken px-2 py-1 font-mono text-[11px] text-accent transition-colors hover:bg-rule"
                >
                  {token.token}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => void remove()}
        title={`Remove “${deleting?.name ?? ''}”?`}
        confirmLabel="Remove"
        danger
        body="Values already entered are kept on the records but stop being shown. Email templates using this field will leave the token visible rather than silently dropping the word."
      />
    </div>
  );
}

/** A key nobody else is using, so two fields cannot share a merge token. */
function uniqueKey(base: string, existing: CustomField[]): string {
  const taken = new Set(existing.map((f) => f.key));
  let key = base || 'field';
  let n = 2;
  while (taken.has(key)) key = `${base}_${n++}`;
  return key;
}
