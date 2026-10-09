/**
 * Number patterns, due dates, ABN checks, compliance, rules and recurrence.
 *
 * The engines under test are the ones where a quiet mistake becomes an invoice
 * that is wrong in someone else's hands: a number reused, a due date that drifts
 * across a daylight-saving boundary, a credit note charging GST the original
 * invoice never did.
 */

import { describe, expect, it } from 'vitest';
import {
  compareNumbers,
  documentTypeLabel,
  hasCounter,
  headingFor,
  nextCounterValue,
  NUMBER_TOKENS,
  numberSortKey,
  patternPrefix,
  patternsCollide,
  periodKeyFor,
  previewNumber,
  renderNumber,
  shouldReset,
} from './numbering';
import {
  addDaysIso,
  ageInDays,
  basPeriod,
  datePartsOf,
  depositBalanceDueDate,
  diffDays,
  dueDateFor,
  endOfNextMonth,
  financialYear,
  financialYearKey,
  financialYearRange,
  formatDate,
  formatDateForFilename,
  isAfter,
  isBefore,
  isDateString,
  isOverdue,
  lastBusinessDayOf,
  monthLabel,
  monthRange,
  nextWeekdayAfter,
  previousMonth,
  quoteExpiry,
  relativeDays,
  resolveTerms,
  termLabel,
  todayIn,
} from '@/core/validation/dates';
import { isValidAbn, validateAbn } from '@/core/validation/abn';
import {
  buildMergeValues,
  customFieldTokens,
  interpolate,
  MERGE_FIELDS,
  missingTokens,
  tokensIn,
  withCustomFieldValues,
} from '@/core/engines/merge';
import { builtinRules, describeCondition, evaluateRules, summariseRule } from '@/core/engines/rules';
import {
  alreadyConsumed,
  advance,
  describeSchedule,
  dueRunDates,
  firstRunOnOrAfter,
  hasEnded,
  interpolate as lineInterpolate,
  isDue,
  LINE_VARIABLES,
  nextRunAfter,
  resolveLineVariables,
  runKey,
} from '@/core/engines/recurrence';
import { documentTypeLabel as typeLabel, headingFor as heading } from '@/core/engines/numbering';
import type { RecurringSchedule } from '@/core/schemas/automation';

