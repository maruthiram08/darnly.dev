// Security headers checker: grades a page's response headers from A to F.
// Pure functions (no fetching), so they can be tried outside the Worker.

export type Level = 'pass' | 'warn' | 'fail';
export type HeaderCheck = {
  id: string;
  label: string;
  level: Level;
  points: number; // what this check is worth; pass earns all, warn half, fail none
  value: string | null; // what the site sends now
  detail: string; // plain-English verdict
  fix?: string;
  set?: { key: string; value: string }; // the header to add or replace, for the config snippet
};
export type Cookie = { name: string; secure: boolean; httpOnly: boolean; sameSite: string | null };
export type HostId = 'vercel' | 'netlify' | 'cloudflare' | 'next' | 'other';
export type HeadersReport = {
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  score: number; // 0 to 100
  host: HostId; // our guess at where the site is hosted, for the snippet picker
  framework: string | null;
  checks: HeaderCheck[];
  cookies: Cookie[];
  raw: [string, string][]; // every response header except set-cookie (cookie values stay private)
};

const HALF_YEAR = 15_552_000;

export const RECOMMENDED = {
  hsts: 'max-age=63072000; includeSubDomains',
  xfo: 'DENY',
  nosniff: 'nosniff',
  referrer: 'strict-origin-when-cross-origin',
  permissions: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
};

