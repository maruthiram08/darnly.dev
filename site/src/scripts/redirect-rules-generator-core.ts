// Redirect rules generator: parsing, checks and config output. Pure functions, no DOM.

export type Code = 301 | 302 | 307 | 308;
export type HostMode = 'leave' | 'www' | 'apex';
export type SlashMode = 'leave' | 'add' | 'remove';
export type Options = { code: Code; host: HostMode; domain: string; slash: SlashMode };
export type Platform = 'vercel' | 'netlify' | 'cloudflare' | 'next' | 'nginx' | 'apache';

export type Rule = {
  line: number;
  from: string; // a path; for a wildcard rule it's the part before the *
  wild: boolean;
  to: string; // a path or a full URL; with splat, the rest of the old path is added to the end
  splat: boolean;
  code: Code;
};
export type BadLine = { line: number; text: string; why: string };
export type Parsed = { rules: Rule[]; bad: BadLine[]; hosts: string[] };

export type Kind = 'ok' | 'chain' | 'loop' | 'dup' | 'hop';
export type Check = { rule: Rule; kind: Kind; hops: string[]; why: string; final?: string };

const CODES = new Set([301, 302, 307, 308]);
const FILE_EXT = /\.(html?|php|aspx?|jsp|xml|json|txt|pdf|png|jpe?g|gif|svg|webp|css|js)$/i;
const HOSTLIKE = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?$/i;

// ---------- parsing ----------

