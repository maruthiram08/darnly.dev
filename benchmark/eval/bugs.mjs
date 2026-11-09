// 30 UI bugs for the "does a Darnly report help the agent fix the bug?" eval.
//
// Unlike the first benchmark (../bugs.mjs), each run's app has ONE bug: the eval builds a clean copy of
// ../app (all 10 original bugs fixed) and plants only the bug under test. So a bug on the orders page
// can be tested even though the original app's orders page is broken by another bug.
//
// Each bug has:
// - note:  a clear sentence, the way a careful user describes it.
// - short: the few words a hurried vibecoder actually types ("save button broken").
//   Both notes are used the same way in every condition, so the only difference between conditions
//   is what Darnly adds (or the screenshot adds).
// - plant: string swaps that turn the clean app into the buggy one ({ file, clean, buggy }).
// - path / setup / pick: how capture.mjs reproduces it and which element the "user" points at.
// - check: a browser test that passes only when the bug is fixed. Some also check the fix did not
//   change other places it shouldn't ("guard"), because "fixed the wrong thing" is a real failure.
// - kind: css, state, network, runtime-error, logic. Darnly should help most with css, errors and
//   network, least with logic, where the screen shows the symptom but the cause is elsewhere.
import { BUGS as ORIGINAL } from '../bugs.mjs';

const BLUE = 'rgb(37, 99, 235)';
const avg = (rgb) => {
  const [r, g, b] = rgb.match(/\d+/g).map(Number);
  return (r + g + b) / 3;
};
const setCart = (lines) => async (page) => {
  await page.evaluate((l) => localStorage.setItem('pebble-cart', JSON.stringify(l)), lines);
  await page.reload();
  await page.waitForLoadState('networkidle');
};
const goDark = async (page) => {
  await page.evaluate(() => localStorage.setItem('pebble-theme', 'dark'));
  await page.reload();
  await page.waitForLoadState('networkidle');
};

// The original 10 bugs: same notes and checks as the first benchmark, plus plants and short notes.
const ORIGINAL_EXTRA = {
  'b01-place-order': {
    short: 'place order button not working',
    plant: [{ file: 'src/styles/checkout.css', clean: '.btn.is-busy {', buggy: '.checkout-actions .btn,\n.btn.is-busy {' }],
  },
  'b02-cart-total': {
    short: 'cart total wrong',
    plant: [{ file: 'src/lib/money.ts', clean: 'sum + lineTotal(line), 0', buggy: 'sum + line.product.price, 0' }],
  },
  'b03-broken-images': {
    short: 'images broken',
    plant: [{ file: 'src/lib/format.ts', clean: '`/images/${productId}.svg`', buggy: '`/img/${productId}.svg`' }],
  },
  'b04-settings-save': {
    short: 'save not working',
    plant: [{ file: 'src/pages/SettingsPage.tsx', clean: '(data.displayName as string)', buggy: '(data.display_name as string)' }],
  },
  'b05-long-names': {
    short: 'long names overflow',
    plant: [{ file: 'src/styles/products.css', clean: 'font-size: 16px; overflow-wrap: anywhere; }', buggy: 'font-size: 16px; white-space: nowrap; }' }],
  },
  'b06-dark-mode': {
    short: 'dark mode broken',
    plant: [{ file: 'src/hooks/useTheme.ts', clean: 'document.documentElement.dataset.theme = theme', buggy: 'document.documentElement.dataset.mode = theme' }],
  },
  'b07-orders-empty': {
    short: 'orders not showing',
    plant: [{ file: 'src/hooks/useOrders.ts', clean: "getJson<Order[]>('/api/orders')", buggy: "getJson<Order[]>('/api/order')" }],
  },
  'b08-subscribe-colour': {
    short: 'subscribe button wrong colour',
    plant: [{ file: 'src/components/NewsletterForm.tsx', clean: '<Button type="submit" variant="primary">', buggy: '<Button type="submit" variant="secondary">' }],
  },
  'b09-modal-close': {
    short: 'popup wont close',
    plant: [{ file: 'src/components/Modal.tsx', clean: 'onClick={onClose}>', buggy: 'onClick={() => onClose}>' }],
  },
  'b10-search-case': {
    short: 'search not working',
    plant: [
      {
        file: 'src/hooks/useSearch.ts',
        clean: 'return p.name.toLowerCase().includes(q.toLowerCase()) || p.description.toLowerCase().includes(q.toLowerCase());',
        buggy: 'return p.name.includes(q) || p.description.includes(q);',
      },
    ],
  },
};

