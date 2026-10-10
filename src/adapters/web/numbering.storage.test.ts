/**
 * Number reservation.
 *
 * The plan's hardest storage guarantee: "numbers are reserved inside a database
 * transaction so two invoices can never share a number", and a number is "never
 * reused".
 *
 * These tests exist because that guarantee has a way of failing silently — it did
 * once: the compound index `reserveDocumentNumber` queries was never declared, so
 * every attempt to finalise a document threw and the code path had no test. A
 * guarantee nobody exercises is a comment, not a guarantee.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createWebPlatform, setPlatform } from '@/adapters';
import { storage } from '@/adapters/types';
import { assertCounterPattern, NumberPatternError, renderNumber, periodKeyFor } from '@/core/engines/numbering';

let close: (() => Promise<void>) | null = null;

async function freshStorage() {
  const platform = createWebPlatform(`duly-test-seq-${Math.random().toString(36).slice(2)}`);
  setPlatform(platform);
  await platform.storage.init();
  close = () => platform.storage.close();
  return platform.storage;
}

afterEach(async () => {
  await close?.();
  close = null;
});

describe('reserveDocumentNumber', () => {
  it('hands out consecutive numbers', async () => {
    await freshStorage();
    const db = storage();

    const first = await db.reserveDocumentNumber({
      profileId: 'prof_1',
      documentType: 'invoice',
      date: '2026-10-06',
    });
    const second = await db.reserveDocumentNumber({
      profileId: 'prof_1',
      documentType: 'invoice',
      date: '2026-10-06',
    });

    expect(first.number).toBe('INV-2026-0001');
    expect(second.number).toBe('INV-2026-0002');
  });

  it('never hands the same number to two concurrent calls', async () => {
    await freshStorage();
    const db = storage();

    // Twenty at once, as twenty invoices saved in the same tick would be.
    const numbers = await Promise.all(
      Array.from({ length: 20 }, () =>
        db.reserveDocumentNumber({ profileId: 'prof_1', documentType: 'invoice', date: '2026-10-06' }),
      ),
    );

    const issued = numbers.map((n) => n.number);
    expect(new Set(issued).size).toBe(20);
    expect(issued.sort()).toEqual(
      Array.from({ length: 20 }, (_, i) => `INV-2026-${String(i + 1).padStart(4, '0')}`),
    );
  });

  it('never reissues a number across a backdated year boundary', async () => {
    await freshStorage();
    const db = storage();

    const dec = await db.reserveDocumentNumber({ profileId: 'prof_1', documentType: 'invoice', date: '2026-12-30' });
    const jan = await db.reserveDocumentNumber({ profileId: 'prof_1', documentType: 'invoice', date: '2027-01-02' });
    // A backdated invoice from the year that just ended — the classic way a
    // reset rule reissues a number it has already handed out.
    const backdated = await db.reserveDocumentNumber({ profileId: 'prof_1', documentType: 'invoice', date: '2026-12-31' });

    expect(dec.number).toBe('INV-2026-0001');
    expect(jan.number).toBe('INV-2027-0001');
    expect(backdated.number).toBe('INV-2026-0002');
    expect(new Set([dec.number, jan.number, backdated.number]).size).toBe(3);
  });

  it('keeps a separate counter per document type and per business', async () => {
    await freshStorage();
    const db = storage();

    await db.reserveDocumentNumber({ profileId: 'prof_1', documentType: 'invoice', date: '2026-10-06' });
    const creditNote = await db.reserveDocumentNumber({
      profileId: 'prof_1',
      documentType: 'credit_note',
      date: '2026-10-06',
    });
    const otherBusiness = await db.reserveDocumentNumber({
      profileId: 'prof_2',
      documentType: 'invoice',
      date: '2026-10-06',
    });

    expect(creditNote.number).toBe('CN-2026-0001');
    expect(otherBusiness.number).toBe('INV-2026-0001');
  });

  it('restarts the counter in a new year, and never repeats inside one', async () => {
    await freshStorage();
    const db = storage();

    const october = await db.reserveDocumentNumber({
      profileId: 'prof_1',
      documentType: 'invoice',
      date: '2026-10-06',
    });
    const january = await db.reserveDocumentNumber({
      profileId: 'prof_1',
      documentType: 'invoice',
      date: '2027-01-04',
    });

    expect(october.number).toBe('INV-2026-0001');
    expect(january.number).toBe('INV-2027-0001');
  });

  it('keeps counting forever when the reset rule says never', async () => {
    await freshStorage();
    const db = storage();

    const first = await db.reserveDocumentNumber({
      profileId: 'prof_1',
      documentType: 'credit_note',
      date: '2026-01-01',
    });
    const sequence = await db.listNumberSequences('prof_1');
    await db.saveNumberSequence({ ...sequence[0], resetRule: 'never' });

    await db.reserveDocumentNumber({ profileId: 'prof_1', documentType: 'credit_note', date: '2030-01-01' });
    const later = await db.reserveDocumentNumber({
      profileId: 'prof_1',
      documentType: 'credit_note',
      date: '2030-01-02',
    });

    expect(first.number).toBe('CN-2026-0001');
    expect(later.number).not.toBe(first.number);
    expect(Number(later.number.split('-').pop())).toBeGreaterThan(1);
  });

  it('records every number it has issued, so reuse is impossible', async () => {
    await freshStorage();
    const db = storage();

    for (let i = 0; i < 3; i++) {
      await db.reserveDocumentNumber({ profileId: 'prof_1', documentType: 'invoice', date: '2026-10-06' });
    }

    const [sequence] = await db.listNumberSequences('prof_1');
    expect(sequence.issued).toEqual(['INV-2026-0001', 'INV-2026-0002', 'INV-2026-0003']);
    expect(sequence.nextValue).toBe(4);
  });

  it('honours a custom pattern', async () => {
    await freshStorage();
    const db = storage();

    const { number } = await db.reserveDocumentNumber({
      profileId: 'prof_1',
      documentType: 'quote',
      date: '2026-10-06',
      pattern: 'Q-{YY}{MM}-{###}',
    });

    expect(number).toBe('Q-2610-001');
  });

  it('reads back through the same compound index the reservation uses', async () => {
    await freshStorage();
    const db = storage();

    await db.reserveDocumentNumber({ profileId: 'prof_1', documentType: 'invoice', date: '2026-10-06' });
    const sequences = await db.listNumberSequences('prof_1');

    expect(sequences).toHaveLength(1);
    expect(sequences[0].documentType).toBe('invoice');
    expect(sequences[0].periodKey).toBe(periodKeyFor('2026-10-06', 'yearly'));
  });

  it('refuses to reserve from a pattern with no counter instead of hanging', async () => {
    await freshStorage();
    const db = storage();

    await db.reserveDocumentNumber({ profileId: 'prof_1', documentType: 'invoice', date: '2026-10-06' });
    const [sequence] = await db.listNumberSequences('prof_1');
    // A counterless pattern that has already "issued" the one number it can
    // render is exactly what froze submit: the skip loop never advanced.
    await db.saveNumberSequence({ ...sequence, pattern: 'INV-{YYYY}', issued: ['INV-2026'] });

    await expect(
      db.reserveDocumentNumber({ profileId: 'prof_1', documentType: 'invoice', date: '2026-10-06' }),
    ).rejects.toThrow(/counter/i);
  });
});

describe('assertCounterPattern', () => {
  it('accepts a pattern with a counter and rejects one without', () => {
    expect(() => assertCounterPattern('INV-{YYYY}-{####}')).not.toThrow();
    expect(() => assertCounterPattern('ACME-{YYYY}-{###}')).not.toThrow();
    expect(() => assertCounterPattern('INV-{YYYY}')).toThrow(NumberPatternError);
    expect(() => assertCounterPattern('INV-{YYYY}')).toThrow(/counter/i);
  });
});

describe('renderNumber', () => {
  it('zero-pads the counter to the width of the hash run', () => {
    const base = { date: '2026-10-06', documentType: 'invoice' as const };
    expect(renderNumber('INV-{YYYY}-{####}', { ...base, value: 1 })).toBe('INV-2026-0001');
    expect(renderNumber('INV-{YYYY}-{####}', { ...base, value: 42 })).toBe('INV-2026-0042');
    expect(renderNumber('INV-{YYYY}-{#####}', { ...base, value: 42 })).toBe('INV-2026-00042');
  });

  it('expands the financial year as its closing year', () => {
    expect(
      renderNumber('INV-{FY}-{####}', {
        value: 1,
        date: '2026-10-06',
        documentType: 'invoice',
        financialYearStartMonth: 7,
      }),
    ).toBe('INV-27-0001');
    expect(
      renderNumber('INV-{FY}-{####}', {
        value: 1,
        date: '2026-03-06',
        documentType: 'invoice',
        financialYearStartMonth: 7,
      }),
    ).toBe('INV-26-0001');
  });
});
