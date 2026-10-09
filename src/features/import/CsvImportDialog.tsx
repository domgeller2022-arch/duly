/**
 * CSV import with column mapping and a preview.
 *
 * The plan asks for "a column-mapping step and preview", because a CSV never arrives
 * in the shape the schema wants: the columns are named by whatever system exported
 * them, the order is whatever that system felt like, and half the rows may be junk.
 *
 * So the flow is: paste or choose a file → look at it → map its columns onto Duly's
 * fields → look at what the first rows will actually become → import. Nothing is
 * written until the preview has been read, and the preview names every row that will
 * be skipped and why, so a bad paste is visible before it becomes a bad import.
 *
 * The parser is `core/csv.ts`; this file is the screen around it.
 */

import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Upload } from 'lucide-react';
import { readCsvFile, splitList, type CsvTable } from '@/core/csv';
import { parseAmountToMinor } from '@/core/money/money';
import { Alert, Button, Dialog, Field, Select, useToast } from '@/ui/components/base';
import { useAppStore } from '@/state/app';
import { importRecords } from '@/lib/import';

export type ImportEntity = 'client' | 'item';

/** One field the importer can fill, and how to read it from a row. */
interface ImportField {
  key: string;
  label: string;
  /** Column names that would be a reasonable guess for this field. */
  guesses: string[];
  required?: boolean;
  read: (value: string, row: Record<string, string>, currency: string) => unknown;
}

const ADDRESS_LINES = ['address', 'street', 'street address', 'address 1', 'line1'];

const tagList = splitList;

const CLIENT_FIELDS: ImportField[] = [
  {
    key: 'displayName',
    label: 'Name',
    guesses: ['name', 'client', 'client name', 'company', 'company name'],
    required: true,
    read: (v) => v.trim(),
  },
  {
    key: 'legalName',
    label: 'Legal name',
    guesses: ['legal name', 'legal_name', 'entity'],
    read: (v) => v.trim(),
  },
  {
    key: 'taxId',
    label: 'ABN or tax ID',
    guesses: ['abn', 'tax id', 'taxid', 'vat', 'abn/acn'],
    read: (v) => v.replace(/\D/g, ''),
  },
  { key: 'email', label: 'Email', guesses: ['email', 'e-mail', 'email address'], read: (v) => v.trim() },
  {
    key: 'phone',
    label: 'Phone',
    guesses: ['phone', 'telephone', 'mobile', 'phone number'],
    read: (v) => v.trim(),
  },
  { key: 'line1', label: 'Street address', guesses: ADDRESS_LINES, read: (v) => v.trim() },
  { key: 'city', label: 'City', guesses: ['city', 'suburb', 'town'], read: (v) => v.trim() },
  { key: 'state', label: 'State', guesses: ['state', 'region', 'province'], read: (v) => v.trim() },
  {
    key: 'postcode',
    label: 'Postcode',
    guesses: ['postcode', 'zip', 'zip code', 'postal code'],
    read: (v) => v.trim(),
  },
  { key: 'country', label: 'Country', guesses: ['country'], read: (v) => v.trim() },
  {
    key: 'tags',
    label: 'Tags',
    guesses: ['tags', 'categories', 'label'],
    read: (_v, row) => tagList(row.tags ?? ''),
  },
  { key: 'notes', label: 'Notes', guesses: ['notes', 'note', 'comment', 'comments'], read: (v) => v.trim() },
];

const ITEM_FIELDS: ImportField[] = [
  {
    key: 'name',
    label: 'Name',
    guesses: ['name', 'item', 'item name', 'description', 'product'],
    required: true,
    read: (v) => v.trim(),
  },
  {
    key: 'code',
    label: 'Code',
    guesses: ['code', 'sku', 'item code', 'product code', 'reference'],
    read: (v) => v.trim().toUpperCase(),
  },
  {
    key: 'description',
    label: 'Description',
    guesses: ['description', 'details', 'notes'],
    read: (v) => v.trim(),
  },
  { key: 'unit', label: 'Unit', guesses: ['unit', 'uom', 'units'], read: (v) => v.trim() || 'each' },
  {
    key: 'price',
    label: 'Price',
    guesses: ['price', 'rate', 'unit price', 'cost', 'amount'],
    read: (v, _row, currency) => parseAmountToMinor(v, currency),
  },
  { key: 'category', label: 'Category', guesses: ['category', 'type', 'group'], read: (v) => v.trim() },
  {
    key: 'taxCodeId',
    label: 'Tax code',
    guesses: ['tax', 'tax code', 'gst', 'vat', 'tax rate'],
    read: (v) => v.trim() || null,
  },
];

