// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { TOOLS, GUIDES } from './src/data/site.ts';

// Hubs stay out of the sitemap (and carry noindex) until they list something.
const hidden = [
  ...(TOOLS.length === 0 ? ['https://darnly.dev/tools/'] : []),
  ...(GUIDES.length === 0 ? ['https://darnly.dev/guides/'] : []),
];

export default defineConfig({
  site: 'https://darnly.dev',
  trailingSlash: 'ignore',
  // Point Vite at this folder's tsconfig so it doesn't pick up the extension's one at the repo root.
  vite: { tsconfig: './tsconfig.json' },
  integrations: [sitemap({ filter: (page) => !hidden.includes(page) })],
});
