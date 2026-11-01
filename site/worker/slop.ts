// AI slop checker: looks for the tells that make a site look AI-made (default fonts, the purple
// gradient, template leftovers, stock phrases) and turns them into a score from 0 to 100.
// Plain functions, given the page and the files it loads, so they can be tested without a Worker.

import type { Font } from './fonts';

export type Tell = {
  id: string;
  title: string; // what we found, in plain words
  detail: string; // the evidence
  fix: string; // one line on how to fix it
  points: number;
};

export type SlopResult = {
  score: number;
  verdict: string;
  tells: Tell[];
  passed: { id: string; title: string }[];
  scripted: boolean; // the page builds itself with JavaScript, so we also read its main script
};

export type SlopInput = {
  html: string;
  css: string[]; // linked and inline stylesheets
  js: string[]; // the page's own main scripts (for sites that render in the browser)
  fonts: Font[];
  title: string | null;
  icon: string | null; // the <link rel="icon"> address, if any
  faviconFile: boolean; // /favicon.ico exists
  shareImage: string | null; // og:image or twitter:image
  year: number; // this year
};

type Check = { id: string; pass: string; points: number; run: (c: Ctx) => Omit<Tell, 'id' | 'points'> | null };
type Ctx = SlopInput & { text: string; all: string; classes: string; headings: string[] };

const STOCK = [
  'elevate your', 'seamless', 'unlock the power', 'unlock your', 'in today’s fast-paced', "in today's fast-paced",
  'in today’s digital', "in today's digital", 'revolutioni', 'supercharge', 'game-changer', 'game changer',
  'cutting-edge', 'to the next level', 'harness the power', 'unleash', 'empower', 'streamline your',
  'effortlessly', 'look no further', 'transform the way', 'transform your', 'next-generation', 'reimagine',
  'all-in-one platform', 'designed to help you', 'built for the modern', 'at your fingertips', 'delve',
  'whether you’re a', "whether you're a", 'like never before', 'say goodbye to', 'boost your productivity',
  'join thousands of', 'trusted by thousands',
];

