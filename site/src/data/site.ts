// One place for links and the lists that the footer and hub pages read.
export const STORE_URL = 'https://chromewebstore.google.com/detail/gognoljafcabnmbbpfoeeamcflpbgidj';

// Chrome Web Store link tagged with the page it came from, so installs can be counted per page.
export const storeUrl = (source: string) => `${STORE_URL}?utm_source=${encodeURIComponent(source)}`;

// Tool groups on /tools/, in the footer and in "More free tools", in this order.
export const CATEGORIES = ['Design', 'Images', 'SEO & sharing', 'Launch & domains', 'Code helpers', 'Security'] as const;
export type Category = (typeof CATEGORIES)[number];

export type Item = { slug: string; name: string; blurb: string; category?: Category };

// A tool with no category shows under this heading.
export const OTHER_CATEGORY = 'More';

// The last few entries in TOOLS get a "New" badge on /tools/, so keep adding new tools at the end.
export const NEW_COUNT = 6;

// Tools grouped by category, in CATEGORIES order, with uncategorized tools last under "More".
export function toolsByCategory(tools: Item[] = TOOLS): { name: string; tools: Item[] }[] {
  const groups = CATEGORIES.map((name) => ({ name: name as string, tools: tools.filter((t) => t.category === name) }));
  groups.push({ name: OTHER_CATEGORY, tools: tools.filter((t) => !t.category || !CATEGORIES.includes(t.category)) });
  return groups.filter((g) => g.tools.length > 0);
}

// Add a tool here when its page ships, at the END of the list, with a category from CATEGORIES.
// The footer, /tools/ and "More free tools" pick it up automatically.
export const TOOLS: Item[] = [
  {
    slug: 'favicon-generator',
    category: 'Images',
    name: 'Favicon generator',
    blurb: 'Every favicon size from one image, plus the HTML to paste.',
  },
  {
    slug: 'open-graph-checker',
    category: 'SEO & sharing',
    name: 'Open Graph checker',
    blurb: 'See how your link looks on X, LinkedIn, WhatsApp and Slack, and what to fix.',
  },
  {
    slug: 'meta-tag-generator',
    category: 'SEO & sharing',
    name: 'Meta tag generator',
    blurb: 'SEO, Open Graph and X tags with a Google preview and length checks.',
  },
  {
    slug: 'font-finder',
    category: 'Design',
    name: 'Font finder',
    blurb: 'See what fonts any website uses, whether they’re free, and copy them into your project.',
  },
  {
    slug: 'color-palette-from-image',
    category: 'Design',
    name: 'Color palette from image',
    blurb: 'The main colors of any screenshot or logo, as hex, CSS and Tailwind.',
  },
  {
    slug: 'image-compressor',
    category: 'Images',
    name: 'Image compressor',
    blurb: 'Shrink images to WebP, JPG or PNG and see the size before and after.',
  },
  {
    slug: 'image-converter',
    category: 'Images',
    name: 'Image converter',
    blurb: 'WebP, AVIF, SVG, PNG or JPG to PNG, JPG or WebP, with resize. Nothing is uploaded.',
  },
  {
    slug: 'og-image-generator',
    category: 'SEO & sharing',
    name: 'OG image generator',
    blurb: 'A 1200×630 share image for link previews, plus the tags to paste.',
  },
  {
    slug: 'launch-checker',
    category: 'Launch & domains',
    name: 'Launch checker',
    blurb: 'Is your site ready to launch? Title, share preview, favicon, sitemap, 404 and more, with fixes.',
  },
  {
    slug: 'website-color-finder',
    category: 'Design',
    name: 'Website color finder',
    blurb: 'Get any website’s color palette and CSS color variables, ready for CSS, Tailwind or your AI agent.',
  },
  {
    slug: 'design-md-generator',
    category: 'Design',
    name: 'DESIGN.md generator',
    blurb: 'Turn any website into a DESIGN.md style guide, so your AI agent builds in the same colors, fonts and spacing.',
  },
  {
    slug: 'tech-stack-finder',
    category: 'Launch & domains',
    name: 'Tech stack finder',
    blurb: 'See what any website is built with, where it’s hosted and which analytics it uses.',
  },
  {
    slug: 'app-icon-generator',
    category: 'Images',
    name: 'App icon generator',
    blurb: 'Every iOS, Android and Expo app icon from one image, in one ZIP.',
  },
  {
    slug: 'contrast-checker',
    category: 'Design',
    name: 'Color contrast checker',
    blurb: 'Is your text readable? WCAG AA and AAA pass or fail, plus the nearest color that passes.',
  },
  {
    slug: 'tailwind-color-generator',
    category: 'Design',
    name: 'Tailwind color shades',
    blurb: 'Turn one brand color into an even 50–950 Tailwind scale, ready for v4, v3 or CSS.',
  },
  {
    slug: 'json-to-typescript',
    category: 'Code helpers',
    name: 'JSON to TypeScript',
    blurb: 'Paste JSON and get TypeScript types and a Zod schema, with optional fields found for you.',
  },
  {
    slug: 'api-key-leak-checker',
    category: 'Security',
    name: 'API key leak checker',
    blurb: 'Did I leak an API key? Check your site’s JavaScript for OpenAI, Stripe, Supabase and other secret keys.',
  },
  {
    slug: 'sitemap-generator',
    category: 'SEO & sharing',
    name: 'Sitemap generator',
    blurb: 'A sitemap.xml and robots.txt for your site in seconds, plus the broken links we found.',
  },
  {
    slug: 'px-to-rem',
    category: 'Code helpers',
    name: 'px to rem converter',
    blurb: 'px to rem and back, live, with the matching Tailwind class and a ruler at real size.',
  },
  {
    slug: 'css-gradient-generator',
    category: 'Design',
    name: 'CSS gradients and shadows',
    blurb: 'Make gradients with draggable colors and soft layered shadows, then copy CSS or Tailwind.',
  },
  {
    slug: 'privacy-policy-generator',
    category: 'Launch & domains',
    name: 'Privacy policy generator',
    blurb: 'A plain-English privacy policy and terms for your app, naming the services you use. Not legal advice.',
  },
  {
    slug: 'screenshot-beautifier',
    category: 'Images',
    name: 'Screenshot beautifier',
    blurb: 'Frame a screenshot in a browser or phone on a nice background, sized for X, LinkedIn or a story.',
  },
];

// Same for guides.
export const GUIDES: Item[] = [];
