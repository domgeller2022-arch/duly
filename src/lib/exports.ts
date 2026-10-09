/**
 * Document exports: CSV, XLSX, DOCX, JSON and bulk ZIP.
 *
 * The plan names these formats, and none of them needs a dependency:
 * a ZIP file with no compression is a few headers plus a CRC32, and XLSX and
 * DOCX are both just folders of XML in a ZIP. That is less code than pulling
 * in SheetJS, and it works offline like everything else here.
 *
 * PNG export is the one format not here: rasterising a PDF needs a real PDF
 * renderer (pdf.js), which would be the biggest dependency in the app for a
 * rarely used export.
 */

import { writeCsv } from '@/core/csv';
import { toMajorNumber } from '@/core/money/money';
import type { CalculationResult } from '@/core/calc/calculate';
import type {
  Attachment,
  BusinessProfile,
  Client,
  DesignTemplate,
  Document,
  DocumentLine,
  Payment,
} from '@/core/schemas';
import type { TaxCode } from '@/core/tax/tax';
import { renderDocumentPdf } from '@/renderer/pdf';
import { buildDocumentModel } from '@/renderer/model';
import { paymentQrSrc } from '@/renderer/qr';

export interface TableExport {
  /** The document's number or draft number, used for filenames. */
  title: string;
  headers: string[];
  rows: (string | number | null)[][];
  /** Key-value lines printed under the table in XLSX/DOCX, e.g. totals. */
  meta: [string, string][];
}

export type ExportFormat = 'csv' | 'xlsx' | 'docx' | 'json';

/* ------------------------------------------------------------------ */
/* CRC32 — the checksum every ZIP entry carries.                       */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ */
/* ZIP writing (stored, no compression).                               */
/* ------------------------------------------------------------------ */

/** DOS time/date for "now" — 2-second resolution is what the format allows. */
function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Build a ZIP from named entries. Entries are stored uncompressed — invoices
 * are small, and "stored" keeps the writer to a few headers.
 *
 * Returns bytes rather than a Blob: a Blob's arrayBuffer() is not readable in
 * every test environment, and callers wrap these in Blobs anyway.
 */
export function buildZip(files: { name: string; data: Uint8Array | string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(new Date());
  const chunks: Uint8Array[] = [];
  const central: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];
  let offset = 0;

  const u16 = (v: number) => new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
  const u32 = (v: number) => new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]);

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    const crc = crc32(data);
    central.push({ name, crc, size: data.length, offset });

    chunks.push(
      u32(0x04034b50), // local file header signature
      u16(20), // version needed
      u16(0x0800), // UTF-8 names
      u16(0), // stored
      u16(time),
      u16(date),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0), // extra length
      name,
      data,
    );
    offset += 30 + name.length + data.length;
  }

  const centralStart = offset;
  for (const entry of central) {
    chunks.push(
      u32(0x02014b50), // central directory signature
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(time),
      u16(date),
      u32(entry.crc),
      u32(entry.size),
      u32(entry.size),
      u16(entry.name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(entry.offset),
      entry.name,
    );
    offset += 46 + entry.name.length;
  }

  chunks.push(
    u32(0x06054b50), // end of central directory
    u16(0),
    u16(0),
    u16(central.length),
    u16(central.length),
    u32(offset - centralStart),
    u32(centralStart),
    u16(0),
  );

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return bytes;
}

/** A ZIP as a download-ready Blob. */
export function zipBlob(files: { name: string; data: Uint8Array | string }[]): Blob {
  return new Blob([buildZip(files) as BlobPart], { type: 'application/zip' });
}

/* ------------------------------------------------------------------ */
/* Format converters.                                                  */
/* ------------------------------------------------------------------ */

function xmlEscape(value: string): string {
  // Real entities, in the right order (& first): the previous version
  // replaced each character with itself, so "Acme & Sons" produced files
  // neither Excel nor Word could open.
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function tableCsv(exportData: TableExport): string {
  if (exportData.meta.length > 0) {
    return writeCsv(
      exportData.meta.map(([k]) => k),
      [exportData.meta.map(([, v]) => v), exportData.headers, ...exportData.rows],
    );
  }
  return writeCsv(exportData.headers, exportData.rows);
}

/**
 * A minimal but valid XLSX: a workbook with one sheet, inline strings for
 * text and plain numbers for numbers. Excel and LibreOffice both open it.
 */
export function tableXlsx(exportData: TableExport): Uint8Array {
  const cell = (v: string | number | null) => {
    if (v === null || v === '') return '';
    if (typeof v === 'number' && Number.isFinite(v)) return `<c><v>${v}</v></c>`;
    return `<c t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(v))}</t></is></c>`;
  };
  const row = (cells: (string | number | null)[], r: number) =>
    `<row r="${r}">${cells.map(cell).join('')}</row>`;

  const rows: string[] = [];
  let r = 1;
  for (const [k, v] of exportData.meta) rows.push(row([k, v], r++));
  if (exportData.meta.length > 0) r++;
  rows.push(row(exportData.headers, r++));
  for (const dataRow of exportData.rows) rows.push(row(dataRow, r++));

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(exportData.title.slice(0, 31) || 'Sheet1')}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  return buildZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ]);
}