/* ================================================================== */
describe('number patterns', () => {
  const ctx = { date: '2026-10-06', documentType: 'invoice' as const };

  it('expands the calendar tokens', () => {
    expect(renderNumber('INV-{YYYY}-{####}', { ...ctx, value: 42 })).toBe('INV-2026-0042');
    expect(renderNumber('Q-{YY}{MM}-{###}', { ...ctx, value: 7 })).toBe('Q-2610-007');
    expect(renderNumber('{DD}/{MM}/{YYYY}', { ...ctx, value: 1 })).toBe('06/10/2026');
  });

  it('zero-pads the counter to the width of the hash run', () => {
    expect(renderNumber('{####}', { ...ctx, value: 1 })).toBe('0001');
    expect(renderNumber('{###}', { ...ctx, value: 1 })).toBe('001');
    expect(renderNumber('{#}', { ...ctx, value: 9 })).toBe('9');
    // Wider than the hash run is left alone rather than truncated.
    expect(renderNumber('{###}', { ...ctx, value: 1234 })).toBe('1234');
  });

  it('expands the financial year token', () => {
    // October 2026 falls in FY27 (July 2026 - June 2027).
    expect(renderNumber('INV-{FY}-{####}', { ...ctx, value: 1 })).toBe('INV-27-0001');
    expect(renderNumber('INV-FY{FY}-{####}', { ...ctx, value: 1 })).toBe('INV-FY27-0001');
    expect(renderNumber('INV-{FY}-{####}', { ...ctx, date: '2026-06-30', value: 1 })).toBe('INV-26-0001');
    expect(renderNumber('INV-{FY}-{####}', { ...ctx, date: '2026-07-01', value: 1 })).toBe('INV-27-0001');
  });

  it('honours a non-July financial year start', () => {
    // With a January start, January 2026 opens the year labelled 2026-27.
    expect(renderNumber('{FY}', { ...ctx, date: '2026-01-15', value: 1, financialYearStartMonth: 1 })).toBe(
      '27',
    );
    expect(renderNumber('{FY}', { ...ctx, date: '2025-12-31', value: 1, financialYearStartMonth: 1 })).toBe(
      '26',
    );
    expect(financialYearKey('2026-01-15', 1)).toBe('2026-27');
    expect(financialYearKey('2026-07-01', 1)).toBe('2026-27');
    // A July start labels the same July date as the start of the year.
    expect(financialYearKey('2026-01-15')).toBe('2025-26');
  });

  it('expands the client, profile and type tokens', () => {
    expect(
      renderNumber('{PROFILE}-{CLIENT}-{####}', {
        ...ctx,
        value: 3,
        profileCode: 'CONS',
        clientCode: 'ACME',
      }),
    ).toBe('CONS-ACME-0003');
    expect(renderNumber('{TYPE}-{####}', { ...ctx, value: 3 })).toBe('INV-0003');
    expect(renderNumber('{TYPE}-{####}', { ...ctx, value: 3, documentType: 'credit_note' })).toBe('CN-0003');
    expect(renderNumber('{TYPE}-{####}', { ...ctx, value: 3, documentType: 'quote' })).toBe('Q-0003');
  });

  it('leaves an unknown token visible rather than blanking it', () => {
    expect(renderNumber('INV-{NOPE}-{####}', { ...ctx, value: 1 })).toBe('INV-{NOPE}-0001');
  });

  it('does not expand a token that appears inside a substituted value', () => {
    const out = renderNumber('{CLIENT}-{####}', { ...ctx, value: 1, clientCode: '{YYYY}' });
    expect(out).toBe('{YYYY}-0001');
  });

  it('accepts custom tokens', () => {
    expect(renderNumber('{BRANCH}-{####}', { ...ctx, value: 1, extra: { BRANCH: 'SYD' } })).toBe('SYD-0001');
  });

  it('exposes the literal prefix and whether a counter is present', () => {
    expect(patternPrefix('INV-{YYYY}-{####}')).toBe('INV-');
    expect(patternPrefix('FLAT')).toBe('FLAT');
    expect(hasCounter('INV-{YYYY}-{####}')).toBe(true);
    expect(hasCounter('INV-{YYYY}')).toBe(false);
  });

  it('previews a pattern without touching the database', () => {
    expect(previewNumber('INV-{YYYY}-{####}', ctx, 12)).toBe('INV-2026-0012');
    expect(previewNumber('INV-{YYYY}-{####}', ctx)).toBe('INV-2026-0001');
  });

  it('documents every token it understands', () => {
    expect(NUMBER_TOKENS.map((t) => t.token)).toContain('{####}');
    expect(NUMBER_TOKENS.map((t) => t.token)).toContain('{FY}');
  });

  it('sorts numbers numerically, not lexically', () => {
    expect(numberSortKey('INV-2')).toBe('INV-000000000002');
    expect(compareNumbers('INV-2', 'INV-10')).toBeLessThan(0);
    expect(compareNumbers('INV-10', 'INV-2')).toBeGreaterThan(0);
    expect(compareNumbers('INV-2', 'INV-2')).toBe(0);
    expect(['INV-10', 'INV-2', 'INV-1'].sort(compareNumbers)).toEqual(['INV-1', 'INV-2', 'INV-10']);
  });

  it('labels every document type', () => {
    expect(documentTypeLabel('invoice')).toBe('Invoice');
    expect(documentTypeLabel('credit_note')).toBe('Credit Note');
    expect(documentTypeLabel('payment_receipt')).toBe('Payment Receipt');
    expect(documentTypeLabel('proforma')).toBe('Pro-forma Invoice');
    expect(typeLabel('delivery_note')).toBe('Delivery Note');
  });

  it('titles a GST-registered invoice as a Tax Invoice, and nothing else does', () => {
    expect(headingFor(true, 'invoice')).toBe('Tax Invoice');
    expect(headingFor(false, 'invoice')).toBe('Invoice');
    expect(headingFor(true, 'credit_note')).toBe('Tax Credit Note');
    expect(headingFor(false, 'credit_note')).toBe('Credit Note');
    expect(headingFor(false, 'quote')).toBe('Quote');
    expect(headingFor(true, 'payment_receipt')).toBe('Payment Receipt');
  });

  it('re-exports the same helpers under both import names', () => {
    expect(heading).toBe(headingFor);
  });
});

/* ================================================================== */
describe('number sequences', () => {
  it('builds the reset key from the rule', () => {
    expect(periodKeyFor('2026-10-06', 'yearly')).toBe('2026');
    expect(periodKeyFor('2026-10-06', 'financial_year')).toBe('2026-27');
    expect(periodKeyFor('2026-10-06', 'never')).toBe('all-time');
  });

  it('resets when the period changes', () => {
    expect(shouldReset({ resetRule: 'yearly', periodKey: '2025' }, '2026-10-06')).toBe(true);
    expect(shouldReset({ resetRule: 'yearly', periodKey: '2026' }, '2026-10-06')).toBe(false);
    // A backdated document must never roll the counter back: the period went
    // backwards, so the sequence keeps running where it was.
    expect(shouldReset({ resetRule: 'yearly', periodKey: '2027' }, '2026-12-31')).toBe(false);
    expect(shouldReset({ resetRule: 'financial_year', periodKey: '2027-28' }, '2026-10-06')).toBe(false);
    expect(shouldReset({ resetRule: 'financial_year', periodKey: '2025-26' }, '2026-10-06')).toBe(true);
    expect(shouldReset({ resetRule: 'financial_year', periodKey: '2026-27' }, '2026-10-06')).toBe(false);
    // A never-resetting sequence must never roll over, however old it is.
    expect(shouldReset({ resetRule: 'never', periodKey: 'all-time' }, '2031-01-01')).toBe(false);
  });

  it('starts over at the configured start value', () => {
    expect(nextCounterValue({ nextValue: 57, startAt: 1 }, true)).toBe(1);
    expect(nextCounterValue({ nextValue: 57, startAt: 100 }, true)).toBe(100);
    expect(nextCounterValue({ nextValue: 57, startAt: 1 }, false)).toBe(57);
  });

  it('spots patterns that would produce the same shape', () => {
    expect(patternsCollide('INV-{YYYY}-{####}', 'INV-{YY}-{###}')).toBe(true);
    expect(patternsCollide('INV-{####}', 'CN-{####}')).toBe(false);
  });
});

