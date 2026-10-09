/**
 * Address rendering.
 *
 * An address can print as a structured block (line1, line2, city state postcode,
 * country) or as a single line, and the choice is a per-business setting rather
 * than a hard-coded rule — an Australian business expects
 * `Sydney NSW 2000`, a British one `Sydney NSW 2000` too, but a lot of overseas
 * clients want the country on its own line.
 *
 * When the user has typed a formatted address by hand it prints exactly as typed.
 */

import type { Address } from '@/core/schemas/common';

export interface AddressFormatOptions {
  /** `structured` or `single_line`. */
  format?: 'structured' | 'single_line';
  /** Include the country line. Default true. */
  includeCountry?: boolean;
  /** Used when the address has no country of its own. */
  defaultCountry?: string;
  /** Printed in place of the country. */
  countryLabel?: string;
}

/** Render an address as an array of printed lines. */
export function formatAddressLines(
  address: Address | null | undefined,
  options: AddressFormatOptions = {},
): string[] {
  if (!address) return [];

  const {
    format = 'structured',
    includeCountry = true,
    defaultCountry = 'Australia',
    countryLabel,
  } = options;

  // A hand-typed address wins outright: the user pressed return on it.
  if (address.formatted && address.formatted.trim()) {
    return address.formatted
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  const cityLine = [address.city, address.state, address.postcode].filter((p) => p && p.trim()).join(' ');
  const country = (countryLabel ?? address.country ?? defaultCountry).trim();

  if (format === 'single_line') {
    const parts = [address.line1, address.line2, cityLine, includeCountry ? country : ''].filter(
      (p) => p && p.trim(),
    );
    return parts.length > 0 ? [parts.join(', ')] : [];
  }

  return [address.line1, address.line2, cityLine, includeCountry ? country : ''].filter((p) => p && p.trim());
}

/** Render an address as a single string, lines joined. */
export function formatAddress(
  address: Address | null | undefined,
  options: AddressFormatOptions = {},
): string {
  return formatAddressLines(address, options).join('\n');
}

/** Postcode and state on one line, the way Australia writes them. */
export function cityLine(address: Address): string {
  return [address.city, address.state, address.postcode].filter((p) => p && p.trim()).join(' ');
}

/** True when there is enough to print. */
export function hasAddress(address: Address | null | undefined): boolean {
  if (!address) return false;
  return Boolean(address.line1 || address.formatted || (address.city && address.state));
}

/** Split a free-text address a user pasted into fields, best effort. */
export function parseAddress(text: string): Address {
  const lines = String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { line1: '', line2: '', city: '', state: '', postcode: '', country: '', formatted: null };
  }

  if (lines.length === 1) {
    // One line: split on commas and hope for the best.
    const parts = lines[0].split(',').map((p) => p.trim());
    const address: Address = {
      line1: parts[0] ?? '',
      line2: parts[1] ?? '',
      city: '',
      state: '',
      postcode: '',
      country: parts[parts.length - 1] !== parts[0] ? (parts[parts.length - 1] ?? '') : '',
      formatted: null,
    };
    if (parts.length >= 3) {
      const cityPart = parts[parts.length - 2] ?? '';
      const [city, state, postcode] = cityPart.split(/\s+/);
      address.city = city ?? '';
      address.state = state ?? '';
      address.postcode = postcode ?? '';
    }
    return address;
  }

  const address: Address = {
    line1: lines[0] ?? '',
    line2: lines[1] ?? '',
    city: '',
    state: '',
    postcode: '',
    country: '',
    formatted: null,
  };

  const last = lines[lines.length - 1] ?? '';
  const penultimate = lines[lines.length - 2] ?? '';

  // "Sydney NSW 2000" in the second-to-last position.
  if (/^[A-Za-z .'-]+\s+[A-Z]{2,3}\s+\d{4}$/.test(penultimate)) {
    const [, city, state, postcode] = penultimate.match(/^(.+?)\s+([A-Z]{2,3})\s+(\d{4})$/) ?? [];
    address.city = (city ?? '').trim();
    address.state = state ?? '';
    address.postcode = postcode ?? '';
    address.country = last;
  } else {
    const [, city, state, postcode] = last.match(/^(.+?)\s+([A-Z]{2,3})\s+(\d{4})$/) ?? [];
    if (state) {
      address.city = (city ?? '').trim();
      address.state = state;
      address.postcode = postcode ?? '';
    } else {
      address.city = last;
    }
  }

  return address;
}
