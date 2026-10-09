/**
 * CSV parsing.
 *
 * Written rather than imported, because the format is two-dimensional plain text
 * and the only genuinely awkward part — quoted fields — is about fifteen lines. A
 * CSV library would be a dependency to handle a case a spreadsheet export makes
 * every single time.
 *
 * What it handles, because every real export contains some of it:
 *
 *   - quoted fields, so `"Smith, John"` is one value not two
 *   - a quote escaped by doubling it, `""` inside quotes
 *   - newlines inside a quoted field, which is how a multi-line address survives
 *   - CRLF line endings, and a lone CR
 *   - a UTF-8 BOM, which would otherwise become part of the first header name
 *   - a ragged final row, which is dropped rather than padded with blanks
 *
 * Everything is pure: the caller supplies the text, so parsing is testable without
 * a file, a browser or a clock.
 */

/** Parse CSV text into rows of strings. */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let started = false;

  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip BOM

  const endField = () => {
    row.push(field);
    field = '';
    started = false;
  };

  const endRow = () => {
    endField();
    // A trailing newline produces one empty row; it is not data.
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];

    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && !started) {
      inQuotes = true;
      started = true;
      continue;
    }

    if (ch === delimiter) {
      endField();
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      // A lone CR is a line ending too; CRLF must not produce two.
      if (ch === '\r' && source[i + 1] === '\n') i++;
      endRow();
      continue;
    }

    field += ch;
    started = true;
  }

  if (field !== '' || row.length > 0) endRow();

  return rows;
}

/** One parsed file: a header row and the data rows beneath it. */
export interface CsvTable {
  headers: string[];
  rows: string[][];
  /** Rows whose cell count differs from the header's. */
  ragged: { row: number; values: string[] }[];
}

/**
 * Parse CSV text into a header and its rows.
 *
 * When there is no header — some exports have none — every column is named by
 * position, so the mapping step always has something to show.
 */
export function readCsv(text: string, delimiter?: string): CsvTable {
  const grid = parseCsv(text, delimiter);
  if (grid.length === 0) return { headers: [], rows: [], ragged: [] };

  const [first, ...rest] = grid;
  const headers = first.map((h, i) => h.trim() || `Column ${i + 1}`);
  const ragged = rest
    .map((values, index) => ({ row: index + 2, values }))
    .filter((r) => r.values.length !== headers.length);

  return { headers, rows: rest.filter((r) => r.length > 1 || (r[0] ?? '') !== ''), ragged };
}

/**
 * Guess which delimiter a file uses, from its first line.
 *
 * Comma, semicolon and tab are the three that appear in practice: comma in
 * en-AU, semicolon in much of Europe, tab straight out of Excel. Compared outside
 * quotes only, so a semicolon inside a quoted address is not a column.
 */
export function sniffDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  let inQuotes = false;
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };

  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch] += 1;
  }

  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/** Read a CSV file's text, choosing its delimiter. */
export function readCsvFile(text: string, delimiter?: string): CsvTable {
  return readCsv(text, delimiter ?? sniffDelimiter(text));
}

/** Quote a value for writing back out, only when it needs it. */
export function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Build CSV text from rows, quoting only what needs it. */
export function writeCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  // Formula injection: a value that starts with =, +, -, @ or a tab runs as
  // a formula when the file opens in Excel or Sheets — a client named
  // "=HYPERLINK(...)" is an attack. The leading apostrophe neutralises it
  // and Excel drops it from the displayed value.
  const safe = (value: string | number | null | undefined) => {
    const cell = csvCell(value);
    if (typeof value === 'string' && /^[=+@\t\r]/.test(value.trimStart())) return `'${cell}`;
    return cell;
  };
  const lines = [headers.map(safe).join(',')];
  for (const row of rows) lines.push(row.map(safe).join(','));
  return lines.join('\r\n');
}

/** Turn "Smith, John" into ["Smith", " John"] without the quotes. */
export function splitList(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean);
}