const CHECKS: Check[] = [
  {
    id: 'font',
    pass: 'Your own choice of font',
    points: 15,
    run: (c) => {
      const main = c.fonts.filter((f) => f.roles.includes('Body text') || f.roles.includes('Headings'));
      const pick = (main.length ? main : c.fonts.slice(0, 1)).find((f) => /^(inter|inter variable|geist|geist sans)$/i.test(f.name));
      if (!pick) return null;
      return {
        title: `${pick.name.replace(/ (variable|sans)$/i, '')} everywhere`,
        detail: `${pick.name} is the default font of Next.js, shadcn/ui and most AI app builders, so it reads as “AI made this”.`,
        fix: 'Pick a font with character for headings (like Fraunces, Space Grotesk or Bricolage Grotesque) and keep a plain one for body text.',
      };
    },
  },
  {
    id: 'gradient',
    pass: 'No purple-to-blue gradient',
    points: 15,
    run: (c) => {
      const tw = c.classes.match(/\b(?:from|via)-(?:purple|violet|indigo|fuchsia)-\d{2,3}\b/);
      const tw2 = /\b(?:to|via)-(?:blue|cyan|sky|indigo|pink|purple|violet)-\d{2,3}\b/.test(c.classes);
      if (tw && tw2) return gradientTell('Tailwind classes like ' + tw[0]);
      for (const g of c.css.join('\n').match(/(?:linear|radial|conic)-gradient\([^;{}]{0,400}\)/gi) ?? []) {
        const hues = colours(g).map(hue).filter((h): h is number => h !== null);
        if (hues.some((h) => h >= 255 && h <= 320) && hues.some((h) => h >= 190 && h < 255)) return gradientTell('a CSS gradient from purple to blue');
      }
      return null;
    },
  },
  {
    id: 'theme',
    pass: 'Colors aren’t the template defaults',
    points: 10,
    run: (c) => {
      const css = c.css.join('\n');
      const tokens = ['--background', '--foreground', '--card-foreground', '--popover-foreground', '--primary-foreground', '--secondary-foreground', '--muted-foreground', '--accent-foreground', '--destructive', '--ring', '--radius'];
      const has = tokens.filter((t) => css.includes(t + ':')).length;
      const primary = css.match(/--primary:\s*([^;}]+)/)?.[1]?.trim() ?? '';
      const defaultPrimary = /^(222\.2 47\.4% 11\.2%|240 5\.9% 10%|0 0% 9%|oklch\(0\.205 0 0\)|oklch\(0\.21 0\.006 285\.885\)|hsl\(222\.2 47\.4% 11\.2%\))$/.test(primary);
      if (has >= 6 && defaultPrimary) {
        return {
          title: 'The default shadcn/ui theme',
          detail: `The color tokens and corner radius are shadcn/ui’s out-of-the-box values (--primary: ${primary}).`,
          fix: 'Choose a brand color and set it as --primary, and change --radius so corners feel like yours.',
        };
      }
      const indigo = c.classes.match(/\bbg-indigo-(?:500|600)\b/);
      if (indigo) {
        return {
          title: 'Default Tailwind indigo buttons',
          detail: `Buttons use ${indigo[0]}, the color of nearly every Tailwind template.`,
          fix: 'Pick one brand color and use it for buttons and links instead of the stock indigo.',
        };
      }
      return null;
    },
  },
  {
    id: 'emoji',
    pass: 'No emoji in headings',
    points: 8,
    run: (c) => {
      const hits = c.headings.filter((h) => /\p{Extended_Pictographic}/u.test(h));
      if (!hits.length) return null;
      return {
        title: 'Emoji in headings',
        detail: `${hits.length} heading${hits.length === 1 ? '' : 's'}, like “${clip(hits[0], 60)}”.`,
        fix: 'Take the emoji out of headings; use a small icon or nothing.',
      };
    },
  },
  {
    id: 'cards',
    pass: 'No stock “three feature cards” row',
    points: 10,
    run: (c) => {
      const grid = /\b(?:sm|md|lg):grid-cols-3\b/.test(c.classes);
      const icons = (c.all.match(/lucide/gi) ?? []).length;
      const centered = /\btext-center\b/.test(c.classes);
      if (!(grid && icons >= 3 && centered)) return null;
      return {
        title: 'Centered hero with three icon cards',
        detail: 'A centered hero followed by a three-column grid of cards with Lucide icons, the layout most AI builders start from.',
        fix: 'Replace the three cards with one real example of the product: a screenshot, a short demo or a quote from a user.',
      };
    },
  },
  {
    id: 'phrases',
    pass: 'No stock marketing phrases',
    points: 20,
    run: (c) => {
      const found = STOCK.filter((p) => c.text.includes(p));
      const uniq = [...new Set(found.map((p) => p.replace('’', "'")))];
      if (!uniq.length) return null;
      return {
        title: `${uniq.length} stock phrase${uniq.length === 1 ? '' : 's'}`,
        detail: uniq.slice(0, 6).map((p) => `“${p}”`).join(', ') + (uniq.length > 6 ? ` and ${uniq.length - 6} more` : '') + '.',
        fix: 'Rewrite those lines to say plainly what the product does and for whom, with a specific number or example.',
        points: Math.min(20, uniq.length * 5),
      } as Omit<Tell, 'id' | 'points'>;
    },
  },
  {
    id: 'lorem',
    pass: 'No lorem ipsum',
    points: 15,
    run: (c) => (/lorem ipsum|dolor sit amet/.test(c.text) ? { title: 'Lorem ipsum left in', detail: 'Placeholder Latin text is still on the page.', fix: 'Replace every “lorem ipsum” with real copy.' } : null),
  },
  {
    id: 'template',
    pass: 'No template leftovers',
    points: 15,
    run: (c) => {
      const found: { what: string; fix: string }[] = [];
      const t = (c.title ?? '').trim();
      if (/^(create next app|vite \+ react(?: \+ ts)?|vite app|react app|lovable app|my v0 project|my app|untitled|home)$/i.test(t)) {
        found.push({ what: `the page title is still “${t}”`, fix: 'set the page title to your product name and what it does' });
      }
      if (/lovable generated project|generated by create next app|created with v0/i.test(c.html)) {
        found.push({ what: 'the page description is the one the app builder wrote', fix: 'write a one-sentence description of your product' });
      }
      if (c.shareImage && /lovable\.dev|bolt\.new|v0\.dev|vercel\.com\/og/i.test(c.shareImage)) {
        found.push({ what: 'links show the app builder’s share image', fix: 'make your own 1200×630 share image' });
      }
      if (c.icon && /\/vite\.svg$|\/next\.svg$|placeholder\.svg$/i.test(c.icon)) {
        found.push({ what: `the tab icon is the template’s ${c.icon.split('/').pop()}`, fix: 'make a favicon from your logo' });
      }
      const names = c.text.match(/\b(acme (?:inc|corp)|your company|your name here|john doe|jane doe)\b/);
      if (names) found.push({ what: `placeholder names like “${names[1].replace(/\b\w/g, (x) => x.toUpperCase())}” are on the page`, fix: 'replace placeholder names with real ones' });
      if (!found.length) return null;
      const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
      return {
        title: found.length === 1 ? 'A starter template leftover' : `${found.length} starter template leftovers`,
        detail: cap(found.map((f) => f.what).join('; ')) + '.',
        fix: cap(found.map((f) => f.fix).join('; ')) + '.',
      };
    },
  },
  {
    id: 'badge',
    pass: 'No “made with” builder badge',
    points: 10,
    run: (c) => {
      const m = c.all.match(/edit with lovable|lovable-badge|made with bolt|built with bolt|bolt\.new\/?\?rid|made with replit|built with v0/i);
      if (!m) return null;
      const who = /lovable/i.test(m[0]) ? 'Edit with Lovable' : /bolt/i.test(m[0]) ? 'Made with Bolt' : /replit/i.test(m[0]) ? 'Made with Replit' : 'Built with v0';
      return { title: 'An app builder badge', detail: `The page shows a “${who}” badge.`, fix: 'Turn off the builder’s badge in its settings (it’s usually a paid-plan switch) or remove it from the code.' };
    },
  },
  {
    id: 'favicon',
    pass: 'Has a favicon',
    points: 5,
    run: (c) => (c.icon || c.faviconFile ? null : { title: 'No favicon', detail: 'The browser tab shows a blank icon.', fix: 'Add a favicon made from your logo (our favicon generator makes every size).' }),
  },
  {
    id: 'share',
    pass: 'Has a share image',
    points: 5,
    run: (c) => (c.shareImage ? null : { title: 'No share image', detail: 'Links to the site show no picture on X, LinkedIn or WhatsApp.', fix: 'Add a 1200×630 og:image (our OG image generator makes one).' }),
  },
  {
    id: 'year',
    pass: 'Footer year is current',
    points: 5,
    run: (c) => {
      const years = [...c.text.matchAll(/(?:©|&copy;|©|copyright)\s*(?:20\d\d\s*[-–]\s*)?(20\d\d)/g)].map((m) => Number(m[1]));
      if (!years.length) return null;
      const y = Math.max(...years);
      return y < c.year ? { title: `Footer says © ${y}`, detail: `It’s ${c.year}, so the site looks unmaintained.`, fix: 'Write the year with code (new Date().getFullYear()) so it never goes stale.' } : null;
    },
  },
];

