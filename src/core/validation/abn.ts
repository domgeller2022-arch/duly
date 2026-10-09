/**
 * ABN validation, entirely offline.
 *
 * The Australian Business Number carries a checksum, so a typo is caught as
 * soon as it is typed without ever contacting the ABN Lookup. The algorithm:
 *
 *  1. Subtract 1 from the first digit.
 *  2. Multiply each of the 11 digits by the weights 10, 1, 3, 5, 7, 9, 11, 13,
 *     15, 17, 19.
 *  3. Sum the products.
 *  4. The number is valid when that sum divides exactly by 89.
 *
 * This catches transpositions, single-digit errors and most missing digits. It
 * cannot catch an ABN that was never issued — that needs the online register,
 * which Duly deliberately never calls.
 */

export interface AbnValidation {
  valid: boolean;
  /** The 11 digits, with no formatting. */
  digits: string;
  /** Display form: "12 345 678 901". */
  formatted: string;
  /** A plain-language reason when invalid. */
  reason: string;
  /** The correct checksum digit, when only that differs. */
  suggestedDigit: string | null;
}

const WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

/** Strip everything that is not a digit. */
export function abnDigits(input: string): string {
  return String(input ?? '').replace(/\D/g, '');
}

/**
 * Group an ABN the way the ATO prints it: `12 345 678 901`.
 *
 * Two digits, then three groups of three — not three-four-four, which is what
 * makes an ABN look like it belongs to another numbering scheme entirely.
 */
