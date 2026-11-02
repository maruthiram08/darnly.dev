// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { TOOLS, GUIDES } from './src/data/site.ts';

// Hubs stay out of the sitemap (and carry noindex) until they list something.
const hidden = [
  ...(TOOLS.length === 0 ? ['https://darnly.dev/tools/'] : []),
  ...(GUIDES.length === 0 ? ['https://darnly.dev/guides/'] : []),
];
const buildDate = new Date().toISOString();

export default defineConfig({
  site: 'https://darnly.dev',
  trailingSlash: 'ignore',
  // Put each page's CSS inside its HTML, so the first paint doesn't wait for separate stylesheet downloads.
  // The CSP already allows inline styles ('unsafe-inline' in style-src, public/_headers).
  build: { inlineStylesheets: 'always' },
  // Point Vite at this folder's tsconfig so it doesn't pick up the extension's one at the repo root.
  // assetsInlineLimit 0: never inline small scripts, because the site's CSP blocks inline scripts.
  vite: { tsconfig: './tsconfig.json', build: { assetsInlineLimit: 0 } },
  // lastmod is the build date: every deploy rebuilds every page.
  integrations: [
    sitemap({
      filter: (page) => !hidden.includes(page),
      serialize: (item) => ({ ...item, lastmod: buildDate }),
    }),
  ],
});