export function checkSlop(input: SlopInput): SlopResult {
  const scripted = isScripted(input.html);
  const visible = textOf(input.html);
  // Sites that render in the browser keep their words in the script, so read those too.
  const jsText = input.js.map(stringsOf).join('\n');
  const text = (visible + '\n' + jsText).toLowerCase().replace(/\s+/g, ' ');
  const classes = [classesOf(input.html), ...input.css.map(selectorsOf), jsText].join(' ');
  const ctx: Ctx = { ...input, text, all: input.html + '\n' + jsText, classes, headings: headingsOf(input.html) };

  const tells: Tell[] = [];
  const passed: { id: string; title: string }[] = [];
  for (const c of CHECKS) {
    const r = c.run(ctx);
    if (r) tells.push({ id: c.id, points: c.points, ...r });
    else passed.push({ id: c.id, title: c.pass });
  }
  const score = Math.min(100, tells.reduce((s, t) => s + t.points, 0));
  return { score, verdict: verdict(score), tells: tells.sort((a, b) => b.points - a.points), passed, scripted };
}

export function verdict(score: number): string {
  if (score < 15) return 'Looks hand-made';
  if (score < 35) return 'A few AI tells';
  if (score < 60) return 'Noticeably AI-made';
  return 'Peak AI slop';
}

