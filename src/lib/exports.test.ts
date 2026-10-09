import { describe, expect, it } from 'vitest';
import { buildZip, tableBlob, tableCsv, tableDocx, tableXlsx, type TableExport } from './exports';

const SAMPLE: TableExport = {
  title: 'INV-2026-0001',
  headers: ['Description', 'Qty', 'Amount'],
  rows: [
    ['Consulting', '2', 500],
    ['Widgets & <gadgets>', '1', 1200],
  ],
  meta: [
    ['Invoice no.', 'INV-2026-0001'],
    ['Total', '1870'],
  ],
};

/** Parse the central directory out of a zip we built. */
function readCentralDirectory(zip: Uint8Array): { name: string; size: number; offset: number }[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // Find the end-of-central-directory signature from the tail.
  let eocd = -1;
  for (let i = zip.byteLength - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  expect(eocd).toBeGreaterThanOrEqual(0);
  const count = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);
  const entries: { name: string; size: number; offset: number }[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(pos, true)).toBe(0x02014b50);
    const size = view.getUint32(pos + 24, true);
    const nameLength = view.getUint16(pos + 28, true);
    const offset = view.getUint32(pos + 42, true);
    entries.push({
      name: new TextDecoder().decode(zip.slice(pos + 46, pos + 46 + nameLength)),
      size,
      offset,
    });
    pos += 46 + nameLength;
  }
  return entries;
}

describe('buildZip', () => {
  it('produces a zip whose central directory round-trips', () => {
    const zip = buildZip([
      { name: 'one.txt', data: 'hello world' },
      { name: 'dir/two.bin', data: new Uint8Array([1, 2, 3, 4, 5]) },
    ]);

    const entries = readCentralDirectory(zip);
    expect(entries.map((e) => e.name)).toEqual(['one.txt', 'dir/two.bin']);
    expect(entries[0].size).toBe(11);
    expect(entries[1].size).toBe(5);

    // The stored data sits at the recorded offset + 30 + name length.
    const text = new TextDecoder().decode(
      zip.slice(entries[0].offset + 30 + 7, entries[0].offset + 30 + 7 + 11),
    );
    expect(text).toBe('hello world');
  });
});

describe('table exports', () => {
  it('CSV carries meta, headers and rows with quoting', () => {
    const csv = tableCsv(SAMPLE);
    expect(csv).toContain('Invoice no.,Total');
    expect(csv).toContain('Description,Qty,Amount');
    expect(csv).toContain('Widgets & <gadgets>');
  });

  it('XLSX is a zip with the workbook parts', () => {
    const entries = readCentralDirectory(tableXlsx(SAMPLE)).map((e) => e.name);
    expect(entries).toContain('[Content_Types].xml');
    expect(entries).toContain('xl/workbook.xml');
    expect(entries).toContain('xl/worksheets/sheet1.xml');
  });

  it('DOCX is a zip with the document part', () => {
    const entries = readCentralDirectory(tableDocx(SAMPLE)).map((e) => e.name);
    expect(entries).toContain('[Content_Types].xml');
    expect(entries).toContain('word/document.xml');
  });

  it('JSON round-trips the table', async () => {
    // jsdom's Blob has neither text() nor arrayBuffer(); FileReader works.
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(tableBlob(SAMPLE, 'json'));
    });
    const parsed = JSON.parse(text);
    expect(parsed.title).toBe('INV-2026-0001');
    expect(parsed.headers).toEqual(SAMPLE.headers);
    expect(parsed.rows).toEqual(SAMPLE.rows);
    expect(parsed.meta['Total']).toBe('1870');
  });
});
