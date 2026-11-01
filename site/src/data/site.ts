// One place for links and the lists that the footer and hub pages read.
export const STORE_URL = 'https://chromewebstore.google.com/detail/gognoljafcabnmbbpfoeeamcflpbgidj';

// Chrome Web Store link tagged with the page it came from, so installs can be counted per page.
export const storeUrl = (source: string) => `${STORE_URL}?utm_source=${encodeURIComponent(source)}`;

export type Item = { slug: string; name: string; blurb: string };

// Add a tool here when its page ships; the footer and /tools/ list it automatically.
export const TOOLS: Item[] = [
  {
    slug: 'favicon-generator',
    name: 'Favicon generator',
    blurb: 'Every favicon size from one image, plus the HTML to paste.',
  },
];

// Same for guides.
export const GUIDES: Item[] = [];
