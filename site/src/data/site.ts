// One place for links and the lists that the footer and hub pages read.
export const STORE_URL = 'https://chromewebstore.google.com/detail/darnly/gognoljafcabnmbbpfoeeamcflpbgidj';

// Chrome Web Store link tagged with the page it came from, so installs can be counted per page.
/** The signed, notarized Mac app: the newest GitHub release's Darnly.dmg (see mac/README.md, Share it). */
export const MAC_DMG_URL = 'https://github.com/maruthiram08/darnly.dev/releases/latest/download/Darnly.dmg';

export const storeUrl = (source: string) => `${STORE_URL}?utm_source=${encodeURIComponent(source)}`;

// Tool groups on /tools/, in the footer and in "More free tools", in this order.
export const CATEGORIES = ['Design', 'Images', 'SEO & sharing', 'Launch & domains', 'Code helpers', 'Security'] as const;
export type Category = (typeof CATEGORIES)[number];

// Each category's own page at /tools/<slug>/. Keep these clear of tool slugs.
export const CATEGORY_SLUGS: Record<Category, string> = {
  Design: 'design',
  Images: 'images',
  'SEO & sharing': 'seo',
  'Launch & domains': 'launch',
  'Code helpers': 'code',
  Security: 'security',
};

// Link to a category's page, or undefined for a heading with no page (like "More").
export const categoryHref = (name: string): string | undefined => {
  const slug = CATEGORY_SLUGS[name as Category];
  return slug ? `/tools/${slug}/` : undefined;
};

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
    slug: 'social-image-resizer',
    category: 'Images',
    name: 'Social image resizer',
    blurb: 'One picture, every size: X header, LinkedIn banner, Instagram, YouTube thumbnail. Drag to crop.',
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
    slug: 'asset-extractor',
    category: 'Images',
    name: 'Asset extractor',
    blurb: 'Every image, SVG and icon on a website, with sizes. Download one or all as a ZIP.',
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
    slug: 'diff-checker',
    category: 'Code helpers',
    name: 'Diff checker',
    blurb: 'Compare two texts side by side and see every added, removed and changed word. Nothing is uploaded.',
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
  {
    slug: 'fake-data-generator',
    category: 'Code helpers',
    name: 'Fake data generator',
    blurb: 'Realistic users, products, orders or posts as JSON, CSV, SQL or a TypeScript seed file.',
  },
  {
    slug: 'logo-maker',
    category: 'Design',
    name: 'Logo maker',
    blurb: 'A simple logo from your project’s name, an icon, a font and colors. SVG, PNG, app icon and favicons.',
  },
  {
    slug: 'cookie-banner-generator',
    category: 'Launch & domains',
    name: 'Cookie banner generator',
    blurb: 'Design a cookie consent banner live and copy a tiny snippet that holds back analytics until people agree.',
  },
  {
    slug: 'hex-to-tailwind',
    category: 'Design',
    name: 'Hex to Tailwind',
    blurb: 'Paste any color and see the nearest Tailwind colors side by side, then copy the class.',
  },
  {
    slug: 'jwt-decoder',
    category: 'Security',
    name: 'JWT decoder',
    blurb: 'Paste a token and see when it expires, who it’s for and its role, in plain words. Nothing is uploaded.',
  },
  {
    slug: 'timestamp-converter',
    category: 'Code helpers',
    name: 'Unix timestamp converter',
    blurb: 'Timestamp to date and back, in your time zone, UTC and four cities, with JS, Postgres and Python code.',
  },
  {
    slug: 'app-store-screenshots',
    category: 'Images',
    name: 'App Store screenshot maker',
    blurb: 'Your app screenshots in a device frame with a headline, at every App Store and Google Play size.',
  },
  {
    slug: 'regex-tester',
    category: 'Code helpers',
    name: 'Regex tester',
    blurb: 'Test a pattern live, see each part explained in plain English, and copy it as JS, Python or Zod.',
  },
  {
    slug: 'page-speed-checker',
    category: 'Launch & domains',
    name: 'Page speed checker',
    blurb: 'Why is my site slow? Phone and laptop scores, a load filmstrip and the top 3 fixes as prompts.',
  },
  {
    slug: 'cron-builder',
    category: 'Code helpers',
    name: 'Cron expression generator',
    blurb: 'Pick a schedule in plain words or paste a cron line, see the next runs in your time and UTC, copy code for Vercel or GitHub.',
  },
  {
    slug: 'gitignore-generator',
    category: 'Code helpers',
    name: '.gitignore generator',
    blurb: 'A .gitignore for your stack that keeps .env files and keys out of git, plus a check for what would leak.',
  },
  {
    slug: 'utm-builder',
    category: 'SEO & sharing',
    name: 'UTM link builder',
    blurb: 'Tag your links for X, LinkedIn, Reddit or Product Hunt and see which post sent your visitors. With a QR code.',
  },
  {
    slug: 'sql-formatter',
    category: 'Code helpers',
    name: 'SQL formatter',
    blurb: 'Format SQL with colors and see what it does in plain English, with a red flag on DELETE or UPDATE without WHERE.',
  },
  {
    slug: 'markdown-preview',
    category: 'Code helpers',
    name: 'Markdown preview',
    blurb: 'Write Markdown and see it like GitHub shows it, with tables, checklists and code colors. Copy into Notion or Docs.',
  },
  {
    slug: 'aspect-ratio-calculator',
    category: 'Images',
    name: 'Aspect ratio calculator',
    blurb: 'Get the missing side for 16:9, 4:3 or 9:16, see it in a YouTube player, phone or Instagram post, and copy the CSS.',
  },
  {
    slug: 'curl-converter',
    category: 'Code helpers',
    name: 'curl converter',
    blurb: 'Paste a curl command from API docs and get fetch, axios, Node.js, Python or a Next.js route, with keys moved to .env.',
  },
  {
    slug: 'color-converter',
    category: 'Design',
    name: 'Color converter',
    blurb: 'Any color as HEX, RGB, HSL, OKLCH, LAB, CSS name and Tailwind, with how it looks on white and black.',
  },
  {
    slug: 'accessibility-checker',
    category: 'Launch & domains',
    name: 'Accessibility checker',
    blurb: 'An accessibility score for your site, with the HTML behind each problem, a one-line fix and one prompt for your AI agent.',
  },
  {
    slug: 'api-tester',
    category: 'Code helpers',
    name: 'API tester',
    blurb: 'Send GET or POST with headers, JSON and a token. See the status in plain words, time, size and CORS, and copy it as curl.',
  },
  {
    slug: 'markdown-table-generator',
    category: 'Code helpers',
    name: 'Markdown table generator',
    blurb: 'Edit a table like a spreadsheet or paste from Excel, and copy it as Markdown, HTML or CSV.',
  },
  {
    slug: 'exif-remover',
    category: 'Security',
    name: 'EXIF remover',
    blurb: 'See if your photos show where you live, then remove the location, date and camera info in one click.',
  },
  {
    slug: 'css-animation-generator',
    category: 'Design',
    name: 'CSS animations and keyframes',
    blurb: 'Pick fade, slide, bounce, shimmer or typing, tune the timing on a visual curve, copy CSS or Tailwind.',
  },
  {
    slug: 'image-watermark',
    category: 'Images',
    name: 'Image watermark',
    blurb: 'Add your name or logo to one picture or a whole batch: corners or tiled, any opacity, color and angle. Download as a ZIP.',
  },
  {
    slug: 'ssl-checker',
    category: 'Launch & domains',
    name: 'SSL checker',
    blurb: 'Is your certificate valid? Days left, who issued it, whether www is covered, and its history.',
  },
  {
    slug: 'browser-info',
    category: 'Code helpers',
    name: 'What browser am I using?',
    blurb: 'Your browser, OS, viewport, screen, dark mode and time zone in one look. Copy it all for a bug report.',
  },
  {
    slug: 'shadcn-theme-generator',
    category: 'Design',
    name: 'shadcn/ui theme generator',
    blurb: 'Pick a brand color, gray and corners, see real shadcn components change live in light and dark, copy globals.css.',
  },
  {
    slug: 'npm-package-checker',
    category: 'Code helpers',
    name: 'npm package checker',
    blurb: 'Is this npm package safe to use? Downloads, last release, license, size and types, with a verdict. Compare up to 3.',
  },
  {
    slug: 'text-case-converter',
    category: 'Code helpers',
    name: 'Case converter',
    blurb: 'See any name in camelCase, snake_case, kebab-case and eight more cases at once. Rename JSON keys and .env names too.',
  },
  {
    slug: 'git-undo-helper',
    category: 'Code helpers',
    name: 'Git undo helper',
    blurb: 'Pick what went wrong in git and see the fix on a picture of your commits, with the exact commands or a prompt for your agent.',
  },
  {
    slug: 'button-generator',
    category: 'Design',
    name: 'CSS button generator',
    blurb: 'Design a button with hover and press, see it on light and dark pages, copy CSS, Tailwind, React or shadcn.',
  },
  {
    slug: 'loader-generator',
    category: 'Design',
    name: 'CSS loading spinners',
    blurb: '20 pure-CSS spinners, dots and bars plus a skeleton card builder. Copy HTML and CSS, Tailwind or React.',
  },
  {
    slug: 'tailwind-class-cleaner',
    category: 'Code helpers',
    name: 'Tailwind class cleaner',
    blurb: 'Sort Tailwind classes the way Prettier does, remove duplicates, and see which classes cancel each other out.',
  },
  {
    slug: 'color-blindness-simulator',
    category: 'Design',
    name: 'Color blindness simulator',
    blurb: 'See your screenshot the way color-blind users do, and which colors turn into the same color.',
  },
  {
    slug: 'video-to-gif',
    category: 'Images',
    name: 'Video to GIF',
    blurb: 'Turn a screen recording into a GIF for your README or bug report. Trim it and see the size live.',
  },
  {
    slug: 'llms-txt-generator',
    category: 'SEO & sharing',
    name: 'llms.txt generator',
    blurb: 'An llms.txt for ChatGPT, Claude and Perplexity from your pages, plus which AI crawlers you let in.',
  },
  {
    slug: 'background-generator',
    category: 'Design',
    name: 'Background generator',
    blurb: 'Waves, blobs, mesh gradients and patterns for your hero. Shuffle, then download SVG or PNG or copy CSS.',
  },
  {
    slug: 'security-headers-checker',
    category: 'Security',
    name: 'Security headers checker',
    blurb: 'Is my site’s security set up right? Grade your headers A to F and get a ready file for your host.',
  },
  {
    slug: 'font-pairing',
    category: 'Design',
    name: 'Font pairing ideas',
    blurb: 'Hand-picked Google Fonts pairs shown on a real-looking landing page. Copy the link tag, CSS, Tailwind or a prompt.',
  },
  {
    slug: 'broken-link-checker',
    category: 'Launch & domains',
    name: 'Broken link checker',
    blurb: 'Find every dead link and missing image on your site, with the page it’s on, and fix them with one prompt.',
  },
  {
    slug: 'base64-encoder',
    category: 'Code helpers',
    name: 'Base64 encoder',
    blurb: 'Encode and decode Base64 as you type, or turn a picture into a data URI to paste into your code.',
  },
  {
    slug: 'env-example-generator',
    category: 'Security',
    name: '.env.example generator',
    blurb: 'Paste your .env and get a safe .env.example, with secrets that would leak to the browser flagged in red.',
  },
  {
    slug: 'icon-finder',
    category: 'Design',
    name: 'Icon finder',
    blurb: 'Search 10,000+ free icons from Lucide, Heroicons, Tabler and Phosphor, then copy as SVG, JSX or React.',
  },
  {
    slug: 'schema-generator',
    category: 'SEO & sharing',
    name: 'Schema markup generator',
    blurb: 'JSON-LD for your company, app, product, article, FAQ, event or shop, with a Google result preview.',
  },
  {
    slug: 'csp-generator',
    category: 'Security',
    name: 'CSP generator',
    blurb: 'Paste your site and get a Content Security Policy that allows exactly what it loads, for any host.',
  },
  {
    slug: 'css-to-tailwind',
    category: 'Code helpers',
    name: 'CSS to Tailwind',
    blurb: 'Paste CSS and get Tailwind classes for each element, with a side-by-side preview that shows they match.',
  },
  {
    slug: 'fluid-type-generator',
    category: 'Design',
    name: 'Fluid type scale generator',
    blurb: 'Font sizes that grow smoothly from phone to desktop. Drag the screen width, then copy clamp() CSS or a Tailwind config.',
  },
  {
    slug: 'yaml-json-converter',
    category: 'Code helpers',
    name: 'YAML to JSON converter',
    blurb: 'Convert YAML to JSON and back as you type. Errors point at the line and say how many spaces it needs.',
  },
  {
    slug: 'image-to-text',
    category: 'Images',
    name: 'Image to text',
    blurb: 'Copy the text out of a screenshot, with every line boxed on the picture. Or copy an error as a prompt for your AI agent.',
  },
  {
    slug: 'social-post-previewer',
    category: 'SEO & sharing',
    name: 'X and LinkedIn post preview',
    blurb: 'See where LinkedIn cuts your post with “…see more”, how X splits it into a thread, and how pictures crop.',
  },
  {
    slug: 'redirect-rules-generator',
    category: 'Launch & domains',
    name: 'Redirect generator',
    blurb: 'Old and new URLs in, redirect rules out for Vercel, Netlify, Cloudflare, Next.js, nginx and .htaccess. Loops and chains in red.',
  },
  {
    slug: 'pwa-checker',
    category: 'Launch & domains',
    name: 'PWA checker',
    blurb: 'See the “Install app” sheet and home-screen icon your site would get, what’s missing, and a ready manifest to fix it.',
  },
  {
    slug: 'glass-effect-generator',
    category: 'Design',
    name: 'Glassmorphism generator',
    blurb: 'Make a frosted glass card over colorful backgrounds or your own screenshot, check the text stays readable, copy CSS or Tailwind.',
  },
  {
    slug: 'blur-placeholder-generator',
    category: 'Images',
    name: 'Blur placeholder generator',
    blurb: 'A tiny blurred placeholder for any image: Next.js blurDataURL, CSS, BlurHash or ThumbHash. Watch the fade-in.',
  },
  {
    slug: 'secret-generator',
    category: 'Security',
    name: 'Secret generator',
    blurb: 'One click for an AUTH_SECRET, JWT secret, webhook secret, API key, UUID or strong password, ready for your .env.',
  },
  {
    slug: 'domain-name-finder',
    category: 'Launch & domains',
    name: 'Domain name finder',
    blurb: 'Type a project name, see if it’s free on .com, .dev, .app, .io, .ai and .co, and get name ideas checked live.',
  },
  {
    slug: 'http-status-explainer',
    category: 'Code helpers',
    name: 'HTTP status code explainer',
    blurb: 'What 404, 500, 502 or a Vercel or Cloudflare error means in plain English, why it happens in your stack, and how to fix it.',
  },
  {
    slug: 'before-after-maker',
    category: 'Images',
    name: 'Before and after image maker',
    blurb: 'Drop two screenshots and get a side-by-side picture or an animated swipe GIF or video for your “I fixed it” post.',
  },
  {
    slug: 'responsive-checker',
    category: 'Launch & domains',
    name: 'Responsive checker',
    blurb: 'See any page at phone, tablet and desktop widths side by side.',
  },
  {
    slug: 'ai-slop-checker',
    category: 'Design',
    name: 'AI slop checker',
    blurb: 'Does your site look AI-made? Get a score, the tells that give it away, and a prompt to fix them.',
  },
  {
    slug: 'svg-optimizer',
    category: 'Images',
    name: 'SVG optimizer and SVG to JSX',
    blurb: 'Shrink an SVG and copy it as SVG, a React component, a data URI or CSS.',
  },
  {
    slug: 'domain-checker',
    category: 'Launch & domains',
    name: 'Domain checker',
    blurb: 'Why isn’t my domain working? DNS records, host, https and redirects, with a plain fix for each.',
  },
  {
    slug: 'qr-code-generator',
    category: 'SEO & sharing',
    name: 'QR code generator',
    blurb: 'A QR code for any link, with your colors and logo. PNG or SVG, and a warning if it won’t scan.',
  },
  {
    slug: 'readme-generator',
    category: 'Code helpers',
    name: 'README generator',
    blurb: 'A clean README.md with badges, screenshot, setup steps and an env var table, in a minute.',
  },
  {
    slug: 'html-to-jsx',
    category: 'Code helpers',
    name: 'HTML to JSX',
    blurb: 'Paste HTML and get JSX for React, with a live preview and every fix listed.',
  },
];