/**
 * A minimal but valid DOCX: a heading paragraph, meta lines, then the table.
 */
export function tableDocx(exportData: TableExport): Uint8Array {
  const p = (text: string, bold = false) =>
    `<w:p><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
  const tc = (text: string | number | null, bold = false) =>
    `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${p(text === null ? '' : String(text), bold)}</w:tc>`;

  const body: string[] = [p(exportData.title, true)];
  for (const [k, v] of exportData.meta) body.push(p(`${k}: ${v}`));
  body.push(
    `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>`,
    `<w:tr>${exportData.headers.map((h) => tc(h, true)).join('')}</w:tr>`,
    ...exportData.rows.map((row) => `<w:tr>${row.map((c) => tc(c)).join('')}</w:tr>`),
    '</w:tbl>',
  );

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  return buildZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'word/document.xml', data: document },
  ]);
}

export function tableJson(exportData: TableExport): Blob {
  const payload = {
    title: exportData.title,
    meta: Object.fromEntries(exportData.meta),
    headers: exportData.headers,
    rows: exportData.rows,
  };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

/** The Blob a format produces, with the extension the filename needs. */
export function tableBlob(exportData: TableExport, format: ExportFormat): Blob {
  switch (format) {
    case 'csv':
      return new Blob([tableCsv(exportData)], { type: 'text/csv' });
    case 'xlsx':
      return new Blob([tableXlsx(exportData) as BlobPart], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    case 'docx':
      return new Blob([tableDocx(exportData) as BlobPart], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
    case 'json':
      return tableJson(exportData);
  }
}

/**
 * The PDF for a document bundle — the one render call every export makes.
 * The QR source is built here, so callers never repeat this pattern.
 */
export async function renderBundlePdf(args: {
  document: Document;
  lines: DocumentLine[];
  payments: Payment[];
  result: CalculationResult;
  profile: BusinessProfile | null;
  client: Client | null;
  template: DesignTemplate | null;
  taxCodes: TaxCode[];
  attachments?: Attachment[];
}): Promise<Blob> {
  const number = args.document.number || args.document.draftNumber || args.document.id;
  return renderDocumentPdf(
    buildDocumentModel({
      ...args,
      qrSrc: await paymentQrSrc(args.profile?.paymentDetails ?? null, number),
    }),
  );
}

/**
 * The document as a flat table: one row per item line, totals as meta lines.
 * Money in rows is plain dollars so a spreadsheet can sum it; the meta lines
 * are formatted the way the document prints them.
 */
export function documentTableExport(args: {
  document: Document;
  lines: DocumentLine[];
  result: CalculationResult;
  clientName: string;
  money: (cents: number, currency: string) => string;
}): TableExport {
  const { document, lines, result, clientName, money } = args;
  // Every valued line type — time lines were dropped entirely and expense
  // lines showed $0 — priced by whichever field that type actually uses.
  const currency = document.currency;
  return {
    title: document.number || document.draftNumber || document.id,
    headers: ['Description', 'Qty', 'Unit price', 'Tax', 'Amount'],
    rows: lines
      .filter((line) => line.type === 'item' || line.type === 'time' || line.type === 'expense')
      .map((line) => {
        const computed = result.lines.get(line.id);
        const perUnit =
          line.type === 'expense' && line.amountOverride !== null ? line.amountOverride : line.unitPrice;
        return [
          line.description,
          line.quantity,
          toMajorNumber(perUnit, currency),
          toMajorNumber(computed?.tax ?? 0, currency),
          toMajorNumber(computed?.gross ?? 0, currency),
        ];
      }),
    meta: [
      [document.type === 'quote' ? 'Quote no.' : 'Invoice no.', document.number || ''],
      ['Client', clientName],
      ['Subtotal', money(document.totals.subtotal, currency)],
      ['Total', money(document.totals.total, currency)],
      ['Paid', money(document.totals.paid, currency)],
      ['Balance', money(document.totals.balance, currency)],
    ],
  };
}
