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
    slug: 'launch-checker',
    name: 'Launch checker',
    blurb: 'Is your site ready to launch? Title, share preview, favicon, sitemap, 404 and more, with fixes.',
  },
  {
    slug: 'website-color-finder',
    name: 'Website color finder',
    blurb: 'Get any website’s color palette and CSS color variables, ready for CSS, Tailwind or your AI agent.',
  },
  {
    slug: 'design-md-generator',
    name: 'DESIGN.md generator',
    blurb: 'Turn any website into a DESIGN.md style guide, so your AI agent builds in the same colors, fonts and spacing.',
  },
  {
    slug: 'tech-stack-finder',
    name: 'Tech stack finder',
    blurb: 'See what any website is built with, where it’s hosted and which analytics it uses.',
  },
  {
    slug: 'app-icon-generator',
    name: 'App icon generator',
    blurb: 'Every iOS, Android and Expo app icon from one image, in one ZIP.',
  },
  {
    slug: 'contrast-checker',
    name: 'Color contrast checker',
    blurb: 'Is your text readable? WCAG AA and AAA pass or fail, plus the nearest color that passes.',
  },
  {
    slug: 'tailwind-color-generator',
    name: 'Tailwind color shades',
    blurb: 'Turn one brand color into an even 50–950 Tailwind scale, ready for v4, v3 or CSS.',
  },
  {
    slug: 'json-to-typescript',
    name: 'JSON to TypeScript',
    blurb: 'Paste JSON and get TypeScript types and a Zod schema, with optional fields found for you.',
  },
  {
    slug: 'api-key-leak-checker',
    name: 'API key leak checker',
    blurb: 'Did I leak an API key? Check your site’s JavaScript for OpenAI, Stripe, Supabase and other secret keys.',
  },
  {
    slug: 'sitemap-generator',
    name: 'Sitemap generator',
    blurb: 'A sitemap.xml and robots.txt for your site in seconds, plus the broken links we found.',
  },
  {
    slug: 'px-to-rem',
    name: 'px to rem converter',
    blurb: 'px to rem and back, live, with the matching Tailwind class and a ruler at real size.',
  },
];

// Same for guides.
export const GUIDES: Item[] = [];