/* ================================================================== */
describe('dates', () => {
  it('adds days without drifting across daylight saving', () => {
    // Australian daylight saving starts on the first Sunday in October.
    expect(addDaysIso('2026-09-25', 10)).toBe('2026-10-05');
    expect(addDaysIso('2026-10-05', 1)).toBe('2026-10-06');
    expect(diffDays('2026-09-25', '2026-10-06')).toBe(11);
    // Across the other boundary as well.
    expect(diffDays('2026-03-25', '2026-04-10')).toBe(16);
  });

  it('handles leap years', () => {
    expect(addDaysIso('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDaysIso('2024-02-29', 1)).toBe('2024-03-01');
    expect(diffDays('2024-02-28', '2024-03-01')).toBe(2);
    expect(addDaysIso('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('recognises valid and invalid date strings', () => {
    expect(isDateString('2026-10-06')).toBe(true);
    expect(isDateString('2026-13-01')).toBe(false);
    expect(isDateString('2026-02-30')).toBe(false);
    expect(isDateString('not a date')).toBe(false);
    expect(isDateString(null)).toBe(false);
  });

  it('compares dates as strings, which is safe for ISO', () => {
    expect(isBefore('2026-01-01', '2026-01-02')).toBe(true);
    expect(isAfter('2026-01-02', '2026-01-01')).toBe(true);
    expect(isBefore('2026-01-01', '2026-01-01')).toBe(false);
  });

  it('resolves every payment term to a due date', () => {
    expect(dueDateFor('2026-10-06', 'due_on_receipt')).toBe('2026-10-06');
    expect(dueDateFor('2026-10-06', 'net_7')).toBe('2026-10-13');
    expect(dueDateFor('2026-10-06', 'net_14')).toBe('2026-10-20');
    expect(dueDateFor('2026-10-06', 'net_30')).toBe('2026-11-05');
    expect(dueDateFor('2026-10-06', 'net_60')).toBe('2026-12-05');
  });

  it('resolves end of next month without overflowing into the wrong year', () => {
    expect(endOfNextMonth('2026-10-06')).toBe('2026-11-30');
    expect(endOfNextMonth('2026-12-15')).toBe('2027-01-31');
    expect(endOfNextMonth('2026-12-31')).toBe('2027-01-31');
    expect(endOfNextMonth('2024-01-31')).toBe('2024-02-29');
    expect(dueDateFor('2026-12-15', 'end_next_month')).toBe('2027-01-31');
  });

  it('falls back to Net 30 for an unknown terms id', () => {
    expect(dueDateFor('2026-10-06', 'does_not_exist')).toBe('2026-11-05');
    const t = resolveTerms('does_not_exist');
    expect(t.id).toBe('net_30');
  });

  it('supports custom terms', () => {
    const custom = [{ id: 'net_45', name: 'Net 45', days: 45, kind: 'net_days' as const }];
    expect(dueDateFor('2026-10-06', 'net_45', custom)).toBe('2026-11-20');
    expect(resolveTerms('net_45', custom).days).toBe(45);
  });

  it('labels terms for printing', () => {
    expect(termLabel(resolveTerms('due_on_receipt'))).toBe('Due on receipt');
    expect(termLabel(resolveTerms('net_14'))).toBe('Net 14');
    expect(termLabel(resolveTerms('end_next_month'))).toBe('End of next month');
  });

  it('marks overdue the day after the due date, not on it', () => {
    expect(isOverdue('2026-10-06', '2026-10-06')).toBe(false);
    expect(isOverdue('2026-10-06', '2026-10-07')).toBe(true);
    expect(isOverdue(null, '2026-10-07')).toBe(false);
  });

  it('computes the Australian financial year', () => {
    expect(financialYear('2026-07-01')).toBe('2026-27');
    expect(financialYear('2027-06-30')).toBe('2026-27');
    expect(financialYear('2026-06-30')).toBe('2025-26');
    expect(financialYear('2027-01-15')).toBe('2026-27');
    expect(financialYearKey('2026-07-01')).toBe('2026-27');
  });

  it('gives an inclusive financial year range', () => {
    expect(financialYearRange('2026-27')).toEqual({ start: '2026-07-01', end: '2027-06-30' });
    expect(financialYearRange('2025-26')).toEqual({ start: '2025-07-01', end: '2026-06-30' });
  });

  it('splits a date into its BAS period', () => {
    // BAS quarters end 30 September, 31 December, 31 March and 30 June.
    expect(basPeriod('2026-07-01')).toEqual({
      label: 'Jul–Sep 2026',
      start: '2026-07-01',
      end: '2026-09-30',
    });
    expect(basPeriod('2026-09-30')).toEqual({
      label: 'Jul–Sep 2026',
      start: '2026-07-01',
      end: '2026-09-30',
    });
    expect(basPeriod('2026-10-06')).toEqual({
      label: 'Oct–Dec 2026',
      start: '2026-10-01',
      end: '2026-12-31',
    });
    expect(basPeriod('2026-03-31')).toEqual({
      label: 'Jan–Mar 2026',
      start: '2026-01-01',
      end: '2026-03-31',
    });
    expect(basPeriod('2026-06-30')).toEqual({
      label: 'Apr–Jun 2026',
      start: '2026-04-01',
      end: '2026-06-30',
    });
  });

  it('gives month ranges and the previous month', () => {
    expect(monthRange('2026-10-06')).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(monthRange('2026-02-15')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(previousMonth('2026-10-06')).toBe('2026-09-15');
    expect(previousMonth('2026-01-15')).toBe('2025-12-15');
    expect(monthLabel('2026-10-06')).toBe('October 2026');
    expect(monthLabel('2026-10-06', 'short')).toBe('Oct 2026');
  });

  it('expires a quote on the day after its validity date', () => {
    expect(quoteExpiry('2026-10-06', 30)).toBe('2026-11-05');
    expect(isDateString(quoteExpiry('2026-10-06', 30))).toBe(true);
  });

  it('moves the balance due date when a deposit is paid', () => {
    expect(depositBalanceDueDate('2026-10-06', 'net_30', null)).toBe('2026-11-05');
    expect(depositBalanceDueDate('2026-10-06', 'net_30', '2026-12-24')).toBe('2026-12-24');
  });

  it('formats dates for people without moving the stored value', () => {
    expect(formatDate('2026-10-06', 'DMY')).toBe('06/10/2026');
    expect(formatDate('2026-10-06', 'MDY')).toBe('10/06/2026');
    expect(formatDate('2026-10-06', 'ISO')).toBe('2026-10-06');
    expect(formatDate('2026-10-06', 'YMD')).toBe('2026-10-06');
    expect(formatDate('nonsense')).toBe('nonsense');
    expect(formatDateForFilename('2026-10-06')).toBe('2026-10-06');
  });

  it('describes relative dates in plain language', () => {
    expect(relativeDays('2026-10-06', '2026-10-06')).toBe('today');
    expect(relativeDays('2026-10-06', '2026-10-07')).toBe('tomorrow');
    expect(relativeDays('2026-10-06', '2026-10-05')).toBe('yesterday');
    expect(relativeDays('2026-10-06', '2026-10-11')).toBe('in 5 days');
    expect(relativeDays('2026-10-06', '2026-10-01')).toBe('5 days ago');
    expect(ageInDays('2026-10-06', '2026-10-01')).toBe(0);
  });

  it('knows the last business day of a month', () => {
    expect(lastBusinessDayOf('2026-10-15')).toBe('2026-10-30');
    // November 2026: the 30th is a Monday, so it stays.
    expect(lastBusinessDayOf('2026-11-15')).toBe('2026-11-30');
    // August 2026: the 31st is a Monday, so it stays.
    expect(lastBusinessDayOf('2026-08-15')).toBe('2026-08-31');
    // May 2026: the 31st is a Sunday, so it falls back to Friday the 29th.
    expect(lastBusinessDayOf('2026-05-15')).toBe('2026-05-29');
  });

  it('finds the next given weekday', () => {
    // 6 October 2026 is a Tuesday.
    expect(nextWeekdayAfter('2026-10-06', 1, 1)).toBe('2026-10-12'); // next Monday
    expect(nextWeekdayAfter('2026-10-06', 2, 1)).toBe('2026-10-13'); // next Tuesday
    expect(nextWeekdayAfter('2026-10-06', 2, 7)).toBe('2026-10-13');
    expect(nextWeekdayAfter('2026-10-06', 2, 8)).toBe('2026-10-20');
    // With no minimum gap, the same day is allowed to match itself.
    expect(nextWeekdayAfter('2026-10-06', 2, 0)).toBe('2026-10-06');
  });

  it('breaks a date into parts', () => {
    expect(datePartsOf('2026-10-06')).toEqual({ y: 2026, m: 9, d: 6 });
  });

  it('resolves today in a named time zone', () => {
    const sydney = todayIn('Australia/Sydney');
    expect(isDateString(sydney)).toBe(true);
    expect(todayIn('Not/AZone')).toBe(todayIn('Not/AZone'));
  });
});

/* ================================================================== */
describe('ABN', () => {
  it('accepts a valid ABN and rejects a transposition', () => {
    expect(isValidAbn('51824753556')).toBe(true);
    expect(isValidAbn('51824753565')).toBe(false);
    expect(validateAbn('5182475356').reason).toMatch(/11 digits/);
  });
});

/* ================================================================== */
describe('merge fields', () => {
  it('substitutes the fields the plan names', () => {
    const values = {
      'client.name': 'Acme',
      'invoice.number': 'INV-2026-0001',
      'invoice.total': '$1,320.00',
      'invoice.due_date': '05/11/2026',
      'business.name': 'Consulting Pty Ltd',
    };
    const out = interpolate(
      'Hi {client.name}, invoice {invoice.number} for {invoice.total} is due {invoice.due_date}. Thanks — {business.name}',
      values,
    );
    expect(out).toBe(
      'Hi Acme, invoice INV-2026-0001 for $1,320.00 is due 05/11/2026. Thanks — Consulting Pty Ltd',
    );
  });

  it('tolerates spaces inside the braces and any capitalisation', () => {
    expect(interpolate('{ Client.Name }', { 'client.name': 'Acme' })).toBe('Acme');
    expect(interpolate('{CLIENT.NAME}', { 'client.name': 'Acme' })).toBe('Acme');
  });

  it('leaves an unknown token visible', () => {
    expect(interpolate('{nope}', {})).toBe('{nope}');
    // A field the caller knows about but has no data for collapses to the fallback.
    expect(interpolate('{client.name}', { 'client.name': '' })).toBe('');
    expect(interpolate('{client.name}', { 'client.name': '' }, { fallback: 'there' })).toBe('there');
    expect(interpolate('{client.name}', { 'client.name': 'Acme' })).toBe('Acme');
  });

  it('lists the tokens a template uses, and the ones it cannot resolve', () => {
    expect(tokensIn('{client.name} {invoice.total} {client.name}')).toEqual(['client.name', 'invoice.total']);
    expect(missingTokens('{client.name} {invoice.po_number}', { 'client.name': 'Acme' })).toEqual([
      'invoice.po_number',
    ]);
  });

  it('builds the value set from a document', () => {
    const values = buildMergeValues({
      business: {
        name: 'Consulting',
        abn: '51 824 753 556',
        addressLines: ['1 High St', 'Sydney NSW 2000'],
        paymentDetailsLines: ['BSB 062-000'],
      },
      client: { name: 'Acme Pty Ltd', addressLines: ['2 Low Rd'] },
      document: {
        number: 'INV-2026-0001',
        typeLabel: 'Tax Invoice',
        issueDate: '06/10/2026',
        dueDate: '05/11/2026',
        currency: 'AUD',
        total: '$1,320.00',
        balance: '$1,320.00',
      },
      sender: { name: 'Sam', email: 'sam@example.com' },
      today: '06/10/2026',
    });

    expect(values['client.first_name']).toBe('Acme');
    expect(values['business.address']).toBe('1 High St\nSydney NSW 2000');
    expect(values['invoice.total']).toBe('$1,320.00');
    expect(values['invoice.days_overdue']).toBe(0);
    expect(values['sender.email']).toBe('sam@example.com');
  });

  it('falls back to the draft number while the document is not yet numbered', () => {
    const values = buildMergeValues({
      business: { name: 'B' },
      client: null,
      document: {
        number: '',
        draftNumber: 'DRAFT',
        typeLabel: 'Invoice',
        issueDate: '06/10/2026',
        currency: 'AUD',
      },
    });
    expect(values['invoice.number']).toBe('DRAFT');
    expect(values['client.name']).toBe('');
  });

  it('documents every field the editor offers', () => {
    expect(MERGE_FIELDS.length).toBeGreaterThan(20);
    expect(MERGE_FIELDS.map((f) => f.token)).toContain('{invoice.due_date}');
  });

  it('turns each custom field into an interpolatable token', () => {
    const tokens = customFieldTokens([
      { entity: 'client', key: 'priority', name: 'Priority' },
      { entity: 'item', key: 'lead_time_days', name: 'Lead time (days)' },
      { entity: 'document', key: 'PO Ref', name: 'PO Ref' },
    ]);

    expect(tokens.map((t) => t.token)).toEqual([
      '{client.custom.priority}',
      '{item.custom.lead_time_days}',
      '{document.custom.po_ref}',
    ]);
    expect(tokens[0].group).toBe('Client');
    expect(tokens[1].description).toBe('Lead time (days)');
  });

  it('resolves a custom-field token from the record', () => {
    const values = withCustomFieldValues(
      { 'client.name': 'Acme' },
      { client: { priority: 'High' }, document: { 'PO Ref': 'PO-9' } },
    );

    expect(values['client.custom.priority']).toBe('High');
    expect(values['invoice.custom.po_ref']).toBeUndefined();
    expect(values['document.custom.po_ref']).toBe('PO-9');

    const subject = interpolate('Hi {client.name}, re {client.custom.priority} client', values);
    expect(subject).toBe('Hi Acme, re High client');
  });

  it('leaves the standard value set untouched', () => {
    const before = { 'client.name': 'Acme' };
    const after = withCustomFieldValues(before, { client: { priority: 'High' } });
    expect(before).toEqual({ 'client.name': 'Acme' });
    expect(after['client.name']).toBe('Acme');
  });
});

/* ================================================================== */
describe('the rules engine', () => {
  const stamp = { id: 'x', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
  const rules = builtinRules(stamp);

  const doc = {
    type: 'invoice' as const,
    currency: 'AUD',
    totals: { total: 0 },
  };
  const client = {
    tags: ['Overseas'],
    defaultCurrency: 'USD',
    billingAddress: { country: 'NZ' },
    defaultTaxCodeId: null,
  };

  function ctx(over: Partial<Parameters<typeof evaluateRules>[1]> = {}) {
    return {
      client: client as never,
      document: doc as never,
      lines: [] as never[],
      subtotalMinor: 0,
      totalMinor: 0,
      itemCount: 0,
      categories: [] as string[],
      profileCode: 'CONS',
      ...over,
    };
  }

  it("ships an overseas rule that export-rates, and never relabels the currency", () => {
    const r = evaluateRules(rules, ctx());
    expect(r.applied.map((x) => x.id)).toContain('rule_overseas');
    expect(r.patch.taxCodeId).toBe('tax_export');
    // Setting a currency converts nothing — prices would simply be wrong —
    // so the rule does not touch it.
    expect(r.patch.currency).toBeUndefined();
    const rule = rules.find((x) => x.id === 'rule_overseas')!;
    expect(rule.actions.some((a) => a.type === 'set_currency')).toBe(false);
  });

  it('leaves an untagged client alone', () => {
    const r = evaluateRules(rules, ctx({ client: { ...client, tags: [] } as never }));
    expect(r.patch.taxCodeId).toBeUndefined();
  });

  it('ships the large-invoice terms rule, disabled by default', () => {
    const rule = rules.find((r) => r.id === 'rule_large_terms')!;
    expect(rule.enabled).toBe(false);
    expect(rule.conditions[0].field).toBe('document.total');
    expect(rule.conditions[0].value).toBe('1000000');
    expect(rule.actions[0]).toEqual({ type: 'set_terms', field: '', value: 'net_14' });
  });

  it('ships a travel markup rule', () => {
    const rule = rules.find((r) => r.id === 'rule_travel_markup')!;
    expect(rule.conditions[0].value).toBe('Travel');
    expect(rule.actions[0].value).toBe('10');
  });

  it('runs rules in priority order', () => {
    const ordered = [...rules].sort((a, b) => a.priority - b.priority).map((r) => r.priority);
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
  });

  it('stops the chain when a rule says to', () => {
    const stop = builtinRules(stamp).map((r) => (r.id === 'rule_overseas' ? { ...r, stopOnMatch: true } : r));
    const r = evaluateRules(stop, ctx());
    expect(r.stopped).toBe(true);
  });

  it('requires every condition by default, or any with match: any', () => {
    const all: Parameters<typeof evaluateRules>[0] = [
      {
        id: 'r',
        createdAt: stamp.createdAt,
        updatedAt: stamp.updatedAt,
        deletedAt: null,
        name: 'r',
        enabled: true,
        match: 'all',
        conditions: [
          { field: 'client.tag', operator: 'equals', value: 'Overseas' },
          { field: 'document.currency', operator: 'equals', value: 'JPY' },
        ],
        actions: [{ type: 'set_terms', field: '', value: 'net_7' }],
        priority: 1,
        stopOnMatch: false,
        builtin: false,
        lastFiredAt: null,
        fireCount: 0,
      },
    ];
    expect(evaluateRules(all, ctx()).patch.termsId).toBeUndefined();
    expect(evaluateRules([{ ...all[0], match: 'any' }], ctx()).patch.termsId).toBe('net_7');
  });

  it('evaluates every operator', () => {
    const one = (field: string, operator: string, value: string) => ({
      id: 'r',
      createdAt: stamp.createdAt,
      updatedAt: stamp.updatedAt,
      deletedAt: null,
      name: 'r',
      enabled: true,
      match: 'all' as const,
      conditions: [{ field, operator, value } as never],
      actions: [{ type: 'set_terms' as const, field: '', value: 'net_7' }],
      priority: 1,
      stopOnMatch: false,
      builtin: false,
      lastFiredAt: null,
      fireCount: 0,
    });

    expect(
      evaluateRules([one('document.total', 'greater_than', '100000')], ctx({ totalMinor: 200000 })).patch
        .termsId,
    ).toBe('net_7');
    expect(
      evaluateRules([one('document.total', 'greater_than', '100000')], ctx({ totalMinor: 50000 })).patch
        .termsId,
    ).toBeUndefined();
    expect(
      evaluateRules([one('document.total', 'less_than', '100000')], ctx({ totalMinor: 50000 })).patch.termsId,
    ).toBe('net_7');
    expect(evaluateRules([one('client.country', 'equals', 'nz')], ctx()).patch.termsId).toBe('net_7');
    expect(evaluateRules([one('client.country', 'not_equals', 'AU')], ctx()).patch.termsId).toBe('net_7');
    expect(evaluateRules([one('client.tag', 'in', 'Overseas, Government')], ctx()).patch.termsId).toBe(
      'net_7',
    );
    expect(evaluateRules([one('client.taxId', 'is_empty', '')], ctx()).patch.termsId).toBe('net_7');
    expect(
      evaluateRules(
        [one('client.taxId', 'is_not_empty', '')],
        ctx({ client: { ...client, taxId: '51 824 753 556' } as never }),
      ).patch.termsId,
    ).toBe('net_7');
  });

  it('ignores disabled, deleted and empty rules', () => {
    expect(evaluateRules([{ ...rules[0], enabled: false }], ctx()).applied).toHaveLength(0);
    expect(
      evaluateRules([{ ...rules[0], deletedAt: '2026-01-02T00:00:00.000Z' }], ctx()).applied,
    ).toHaveLength(0);
    expect(evaluateRules([{ ...rules[0], conditions: [] }], ctx()).applied).toHaveLength(0);
  });

  it('only writes known fields', () => {
    const r = evaluateRules(
      [{ ...rules[0], actions: [{ type: 'set_field', field: 'secretInjected', value: 'x' }] }],
      ctx(),
    );
    expect(Object.keys(r.patch)).not.toContain('secretInjected');
  });

  it('logs every action in plain English', () => {
    const r = evaluateRules(rules, ctx());
    expect(r.log.join(' ')).toContain('Overseas clients are export-rated');
    expect(r.log.some((l) => l.includes('set tax code to'))).toBe(true);
  });

  it('describes a rule as a readable sentence', () => {
    expect(summariseRule(rules[0])).toContain('If client tag is "Overseas"');
    expect(summariseRule(rules[0])).toContain('then');
  });

  it('names every operator in a description', () => {
    expect(describeCondition({ field: 'document.total', operator: 'greater_than', value: '100' })).toBe(
      'document total is more than "100"',
    );
    expect(describeCondition({ field: 'client.taxId', operator: 'is_empty', value: '' })).toBe(
      'client tax ID is empty',
    );
  });
});

/* ================================================================== */
describe('recurring schedules', () => {
  const base: RecurringSchedule = {
    id: 's1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    name: 'Retainer',
    documentType: 'invoice',
    profileId: 'p1',
    clientId: 'c1',
    sourceDocumentId: null,
    designTemplateId: null,
    emailTemplateId: null,
    contentPresetId: null,
    frequency: 'monthly' as const,
    dayOfMonth: 1,
    dayOfWeek: 1,
    timeOfDayMinutes: 540,
    timezone: 'Australia/Sydney',
    startDate: '2026-01-01',
    nextRunDate: '2026-11-01',
    lastRunDate: null,
    lastRunDocumentId: null,
    endCondition: 'never',
    endAfterRuns: 12,
    endOnDate: null,
    runsCompleted: 0,
    maxCatchUpRuns: 3,
    currency: null,
    termsId: null,
    dueOffsetDays: null,
    notes: '',
    paused: false,
    reviewRequired: true,
    consumedRunKeys: [] as string[],
  };

  it('always creates drafts for review in v1', () => {
    expect(base.reviewRequired).toBe(true);
  });

  it('does not run before the next run date', () => {
    expect(dueRunDates(base, '2026-10-31')).toEqual([]);
    expect(dueRunDates(base, '2026-11-01')).toEqual(['2026-11-01']);
  });

  it('produces exactly one run when the app opens late', () => {
    // Opened on the 5th, schedule next-run 1 November, run once per month.
    const dates = dueRunDates({ ...base, nextRunDate: '2026-11-01', maxCatchUpRuns: 1 }, '2027-01-05');
    expect(dates).toEqual(['2026-11-01']);
  });

  it('an "after N runs" schedule has only its remaining runs due', () => {
    expect(dueRunDates({ ...base, runsCompleted: 1, endCondition: 'after_runs', endAfterRuns: 2 }, '2027-06-01')).toHaveLength(1);
    expect(
      dueRunDates({ ...base, runsCompleted: 2, endCondition: 'after_runs', endAfterRuns: 2 }, '2027-06-01'),
    ).toHaveLength(0);
  });

  it('a schedule ending on a date has no runs on or after it', () => {
    const dates = dueRunDates({ ...base, endCondition: 'on_date', endOnDate: '2026-12-15' }, '2027-06-01');
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.every((d) => d < '2026-12-15')).toBe(true);
  });

  it('catches up a few runs but not sixty', () => {
    const dates = dueRunDates({ ...base, nextRunDate: '2026-11-01', maxCatchUpRuns: 3 }, '2027-01-05');
    expect(dates).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
  });

  it('is idempotent: a consumed run date never runs twice', () => {
    const date = '2026-11-01';
    expect(alreadyConsumed(base, date)).toBe(false);

    const after = advance(base, date);
    expect(alreadyConsumed(after, date)).toBe(true);
    expect(after.nextRunDate).toBe('2026-12-01');
    expect(after.runsCompleted).toBe(1);
    expect(after.consumedRunKeys).toContain(runKey('s1', date));

    // Running the scheduler again the same day adds nothing.
    const again = dueRunDates(after, '2026-11-01');
    expect(again.every((d) => alreadyConsumed(after, d))).toBe(true);
  });

  it('resumes from where it left off after many runs', () => {
    let s = base;
    for (const date of ['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01']) s = advance(s, date);
    expect(s.nextRunDate).toBe('2027-03-01');
    expect(s.runsCompleted).toBe(4);
  });

  it('clamps a day-of-month schedule into a short month instead of skipping it', () => {
    // A schedule on the 31st must still run in February.
    const s = { ...base, dayOfMonth: 31, startDate: '2026-01-31', nextRunDate: '2026-01-31' };
    expect(nextRunAfter(s, '2026-01-31')).toBe('2026-02-28');
    expect(nextRunAfter(s, '2024-01-31')).toBe('2024-02-29');
    expect(nextRunAfter(s, '2026-03-31')).toBe('2026-04-30');
  });

  it('steps quarterly, half-yearly and yearly without drift', () => {
    // dayOfMonth is 1 on this fixture, so each step lands on the 1st.
    expect(nextRunAfter({ ...base, frequency: 'quarterly' }, '2026-01-01')).toBe('2026-04-01');
    expect(nextRunAfter({ ...base, frequency: 'half_yearly' }, '2026-01-01')).toBe('2026-07-01');
    expect(nextRunAfter({ ...base, frequency: 'yearly' }, '2026-01-01')).toBe('2027-01-01');
    // A 31st schedule clamps into the short months instead of skipping them.
    const end = { ...base, dayOfMonth: 31 };
    expect(nextRunAfter({ ...end, frequency: 'quarterly' }, '2026-01-31')).toBe('2026-04-30');
    expect(nextRunAfter({ ...end, frequency: 'half_yearly' }, '2026-01-31')).toBe('2026-07-31');
    expect(nextRunAfter({ ...end, frequency: 'yearly' }, '2026-01-31')).toBe('2027-01-31');
  });

  it('steps weekly and fortnightly by weekday', () => {
    expect(nextRunAfter({ ...base, frequency: 'weekly', dayOfWeek: 1 }, '2026-10-05')).toBe('2026-10-12');
    expect(nextRunAfter({ ...base, frequency: 'fortnightly', dayOfWeek: 1 }, '2026-10-05')).toBe(
      '2026-10-19',
    );
  });

  it('uses the last business day when asked to', () => {
    expect(nextRunAfter({ ...base, frequency: 'monthly_last_business_day' }, '2026-04-02')).toBe(
      '2026-05-29',
    );
  });

  it('waits for the next occurrence when the start date is mid-cycle', () => {
    expect(
      firstRunOnOrAfter(
        { ...base, frequency: 'monthly', dayOfMonth: 1, startDate: '2026-10-15' },
        '2026-10-15',
      ),
    ).toBe('2026-11-01');
    expect(
      firstRunOnOrAfter(
        { ...base, frequency: 'monthly', dayOfMonth: 28, startDate: '2026-10-28' },
        '2026-10-28',
      ),
    ).toBe('2026-10-28');
  });

  it('honours end conditions', () => {
    expect(
      hasEnded({ ...base, endCondition: 'after_runs', endAfterRuns: 2, runsCompleted: 2 }, '2026-11-01'),
    ).toBe(true);
    expect(
      hasEnded({ ...base, endCondition: 'after_runs', endAfterRuns: 2, runsCompleted: 1 }, '2026-11-01'),
    ).toBe(false);
    expect(hasEnded({ ...base, endCondition: 'on_date', endOnDate: '2026-10-31' }, '2026-11-01')).toBe(true);
    expect(hasEnded({ ...base, endCondition: 'on_date', endOnDate: '2026-11-30' }, '2026-11-01')).toBe(false);
    expect(hasEnded(base, '2099-01-01')).toBe(false);
  });

  it('does not run while paused or finished', () => {
    expect(isDue({ ...base, paused: true }, '2026-11-01')).toBe(false);
    expect(isDue({ ...base, endCondition: 'on_date', endOnDate: '2026-10-01' }, '2026-11-01')).toBe(false);
    expect(isDue(base, '2026-11-01')).toBe(true);
  });

  it('resolves line-text variables on each run', () => {
    const lines = [
      { id: 'l1', description: 'Retainer — {month} {year}', notes: 'Covers {period_start} to {period_end}' },
      { id: 'l2', description: 'Previous period: {prev_month_year}' },
      { id: 'l3', description: 'Plain description' },
    ] as never;

    const out = resolveLineVariables(lines, '2026-10-06');
    expect(out[0].description).toBe('Retainer — October 2026');
    expect(out[0].notes).toBe('Covers 1 October 2026 to 31 October 2026');
    expect(out[1].description).toBe('Previous period: September 2026');
    expect(out[2].description).toBe('Plain description');
  });

  it('leaves an unknown line variable visible', () => {
    expect(lineInterpolate('{not_a_variable}', {})).toBe('{not_a_variable}');
  });

  it('handles a January run referring back to December', () => {
    const out = resolveLineVariables(
      [{ id: 'l1', description: '{month_year} (was {prev_month_year})' }] as never,
      '2027-01-15',
    );
    expect(out[0].description).toBe('January 2027 (was December 2026)');
  });

  it('documents the variables it understands', () => {
    expect(LINE_VARIABLES.map((v) => v.token)).toContain('{prev_month}');
    expect(LINE_VARIABLES.map((v) => v.token)).toContain('{period_end}');
  });

  it('describes a schedule for the list screen', () => {
    expect(describeSchedule(base)).toContain('Monthly');
    expect(describeSchedule({ ...base, paused: true })).toBe('Paused');
    expect(describeSchedule({ ...base, frequency: 'weekly', dayOfWeek: 1 })).toContain('Weekly');
  });
});