export function formatAbn(input: string): string {
  const d = abnDigits(input);
  if (d.length === 0) return '';
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)} ${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`;
  // Nine and over: the trailing group carries whatever is left, up to 11.
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
}

/** Insert the standard spacing as the user types, capped at 11 digits. */
export function formatAbnAsTyping(input: string): string {
  return formatAbn(abnDigits(input).slice(0, 11));
}

/** The weighted sum the checksum is built from. */
export function abnChecksumValue(digits: string): number | null {
  if (digits.length !== 11) return null;
  let total = 0;
  for (let i = 0; i < 11; i++) {
    // The first digit has 1 subtracted before it is weighted.
    const d = i === 0 ? Number(digits[i]) - 1 : Number(digits[i]);
    total += d * WEIGHTS[i];
  }
  return total;
}

/** The check digit that would make an ABN valid, given the first 10 digits. */
export function abnCheckDigit(firstTen: string): string | null {
  if (firstTen.length !== 10 || !/^\d{10}$/.test(firstTen)) return null;
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const d = i === 0 ? Number(firstTen[i]) - 1 : Number(firstTen[i]);
    total += d * WEIGHTS[i];
  }
  // total + digit * 19 must be divisible by 89.
  for (let digit = 0; digit <= 9; digit++) {
    if ((total + digit * WEIGHTS[10]) % 89 === 0) return String(digit);
  }
  return null;
}

export function validateAbn(input: string): AbnValidation {
  const digits = abnDigits(input);
  const formatted = formatAbn(digits);

  if (digits.length === 0) {
    return { valid: false, digits, formatted, reason: '', suggestedDigit: null };
  }

  if (digits.length !== 11) {
    return {
      valid: false,
      digits,
      formatted,
      reason: `An ABN has 11 digits. ${digits.length === 1 ? 'This one has 1' : `This one has ${digits.length}`}.`,
      suggestedDigit: null,
    };
  }

  if (!/^\d{11}$/.test(digits)) {
    return { valid: false, digits, formatted, reason: 'An ABN contains only digits.', suggestedDigit: null };
  }

  // A leading zero is not a valid ABN, and neither is an all-zero number.
  if (digits === '00000000000') {
    return { valid: false, digits, formatted, reason: 'That is not a valid ABN.', suggestedDigit: null };
  }

  const sum = abnChecksumValue(digits);
  if (sum === null) {
    return { valid: false, digits, formatted, reason: 'Could not read the checksum.', suggestedDigit: null };
  }

  if (sum % 89 === 0) {
    return { valid: true, digits, formatted, reason: '', suggestedDigit: null };
  }

  const suggested = abnCheckDigit(digits.slice(0, 10));
  return {
    valid: false,
    digits,
    formatted,
    reason: 'That ABN fails its checksum, so it is probably a typo.',
    suggestedDigit: suggested !== null && suggested !== digits[10] ? suggested : null,
  };
}

export function isValidAbn(input: string): boolean {
  return validateAbn(input).valid;
}

/**
 * Tax identifiers for clients outside Australia.
 *
 * Only the shape is checked — there is no offline checksum for most countries'
 * VAT numbers, and inventing one would reject valid numbers.
 */
export function validateForeignTaxId(input: string, country: string): { valid: boolean; reason: string } {
  const value = String(input ?? '')
    .trim()
    .toUpperCase();
  if (!value) return { valid: false, reason: '' };

  switch (country.toUpperCase()) {
    case 'NZ':
    case 'NEW ZEALAND':
      if (!/^NZ\d{8,9}$/.test(value.replace(/\s/g, ''))) {
        return { valid: false, reason: 'An NZBN is NZ followed by 8 or 9 digits.' };
      }
      return { valid: true, reason: '' };
    case 'GB':
    case 'UK':
    case 'UNITED KINGDOM':
      if (!/^(GB)?\d{9,12}$/.test(value.replace(/[\s-]/g, ''))) {
        return { valid: false, reason: 'A UK VAT number is 9 to 12 digits.' };
      }
      return { valid: true, reason: '' };
    case 'US':
      if (!/^\d{9}$/.test(value.replace(/[\s-]/g, ''))) {
        return { valid: false, reason: 'A US EIN is 9 digits.' };
      }
      return { valid: true, reason: '' };
    case 'EU':
    case 'DE':
    case 'FR':
    case 'IE':
    case 'NL':
      if (!/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(value.replace(/\s/g, ''))) {
        return { valid: false, reason: 'An EU VAT number is two letters then up to 13 characters.' };
      }
      return { valid: true, reason: '' };
    default:
      return { valid: true, reason: '' };
  }
}

/**
 * BSB format: three digits, hyphen, three digits (e.g. 062-000).
 *
 * Only the shape is checked. Several weighted check-digit schemes circulate for
 * BSBs and none of them agree with real branch numbers — 062-000 is a genuine,
 * widely published BSB that the common schemes reject. An invented checksum
 * would therefore block valid payment details, so the shape and the formatting
 * are all Duly enforces.
 */
export function validateBsb(input: string): { valid: boolean; formatted: string; reason: string } {
  const d = String(input ?? '').replace(/\D/g, '');
  const formatted = d.length === 6 ? `${d.slice(0, 3)}-${d.slice(3)}` : String(input ?? '');
  if (d.length === 0) return { valid: false, formatted, reason: '' };
  if (d.length !== 6) return { valid: false, formatted, reason: 'A BSB has 6 digits.' };
  return { valid: true, formatted, reason: '' };
}

/**
 * Australian phone numbers, formatted but never rejected.
 *
 * Landlines read `02 9123 4567` (area, four, four) while mobiles read
 * `0412 345 678`, because that is how each is written in practice. Anything we
 * do not recognise is returned untouched rather than mangled.
 */
export function formatAuPhone(input: string): string {
  const original = String(input ?? '');
  const d = original.replace(/\D/g, '');

  // International form: +61 then the national significant number. The national
  // number has the trunk 0 stripped, so it is put back before grouping.
  if (d.length === 11 && d.startsWith('61')) {
    const national = d.slice(2);
    if (national.startsWith('0')) return `+61 ${formatNational(national)}`;
    if (national.startsWith('4'))
      return `+61 04${national.slice(1, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
    return `+61 ${formatNational('0' + national)}`;
  }

  if (d.length === 10) return formatNational(d);

  return original;
}

function formatNational(n: string): string {
  if (n.length !== 10 || !n.startsWith('0')) return n;
  const area = n.slice(0, 2);
  // Mobile numbers group 2-3-3 after the area prefix: 0412 345 678.
  if (area === '04') return `${area}${n.slice(2, 4)} ${n.slice(4, 7)} ${n.slice(7)}`;
  // Landlines group 4-4 after the area prefix: 02 9123 4567.
  return `${area} ${n.slice(2, 6)} ${n.slice(6)}`;
}

/**
 * PayID. Duly does not verify the address belongs to anyone — it only checks
 * the shape, so the payment block is not silently left blank.
 */
export function validatePayId(input: string): { valid: boolean; reason: string } {
  const v = String(input ?? '').trim();
  if (!v) return { valid: false, reason: '' };
  if (/^\S+@\S+\.\S+$/.test(v)) return { valid: true, reason: '' };
  if (/^(\+?61|0)[2-478](?:[ -]?\d){8}$/.test(v)) return { valid: true, reason: '' };
  if (/^\d{11}$/.test(v)) return { valid: true, reason: '' };
  return { valid: false, reason: 'A PayID is an email, a mobile number, or an ABN.' };
}
