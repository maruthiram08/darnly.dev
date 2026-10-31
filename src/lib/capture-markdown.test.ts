import { describe, expect, it } from 'vitest';
import { captureMarkdown, headingFrom } from './capture-markdown';

const base = {
  id: '2026-11-01-0140-pay-now-should-open',
  note: 'Pay now should open the payment form',
  url: 'http://localhost:3000/checkout',
  title: 'Checkout | My shop',
  viewport: { width: 1440, height: 900 },
  browser: 'Chrome/156.0.0.0',
  capturedAt: new Date('2026-10-31T20:10:00Z'),
};

describe('captureMarkdown', () => {
  it('leads with the intent, then the element facts', () => {
    const md = captureMarkdown({
      ...base,
      element: {
        selector: 'button[data-testid="pay-now"]',
        tag: 'button',
        text: 'Pay now',
        html: '<button data-testid="pay-now">Pay now</button>',
        styles: { display: 'flex', opacity: '0.5', 'pointer-events': 'none' },
        rect: { x: 10, y: 20, width: 120, height: 40 },
      },
    });
    expect(md).toContain('# Pay now should open the payment form');
    expect(md).toContain('**Expected:** Pay now should open the payment form');
    expect(md).toContain('**Screenshot:** .darnly/inbox/2026-11-01-0140-pay-now-should-open.png');
    expect(md).toContain('- selector: `button[data-testid="pay-now"]`');
    expect(md).toContain('opacity: 0.5; pointer-events: none');
    expect(md).toContain('page_title: "Checkout | My shop"');
    expect(md).toContain('.darnly/done/');
    expect(md.indexOf('Expected')).toBeLessThan(md.indexOf('## Element'));
  });

  it('handles a whole-page capture with no note', () => {
    const md = captureMarkdown({ ...base, note: '' });
    expect(md).toContain('# Problem on this page');
    expect(md).toContain('(no note given)');
    expect(md).toContain('Whole visible page');
  });
});

describe('headingFrom', () => {
  it('cuts long notes at a word', () => {
    const h = headingFrom('When I click the big blue button at the bottom of the checkout page nothing happens at all');
    expect(h.length).toBeLessThanOrEqual(71);
    expect(h.endsWith('…')).toBe(true);
  });
});