const gradientTell = (how: string) => ({
  title: 'Purple-to-blue gradient',
  detail: `Found ${how}. It’s the gradient every AI builder reaches for first.`,
  fix: 'Use one solid brand color, or a gradient between two shades of the same color.',
});

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// A page that is mostly an empty <div id="root"> plus a module script.
export function isScripted(html: string): boolean {
  const body = textOf(html).trim();
  return body.length < 200 && /<script\b[^>]*\btype\s*=\s*["']?module/i.test(html);
}

// The page's own main scripts, which hold the words for sites that render in the browser.
export function mainScripts(html: string, base: string): string[] {
  const out: string[] = [];
  for (const tag of html.match(/<script\b[^>]*\bsrc\s*=[^>]*>/gi) ?? []) {
    const src = tag.match(/\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const raw = src?.[2] ?? src?.[3] ?? src?.[4];
    if (!raw) continue;
    try {
      const u = new URL(raw, base);
      if (u.host !== new URL(base).host) continue;
      if (/module/i.test(tag) || /\/(assets|_next\/static\/chunks\/(app|pages))\//.test(u.pathname)) out.push(u.href);
    } catch {
      /* skip bad addresses */
    }
  }
  return out.slice(0, 2);
}

export function textOf(html: string): string {
  return decode(
    html
      .replace(/<(script|style|template|svg|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ');
}

function headingsOf(html: string): string[] {
  return [...html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => textOf(m[1]).trim()).filter(Boolean);
}

function classesOf(html: string): string {
  return [...html.matchAll(/\sclass(?:Name)?\s*=\s*("([^"]*)"|'([^']*)')/gi)].map((m) => m[2] ?? m[3] ?? '').join(' ');
}

// Compiled Tailwind CSS keeps class names as selectors: .md\:grid-cols-3, .from-purple-600
function selectorsOf(css: string): string {
  return (css.match(/\.[a-z0-9\\:_-]+(?=[\s,{:.>[])/gi) ?? []).map((s) => s.slice(1).replace(/\\/g, '')).join(' ');
}

// Quoted strings in a script: JSX text and class names end up there.
function stringsOf(js: string): string {
  return (js.match(/"(?:[^"\\\n]|\\.){0,400}"|'(?:[^'\\\n]|\\.){0,400}'|`(?:[^`\\]|\\.){0,400}`/g) ?? [])
    .filter((s) => s.length > 3)
    .map((s) => s.slice(1, -1).replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\n/g, ' '))
    .join('\n');
}

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&copy;/g, '©')
    .replace(/&rsquo;/g, '’')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// Colors written in a CSS value, as [r, g, b] (0-255).
const NAMED: Record<string, [number, number, number]> = {
  purple: [128, 0, 128], violet: [238, 130, 238], indigo: [75, 0, 130], blueviolet: [138, 43, 226], magenta: [255, 0, 255],
  blue: [0, 0, 255], royalblue: [65, 105, 225], dodgerblue: [30, 144, 255], deepskyblue: [0, 191, 255], cyan: [0, 255, 255],
};

export function colours(v: string): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const m of v.matchAll(/#([0-9a-f]{3,8})\b|rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)|hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%|\b([a-z]+)\b/gi)) {
    if (m[1]) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((x) => x + x).join('');
      if (h.length >= 6) out.push([parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]);
    } else if (m[2]) out.push([+m[2], +m[3], +m[4]]);
    else if (m[5]) out.push(hslToRgb(+m[5], +m[6], +m[7]));
    else if (m[8] && NAMED[m[8].toLowerCase()]) out.push(NAMED[m[8].toLowerCase()]);
  }
  return out;
}

// Hue in degrees, or null for greys and near-black/white that have no real color.
export function hue([r, g, b]: [number, number, number]): number | null {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 40 || max < 50) return null;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