function csvCells(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

export function cells(line: string): string[] {
  const s = line.trim().replace(/\s*(?:->|=>|→|⟶|➜)\s*/g, '\t');
  if (s.includes('\t')) return s.split('\t').map((x) => x.trim()).filter(Boolean);
  if (/[,;]/.test(s)) {
    const c = csvCells(s);
    if (c.length >= 2) return c;
  }
  return s.split(/\s+/).filter(Boolean);
}

type Loc = { path: string; host?: string; abs?: string };

// Turns "mysite.com/a", "https://x.com/a?b" or "a" into a path, keeping the host if there was one.
function locate(raw: string): Loc | null {
  let s = raw.trim().replace(/^["']|["']$/g, '');
  if (!s) return null;
  const first = s.split('/')[0];
  const hasScheme = /^https?:\/\//i.test(s);
  if (!hasScheme && !s.startsWith('/') && HOSTLIKE.test(first) && !FILE_EXT.test(first)) s = 'https://' + s;
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const path = encodePath(decodeSafe(u.pathname)) || '/';
      return { path: path + u.search, host: u.hostname.toLowerCase(), abs: `${u.protocol}//${u.host}${path}${u.search}${u.hash}` };
    } catch {
      return null;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !s.startsWith('/')) return null; // mailto:, javascript: …
  if (!s.startsWith('/')) s = '/' + s;
  return { path: encodePath(decodeSafe(s)) };
}

function decodeSafe(s: string): string {
  try { return decodeURI(s); } catch { return s; }
}
function encodePath(s: string): string {
  return encodeURI(s).replace(/%25([0-9A-F]{2})/gi, '%$1');
}

const HEADER = /^(old|new|from|to|source|destination|target|url|path|redirect)[\s_-]*(url|path|address|page)?$/i;
const WILD_END = /(?:\*|:splat|:[a-z_]+\*)$/i;
const SPLAT_END = /(?:\*|:splat|:[a-z_]+\*|\$1)$/i;

export function cleanDomain(s: string): string {
  return s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
}

function slashed(path: string, mode: SlashMode): string {
  if (mode === 'leave' || path === '/' || !path.startsWith('/')) return path;
  const q = path.search(/[?#]/);
  const p = q === -1 ? path : path.slice(0, q);
  const rest = q === -1 ? '' : path.slice(q);
  if (mode === 'remove') return p.replace(/\/+$/, '') + rest || '/';
  const last = p.split('/').pop() || '';
  if (p.endsWith('/') || last.includes('.')) return path;
  return p + '/' + rest;
}

export function parse(text: string, opts: Options): Parsed {
  const rules: Rule[] = [];
  const bad: BadLine[] = [];
  const hosts = new Set<string>();
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = i + 1;
    const t = raw.trim();
    if (!t || t.startsWith('#') || t.startsWith('//')) return;
    const c = cells(t);
    // A CSV header like "old,new" or "from,to,status".
    if (rules.length === 0 && bad.length === 0 && c.length >= 2 && HEADER.test(c[0]) && HEADER.test(c[1])) return;
    if (c.length < 2) {
      bad.push({ line, text: t, why: 'Needs an old and a new address on the same line, like /old /new.' });
      return;
    }
    let code = opts.code;
    if (c[2]) {
      const n = Number(c[2].replace(/!$/, ''));
      if (CODES.has(n)) code = n as Code;
      else {
        bad.push({ line, text: t, why: `“${c[2]}” isn’t a redirect code. Use 301 or 302, or leave it out.` });
        return;
      }
    }
    let fromRaw = c[0];
    let toRaw = c[1];
    const wild = WILD_END.test(fromRaw);
    if (wild) fromRaw = fromRaw.replace(WILD_END, '');
    const splat = SPLAT_END.test(toRaw);
    if (splat) toRaw = toRaw.replace(SPLAT_END, '');
    if (splat && !wild) {
      bad.push({ line, text: t, why: 'The new address ends in *, so the old one needs a * at the end too, like /blog/* /posts/*.' });
      return;
    }
    if (/[*]|\/:[a-z]/i.test(fromRaw) || /\*/.test(toRaw)) {
      bad.push({ line, text: t, why: 'Only a * at the very end is supported, like /blog/*.' });
      return;
    }
    const from = locate(fromRaw || '/');
    const to = locate(toRaw || '/');
    if (!from || !to) {
      bad.push({ line, text: t, why: 'One of these doesn’t look like a web address.' });
      return;
    }
    if (from.host) hosts.add(from.host.replace(/^www\./, ''));
    let fromPath = from.path.replace(/[?#].*$/, '');
    if (!wild) fromPath = slashed(fromPath, opts.slash);
    if (wild && fromRaw === '') fromPath = '/';
    let toVal = to.abs ?? to.path;
    if (!to.abs && !splat) toVal = slashed(toVal, opts.slash);
    rules.push({ line, from: fromPath, wild, to: toVal, splat, code });
  });
  return { rules, bad, hosts: [...hosts] };
}

// ---------- checks ----------

export function show(r: Rule, side: 'from' | 'to'): string {
  if (side === 'from') return r.wild ? (r.from.endsWith('/') ? r.from : r.from) + '*' : r.from;
  return r.splat ? r.to + '*' : r.to;
}

const key = (p: string) => {
  const s = p.replace(/[?#].*$/, '');
  return s.length > 1 ? s.replace(/\/+$/, '') : s;
};

function hostOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

export function check(rules: Rule[], opts: Options, guessHosts: string[] = []): Check[] {
  const domain = cleanDomain(opts.domain) || guessHosts[0] || '';
  const own = (h: string) => !!domain && (h === domain || h === 'www.' + domain);
  const exact = new Map<string, Rule>();
  const wilds: Rule[] = [];
  const firstOf = new Map<string, Rule>();
  for (const r of rules) {
    const k = (r.wild ? '*' : '') + key(r.from);
    if (!firstOf.has(k)) firstOf.set(k, r);
    if (r.wild) { if (firstOf.get(k) === r) wilds.push(r); }
    else if (!exact.has(k)) exact.set(k, r);
  }
  wilds.sort((a, b) => b.from.length - a.from.length);

  // Where does this path go next? null when nothing matches or it leaves the site.
  function step(path: string): { next: string; shown: string; leaves: boolean } | null {
    const k = key(path);
    let r = exact.get(k);
    let rest = '';
    if (!r) {
      r = wilds.find((w) => path.startsWith(w.from) || k === key(w.from));
      if (r) rest = path.startsWith(r.from) ? path.slice(r.from.length) : '';
    }
    if (!r) return null;
    const dest = r.splat ? joinRest(r.to, rest) : r.to;
    if (/^https?:\/\//i.test(dest)) {
      const h = hostOf(dest);
      if (h && own(h)) {
        try { const u = new URL(dest); return { next: u.pathname + u.search, shown: dest, leaves: false }; } catch { /* fall through */ }
      }
      return { next: dest, shown: dest, leaves: true };
    }
    return { next: dest, shown: dest, leaves: false };
  }

  return rules.map((r): Check => {
    const k = (r.wild ? '*' : '') + key(r.from);
    const first = firstOf.get(k)!;
    if (first !== r) {
      return { rule: r, kind: 'dup', hops: [show(r, 'from'), show(r, 'to')], why: `Line ${first.line} already redirects ${show(r, 'from')}, so this line is ignored.` };
    }
    // A wildcard that sends its own folder back into itself never stops.
    if (r.wild && r.splat && !/^https?:/i.test(r.to) && r.to.startsWith(r.from)) {
      return { rule: r, kind: 'loop', hops: [show(r, 'from'), show(r, 'to')], why: `${show(r, 'to')} is inside ${show(r, 'from')}, so it redirects again and again forever.` };
    }
    const start = r.wild ? r.from + (r.from.endsWith('/') ? 'page' : '/page') : r.from;
    const hops = [start];
    const seen = new Set([key(start)]);
    let cur = start;
    let loop = false;
    for (let i = 0; i < 12; i++) {
      const s = step(cur);
      if (!s) break;
      hops.push(s.shown);
      if (s.leaves) break;
      const nk = key(s.next);
      if (seen.has(nk)) { loop = true; break; }
      seen.add(nk);
      cur = s.next;
    }
    if (hops.length > 12) loop = true;
    const pretty = r.wild && hops.length <= 2 ? [show(r, 'from'), show(r, 'to')] : hops;
    if (loop) {
      const back = hops[hops.length - 1];
      return { rule: r, kind: 'loop', hops: pretty, why: hops.length === 2 ? `${hops[0]} redirects to itself. Browsers show “too many redirects”.` : `This goes round in a circle back to ${back}. Browsers show “too many redirects”.` };
    }
    if (hops.length > 2) {
      const final = hops[hops.length - 1];
      return { rule: r, kind: 'chain', hops: pretty, final, why: `${hops.length - 1} redirects in a row. Point ${hops[0]} straight to ${final}: it’s faster and Google keeps the ranking.` };
    }
    // Same site, but through the www redirect or plain http first.
    if (/^https?:\/\//i.test(r.to)) {
      const h = hostOf(r.to);
      if (h && own(h)) {
        const wantHost = opts.host === 'www' ? 'www.' + domain : opts.host === 'apex' ? domain : h;
        if (h !== wantHost || r.to.startsWith('http://')) {
          const fixed = r.to.replace(/^http:/i, 'https:').replace(`//${h}`, `//${wantHost}`);
          return { rule: r, kind: 'hop', hops: pretty, final: fixed, why: `This goes through your ${h !== wantHost ? 'www' : 'https'} redirect too. Use ${fixed + (r.splat ? '*' : '')} or just the path.` };
        }
      }
    }
    return { rule: r, kind: 'ok', hops: pretty, why: '' };
  });
}

function joinRest(to: string, rest: string): string {
  if (!rest) return to;
  if (to.endsWith('/') && rest.startsWith('/')) return to + rest.slice(1);
  if (!to.endsWith('/') && !rest.startsWith('/')) return to + '/' + rest;
  return to + rest;
}

// Rules that should go into the config: the first rule for each old address, exact ones first.
export function usable(checks: Check[]): Rule[] {
  const keep = checks.filter((c) => c.kind !== 'dup').map((c) => c.rule);
  const exact = keep.filter((r) => !r.wild);
  const wild = keep.filter((r) => r.wild).sort((a, b) => b.from.length - a.from.length);
  return [...exact, ...wild];
}

// ---------- output ----------

export const PLATFORMS: { id: Platform; label: string; file: string; where: string }[] = [
  { id: 'vercel', label: 'Vercel', file: 'vercel.json', where: 'Put <code>vercel.json</code> in the root of your project. If you already have one, copy the <code>redirects</code> list into it.' },
  { id: 'netlify', label: 'Netlify', file: '_redirects', where: 'Put <code>_redirects</code> in the folder Netlify publishes (often <code>public/</code> or <code>dist/</code>). No file extension.' },
  { id: 'cloudflare', label: 'Cloudflare', file: '_redirects', where: 'For Cloudflare Pages and Workers sites: put <code>_redirects</code> in your build output folder (often <code>public/</code>). Up to 2,000 plain redirects and 100 with a <code>*</code>.' },
  { id: 'next', label: 'Next.js', file: 'next.config.js', where: 'Add the <code>redirects()</code> part to your <code>next.config.js</code>. In <code>next.config.mjs</code> or <code>.ts</code>, use <code>export default</code> instead of <code>module.exports</code>.' },
  { id: 'nginx', label: 'nginx', file: 'redirects.conf', where: 'Paste into your site’s <code>server { }</code> block, then run <code>nginx -t</code> and reload nginx.' },
  { id: 'apache', label: '.htaccess', file: '.htaccess', where: 'For Apache and most shared hosting: paste at the top of the <code>.htaccess</code> file in your site’s main folder.' },
];

function hostRule(opts: Options): { from: string; to: string } | null {
  const d = cleanDomain(opts.domain);
  if (opts.host === 'leave' || !d) return null;
  return opts.host === 'www' ? { from: d, to: 'www.' + d } : { from: 'www.' + d, to: d };
}

// Escapes path-to-regexp characters for Vercel and Next.js.
const p2r = (s: string) => s.replace(/[():*?+{}]/g, (c) => '\\' + c);
const isAbs = (s: string) => /^https?:\/\//i.test(s);
const p2rDest = (s: string) => (isAbs(s) ? s : p2r(s));

function vercelRules(rules: Rule[]) {
  return rules.map((r) => {
    const source = r.wild ? p2r(r.from.replace(/\/$/, '')) + '/:path*' : p2r(r.from);
    let destination = p2rDest(r.to);
    if (r.splat) destination = r.to.replace(/\/$/, '') + '/:path*';
    return { source: source === '/:path*' ? '/:path*' : source, destination, statusCode: r.code };
  });
}

function vercel(rules: Rule[], opts: Options): string {
  const list: Record<string, unknown>[] = [];
  const h = hostRule(opts);
  if (h) list.push({ source: '/:path*', has: [{ type: 'host', value: h.from }], destination: `https://${h.to}/:path*`, statusCode: 301 });
  list.push(...vercelRules(rules));
  const out: Record<string, unknown> = {};
  if (opts.slash !== 'leave') out.trailingSlash = opts.slash === 'add';
  out.redirects = list;
  // One redirect per line reads better than JSON.stringify's fully expanded objects.
  const body = list.map((x) => '    ' + JSON.stringify(x).replace(/":/g, '": ').replace(/,"/g, ', "').replace(/^\{/, '{ ').replace(/\}$/, ' }'));
  const lines = ['{'];
  if ('trailingSlash' in out) lines.push(`  "trailingSlash": ${out.trailingSlash},`);
  lines.push('  "redirects": [', body.join(',\n'), '  ]', '}');
  return lines.filter((l) => l !== '').join('\n');
}

function underscore(rules: Rule[], opts: Options, cf: boolean): string {
  const lines: string[] = [];
  const h = hostRule(opts);
  if (h) {
    if (cf) {
      lines.push(
        `# ${h.from} → ${h.to} can't go in this file. In the Cloudflare dashboard open`,
        `# your domain → Rules → Redirect Rules, and use the "Redirect from ${opts.host === 'www' ? 'root to WWW' : 'WWW to root'}" template.`,
        '',
      );
    } else {
      lines.push(`https://${h.from}/*  https://${h.to}/:splat  301!`, `http://${h.from}/*  https://${h.to}/:splat  301!`, '');
    }
  }
  if (opts.slash !== 'leave') {
    lines.push(cf
      ? `# Trailing slashes: Cloudflare already ${opts.slash === 'add' ? 'adds' : 'removes'} them for HTML pages based on your file names.`
      : `# Trailing slashes: turn on "Pretty URLs" in Site configuration → Build & deploy → Post processing.`, '');
  }
  const w1 = Math.min(48, Math.max(8, ...rules.map((r) => show(r, 'from').length)));
  const w2 = Math.min(56, Math.max(8, ...rules.map((r) => (r.splat ? r.to + ':splat' : r.to).length)));
  for (const r of rules) {
    const to = r.splat ? (r.to.endsWith('/') ? r.to : r.to + '/') + ':splat' : r.to;
    lines.push(`${show(r, 'from').padEnd(w1)}  ${to.padEnd(w2)}  ${r.code}`);
  }
  return lines.join('\n').trimEnd();
}

const jsStr = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function next(rules: Rule[], opts: Options): string {
  const h = hostRule(opts);
  const items: string[] = [];
  if (h) items.push(`      { source: '/:path*', has: [{ type: 'host', value: ${jsStr(h.from)} }], destination: ${jsStr(`https://${h.to}/:path*`)}, statusCode: 301 },`);
  for (const r of vercelRules(rules)) items.push(`      { source: ${jsStr(r.source)}, destination: ${jsStr(r.destination)}, statusCode: ${r.statusCode} },`);
  const lines = ['/** @type {import(\'next\').NextConfig} */', 'module.exports = {'];
  if (opts.slash === 'add') lines.push('  trailingSlash: true,');
  if (opts.slash === 'remove') lines.push('  trailingSlash: false, // the default: /about/ goes to /about');
  lines.push('  async redirects() {', '    return [', ...items, '    ];', '  },', '};');
  return lines.join('\n');
}

const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// nginx and Apache match the decoded path, so spaces etc. go in as plain (escaped) characters.
const rePath = (p: string) => reEsc(decodeSafeAll(p)).replace(/ /g, '\\s');
function decodeSafeAll(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

function nginx(rules: Rule[], opts: Options): string {
  const lines: string[] = [];
  const h = hostRule(opts);
  if (h) {
    lines.push(
      '# 1. Add this as its own server block, next to your main one:',
      'server {',
      '    listen 80;',
      '    listen 443 ssl;',
      `    server_name ${h.from};`,
      '    # Copy the ssl_certificate lines from your main server block here.',
      `    return 301 https://${h.to}$request_uri;`,
      '}',
      '',
      '# 2. Paste the rest inside your main server { } block:',
    );
  }
  for (const r of rules) {
    const base = r.from.replace(/\/$/, '');
    const re = r.wild ? `^${rePath(r.from)}${r.splat ? '(.*)' : '.*'}$` : r.from === '/' ? '^/$' : `^${rePath(base)}/?$`;
    const dest = (r.splat ? joinRest(r.to, '$1') : r.to).replace(/ /g, '%20');
    if (r.code === 301 || r.code === 302) lines.push(`rewrite ${re} ${dest} ${r.code === 301 ? 'permanent' : 'redirect'};`);
    else lines.push(`location ~ ${re} { return ${r.code} ${dest}; }`);
  }
  if (opts.slash === 'remove') lines.push('', '# Remove the trailing slash from every other address', 'rewrite ^/(.+)/$ /$1 permanent;');
  if (opts.slash === 'add') lines.push('', '# Add a trailing slash to addresses without a file extension', 'rewrite ^([^.?]*[^/])$ $1/ permanent;');
  return lines.join('\n');
}

function apache(rules: Rule[], opts: Options): string {
  const lines = ['RewriteEngine On', ''];
  const h = hostRule(opts);
  if (h) {
    lines.push(
      `# ${h.from} → ${h.to}`,
      `RewriteCond %{HTTP_HOST} ^${reEsc(h.from)}$ [NC]`,
      `RewriteRule ^(.*)$ https://${h.to}/$1 [R=301,L]`,
      '',
    );
  }
  for (const r of rules) {
    const p = r.from.replace(/^\//, '');
    const re = r.wild ? `^${rePath(p)}${r.splat ? '(.*)' : '.*'}$` : p === '' ? '^$' : `^${rePath(p.replace(/\/$/, ''))}/?$`;
    const raw = r.splat ? joinRest(r.to, '$1') : r.to;
    const dest = raw.replace(/%/g, '\\%');
    const flags = [`R=${r.code}`, 'L'];
    if (/[%#]/.test(raw)) flags.push('NE');
    lines.push(`RewriteRule ${re} ${dest} [${flags.join(',')}]`);
  }
  if (opts.slash === 'remove') lines.push('', '# Remove the trailing slash (but not from real folders)', 'RewriteCond %{REQUEST_FILENAME} !-d', 'RewriteRule ^(.+)/$ /$1 [R=301,L]');
  if (opts.slash === 'add') lines.push('', '# Add a trailing slash to addresses that aren’t files', 'RewriteCond %{REQUEST_FILENAME} !-f', 'RewriteRule ^([^.]*[^/])$ /$1/ [R=301,L]');
  return lines.join('\n').trimEnd();
}

export function generate(platform: Platform, rules: Rule[], opts: Options): string {
  switch (platform) {
    case 'vercel': return vercel(rules, opts);
    case 'netlify': return underscore(rules, opts, false);
    case 'cloudflare': return underscore(rules, opts, true);
    case 'next': return next(rules, opts);
    case 'nginx': return nginx(rules, opts);
    case 'apache': return apache(rules, opts);
  }
}

export const EXAMPLE = `# old address          new address
/pricing.html           /pricing
/blog/*                 /posts/*
/team                   /about-us
/about-us               /about
/signup                 /register
/register               /signup
/docs/getting-started   https://docs.mysite.com/start`;
