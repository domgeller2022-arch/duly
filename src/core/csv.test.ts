import { describe, expect, it } from 'vitest';
import { csvCell, parseCsv, readCsv, sniffDelimiter, splitList, writeCsv } from '@/core/csv';

describe('parseCsv', () => {
  it('reads a plain file', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps a quoted comma inside one field', () => {
    expect(parseCsv('name,address\n"Smith, John","1 High St"')).toEqual([
      ['name', 'address'],
      ['Smith, John', '1 High St'],
    ]);
  });

  it('reads a doubled quote as one quote', () => {
    expect(parseCsv('"He said ""no""",2')).toEqual([['He said "no"', '2']]);
  });

  it('keeps a newline inside a quoted field', () => {
    expect(parseCsv('"1 High St\nSydney",NSW')).toEqual([['1 High St\nSydney', 'NSW']]);
  });

  it('handles CRLF without producing an empty row', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles a lone CR', () => {
    expect(parseCsv('a,b\r1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a UTF-8 BOM', () => {
    expect(parseCsv('﻿name,email')[0][0]).toBe('name');
  });

  it('keeps empty fields', () => {
    expect(parseCsv('a,b,c\n1,,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });

  it('reads an empty string as no rows', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('reads a row of empty fields as data, not as nothing', () => {
    expect(parseCsv('a,b\n,')).toEqual([
      ['a', 'b'],
      ['', ''],
    ]);
  });

  it('reads a semicolon-delimited file', () => {
    expect(parseCsv('a;b\n1;2', ';')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('sniffDelimiter', () => {
  it('finds commas', () => {
    expect(sniffDelimiter('name,email\nSam,sam@example.com')).toBe(',');
  });

  it('finds semicolons', () => {
    expect(sniffDelimiter('name;email\nSam;sam@example.com')).toBe(';');
  });

  it('finds tabs', () => {
    expect(sniffDelimiter('name\temail\nSam\tsam@example.com')).toBe('\t');
  });

  it('ignores a delimiter inside quotes', () => {
    expect(sniffDelimiter('name;address\n"Smith, John";"1 High St"')).toBe(';');
  });
});

describe('readCsv', () => {
  it('separates the header from the data', () => {
    const table = readCsv('Name,Email\nSam,sam@example.com');
    expect(table.headers).toEqual(['Name', 'Email']);
    expect(table.rows).toEqual([['Sam', 'sam@example.com']]);
  });

  it('names a blank header cell by position', () => {
    expect(readCsv('Name,,Email').headers).toEqual(['Name', 'Column 2', 'Email']);
  });

  it('reports rows whose width does not match the header', () => {
    const table = readCsv('a,b,c\n1,2\n3,4,5');
    expect(table.ragged).toHaveLength(1);
    expect(table.ragged[0]).toEqual({ row: 2, values: ['1', '2'] });
  });

  it('trims header whitespace but not data', () => {
    const table = readCsv(' Name , Email\n Sam , sam@example.com');
    expect(table.headers).toEqual(['Name', 'Email']);
    expect(table.rows[0][0]).toBe(' Sam ');
  });

  it('is empty for empty text', () => {
    expect(readCsv('')).toEqual({ headers: [], rows: [], ragged: [] });
  });
});

describe('writeCsv', () => {
  it('quotes only what needs it', () => {
    expect(
      writeCsv(
        ['a', 'b'],
        [
          ['1', 'plain'],
          ['has,comma', 'has"quote'],
        ],
      ),
    ).toBe('a,b\r\n1,plain\r\n"has,comma","has""quote"');
  });

  it('writes an empty cell for null and undefined', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('round-trips through the parser', () => {
    const rows = [['plain', 'has,comma', 'has"quote', 'has\nnewline']];
    const parsed = parseCsv(writeCsv(['a', 'b', 'c', 'd'], rows));
    expect(parsed[1]).toEqual(rows[0]);
  });
});

describe('splitList', () => {
  it('splits on commas or semicolons and trims', () => {
    expect(splitList('Low, Normal ,High')).toEqual(['Low', 'Normal', 'High']);
    expect(splitList('Low; Normal')).toEqual(['Low', 'Normal']);
  });

  it('drops empties', () => {
    expect(splitList('Low,,,High')).toEqual(['Low', 'High']);
    expect(splitList('')).toEqual([]);
  });
});