export function checkHeaders(headers: Headers, finalUrl: string, html: string): HeadersReport {
  const h = (k: string) => headers.get(k);
  const https = finalUrl.startsWith('https:');
  const checks: HeaderCheck[] = [];
  const csp = h('content-security-policy');
  const cspDirs = parseCsp(csp ?? '');

  // 1. HTTPS and HSTS
  {
    const v = h('strict-transport-security');
    const age = Number(v?.match(/max-age\s*=\s*"?(\d+)/i)?.[1] ?? NaN);
    const base = { id: 'hsts', label: 'Always use https (HSTS)', points: 20, value: v };
    if (!https) {
      checks.push({ ...base, level: 'fail', detail: 'This page loads over plain http, so anyone on the same Wi-Fi can read or change it.', fix: 'Turn on https at your host and redirect http to https, then add this header.', set: { key: 'Strict-Transport-Security', value: RECOMMENDED.hsts } });
    } else if (!v) {
      checks.push({ ...base, level: 'fail', detail: 'Browsers aren’t told to always use https, so the first visit can still be downgraded to http.', fix: 'Add the Strict-Transport-Security header.', set: { key: 'Strict-Transport-Security', value: RECOMMENDED.hsts } });
    } else if (!(age >= HALF_YEAR)) {
      checks.push({ ...base, level: 'warn', detail: `HSTS is on, but only for ${isNaN(age) ? 'an unclear time' : humanTime(age)}. Six months or more is the usual minimum.`, fix: 'Raise max-age to two years.', set: { key: 'Strict-Transport-Security', value: RECOMMENDED.hsts } });
    } else {
      checks.push({ ...base, level: 'pass', detail: `Browsers will only use https here, for ${humanTime(age)}.` });
    }
  }

  // 2. Content-Security-Policy
  {
    const reportOnly = h('content-security-policy-report-only');
    const base = { id: 'csp', label: 'Content Security Policy', points: 25, value: csp ?? (reportOnly ? `(report only) ${reportOnly}` : null) };
    const starter = starterCsp(html, finalUrl);
    if (!csp) {
      checks.push({
        ...base,
        level: 'fail',
        detail: reportOnly
          ? 'There’s a policy in report-only mode, so it logs problems but blocks nothing yet.'
          : 'No policy, so if anyone gets a script onto your page (a bad package, a comment box), the browser runs it.',
        fix: 'Add a Content-Security-Policy. We built a starter from the scripts and files your page loads. Try it on a preview first, because it blocks anything it doesn’t list.',
        set: { key: 'Content-Security-Policy', value: starter },
      });
    } else {
      const scripts = cspDirs.get('script-src') ?? cspDirs.get('default-src');
      const problems: string[] = [];
      if (!scripts) problems.push('it doesn’t limit scripts (no script-src or default-src)');
      else {
        const hasNonce = scripts.some((s) => /^'(nonce-|sha256-|sha384-|sha512-)/.test(s));
        if (scripts.includes("'unsafe-inline'") && !hasNonce && !scripts.includes("'strict-dynamic'")) problems.push('it allows inline scripts (\'unsafe-inline\'), which is the main thing a CSP should stop');
        if (scripts.includes("'unsafe-eval'")) problems.push('it allows \'unsafe-eval\'');
        if (scripts.some((s) => s === '*' || s === 'https:' || s === 'http:' || s === 'data:')) problems.push('it lets scripts load from any site');
      }
      if (problems.length) {
        checks.push({ ...base, level: 'warn', detail: `You have a policy, but ${problems.join(', and ')}.`, fix: 'Tighten script-src in your current policy: drop \'unsafe-inline\', \'unsafe-eval\' and wildcards, and use nonces or hashes for any inline scripts you need. Your AI agent can do this without losing the services you already allow.' });
      } else {
        checks.push({ ...base, level: 'pass', detail: 'You have a policy, and it limits where scripts can come from.' });
      }
    }
  }

  // 3. Clickjacking: X-Frame-Options or frame-ancestors
  {
    const xfo = h('x-frame-options');
    const fa = cspDirs.get('frame-ancestors');
    const value = [xfo && `X-Frame-Options: ${xfo}`, fa && `frame-ancestors ${fa.join(' ')}`].filter(Boolean).join(' · ') || null;
    const base = { id: 'frames', label: 'Can’t be framed (clickjacking)', points: 15, value };
    const goodXfo = !!xfo && /^(deny|sameorigin)$/i.test(xfo.trim());
    const goodFa = !!fa && !fa.includes('*') && !fa.includes('https:');
    if (goodXfo || goodFa) {
      checks.push({ ...base, level: 'pass', detail: 'Other sites can’t show your page inside a hidden frame to trick people into clicking.' });
    } else if (xfo || fa) {
      checks.push({ ...base, level: 'warn', detail: 'There’s a framing rule, but it doesn’t clearly block other sites.', fix: 'Set X-Frame-Options to DENY (or SAMEORIGIN if you frame your own pages).', set: { key: 'X-Frame-Options', value: RECOMMENDED.xfo } });
    } else {
      checks.push({ ...base, level: 'fail', detail: 'Any site can put your page in a hidden frame and trick people into clicking your buttons.', fix: 'Add X-Frame-Options: DENY.', set: { key: 'X-Frame-Options', value: RECOMMENDED.xfo } });
    }
  }

  // 4. X-Content-Type-Options
  {
    const v = h('x-content-type-options');
    const base = { id: 'nosniff', label: 'No file-type guessing (nosniff)', points: 10, value: v };
    if (v && /nosniff/i.test(v)) checks.push({ ...base, level: 'pass', detail: 'Browsers won’t treat an uploaded file as a script just because it looks like one.' });
    else checks.push({ ...base, level: 'fail', detail: 'Browsers may guess a file’s type, so an uploaded “image” could run as a script.', fix: 'Add X-Content-Type-Options: nosniff.', set: { key: 'X-Content-Type-Options', value: RECOMMENDED.nosniff } });
  }

  // 5. Referrer-Policy
  {
    const v = h('referrer-policy');
    const base = { id: 'referrer', label: 'Referrer policy', points: 10, value: v };
    const last = v?.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).pop();
    if (!v) checks.push({ ...base, level: 'warn', detail: 'Not set. Modern browsers fall back to a safe default, but older ones send your full page address (with any tokens in it) to other sites.', fix: 'Add Referrer-Policy: strict-origin-when-cross-origin.', set: { key: 'Referrer-Policy', value: RECOMMENDED.referrer } });
    else if (last === 'unsafe-url' || last === 'no-referrer-when-downgrade') checks.push({ ...base, level: 'fail', detail: 'Your full page addresses, including anything in them like reset tokens, are sent to every site you link to.', fix: 'Change it to strict-origin-when-cross-origin.', set: { key: 'Referrer-Policy', value: RECOMMENDED.referrer } });
    else checks.push({ ...base, level: 'pass', detail: 'Other sites only see which site a visitor came from, not the full address.' });
  }

  // 6. Permissions-Policy
  {
    const v = h('permissions-policy');
    const base = { id: 'permissions', label: 'Permissions policy', points: 5, value: v };
    if (v) checks.push({ ...base, level: 'pass', detail: 'You’ve said which browser features (camera, microphone, location) the page and its embeds may ask for.' });
    else checks.push({ ...base, level: 'warn', detail: 'Not set, so any script or embed on the page can ask for the camera, microphone or location.', fix: 'Add a Permissions-Policy that turns off what you don’t use.', set: { key: 'Permissions-Policy', value: RECOMMENDED.permissions } });
  }

  // 7. Cookies
  const cookies = readCookies(headers);
  {
    const base = { id: 'cookies', label: 'Cookie safety flags', points: 10, value: cookies.length ? cookies.map((c) => c.name).join(', ') : null };
    if (!cookies.length) {
      checks.push({ ...base, level: 'pass', detail: 'This page doesn’t set any cookies, so there’s nothing to lock down here.' });
    } else {
      const bad = cookies.filter((c) => (https && !c.secure) || !c.httpOnly || !c.sameSite || (c.sameSite.toLowerCase() === 'none' && !c.secure));
      const missing = (c: Cookie) => [https && !c.secure && 'Secure', !c.httpOnly && 'HttpOnly', !c.sameSite && 'SameSite'].filter(Boolean).join(', ');
      if (!bad.length) checks.push({ ...base, level: 'pass', detail: `All ${cookies.length} cookie${cookies.length === 1 ? ' has' : 's have'} Secure, HttpOnly and SameSite.` });
      else {
        const noSecure = bad.some((c) => https && !c.secure);
        checks.push({
          ...base,
          level: noSecure ? 'fail' : 'warn',
          detail: bad.map((c) => `${c.name} is missing ${missing(c) || 'Secure (needed with SameSite=None)'}`).join('; ') + '.',
          fix: 'Set cookies with Secure, HttpOnly and SameSite=Lax. Only leave HttpOnly off for a cookie your own JavaScript has to read, and never for a login cookie.',
        });
      }
    }
  }

  // 8. Server version
  {
    const exposed = (['server', 'x-powered-by', 'x-aspnet-version', 'x-aspnetmvc-version', 'x-generator'] as const)
      .map((k) => [k, h(k)] as const)
      .filter(([k, v]) => v && (k !== 'server' || /\d/.test(v)));
    const base = { id: 'version', label: 'Server version hidden', points: 5, value: exposed.map(([k, v]) => `${k}: ${v}`).join(' · ') || null };
    if (!exposed.length) checks.push({ ...base, level: 'pass', detail: 'The page doesn’t say which server software or version it runs.' });
    else {
      const powered = exposed.find(([k]) => k === 'x-powered-by')?.[1] ?? '';
      const how = /next\.js/i.test(powered) ? 'In next.config.js set poweredByHeader: false.' : /express/i.test(powered) ? 'In Express call app.disable(\'x-powered-by\').' : /php/i.test(powered) ? 'Set expose_php = Off in php.ini.' : 'Turn off the version banner in your server or framework settings.';
      checks.push({ ...base, level: 'warn', detail: `The page announces ${exposed.map(([, v]) => v).join(' and ')}, which tells attackers which known bugs to try.`, fix: how });
    }
  }

  const total = checks.reduce((s, c) => s + c.points, 0);
  const earned = checks.reduce((s, c) => s + (c.level === 'pass' ? c.points : c.level === 'warn' ? c.points / 2 : 0), 0);
  const score = Math.round((earned / total) * 100);
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';

  const raw: [string, string][] = [];
  headers.forEach((v, k) => {
    if (k.toLowerCase() !== 'set-cookie') raw.push([k, v]);
  });

  return { grade, score, ...detectHost(headers, html), checks, cookies, raw };
}

function parseCsp(csp: string): Map<string, string[]> {
  const m = new Map<string, string[]>();
  // With several policies (comma-joined), the first one is enough for a grade.
  for (const part of csp.split(',')[0].split(';')) {
    const [name, ...vals] = part.trim().split(/\s+/);
    if (name && !m.has(name.toLowerCase())) m.set(name.toLowerCase(), vals);
  }
  return m;
}

function readCookies(headers: Headers): Cookie[] {
  const list: string[] = typeof (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === 'function'
    ? (headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
    : (headers.get('set-cookie') ?? '').split(/,(?=\s*[^;=\s]+=)/).filter(Boolean);
  return list.slice(0, 20).map((line) => {
    const [pair, ...attrs] = line.split(';').map((s) => s.trim());
    const a = attrs.map((s) => s.toLowerCase());
    const same = attrs.find((s) => /^samesite\s*=/i.test(s));
    return {
      name: (pair.split('=')[0] || '(unnamed)').slice(0, 60),
      secure: a.includes('secure'),
      httpOnly: a.includes('httponly'),
      sameSite: same ? same.split('=')[1].trim() : null,
    };
  });
}

function humanTime(sec: number): string {
  const days = Math.round(sec / 86400);
  if (days >= 365) return `${Math.round((days / 365) * 10) / 10} year${days >= 730 ? 's' : ''}`;
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`;
  return `${sec} seconds`;
}

// A starting CSP built from what the page actually loads, so it doesn't break the site on day one.
export function starterCsp(html: string, pageUrl: string): string {
  let self = '';
  try {
    self = new URL(pageUrl).origin;
  } catch {}
  const origins = (re: RegExp) => {
    const out = new Set<string>();
    for (const m of html.matchAll(re)) {
      try {
        const u = new URL(m[1].replace(/&amp;/g, '&'), pageUrl);
        if (u.protocol === 'https:' && u.origin !== self) out.add(u.origin);
      } catch {}
    }
    return [...out].slice(0, 12);
  };
  const scripts = origins(/<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi);
  const styles = origins(/<link\b[^>]*rel\s*=\s*["']?stylesheet[^>]*href\s*=\s*["']?([^"'\s>]+)/gi)
    .concat(origins(/<link\b[^>]*href\s*=\s*["']?([^"'\s>]+)[^>]*rel\s*=\s*["']?stylesheet/gi));
  const frames = origins(/<iframe\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi);
  // Inline scripts other than JSON data blocks. Next.js, Nuxt and many builders need these.
  const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].some(
    ([, attrs, body]) => !/\bsrc\s*=/.test(attrs) && !/type\s*=\s*["']?(application\/(ld\+)?json|text\/template|importmap)/i.test(attrs) && body.trim(),
  );
  const fonts = /fonts\.googleapis\.com/.test(html) ? ['https://fonts.gstatic.com'] : [];
  const join = (...parts: (string | string[])[]) => parts.flat().filter(Boolean).join(' ');
  const dirs = [
    "default-src 'self'",
    `script-src ${join("'self'", inline ? "'unsafe-inline'" : '', scripts)}`,
    `style-src ${join("'self'", "'unsafe-inline'", [...new Set(styles)])}`,
    "img-src 'self' data: blob: https:",
    `font-src ${join("'self'", 'data:', fonts)}`,
    "connect-src 'self' https:",
    frames.length ? `frame-src ${frames.join(' ')}` : '',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].filter(Boolean);
  return dirs.join('; ');
}

function detectHost(headers: Headers, html: string): { host: HostId; framework: string | null } {
  const h = (k: string) => (headers.get(k) ?? '').toLowerCase();
  const powered = h('x-powered-by');
  const next = /next\.js/.test(powered) || /\/_next\/static\//.test(html) || !!headers.get('x-nextjs-cache') || !!headers.get('x-nextjs-prerender');
  const framework = next ? 'Next.js' : /nuxt/.test(powered) || /\/_nuxt\//.test(html) ? 'Nuxt' : /\/_astro\//.test(html) ? 'Astro' : null;
  if (h('server') === 'vercel' || headers.get('x-vercel-id') || headers.get('x-vercel-cache')) return { host: next ? 'next' : 'vercel', framework };
  if (h('server') === 'netlify' || headers.get('x-nf-request-id')) return { host: 'netlify', framework };
  if (next) return { host: 'next', framework };
  if (h('server') === 'cloudflare' || headers.get('cf-ray')) return { host: 'cloudflare', framework };
  return { host: 'other', framework };
}
