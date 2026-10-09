import { describe, expect, it } from 'vitest';
import { paymentQrPayload, paymentQrSrc } from '@/renderer/qr';
import { paymentDetailsSchema } from '@/core/schemas/common';

describe('payment QR payload', () => {
  it('prefers a payment link, then PayID, then BSB', () => {
    const base = paymentDetailsSchema.parse({
      methodLabel: 'Direct bank transfer',
      accountName: 'Acme',
      bsb: '062000',
      accountNumber: '12345678',
      paymentLink: 'https://pay.example',
      payId: 'acme@example',
    });
    expect(paymentQrPayload(base, 'INV-001')).toBe('https://pay.example');
    expect(paymentQrPayload({ ...base, paymentLink: '' }, 'INV-001')).toBe('payid:acme@example');
    expect(paymentQrPayload({ ...base, paymentLink: '', payId: '' }, 'INV-001')).toBe(
      'bsb:062000 account:12345678 ref:INV-001',
    );
  });

  it('is null when there is nothing worth scanning', () => {
    expect(paymentQrPayload(paymentDetailsSchema.parse({}), 'INV-001')).toBeNull();
  });
});

describe('payment QR src', () => {
  it('renders a PNG data URL for a PayID', async () => {
    const src = await paymentQrSrc({ ...paymentDetailsSchema.parse({}), payId: 'acme@example' }, 'INV-001');
    expect(src).toMatch(/^data:image\/png;base64,/);
  });
});
