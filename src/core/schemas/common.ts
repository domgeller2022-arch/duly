/**
 * Shared field definitions for every Duly entity.
 *
 * Every record carries a UUID, created/updated timestamps and a soft-delete
 * flag. The soft delete is what lets a future sync or merge be added without a
 * redesign: a deleted row is still there, just hidden.
 */

import { z } from 'zod';

export const uuid = z.string().min(1).max(64);

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD');

export const isoDateTime = z
  .string()
  .min(10)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Expected an ISO date-time');

/**
 * A decimal stored as a string so no binary floating point creeps into a stored
 * value.
 *
 * `MAX_DECIMALS` is the plan's limit of four decimal places on a quantity: 7.25 hours
 * and 1.2345 km are real, 1.234567 is a typo or a bad paste. Enforcing it here rather
 * than only documenting it means a hand-edited import cannot put a number in the
 * calculation engine that the editor could never have produced.
 */
export const MAX_DECIMALS = 4;

const DECIMAL_BODY = '(?:\\d+(?:\\.\\d{1,' + String(MAX_DECIMALS) + '})?)';

/** A decimal stored as a string, at most four decimal places. */
export const decimal = z
  .string()
  .regex(
    new RegExp(`^-?${DECIMAL_BODY}$`),
    `Expected a decimal number, at most ${MAX_DECIMALS} decimal places`,
  );

/** Non-negative decimal, at most four decimal places. */
export const positiveDecimal = z
  .string()
  .regex(
    new RegExp(`^${DECIMAL_BODY}$`),
    `Expected a positive decimal number, at most ${MAX_DECIMALS} decimal places`,
  );

/** A percentage written as a whole number: "10" means 10%. */
export const percentString = z.string().regex(/^-?\d+(\.\d+)?$/, 'Expected a percentage');

export const currencyCode = z
  .string()
  .length(3)
  .transform((s) => s.toUpperCase())
  .default('AUD');

export const emailAddress = z
  .string()
  .min(3)
  .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Expected an email address');

/** Optional string that turns `undefined` into `null` for storage consistency. */
export const nullableString = z.string().nullable().default(null);

export const currencyList = z.array(currencyCode).default(['AUD']);

/** Base mixin added to every stored entity. */
export const baseEntity = {
  id: uuid,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deletedAt: isoDateTime.nullable().default(null),
};

/** Fields every new record needs, filled in by `newEntity`. */
export interface EntityStamps {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: null;
}

/**
 * A UUID v4 for a new record, falling back to a hand-built v4 where
 * `crypto.randomUUID` is unavailable (older browsers, some test runners).
 */
export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();

  // Set the version (4) and variant bits so the result is a valid v4 UUID.
  const hex = Array.from({ length: 16 }, (_, i) => {
    if (i === 6) return ((Math.floor(Math.random() * 16) & 0x0f) | 0x40).toString(16);
    if (i === 8) return ((Math.floor(Math.random() * 16) & 0x3f) | 0x80).toString(16);
    return Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0');
  }).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Stamp a new record with an id and timestamps.
 *
 * Timestamps are deliberately *not* defaulted inside the schemas: a default that
 * reads the clock would silently invent a fresh `updatedAt` on every import and
 * every re-parse, which would make a JSON export re-import non-identical.
 */
export function newEntity<T extends Record<string, unknown>>(fields: T): T & EntityStamps {
  const now = new Date().toISOString();
  return { id: newId(), createdAt: now, updatedAt: now, deletedAt: null, ...fields } as T & EntityStamps;
}

/** Stamp a mutation, leaving the creation time untouched. */
export function touch<T extends { updatedAt: string }>(entity: T): T {
  entity.updatedAt = new Date().toISOString();
  return entity;
}

/** A structured postal address. Single-line rendering is a presentation choice. */
export const addressSchema = z.object({
  line1: z.string().default(''),
  line2: z.string().default(''),
  city: z.string().default(''),
  state: z.string().default(''),
  postcode: z.string().default(''),
  country: z.string().default(''),
  /** Pre-rendered override. When set, the address prints exactly as typed. */
  formatted: z.string().nullable().default(null),
});
export type Address = z.infer<typeof addressSchema>;

export const EMPTY_ADDRESS: Address = {
  line1: '',
  line2: '',
  city: '',
  state: '',
  postcode: '',
  country: '',
  formatted: null,
};

/** Bank / payment details block, printed near the bottom of every document. */
export const paymentDetailsSchema = z.object({
  methodLabel: z.string().default(''),
  accountName: z.string().default(''),
  bsb: z.string().default(''),
  accountNumber: z.string().default(''),
  payId: z.string().default(''),
  bpayBillerCode: z.string().default(''),
  bpayReference: z.string().default(''),
  other: z.string().default(''),
  /** A payment link from any provider the user already uses. */
  paymentLink: z.string().default(''),
});
export type PaymentDetails = z.infer<typeof paymentDetailsSchema>;

export const EMPTY_PAYMENT_DETAILS: PaymentDetails = {
  methodLabel: 'Direct bank transfer',
  accountName: '',
  bsb: '',
  accountNumber: '',
  payId: '',
  bpayBillerCode: '',
  bpayReference: '',
  other: '',
  paymentLink: '',
};

export const logoSchema = z.object({
  /** Data URL or a filesystem path, depending on the storage adapter. */
  src: z.string(),
  width: z.number().nullable().default(null),
  height: z.number().nullable().default(null),
  /** Height in millimetres as laid out on the page. */
  maxHeightMm: z.number().default(18),
  position: z.enum(['left', 'centre', 'right']).default('left'),
});
export type Logo = z.infer<typeof logoSchema>;

export const stampedSignatureSchema = z.object({
  kind: z.enum(['image', 'typed']),
  /** Image data URL, or the name to render in the script font. */
  value: z.string(),
  signedAt: isoDateTime.nullable().default(null),
});
export type StampedSignature = z.infer<typeof stampedSignatureSchema>;