// Same for guides: add new ones at the END. Each lives at /guides/<slug>/.
export const GUIDES: Item[] = [
  { slug: 'show-claude-code-a-bug', name: 'How to show Claude Code a bug', blurb: 'A marked screenshot, the page and one sentence on what you expected. The manual way and the one-key way.' },
  { slug: 'report-a-bug-to-cursor', name: 'How to report a bug to Cursor', blurb: 'Give Cursor a screenshot, the page, what you expected and the errors, in one clear message.' },
  { slug: 'give-codex-a-screenshot', name: 'How to give Codex a screenshot of a bug', blurb: 'Paste it or use codex --image, and add what a picture can’t show.' },
  { slug: 'write-a-bug-report-for-ai-agents', name: 'How to write a bug report for an AI coding agent', blurb: 'A copyable template, with a bad and a good example.' },
  { slug: 'local-or-global-change', name: 'Why your agent asks “local or global?”', blurb: 'Why one fix can have two homes, and the one line that answers it up front.' },
  { slug: 'copy-console-errors-for-ai', name: 'How to copy console errors in Chrome', blurb: 'Open the console, catch the red lines and failed requests, remove secrets, paste.' },
  { slug: 'fix-a-bug-on-a-live-site', name: 'How to fix a bug on a live site you built with AI', blurb: 'Capture it, rule out the host, try it on localhost, fix, redeploy, check.' },
  { slug: 'keep-a-list-of-bugs', name: 'How to keep a list of bugs across projects', blurb: 'A BUGS.md your agent can tick off, or an inbox that fills as you capture.' },
  { slug: 'test-your-vibe-coded-app', name: 'How to test your app before launch', blurb: 'A checklist: every main path, phones, wrong input, launch checks, then fix in a batch.' },
  { slug: 'send-bugs-from-testers-to-ai', name: 'How to send bugs from testers to your AI agent', blurb: 'A template for testers and clients, and how to turn their notes into one clear bug each.' },
  { slug: 'darnly-vs-screenshot', name: 'Darnly vs a plain screenshot', blurb: 'Our benchmark: both fixed 16 of 16 bugs, Darnly cost more. When each is the better pick.' },
  { slug: 'darnly-vs-marker-io', name: 'Darnly vs Marker.io', blurb: 'A free, local bug capture for solo builders, or a paid team feedback tool with a client widget.' },
  { slug: 'darnly-vs-chrome-devtools-mcp', name: 'Darnly vs Chrome DevTools MCP', blurb: 'You point at the bug you saw, or the agent drives its own browser. Often both.' },
  { slug: 'darnly-vs-tracebug', name: 'Darnly vs TraceBug', blurb: 'A full bug recording for developers and QA, or a quick capture that lands in your project.' },
  { slug: 'screenshot-wont-paste-into-claude-code', name: 'Screenshot won’t paste into Claude Code or Cursor?', blurb: 'The right paste key for Mac, Windows, WSL and VS Code, and the file path fallback that always works.' },
  { slug: 'stuck-in-an-ai-error-loop', name: 'Stuck in an AI error loop? How to get out', blurb: 'Stop, revert to the last working commit, give the exact error and what you expected, one change at a time.' },
  { slug: 'report-a-bug-to-lovable', name: 'How to report a bug to Lovable', blurb: 'A marked screenshot, the page and what you expected, pasted into Lovable\u2019s chat.' },
  { slug: 'report-a-bug-to-bolt', name: 'How to report a bug to Bolt', blurb: 'Attach a marked screenshot within Bolt\u2019s limits, plus the page, what you expected and the errors.' },
  { slug: 'report-a-bug-to-v0', name: 'How to report a bug to v0', blurb: 'Paste a marked screenshot into v0 and point it at the one component to fix.' },
];
