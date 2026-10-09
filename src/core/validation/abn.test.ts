/**
 * Offline ABN validation.
 *
 * The real ABNs used here are published test values, so these cases assert the
 * checksum rather than a fabricated expectation.
 */

import { describe, expect, it } from 'vitest';
import {
  abnCheckDigit,
  abnChecksumValue,
  abnDigits,
  formatAbn,
  formatAbnAsTyping,
  formatAuPhone,
  isValidAbn,
  validateAbn,
  validateBsb,
  validateForeignTaxId,
  validatePayId,
} from './abn';

describe('normalising input', () => {
  it('strips everything that is not a digit', () => {
    expect(abnDigits('12 345 678 901')).toBe('12345678901');
    expect(abnDigits('12-345-678-901')).toBe('12345678901');
    expect(abnDigits('ABN: 12345678901')).toBe('12345678901');
    expect(abnDigits('')).toBe('');
    expect(abnDigits(null as unknown as string)).toBe('');
  });

  it('formats the way the ATO prints it: 12 345 678 901', () => {
    expect(formatAbn('12345678901')).toBe('12 345 678 901');
    expect(formatAbn('51824753556')).toBe('51 824 753 556');
    expect(formatAbn('')).toBe('');
  });

  it('groups sensibly while the field is still short', () => {
    expect(formatAbn('1')).toBe('1');
    expect(formatAbn('12')).toBe('12');
    expect(formatAbn('123')).toBe('12 3');
    expect(formatAbn('12345')).toBe('12 345');
    expect(formatAbn('123456789')).toBe('12 345 678 9');
    expect(formatAbn('1234567890')).toBe('12 345 678 90');
  });

  it('caps at 11 digits while typing', () => {
    expect(formatAbnAsTyping('518247535561234')).toBe('51 824 753 556');
    expect(formatAbnAsTyping('518')).toBe('51 8');
    expect(formatAbnAsTyping('')).toBe('');
  });
});

describe('the checksum', () => {
  it('computes the weighted sum, which must be a multiple of 89', () => {
    // 51 824 753 556: subtract 1 from the 5, weight, sum to 534 = 6 x 89.
    expect(abnChecksumValue('51824753556')).toBe(534);
    expect(abnChecksumValue('51824753556')! % 89).toBe(0);
    expect(abnChecksumValue('123')).toBeNull();
    expect(abnChecksumValue('123456789012')).toBeNull();
  });

  it('builds a check digit that makes the sum divisible by 89', () => {
    for (const valid of ['51824753556', '10000000000', '10000000113', '10000000226']) {
      const check = abnCheckDigit(valid.slice(0, 10));
      expect(check, `check digit for ${valid}`).toBe(valid.slice(10));
      expect(abnChecksumValue(valid)! % 89).toBe(0);
    }
  });

  it('validates a known-good ABN', () => {
    expect(isValidAbn('51824753556')).toBe(true);
    expect(isValidAbn('51 824 753 556')).toBe(true);
    expect(validateAbn('51824753556').valid).toBe(true);
    expect(validateAbn('51824753556').formatted).toBe('51 824 753 556');
    expect(validateAbn('51824753556').reason).toBe('');
  });

  it('validates every ABN the checksum builder produces', () => {
    // Random ten-digit prefixes only have a valid check digit about one time in
    // nine, so these are generated rather than guessed.
    for (const abn of [
      '51824753556',
      '10000000000',
      '10000000032',
      '10000000064',
      '10000000096',
      '10000000113',
    ]) {
      expect(isValidAbn(abn), `${abn} should be valid`).toBe(true);
    }
  });

  it('rejects a single transposed digit', () => {
    // Swapping two digits of a valid ABN breaks the checksum.
    expect(isValidAbn('51824753565')).toBe(false);
    expect(isValidAbn('51824735556')).toBe(false);
  });

  it('rejects an ABN of the wrong length', () => {
    const r = validateAbn('5182475355');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/11 digits/);
    expect(validateAbn('5').reason).toMatch(/1/);
    expect(validateAbn('518247535561').reason).toMatch(/12/);
  });

  it('says nothing when the field is empty, so it is not nagging mid-typing', () => {
    const r = validateAbn('');
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('');
  });

  it('rejects an all-zero ABN', () => {
    expect(isValidAbn('00000000000')).toBe(false);
  });

  it('suggests the check digit when only that is wrong', () => {
    const correct = '51824753556';
    const wrong = `${correct.slice(0, 10)}0`;
    expect(isValidAbn(wrong)).toBe(false);

    const r = validateAbn(wrong);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/checksum/);
    if (r.suggestedDigit !== null) expect(r.suggestedDigit).toBe(correct.slice(10));
  });

  it('computes a check digit for the first ten digits', () => {
    expect(abnCheckDigit('5182475355')).toBe('6');
    expect(abnCheckDigit('123456789')).toBeNull();
    expect(abnCheckDigit('abcdefghij')).toBeNull();
    expect(abnCheckDigit('12345')).toBeNull();
  });

  it('a corrected ABN then validates', () => {
    const digits = '5182475355';
    const check = abnCheckDigit(digits)!;
    expect(isValidAbn(digits + check)).toBe(true);
  });

  it('tolerates surrounding whitespace and punctuation', () => {
    expect(isValidAbn('  51 824 753 556  ')).toBe(true);
    expect(isValidAbn('ABN 51824753556')).toBe(true);
  });
});

