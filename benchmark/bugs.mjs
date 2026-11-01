// The 10 planted bugs in app/. Each has:
// - note: what the user types. The SAME words are used for the plain prompt and the Darnly note,
//   so the only difference between the two runs is the extra context Darnly adds.
// - path, setup, pick: how capture-reports.mjs reproduces the bug and which element it clicks.
// - check: a Playwright test that passes only when the bug is fixed (run against the agent's copy).
// - kind: what sort of bug, so results can be split (Darnly should help less with logic bugs).

const PRIMARY_BLUE = 'rgb(37, 99, 235)';

export const BUGS = [
  {
    id: 'b01-place-order',
    kind: 'css',
    note: 'The Place order button on checkout looks faded and nothing happens when I click it.',
    path: '/checkout',
    pick: (page) => page.getByRole('button', { name: /Place order/ }),
    check: async (page, base) => {
      await page.goto(base + '/checkout');
      await page.getByRole('button', { name: /Place order/ }).click({ timeout: 3000 });
      await page.getByText(/Your order A-1071 is placed/).waitFor({ timeout: 3000 });
    },
  },
  {
    id: 'b02-cart-total',
    kind: 'logic',
    note: "On the cart page the subtotal and total don't go up when I add more of the same item.",
    path: '/cart',
    setup: async (page) => {
      await page.getByRole('button', { name: 'Increase quantity' }).click();
      await page.getByRole('button', { name: 'Increase quantity' }).click();
    },
    pick: (page) => page.locator('.cart-summary'),
    check: async (page, base) => {
      await page.goto(base + '/cart');
      await page.getByRole('button', { name: 'Increase quantity' }).click();
      await page.getByRole('button', { name: 'Increase quantity' }).click();
      await page.getByTestId('subtotal').getByText('$36.00').waitFor({ timeout: 3000 });
      await page.getByTestId('total').getByText('$41.00').waitFor({ timeout: 3000 });
    },
  },
  {
    id: 'b03-broken-images',
    kind: 'network',
    note: 'Product pictures are broken on the shop page.',
    path: '/products',
    pick: (page) => page.locator('.product-card__image img').first(),
    check: async (page, base) => {
      await page.goto(base + '/products');
      await page.locator('.product-card img').first().waitFor({ timeout: 3000 });
      await page.waitForTimeout(800);
      const broken = await page.$$eval('.product-card img', (imgs) => imgs.filter((i) => !i.complete || i.naturalWidth === 0).length);
      if (broken) throw new Error(`${broken} images still broken`);
    },
  },
  {
    id: 'b04-settings-save',
    kind: 'runtime-error',
    note: 'Clicking Save on the settings page does nothing.',
    path: '/settings',
    setup: async (page) => {
      await page.getByRole('button', { name: 'Save' }).first().click();
      await page.waitForTimeout(300);
    },
    pick: (page) => page.getByRole('button', { name: 'Save' }).first(),
    check: async (page, base) => {
      await page.goto(base + '/settings');
      await page.getByLabel('Display name').fill('Sam R');
      await page.getByRole('button', { name: 'Save' }).first().click();
      await page.getByText('Settings saved', { exact: true }).waitFor({ timeout: 3000 });
    },
  },
  {
    id: 'b05-long-names',
    kind: 'css',
    note: 'Long product names spill out of the card on the shop page.',
    path: '/products',
    pick: (page) => page.locator('.product-card__title', { hasText: 'Leather Notebook' }),
    check: async (page, base) => {
      await page.goto(base + '/products');
      await page.locator('.product-card').nth(4).waitFor({ timeout: 3000 });
      const bad = await page.$$eval('.product-card', (cards) =>
        cards.filter((card) => {
          const t = card.querySelector('h3, .product-card__title');
          if (!t) return false;
          const c = card.getBoundingClientRect();
          const r = t.getBoundingClientRect();
          const clipped = getComputedStyle(t).overflowX !== 'visible';
          const spills = r.right > c.right + 1 || (t.scrollWidth > t.clientWidth + 1 && !clipped);
          return spills;
        }).length,
      );
      if (bad) throw new Error(`${bad} titles still spill out`);
    },
  },
  {
    id: 'b06-dark-mode',
    kind: 'state',
    note: "The dark mode switch in the header doesn't change anything.",
    path: '/',
    setup: async (page) => {
      await page.getByText('Dark mode').click();
    },
    pick: (page) => page.locator('.theme-toggle'),
    check: async (page, base) => {
      await page.goto(base + '/');
      await page.evaluate(() => localStorage.removeItem('pebble-theme'));
      await page.reload();
      await page.getByText('Dark mode').click();
      await page.waitForTimeout(400);
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const [r, g, b] = bg.match(/\d+/g).map(Number);
      if ((r + g + b) / 3 > 80) throw new Error(`background still light: ${bg}`);
    },
  },
  {
    id: 'b07-orders-empty',
    kind: 'network',
    note: 'My orders page says I have no orders, but I have placed orders.',
    path: '/orders',
    pick: (page) => page.locator('.empty-state'),
    check: async (page, base) => {
      await page.goto(base + '/orders');
      await page.getByText('A-1057').waitFor({ timeout: 3000 });
      const rows = await page.locator('table tbody tr').count();
      if (rows !== 3) throw new Error(`expected 3 orders, saw ${rows}`);
    },
  },
  {
    id: 'b08-subscribe-colour',
    kind: 'css',
    note: 'The Subscribe button in the footer is grey. It should be blue like the other main buttons.',
    path: '/',
    pick: (page) => page.getByRole('button', { name: 'Subscribe' }),
    check: async (page, base) => {
      await page.goto(base + '/');
      const bg = await page.getByRole('button', { name: 'Subscribe' }).evaluate((b) => getComputedStyle(b).backgroundColor);
      if (bg !== PRIMARY_BLUE) throw new Error(`Subscribe is ${bg}, expected ${PRIMARY_BLUE}`);
    },
  },
  {
    id: 'b09-modal-close',
    kind: 'state',
    note: "On the blanket page, the X on the size guide popup doesn't close it.",
    path: '/products/p3',
    setup: async (page) => {
      await page.getByRole('button', { name: 'Size guide' }).click();
    },
    pick: (page) => page.getByRole('button', { name: 'Close' }),
    check: async (page, base) => {
      await page.goto(base + '/products/p3');
      await page.getByRole('button', { name: 'Size guide' }).click();
      await page.getByRole('dialog').waitFor({ timeout: 3000 });
      await page.getByRole('button', { name: 'Close' }).click();
      await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 3000 });
    },
  },
  {
    id: 'b10-search-case',
    kind: 'logic',
    note: 'Searching for "lamp" in the shop finds nothing, but we sell a Desk Lamp.',
    path: '/products',
    setup: async (page) => {
      await page.getByLabel('Search products').fill('lamp');
      await page.waitForTimeout(200);
    },
    pick: (page) => page.locator('.empty-state'),
    check: async (page, base) => {
      await page.goto(base + '/products');
      await page.locator('.product-card').first().waitFor({ timeout: 3000 });
      await page.getByLabel('Search products').fill('lamp');
      await page.locator('.product-card', { hasText: 'Desk Lamp' }).waitFor({ timeout: 3000 });
      await page.getByLabel('Search products').fill('Lamp');
      await page.locator('.product-card', { hasText: 'Desk Lamp' }).waitFor({ timeout: 3000 });
    },
  },
];