const NEW = [
  {
    id: 'b11-faq-tiny',
    kind: 'css',
    note: 'On the help page the answers under each question are tiny and hard to read.',
    short: 'text too small',
    path: '/help',
    plant: [{ file: 'src/styles/components.css', clean: '.faq dd { margin: 4px 0 0; color: var(--muted); }', buggy: '.faq dd { margin: 4px 0 0; color: var(--muted); font-size: 11px; }' }],
    pick: (page) => page.locator('.faq dd').first(),
    check: async (page, base) => {
      await page.goto(base + '/help');
      const size = await page.locator('.faq dd').first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
      if (size < 14) throw new Error(`answers are ${size}px`);
      const q = await page.locator('.faq dt').first().evaluate((e) => getComputedStyle(e).fontWeight);
      if (q !== '600') throw new Error(`guard: questions changed (font-weight ${q})`);
    },
  },
  {
    id: 'b12-contact-tab',
    kind: 'state',
    note: 'On the help page, clicking the Contact tab shows an empty space instead of the contact info.',
    short: 'contact tab empty',
    path: '/help',
    setup: async (page) => page.getByRole('tab', { name: 'Contact' }).click(),
    plant: [
      { file: 'src/pages/HelpPage.tsx', clean: '      ) : (\n        <div>\n          <p>We answer', buggy: "      ) : tab === 'contacts' ? (\n        <div>\n          <p>We answer" },
      { file: 'src/pages/HelpPage.tsx', clean: '        </div>\n      )}\n      <Modal', buggy: '        </div>\n      ) : null}\n      <Modal' },
    ],
    pick: (page) => page.getByRole('tab', { name: 'Contact' }),
    check: async (page, base) => {
      await page.goto(base + '/help');
      await page.getByRole('tab', { name: 'Contact' }).click();
      await page.getByText('We answer within one working day.').waitFor({ timeout: 3000 });
      await page.getByRole('tab', { name: 'Questions' }).click();
      await page.getByText('How long does shipping take?').waitFor({ timeout: 3000 });
    },
  },
  {
    id: 'b13-notifications-save',
    kind: 'network',
    note: 'Saving my notification settings on the settings page does nothing. No message, and it does not stick.',
    short: 'save not working',
    path: '/settings',
    setup: async (page) => {
      await page.getByRole('button', { name: 'Save' }).nth(1).click();
      await page.waitForTimeout(400);
    },
    plant: [
      { file: 'src/pages/SettingsPage.tsx', clean: "import { Button } from '../components/Button';", buggy: "import { Button } from '../components/Button';\nimport { postJson } from '../lib/api';" },
      {
        file: 'src/pages/SettingsPage.tsx',
        clean: "await save({ newsletter: data.get('newsletter') === 'on', orderUpdates: data.get('orderUpdates') === 'on' });",
        buggy: "await postJson('/api/settings/notifications', { newsletter: data.get('newsletter') === 'on', orderUpdates: data.get('orderUpdates') === 'on' });",
      },
    ],
    pick: (page) => page.getByRole('button', { name: 'Save' }).nth(1),
    check: async (page, base) => {
      await page.goto(base + '/settings');
      await page.getByLabel('Newsletter').uncheck();
      await page.getByRole('button', { name: 'Save' }).nth(1).click();
      await page.getByText('Notification settings saved').waitFor({ timeout: 3000 });
      await page.reload();
      await page.getByLabel('Newsletter').waitFor({ timeout: 3000 });
      if (await page.getByLabel('Newsletter').isChecked()) throw new Error('newsletter setting did not stick');
    },
  },
  {
    id: 'b14-order-dates',
    kind: 'logic',
    note: 'The dates on my orders page all say Invalid Date.',
    short: 'dates broken',
    path: '/orders',
    plant: [
      { file: 'mock-api.ts', clean: "date: '2026-10-02',", buggy: "date: '2026-10-02T09:15:00Z'," },
      { file: 'mock-api.ts', clean: "date: '2026-10-14',", buggy: "date: '2026-10-14T16:40:00Z'," },
      { file: 'mock-api.ts', clean: "date: '2026-10-27',", buggy: "date: '2026-10-27T11:05:00Z'," },
    ],
    pick: (page) => page.locator('.order-row td').nth(1),
    check: async (page, base) => {
      await page.goto(base + '/orders');
      await page.getByText('A-1057').waitFor({ timeout: 3000 });
      const text = await page.locator('table.orders').innerText();
      if (/Invalid/.test(text)) throw new Error('still Invalid Date');
      if (!/Oct 14, 2026/.test(text)) throw new Error('date for A-1057 is not Oct 14, 2026');
    },
  },
  {
    id: 'b15-cart-remove',
    kind: 'logic',
    note: 'On the cart page, clicking Remove on the mug removes the lamp instead and keeps the mug.',
    short: 'remove button removes wrong item',
    path: '/cart',
    setup: async (page) => {
      await setCart([{ id: 'p1', qty: 1 }, { id: 'p2', qty: 1 }, { id: 'p4', qty: 1 }])(page);
      await page.locator('.cart-item', { hasText: 'Ceramic Mug' }).getByRole('button', { name: 'Remove' }).click();
    },
    plant: [{ file: 'src/hooks/useCart.tsx', clean: 'prev.filter((l) => l.product.id !== productId)', buggy: 'prev.filter((l) => l.product.id === productId)' }],
    pick: (page) => page.locator('.cart-item').first(),
    check: async (page, base) => {
      await page.goto(base + '/');
      await setCart([{ id: 'p1', qty: 1 }, { id: 'p2', qty: 1 }, { id: 'p4', qty: 1 }])(page);
      await page.goto(base + '/cart');
      await page.locator('.cart-item', { hasText: 'Ceramic Mug' }).getByRole('button', { name: 'Remove' }).click();
      await page.waitForTimeout(200);
      const names = await page.locator('.cart-item__name').allInnerTexts();
      if (names.includes('Ceramic Mug')) throw new Error('mug still in cart');
      if (!names.includes('Desk Lamp') || !names.includes('Trail Water Bottle')) throw new Error(`other items gone: ${names.join(', ')}`);
    },
  },
  {
    id: 'b16-qty-minus',
    kind: 'state',
    note: 'On the cart page the minus button makes the quantity go up instead of down.',
    short: 'minus button wrong',
    path: '/cart',
    setup: async (page) => {
      await setCart([{ id: 'p2', qty: 3 }])(page);
      await page.getByRole('button', { name: 'Decrease quantity' }).click();
    },
    plant: [{ file: 'src/components/QuantityPicker.tsx', clean: 'aria-label="Decrease quantity" onClick={() => onChange(value - 1)}', buggy: 'aria-label="Decrease quantity" onClick={() => onChange(value + 1)}' }],
    pick: (page) => page.getByRole('button', { name: 'Decrease quantity' }),
    check: async (page, base) => {
      await page.goto(base + '/');
      await setCart([{ id: 'p2', qty: 3 }])(page);
      await page.goto(base + '/cart');
      await page.getByRole('button', { name: 'Decrease quantity' }).click();
      await page.locator('.qty span').getByText('2', { exact: true }).waitFor({ timeout: 3000 });
      await page.getByRole('button', { name: 'Increase quantity' }).click();
      await page.getByRole('button', { name: 'Increase quantity' }).click();
      await page.locator('.qty span').getByText('4', { exact: true }).waitFor({ timeout: 3000 });
    },
  },
  {
    id: 'b17-hero-button',
    kind: 'css',
    note: 'The "Browse the shop" button on the home page looks washed out. It should be a solid blue button like the others.',
    short: 'button looks wrong',
    path: '/',
    plant: [{ file: 'src/pages/HomePage.tsx', clean: '<Link href="/products" className="btn btn-primary btn-md">', buggy: '<Link href="/products" className="btn btn-ghost btn-md">' }],
    pick: (page) => page.getByRole('link', { name: 'Browse the shop' }),
    check: async (page, base) => {
      await page.goto(base + '/');
      const bg = await page.getByRole('link', { name: 'Browse the shop' }).evaluate((e) => getComputedStyle(e).backgroundColor);
      if (bg !== BLUE) throw new Error(`hero button is ${bg}`);
      await setCart([{ id: 'p2', qty: 1 }])(page);
      await page.goto(base + '/cart');
      const ghost = await page.getByRole('button', { name: 'Remove' }).evaluate((e) => getComputedStyle(e).backgroundColor);
      if (ghost !== 'rgba(0, 0, 0, 0)') throw new Error(`guard: ghost buttons changed too (Remove is ${ghost})`);
    },
  },
  {
    id: 'b18-nav-active',
    kind: 'css',
    note: "The menu at the top doesn't show which page I'm on. The current page should be bold and darker.",
    short: 'menu not highlighting',
    path: '/orders',
    plant: [{ file: 'src/styles/base.css', clean: '.site-nav a.active {', buggy: '.site-nav a:active {' }],
    pick: (page) => page.locator('.site-nav a', { hasText: 'Orders' }),
    check: async (page, base) => {
      await page.goto(base + '/orders');
      const w = await page.locator('.site-nav a', { hasText: 'Orders' }).evaluate((e) => getComputedStyle(e).fontWeight);
      if (Number(w) < 600) throw new Error(`current page link weight ${w}`);
      const other = await page.locator('.site-nav a', { hasText: 'Help' }).evaluate((e) => getComputedStyle(e).fontWeight);
      if (Number(other) >= 600) throw new Error('guard: other links are bold too');
    },
  },
  {
    id: 'b19-stars',
    kind: 'logic',
    note: 'Some product ratings on the shop page show only 4 stars in total instead of 5.',
    short: 'stars wrong',
    path: '/products',
    plant: [{ file: 'src/lib/format.ts', clean: "'★'.repeat(Math.round(rating))", buggy: "'★'.repeat(Math.floor(rating))" }],
    pick: (page) => page.locator('.product-card', { hasText: 'Desk Lamp' }).locator('.rating'),
    check: async (page, base) => {
      await page.goto(base + '/products');
      await page.locator('.product-card').nth(7).waitFor({ timeout: 3000 });
      const ratings = await page.locator('.product-card .rating').allInnerTexts();
      const bad = ratings.filter((r) => [...r].length !== 5);
      if (bad.length) throw new Error(`${bad.length} ratings don't have 5 stars`);
      const lamp = await page.locator('.product-card', { hasText: 'Desk Lamp' }).locator('.rating').innerText();
      if (lamp !== '★★★★★') throw new Error(`Desk Lamp (4.6) shows ${lamp}`);
    },
  },
  {
    id: 'b20-dark-header',
    kind: 'css',
    note: 'In dark mode the bar at the top stays light grey. Everything else goes dark.',
    short: 'header wrong in dark mode',
    path: '/',
    setup: goDark,
    plant: [{ file: 'src/styles/base.css', clean: 'border-bottom: 1px solid var(--border); background: var(--surface);', buggy: 'border-bottom: 1px solid var(--border); background: #f6f7f9;' }],
    pick: (page) => page.locator('.site-header'),
    check: async (page, base) => {
      await page.goto(base + '/');
      await goDark(page);
      const bg = await page.locator('.site-header').evaluate((e) => getComputedStyle(e).backgroundColor);
      if (avg(bg) > 80) throw new Error(`header is ${bg} in dark mode`);
      await page.evaluate(() => localStorage.setItem('pebble-theme', 'light'));
      await page.reload();
      const light = await page.locator('.site-header').evaluate((e) => getComputedStyle(e).backgroundColor);
      if (avg(light) < 200) throw new Error(`guard: header is ${light} in light mode`);
    },
  },
  {
    id: 'b21-newsletter',
    kind: 'network',
    note: 'Subscribing to the newsletter at the bottom of the page does nothing. No confirmation.',
    short: 'subscribe not working',
    path: '/',
    setup: async (page) => {
      await page.getByPlaceholder('you@example.com').fill('sam@example.com');
      await page.getByRole('button', { name: 'Subscribe' }).click();
      await page.waitForTimeout(400);
    },
    plant: [{ file: 'src/components/NewsletterForm.tsx', clean: "postJson('/api/newsletter', { email })", buggy: "postJson('/api/subscribe', { email })" }],
    pick: (page) => page.getByRole('button', { name: 'Subscribe' }),
    check: async (page, base) => {
      await page.goto(base + '/');
      await page.getByPlaceholder('you@example.com').fill('sam@example.com');
      await page.getByRole('button', { name: 'Subscribe' }).click();
      await page.getByText('You are on the list.').waitFor({ timeout: 3000 });
    },
  },
  {
    id: 'b22-cart-count',
    kind: 'logic',
    note: 'The cart count in the top bar says 1 even though I have 3 mugs in my cart.',
    short: 'cart count wrong',
    path: '/cart',
    setup: setCart([{ id: 'p2', qty: 3 }]),
    plant: [{ file: 'src/hooks/useCart.tsx', clean: 'count: lines.reduce((n, l) => n + l.qty, 0),', buggy: 'count: lines.length,' }],
    pick: (page) => page.locator('.cart-link'),
    check: async (page, base) => {
      await page.goto(base + '/');
      await setCart([{ id: 'p2', qty: 3 }, { id: 'p1', qty: 1 }])(page);
      await page.locator('.cart-link').getByText('Cart (4)').waitFor({ timeout: 3000 });
    },
  },
  {
    id: 'b23-size-pick',
    kind: 'state',
    note: "On the blanket page, clicking a size doesn't select it.",
    short: "can't pick size",
    path: '/products/p3',
    setup: async (page) => page.getByRole('button', { name: 'M', exact: true }).click(),
    plant: [{ file: 'src/pages/ProductPage.tsx', clean: 'onClick={() => setSize(s)}', buggy: 'onClick={() => setSize(size)}' }],
    pick: (page) => page.getByRole('button', { name: 'M', exact: true }),
    check: async (page, base) => {
      await page.goto(base + '/products/p3');
      await page.getByRole('button', { name: 'M', exact: true }).click();
      const cls = await page.getByRole('button', { name: 'M', exact: true }).getAttribute('class');
      if (!/active/.test(cls ?? '')) throw new Error('M is not selected');
      await page.getByRole('button', { name: 'L', exact: true }).click();
      const m = await page.getByRole('button', { name: 'M', exact: true }).getAttribute('class');
      if (/active/.test(m ?? '')) throw new Error('M still selected after picking L');
    },
  },
  {
    id: 'b24-checkout-inputs',
    kind: 'css',
    note: 'The text in the boxes on the checkout page is cut off at the bottom.',
    short: 'inputs cut off',
    path: '/checkout',
    plant: [{ file: 'src/styles/checkout.css', clean: '.checkout-form input, .checkout-form select { padding: 10px 12px;', buggy: '.checkout-form input, .checkout-form select { height: 26px; padding: 10px 12px;' }],
    pick: (page) => page.locator('.checkout-form input[name=address]'),
    check: async (page, base) => {
      await page.goto(base + '/checkout');
      const h = await page.locator('.checkout-form input[name=address]').evaluate((e) => e.getBoundingClientRect().height);
      if (h < 36) throw new Error(`input is ${h}px tall`);
    },
  },
  {
    id: 'b25-shipped-badge',
    kind: 'css',
    note: 'On the orders page the "shipped" label is grey. It should be blue.',
    short: 'label wrong colour',
    path: '/orders',
    plant: [{ file: 'src/components/OrderRow.tsx', clean: "order.status === 'shipped' ? 'blue'", buggy: "order.status === 'shiped' ? 'blue'" }],
    pick: (page) => page.locator('.badge', { hasText: 'shipped' }),
    check: async (page, base) => {
      await page.goto(base + '/orders');
      await page.getByText('A-1057').waitFor({ timeout: 3000 });
      const bg = await page.locator('.badge', { hasText: 'shipped' }).evaluate((e) => getComputedStyle(e).backgroundColor);
      if (bg !== 'rgb(219, 234, 254)') throw new Error(`shipped badge is ${bg}`);
      const p = await page.locator('.badge', { hasText: 'processing' }).evaluate((e) => getComputedStyle(e).backgroundColor);
      if (p === 'rgb(219, 234, 254)') throw new Error('guard: processing badge turned blue too');
    },
  },
  {
    id: 'b26-footer-links',
    kind: 'css',
    note: 'The links at the very bottom of the page are squashed together with no space between them.',
    short: 'links squashed',
    path: '/',
    plant: [{ file: 'src/styles/base.css', clean: '.site-footer__links { display: flex; gap: 18px;', buggy: '.site-footer__links { display: flex; gap: 0;' }],
    pick: (page) => page.locator('.site-footer__links'),
    check: async (page, base) => {
      await page.goto(base + '/');
      const gaps = await page.locator('.site-footer__links > *').evaluateAll((els) => {
        const r = els.map((e) => e.getBoundingClientRect());
        return r.slice(1).map((b, i) => b.left - r[i].right);
      });
      if (gaps.some((g) => g < 8)) throw new Error(`gaps ${gaps.map((g) => g.toFixed(0)).join(', ')}px`);
    },
  },
  {
    id: 'b27-free-shipping',
    kind: 'logic',
    note: 'My cart is exactly $50 and it still charges $5 shipping. Shipping should be free from $50.',
    short: 'shipping wrong',
    path: '/cart',
    setup: setCart([{ id: 'p4', qty: 1 }, { id: 'p6', qty: 1 }]),
    plant: [{ file: 'src/lib/money.ts', clean: 'subtotal >= FREE_SHIPPING_FROM', buggy: 'subtotal > FREE_SHIPPING_FROM' }],
    pick: (page) => page.locator('.cart-summary'),
    check: async (page, base) => {
      await page.goto(base + '/');
      await setCart([{ id: 'p4', qty: 1 }, { id: 'p6', qty: 1 }])(page);
      await page.goto(base + '/cart');
      await page.getByTestId('total').getByText('$50.00').waitFor({ timeout: 3000 });
      await setCart([{ id: 'p2', qty: 1 }])(page);
      await page.getByTestId('total').getByText('$17.00').waitFor({ timeout: 3000 });
    },
  },
  {
    id: 'b28-escape-key',
    kind: 'state',
    note: "Pressing Escape doesn't close the size guide popup on the blanket page.",
    short: "escape doesn't close popup",
    path: '/products/p3',
    setup: async (page) => {
      await page.getByRole('button', { name: 'Size guide' }).click();
      await page.keyboard.press('Escape');
    },
    plant: [{ file: 'src/components/Modal.tsx', clean: "e.key === 'Escape' && onClose()", buggy: "e.key === 'Esc' && onClose()" }],
    pick: (page) => page.getByRole('dialog'),
    check: async (page, base) => {
      await page.goto(base + '/products/p3');
      await page.getByRole('button', { name: 'Size guide' }).click();
      await page.getByRole('dialog').waitFor({ timeout: 3000 });
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 3000 });
    },
  },
  {
    id: 'b29-back-to-cart',
    kind: 'logic',
    note: 'On the checkout page, "Back to cart" takes me to a "Page not found" page.',
    short: 'back link broken',
    path: '/checkout',
    plant: [{ file: 'src/pages/CheckoutPage.tsx', clean: '<Link href="/cart">Back to cart</Link>', buggy: '<Link href="/basket">Back to cart</Link>' }],
    pick: (page) => page.getByRole('link', { name: 'Back to cart' }),
    check: async (page, base) => {
      await page.goto(base + '/checkout');
      await page.getByRole('link', { name: 'Back to cart' }).click();
      await page.getByRole('heading', { name: 'Your cart' }).waitFor({ timeout: 3000 });
    },
  },
  {
    id: 'b30-dark-search',
    kind: 'css',
    note: 'In dark mode the search box on the shop page is bright white.',
    short: 'search box white in dark mode',
    path: '/products',
    setup: goDark,
    plant: [{ file: 'src/styles/products.css', clean: 'font: inherit; background: var(--bg); color: var(--text); }\n.search-bar select', buggy: 'font: inherit; background: #fff; color: var(--text); }\n.search-bar select' }],
    pick: (page) => page.getByLabel('Search products'),
    check: async (page, base) => {
      await page.goto(base + '/products');
      await goDark(page);
      const bg = await page.getByLabel('Search products').evaluate((e) => getComputedStyle(e).backgroundColor);
      if (avg(bg) > 80) throw new Error(`search box is ${bg} in dark mode`);
    },
  },
];

export const BUGS = [...ORIGINAL.map((b) => ({ ...b, ...ORIGINAL_EXTRA[b.id] })), ...NEW];

// The 10 original bugs are planted in ../app. The clean app = ../app with each of those swapped back.
export const ORIGINAL_IDS = ORIGINAL.map((b) => b.id);