const FIELD_SETS: Record<ImportEntity, ImportField[]> = {
  client: CLIENT_FIELDS,
  item: ITEM_FIELDS,
};

/* ------------------------------------------------------------------ */
/* Column guessing                                                     */
/* ------------------------------------------------------------------ */

/**
 * Guess the mapping from a header row.
 *
 * Exact match first, then a header that contains the guess, then nothing. Good
 * enough to save most of the clicking, and every guess is still changeable — which
 * is what the mapping step is for.
 */
export function guessMapping(headers: string[], fields: ImportField[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();

  const normalise = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  for (const field of fields) {
    const wanted = field.guesses.map(normalise);
    let header = headers.find((h) => !used.has(h) && wanted.includes(normalise(h)));

    if (!header) {
      header = headers.find(
        (h) => !used.has(h) && wanted.some((g) => g.length > 2 && normalise(h).includes(g)),
      );
    }

    if (header) {
      mapping[field.key] = header;
      used.add(header);
    }
  }

  return mapping;
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

export interface ImportPreview {
  /** The record each row would produce, keyed by field. */
  records: Record<string, unknown>[];
  /** Row numbers (1-based, as a spreadsheet shows them) that will not import. */
  skipped: { row: number; reason: string }[];
}

/**
 * Turn mapped rows into records, naming anything that cannot be imported.
 *
 * Only a required field missing, or a row with nothing in it at all, stops a row.
 * Everything else imports as best it can be read — an import that rejects half a
 * spreadsheet for a missing postcode is not an import anybody will trust.
 */
export function buildPreview(
  table: CsvTable,
  mapping: Record<string, string>,
  fields: ImportField[],
  currency: string,
): ImportPreview {
  const records: Record<string, unknown>[] = [];
  const skipped: { row: number; reason: string }[] = [];

  table.rows.forEach((values, index) => {
    const row: Record<string, string> = {};
    table.headers.forEach((header, i) => {
      row[header] = (values[i] ?? '').trim();
    });

    const line = index + 2; // +1 for the header, +1 to be 1-based

    if (!mappingRequired(fields).some((f) => row[mapping[f.key]])) {
      skipped.push({ row: line, reason: 'The row is empty' });
      return;
    }

    const missing = mappingRequired(fields).find((f) => !row[mapping[f.key]]);
    if (missing) {
      skipped.push({ row: line, reason: `${missing.label} is empty` });
      return;
    }

    const record: Record<string, unknown> = {};
    for (const field of fields) {
      const value = row[mapping[field.key]] ?? '';
      record[field.key] = field.read(value, row, currency);
    }
    // Carried so a price read from a spreadsheet is filed against the right
    // currency's decimal places, whatever the header row said.
    record.currency = currency;
    records.push(record);
  });

  return { records, skipped };
}

function mappingRequired(fields: ImportField[]): ImportField[] {
  return fields.filter((f) => f.required);
}

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

export function CsvImportDialog({ entity, onClose }: { entity: ImportEntity; onClose: () => void }) {
  const { push } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = useAppStore((s) => s.refresh);
  const settings = useAppStore((s) => s.settings);
  const profiles = useAppStore((s) => s.profiles);
  const activeProfileId = useAppStore((s) => s.activeProfileId);
  const currency =
    profiles.find((p) => p.id === activeProfileId)?.defaultCurrency ?? settings?.defaultCurrency ?? 'AUD';

  const [text, setText] = useState('');
  const [table, setTable] = useState<CsvTable | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const fields = FIELD_SETS[entity];
  const noun = entity === 'client' ? 'client' : 'item';

  const read = (value: string) => {
    const parsed = readCsvFile(value);
    setTable(parsed);
    setMapping(guessMapping(parsed.headers, fields));
  };

  const preview = useMemo(
    () => (table ? buildPreview(table, mapping, fields, currency) : null),
    [table, mapping, fields, currency],
  );

  const submit = async () => {
    if (!preview || preview.records.length === 0) return;
    setBusy(true);
    try {
      const written = await importRecords(entity, preview.records);
      await refresh();
      push({
        tone: 'success',
        title: `Imported ${written} ${noun}${written === 1 ? '' : 's'}`,
        description: preview.skipped.length > 0 ? `${preview.skipped.length} rows were skipped.` : undefined,
      });
      onClose();
    } catch (error) {
      push({
        tone: 'error',
        title: 'That import did not finish',
        description: error instanceof Error ? error.message : '',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={`Import ${noun}s from a CSV`}
      description="Choose a file or paste the text. Nothing is written until you have read the preview."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!preview || preview.records.length === 0}
            onClick={() => void submit()}
          >
            {preview && preview.records.length > 0
              ? `Import ${preview.records.length} ${noun}${preview.records.length === 1 ? '' : 's'}`
              : 'Import'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* ---- 1. the file ---- */}
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="text/csv,.csv,text/plain"
            className="sr-only"
            aria-label="Choose a CSV file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void file.text().then(read);
              if (fileRef.current) fileRef.current.value = '';
            }}
          />
          <Button icon={<Upload className="size-3.5" aria-hidden />} onClick={() => fileRef.current?.click()}>
            Choose a CSV file
          </Button>
        </div>

        <Field label="Or paste the text" hint="First row is read as the column headings">
          <textarea
            rows={4}
            value={text}
            placeholder={'Name,ABN,Email\nAcme Pty Ltd,51824753556,billing@acme.com'}
            onChange={(e) => {
              setText(e.target.value);
              read(e.target.value);
            }}
            className="w-full rounded-[8px] border border-rule bg-paper-raised px-3 py-2 font-mono text-[12px] text-ink focus:border-accent focus:outline-none"
          />
        </Field>

        {!table && <Alert tone="info">Choose a file or paste some text to begin.</Alert>}

        {table && (
          <>
            {/* ---- 2. the mapping ---- */}
            <div>
              <h3 className="text-[13px] font-semibold text-ink">Match the columns</h3>
              <p className="mt-0.5 text-[12px] text-ink-muted">
                Duly guesses from the headings. Change anything it got wrong.
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {fields.map((field) => (
                  <Field key={field.key} label={field.label} required={field.required}>
                    <Select
                      inputSize="sm"
                      value={mapping[field.key] ?? ''}
                      aria-label={`Column for ${field.label}`}
                      onChange={(e) => setMapping((current) => ({ ...current, [field.key]: e.target.value }))}
                    >
                      <option value="">— not mapped —</option>
                      {table.headers.map((header) => (
                        <option key={header} value={header}>
                          {header}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}
              </div>
            </div>

            {/* ---- 3. the preview ---- */}
            <div>
              <h3 className="text-[13px] font-semibold text-ink">Preview</h3>
              {preview && preview.records.length > 0 ? (
                <>
                  <p className="mt-0.5 text-[12px] text-ink-muted">
                    The first {Math.min(5, preview.records.length)} of {preview.records.length} rows.
                  </p>
                  <div className="mt-2 overflow-x-auto scroll-quiet rounded-[8px] border border-rule">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr>
                          <th className="border-b border-rule px-2 py-1.5 text-left font-semibold text-ink-faint">
                            Row
                          </th>
                          {fields
                            .filter((f) => mapping[f.key])
                            .map((f) => (
                              <th
                                key={f.key}
                                className="border-b border-rule px-2 py-1.5 text-left font-semibold text-ink-faint"
                              >
                                {f.label}
                              </th>
                            ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.records.slice(0, 5).map((record, i) => (
                          <tr key={i}>
                            <td className="px-2 py-1.5 font-mono text-ink-faint">{i + 2}</td>
                            {fields
                              .filter((f) => mapping[f.key])
                              .map((f) => (
                                <td key={f.key} className="px-2 py-1.5 text-ink">
                                  {formatCell(record[f.key])}
                                </td>
                              ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <Alert tone="warning" title="Nothing to import">
                  Every row is missing a name. Check the column mapping above.
                </Alert>
              )}

              {preview && preview.skipped.length > 0 && (
                <div className="mt-2">
                  <Alert tone="warning" title={`${preview.skipped.length} rows will be skipped`}>
                    <ul className="mt-1 space-y-0.5">
                      {preview.skipped.slice(0, 6).map((s) => (
                        <li key={s.row} className="text-[12px]">
                          Row {s.row}: {s.reason}
                        </li>
                      ))}
                      {preview.skipped.length > 6 && (
                        <li className="text-[12px]">and {preview.skipped.length - 6} more…</li>
                      )}
                    </ul>
                  </Alert>
                </div>
              )}
            </div>

            {table.ragged.length > 0 && (
              <Alert tone="warning">
                <AlertTriangle className="mr-1 inline size-3" aria-hidden />
                {table.ragged.length} row{table.ragged.length === 1 ? '' : 's'} have a different number of
                columns from the heading. Missing columns are treated as empty.
              </Alert>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}
