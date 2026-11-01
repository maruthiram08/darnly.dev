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
  {
    slug: 'open-graph-checker',
    name: 'Open Graph checker',
    blurb: 'See how your link looks on X, LinkedIn, WhatsApp and Slack, and what to fix.',
  },
  {
    slug: 'meta-tag-generator',
    name: 'Meta tag generator',
    blurb: 'SEO, Open Graph and X tags with a Google preview and length checks.',
  },
  {
    slug: 'font-finder',
    name: 'Font finder',
    blurb: 'See what fonts any website uses, whether they’re free, and copy them into your project.',
  },
  {
    slug: 'color-palette-from-image',
    name: 'Color palette from image',
    blurb: 'The main colors of any screenshot or logo, as hex, CSS and Tailwind.',
  },
  {
    slug: 'image-compressor',
    name: 'Image compressor',
    blurb: 'Shrink images to WebP, JPG or PNG and see the size before and after.',
  },
  {
    slug: 'image-converter',
    name: 'Image converter',
    blurb: 'WebP, AVIF, SVG, PNG or JPG to PNG, JPG or WebP, with resize. Nothing is uploaded.',
  },
  {
    slug: 'og-image-generator',
    name: 'OG image generator',
    blurb: 'A 1200×630 share image for link previews, plus the tags to paste.',
  },
  {
    slug: 'ai-slop-checker',
    name: 'AI slop checker',
    blurb: 'Does your site look AI-made? Get a score, the tells that give it away, and a prompt to fix them.',
  },
];

// Same for guides.
export const GUIDES: Item[] = [];
