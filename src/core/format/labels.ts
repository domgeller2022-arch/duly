/**
 * Shared label tables.
 *
 * Kept separate from the renderer so the UI, the PDF and the exports all read the
 * same strings — a payment method called "Bank transfer" in the app must not print
 * as "Bank Transfer" on the invoice.
 */

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  bank_transfer: 'Bank transfer',
  card: 'Card',
  cash: 'Cash',
  cheque: 'Cheque',
  paypal: 'PayPal',
  other: 'Other',
  credit_note: 'Credit note',
  deposit: 'Deposit',
};

/** The ATO's statement, permitted only at exactly one eleventh. */
export const INCLUSIVE_GST_STATEMENT = 'Total price includes GST';

/** For a business that is not registered for GST. */
export const NO_GST_STATEMENT = 'No GST has been charged';

/** Document type names as they print and as they appear in lists. */
export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  invoice: 'Invoice',
  quote: 'Quote',
  credit_note: 'Credit Note',
  proforma: 'Pro-forma Invoice',
  delivery_note: 'Delivery Note',
  payment_receipt: 'Payment Receipt',
};