describe('foreign tax identifiers', () => {
  it('accepts a well-formed NZBN', () => {
    expect(validateForeignTaxId('NZ123456789', 'NZ').valid).toBe(true);
    expect(validateForeignTaxId('NZ12345678', 'NZ').valid).toBe(true);
    expect(validateForeignTaxId('123456789', 'NZ').valid).toBe(false);
  });

  it('accepts a UK VAT number', () => {
    expect(validateForeignTaxId('GB123456789', 'GB').valid).toBe(true);
    expect(validateForeignTaxId('123456789', 'UK').valid).toBe(true);
    expect(validateForeignTaxId('ABC', 'GB').valid).toBe(false);
  });

  it('accepts a US EIN', () => {
    expect(validateForeignTaxId('12-3456789', 'US').valid).toBe(true);
    expect(validateForeignTaxId('12345', 'US').valid).toBe(false);
  });

  it('accepts an EU VAT number', () => {
    expect(validateForeignTaxId('DE123456789', 'DE').valid).toBe(true);
    expect(validateForeignTaxId('12', 'FR').valid).toBe(false);
  });

  it('does not invent a rule for a country it has never heard of', () => {
    expect(validateForeignTaxId('ANYTHING-AT-ALL', 'ZZ').valid).toBe(true);
  });

  it('says nothing when empty', () => {
    expect(validateForeignTaxId('', 'NZ').reason).toBe('');
  });
});

describe('payment details', () => {
  it('validates and formats a BSB', () => {
    const good = validateBsb('062000');
    expect(good.valid).toBe(true);
    expect(good.formatted).toBe('062-000');

    expect(validateBsb('062-000').valid).toBe(true);
    expect(validateBsb('12345').valid).toBe(false);
    expect(validateBsb('12345').reason).toBe('A BSB has 6 digits.');
    expect(validateBsb('').reason).toBe('');
    // Shape only: 999-999 is well formed even though no such branch exists, and
    // rejecting it would need the bank's own register, which Duly never calls.
    expect(validateBsb('999999').valid).toBe(true);
  });

  it('recognises the three PayID forms', () => {
    expect(validatePayId('someone@example.com').valid).toBe(true);
    expect(validatePayId('+61412345678').valid).toBe(true);
    expect(validatePayId('0412345678').valid).toBe(true);
    expect(validatePayId('51824753556').valid).toBe(true);
    expect(validatePayId('nonsense').valid).toBe(false);
    expect(validatePayId('').reason).toBe('');
  });

  it('formats Australian phone numbers without rejecting them', () => {
    expect(formatAuPhone('0412345678')).toBe('0412 345 678');
    expect(formatAuPhone('0291234567')).toBe('02 9123 4567');
    expect(formatAuPhone('+61412345678')).toBe('+61 0412 345 678');
    expect(formatAuPhone('unknown')).toBe('unknown');
    expect(formatAuPhone('')).toBe('');
    expect(formatAuPhone('12345')).toBe('12345');
  });
});

describe('decimal precision', () => {
  it('accepts up to four decimal places on a quantity', async () => {
    const { documentLineSchema } = await import('@/core/schemas/document');
    const now = '2026-01-01T00:00:00.000Z';
    const base = { id: 'l1', documentId: 'd1', createdAt: now, updatedAt: now, deletedAt: null };

    for (const quantity of ['1', '7.25', '1.2345']) {
      expect(() => documentLineSchema.parse({ ...base, quantity })).not.toThrow();
    }
  });

  it('refuses more than four, which the editor could never produce', async () => {
    const { documentLineSchema } = await import('@/core/schemas/document');
    const now = '2026-01-01T00:00:00.000Z';
    const base = { id: 'l1', documentId: 'd1', createdAt: now, updatedAt: now, deletedAt: null };

    const result = documentLineSchema.safeParse({ ...base, quantity: '1.23456' });
    expect(result.success).toBe(false);
  });
});
