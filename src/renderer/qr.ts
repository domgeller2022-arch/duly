/**
 * Payment QR helpers.
 *
 * The ATO does not define a single consumer QR format for PayID, so what we
 * encode is the useful part of the payment details: PayID, payment link,
 * or BSB/account/reference. It is a machine-readable hint for the customer,
 * not a regulated reference number.
 */

import QRCode from 'qrcode';
import type { PaymentDetails } from '@/core/schemas/common';

/** The string we encode, or null when the business has no usable payment details. */
export function paymentQrPayload(
  payment: PaymentDetails | null | undefined,
  documentNumber: string,
): string | null {
  if (!payment) return null;
  if (payment.paymentLink) return payment.paymentLink;
  if (payment.payId) return `payid:${payment.payId}`;
  if (payment.bsb && payment.accountNumber) {
    return `bsb:${payment.bsb} account:${payment.accountNumber} ref:${documentNumber}`;
  }
  return null;
}

/** A PNG data URL suitable for react-pdf's `<Image src=...>`, or null. */
export async function paymentQrSrc(
  payment: PaymentDetails | null | undefined,
  documentNumber: string,
): Promise<string | null> {
  const payload = paymentQrPayload(payment, documentNumber);
  if (!payload) return null;
  return QRCode.toDataURL(payload, { width: 128, margin: 1 });
}
