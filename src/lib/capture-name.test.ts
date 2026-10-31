import { describe, expect, it } from 'vitest';
import { captureId } from './capture-name';

describe('captureId', () => {
  const when = new Date(2026, 10, 5, 14, 2);

  it('joins date, time and a short slug', () => {
    expect(captureId(when, 'Checkout button')).toBe('2026-11-05-1402-checkout-button');
  });

  it('strips symbols and keeps at most five words', () => {
    expect(captureId(when, '  "Pay now" does NOTHING on the checkout page!! ')).toBe(
      '2026-11-05-1402-pay-now-does-nothing-on',
    );
  });

  it('falls back when the label is empty', () => {
    expect(captureId(when, '!!!')).toBe('2026-11-05-1402-capture');
  });
});
