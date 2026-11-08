// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { isSensitiveField, selectorFor, trimmedHtml, visibleText } from './element-info';

beforeEach(() => {
  document.body.innerHTML = `
    <main id="app">
      <section class="checkout">
        <button data-testid="pay-now" class="btn btn-primary">Pay now</button>
        <ul class="items"><li>One</li><li>Two</li><li>Three</li></ul>
        <div class="card"><div class="inner"><div class="deep"><span>Very deep</span></div></div></div>
        <input type="password" name="pw" value="hunter2" />
        <a id="save-123456" class="sc-AxjAm">Save</a>
      </section>
    </main>`;
});

describe('selectorFor', () => {
  it('prefers a test id', () => {
    expect(selectorFor(document.querySelector('button')!)).toBe('button[data-testid="pay-now"]');
  });

  it('builds a short unique path with nth-of-type for repeated items', () => {
    const li = document.querySelectorAll('li')[1]!;
    const s = selectorFor(li);
    expect(document.querySelectorAll(s)).toHaveLength(1);
    expect(document.querySelector(s)).toBe(li);
    expect(s).toContain('nth-of-type(2)');
  });

  it('skips generated ids and class names', () => {
    const s = selectorFor(document.querySelector('a')!);
    expect(s).not.toContain('123456');
    expect(s).not.toContain('sc-AxjAm');
    expect(document.querySelector(s)).toBe(document.querySelector('a'));
  });

  it('uses a plain id when there is one', () => {
    expect(selectorFor(document.querySelector('main')!)).toBe('#app');
  });
});

describe('trimmedHtml', () => {
  it('keeps two levels and cuts deeper ones', () => {
    const html = trimmedHtml(document.querySelector('.card')!);
    expect(html).toContain('class="inner"');
    expect(html).not.toContain('Very deep');
  });

  it('hides password values', () => {
    const html = trimmedHtml(document.querySelector('section')!);
    expect(html).not.toContain('hunter2');
    expect(isSensitiveField(document.querySelector('input')!)).toBe(true);
  });
});

describe('visibleText', () => {
  it('squashes whitespace', () => {
    expect(visibleText(document.querySelector('ul')!)).toMatch(/^One\s?Two\s?Three$/);
  });
});

describe('deepestElementAt', () => {
  it('finds a child even when the browser hit test stops at its parent', async () => {
    const { deepestElementAt } = await import('./element-info');
    const parent = document.querySelector('section')!;
    const button = document.querySelector('button')!;
    const rect = (x: number, y: number, w: number, h: number) =>
      ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON() {} }) as DOMRect;
    for (const el of Array.from(parent.children)) el.getBoundingClientRect = () => rect(0, 500, 10, 10);
    button.getBoundingClientRect = () => rect(10, 10, 100, 40);
    const doc = { elementFromPoint: () => parent } as unknown as Document;
    expect(deepestElementAt(doc, 20, 20)).toBe(button);
  });
});

describe('failedRequestsFromHistory', () => {
  it('keeps only 4xx/5xx entries from the browser request history', async () => {
    const { failedRequestsFromHistory } = await import('./element-info');
    const win = {
      performance: {
        timeOrigin: 1000,
        getEntriesByType: () => [
          { name: 'https://x.com/ok.js', responseStatus: 200, responseEnd: 5, duration: 5, initiatorType: 'script' },
          { name: 'https://x.com/api/frames', responseStatus: 404, responseEnd: 10, duration: 8, initiatorType: 'fetch' },
          { name: 'https://cdn.other.com/a.png', responseStatus: 0, responseEnd: 12, duration: 3, initiatorType: 'img' },
        ],
      },
    } as unknown as Window;
    const out = failedRequestsFromHistory(win);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ url: 'https://x.com/api/frames', status: 404, fromHistory: true, t: 1010 });
  });
});

describe('slowRequestsFromHistory', () => {
  it('keeps slow data requests that worked, slowest first', async () => {
    const { slowRequestsFromHistory } = await import('./element-info');
    const win = {
      performance: {
        timeOrigin: 1000,
        getEntriesByType: () => [
          { name: 'https://x.com/api/fast', responseStatus: 200, responseEnd: 5, duration: 200, initiatorType: 'fetch' },
          { name: 'https://x.com/api/slow', responseStatus: 200, responseEnd: 3000, duration: 2500, initiatorType: 'fetch' },
          { name: 'https://x.com/api/slower', responseStatus: 200, responseEnd: 6000, duration: 5200, initiatorType: 'xmlhttprequest' },
          { name: 'https://x.com/api/failed', responseStatus: 422, responseEnd: 6000, duration: 5100, initiatorType: 'fetch' },
          { name: 'https://x.com/big.png', responseStatus: 200, responseEnd: 4000, duration: 4000, initiatorType: 'img' },
        ],
      },
    } as unknown as Window;
    const out = slowRequestsFromHistory(win);
    expect(out.map((e) => e.url)).toEqual(['https://x.com/api/slower', 'https://x.com/api/slow']);
    expect(out[0]).toMatchObject({ ms: 5200, status: 200, slow: true });
  });
});

describe('similarElements', () => {
  it('counts other elements with the same tag and classes', async () => {
    const { similarElements } = await import('./element-info');
    document.body.insertAdjacentHTML('beforeend', '<button class="btn btn-primary">A</button><button class="btn btn-primary">B</button>');
    expect(similarElements(document.querySelector('button')!)).toEqual({ selector: 'button.btn', count: 2 });
    expect(similarElements(document.querySelector('.card')!)).toBeUndefined(); // the only one
    expect(similarElements(document.querySelector('li')!)).toBeUndefined(); // no classes
  });
});
