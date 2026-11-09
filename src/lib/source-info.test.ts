// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { shortPath, sourceInfo } from './source-info';

const el = (html: string) => {
  document.body.innerHTML = html;
  return document.body.firstElementChild!;
};

describe('shortPath', () => {
  it('keeps the part from src/ or app/ on, without query strings', () => {
    expect(shortPath('/Users/me/shop/src/components/Card.tsx?t=123')).toBe('src/components/Card.tsx');
    expect(shortPath('webpack-internal:///(app-pages-browser)/./app/pricing/page.tsx')).toBe('app/pricing/page.tsx');
    expect(shortPath('/a/b/c/d/Card.vue')).toBe('c/d/Card.vue');
  });
});

describe('sourceInfo: React', () => {
  it('names each component with where its tag is written, so a shared Button names the card using it', () => {
    const button = el('<button>Buy</button>');
    (button as any)['__reactFiber$x'] = {
      type: 'button',
      _debugSource: { fileName: '/u/shop/src/ui/Button.tsx', lineNumber: 8 },
      return: {
        type: { name: 'Button' },
        _debugSource: { fileName: '/u/shop/src/components/PlanCard.tsx', lineNumber: 42 },
        return: {
          type: { name: 'PlanCard' },
          _debugSource: { fileName: '/u/shop/src/app/pricing/page.tsx', lineNumber: 30 },
          return: { type: { name: 'PricingPage' }, return: null },
        },
      },
    };
    const info = sourceInfo(button)!;
    expect(info.framework).toBe('react');
    expect(info.chain).toEqual(['PricingPage', 'PlanCard', 'Button']);
    expect(info.source).toBe('src/ui/Button.tsx:8');
    expect(info.parts).toEqual([
      { name: 'PricingPage' },
      { name: 'PlanCard', at: 'src/app/pricing/page.tsx:30' },
      { name: 'Button', at: 'src/components/PlanCard.tsx:42' },
    ]);
  });

  it('reads React 19 stacks and skips library frames', () => {
    const div = el('<div>Hi</div>');
    (div as any)['__reactFiber$y'] = {
      type: 'div',
      _debugStack: { stack: 'Error: react-stack-top-frame\n    at jsxDEV (http://localhost:5173/node_modules/.vite/deps/react.js:1:1)\n    at Hello (http://localhost:5173/src/Hello.tsx?t=1:7:12)' },
      return: { type: { name: 'Hello' }, return: null },
    };
    expect(sourceInfo(div)!.source).toBe('src/Hello.tsx:7');
  });
});

describe('sourceInfo: Vue', () => {
  it('walks Vue 3 instances and names each own file', () => {
    const b = el('<button>Buy</button>');
    (b as any).__vueParentComponent = {
      type: { __name: 'BuyButton', __file: '/u/app/src/components/BuyButton.vue' },
      parent: { type: { name: 'plan-card', __file: '/u/app/src/components/PlanCard.vue' }, parent: { type: {}, parent: null } },
    };
    const info = sourceInfo(b)!;
    expect(info.framework).toBe('vue');
    expect(info.chain).toEqual(['PlanCard', 'BuyButton']);
    expect(info.source).toBe('src/components/BuyButton.vue');
    expect(info.parts?.[0]).toEqual({ name: 'PlanCard', file: 'src/components/PlanCard.vue' });
  });

  it('reads Vue 2', () => {
    const b = el('<span>x</span>');
    (b as any).__vue__ = { $options: { name: 'Badge', __file: 'src/Badge.vue' }, $parent: null };
    expect(sourceInfo(b)!.chain).toEqual(['Badge']);
  });
});

describe('sourceInfo: Svelte', () => {
  it('uses the tag location and Svelte 5 component parents', () => {
    const b = el('<button>Buy</button>');
    (b as any).__svelte_meta = {
      loc: { file: 'src/lib/Button.svelte', line: 3 },
      parent: { type: 'component', componentTag: 'Button', file: 'src/lib/PlanCard.svelte', line: 12, parent: { type: 'component', componentTag: 'PlanCard', file: 'src/routes/+page.svelte', line: 5, parent: null } },
    };
    const info = sourceInfo(b)!;
    expect(info.framework).toBe('svelte');
    expect(info.source).toBe('src/lib/Button.svelte:3');
    expect(info.parts).toEqual([
      { name: 'PlanCard', file: 'src/lib/PlanCard.svelte', at: 'src/routes/+page.svelte:5' },
      { name: 'Button', file: 'src/lib/Button.svelte', at: 'src/lib/PlanCard.svelte:12' },
    ]);
  });
});

describe('sourceInfo: nothing to read', () => {
  it('is empty on a production build, and never throws on odd page values', () => {
    expect(sourceInfo(el('<p>plain</p>'))).toBeUndefined();
    const p = el('<p>odd</p>');
    Object.defineProperty(p, '__vueParentComponent', { get() { throw new Error('nope'); } });
    expect(sourceInfo(p)).toBeUndefined();
  });

  it('prefers a path a dev plugin wrote on the element', () => {
    const p = el('<div data-source-file="src/Card.tsx"><b>x</b></div>');
    expect(sourceInfo(p.firstElementChild!)!.source).toBe('src/Card.tsx');
  });
});
