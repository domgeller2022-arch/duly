/**
 * The single entry point for domain types and schema validation.
 *
 * Everything above this line is a schema; everything below is a convenience.
 * Importing types from here keeps the rest of the app from needing to know which
 * file a type happens to live in, and guarantees there is exactly one
 * definition of "a Duly document".
 */

export * from './common';
export * from './crm';
export * from './document';
export * from './template';
export * from './automation';
export * from './settings';

/** Everything the calculation engine needs, in one bundle. */
export interface DocumentBundle {
  document: import('./document').Document;
  lines: import('./document').DocumentLine[];
  payments: import('./document').Payment[];
  taxCodes: import('../tax/tax').TaxCode[];
}
