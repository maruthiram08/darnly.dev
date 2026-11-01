// SSL checker: asks /api/ssl about a domain's certificate and draws the verdict, countdown,
// covered names, checks and certificate history. Shows a made-up example until the first check.

type Level = 'pass' | 'warn' | 'fail';
type Issue = { id: string; level: Level; title: string; detail: string; fix?: string; prompt?: string };
type Cert = { id: string; issuer: string; issuerName: string; notBefore: string; notAfter: string; names: string[] };
type Probe = { ok: boolean; status: number; finalUrl: string; error?: string } | null;
type Result = {
  host: string;
  www: string;
  checkedAt: string;
  status: 'secure' | 'expiring' | 'expired' | 'broken' | 'none' | 'unknown';
  live: { https: Probe; http: Probe; www: Probe; dns: boolean; wwwDns: boolean };
  current: (Cert & { daysLeft: number; daysTotal: number; coversHost: boolean; coversWww: boolean }) | null;
  history: Cert[];
  source: 'crt.sh' | 'certspotter' | null;
  hostedOn: string | null;
  issues: Issue[];
  error?: string;
};

const DAY = 86_400_000;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('ssl-form');
const input = $<HTMLInputElement>('ssl-domain');
const button = $<HTMLButtonElement>('ssl-go');
const error = $<HTMLParagraphElement>('ssl-error');
const wait = $<HTMLParagraphElement>('ssl-wait');
const exampleTag = $<HTMLParagraphElement>('ssl-example');
const hero = $<HTMLElement>('ssl-hero');
const lock = $<HTMLSpanElement>('ssl-lock');
const verdict = $<HTMLParagraphElement>('ssl-verdict');
const sub = $<HTMLParagraphElement>('ssl-sub');
const ring = $<HTMLElement>('ssl-ring') as unknown as SVGCircleElement;
const days = $<HTMLSpanElement>('ssl-days');
const daysLabel = $<HTMLSpanElement>('ssl-days-label');
const issuer = $<HTMLElement>('ssl-issuer');
const dates = $<HTMLElement>('ssl-dates');
const renews = $<HTMLElement>('ssl-renews');
const hostRow = $<HTMLDivElement>('ssl-host-row');
const hosted = $<HTMLElement>('ssl-hosted');
const names = $<HTMLUListElement>('ssl-names');
const list = $<HTMLUListElement>('ssl-list');
const promptBtn = $<HTMLButtonElement>('ssl-prompt');
const timeline = $<HTMLDivElement>('ssl-timeline');
const techBody = $<HTMLDivElement>('ssl-tech-body');

const PROMPT_LABEL = 'Copy all fixes for your AI agent';
const ORDER: Record<Level, number> = { fail: 0, warn: 1, pass: 2 };
const MARK: Record<Level, string> = { pass: '✓', warn: '!', fail: '✕' };
const WORD: Record<Level, string> = { pass: 'Fine', warn: 'Worth checking', fail: 'Needs fixing' };
const CIRC = 2 * Math.PI * 52;
let lastPrompt = '';

const ISSUER_COLORS: Record<string, string> = {
  'Let’s Encrypt': '#1E5AA8',
  'Google Trust Services': '#1A73E8',
  Cloudflare: '#F38020',
  Amazon: '#E68A00',
  DigiCert: '#0067B1',
  Sectigo: '#00A35C',
  ZeroSSL: '#3F51B5',
};
const PALETTE = ['#0593C6', '#D83995', '#6B4FD8', '#1F9D55', '#C98A00', '#4A6472'];
const issuerColor = (name: string) =>
  ISSUER_COLORS[name] ?? PALETTE[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % PALETTE.length];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string | null) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const fmt = (iso: string, year = true) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });

const SVG_NS = 'http://www.w3.org/2000/svg';
function lockIcon(open: boolean): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', '#fff');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const body = document.createElementNS(SVG_NS, 'rect');
  Object.entries({ x: '4', y: '11', width: '16', height: '10', rx: '2.5' }).forEach(([k, v]) => body.setAttribute(k, v));
  const shackle = document.createElementNS(SVG_NS, 'path');
  shackle.setAttribute('d', open ? 'M8 11V7a4 4 0 0 1 7.6-1.7' : 'M8 11V7a4 4 0 0 1 8 0v4');
  const dot = document.createElementNS(SVG_NS, 'path');
  dot.setAttribute('d', 'M12 15v2');
  svg.append(body, shackle, dot);
  return svg;
}

async function copyText(text: string, btn: HTMLButtonElement, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Couldn’t copy';
  }
  setTimeout(() => (btn.textContent = label), 1500);
}

function headline(r: Result): { tone: Level | 'unknown'; title: string; sub: string } {
  const h = r.host;
  switch (r.status) {
    case 'secure':
      return { tone: r.issues.some((i) => i.level === 'fail') ? 'warn' : 'pass', title: `${h} is secure`, sub: 'Visitors see the padlock, and the certificate is valid.' };
    case 'expiring':
      return { tone: 'warn', title: `${h} works, but the certificate runs out soon`, sub: 'Renewal looks stuck. Fix it before visitors get a warning page.' };
    case 'expired':
      return { tone: 'fail', title: `${h}’s certificate has expired`, sub: 'Visitors get a “Your connection is not private” warning.' };
    case 'broken':
      return { tone: 'fail', title: `${h} shows a security warning`, sub: 'The site answers, but not with a certificate browsers trust.' };
    case 'none':
      return { tone: 'fail', title: `${h} has no working certificate`, sub: r.live.dns ? 'https doesn’t work on this domain yet.' : 'The domain doesn’t point anywhere yet.' };
    default:
      return { tone: 'unknown', title: `We couldn’t reach ${h}`, sub: 'Check the spelling, or try again in a minute.' };
  }
}

function item(c: Issue): HTMLLIElement {
  const li = el('li', `item ${c.level}`);
  const dot = el('span', 'dot', MARK[c.level]);
  dot.setAttribute('aria-label', WORD[c.level]);
  dot.setAttribute('role', 'img');
  li.append(dot, el('p', 'label', c.title), el('p', 'detail', c.detail));
  if (c.level !== 'pass' && c.fix) {
    const fix = el('p', 'fix');
    fix.append(el('b', '', 'Fix: '), document.createTextNode(c.fix));
    li.append(fix);
  }
  if (c.level !== 'pass' && c.prompt) {
    const actions = el('div', 'actions');
    const b = el('button', '', 'Copy prompt');
    b.type = 'button';
    b.addEventListener('click', () => copyText(c.prompt!, b, 'Copy prompt'));
    actions.append(b);
    li.append(actions);
  }
  return li;
}

function renderTimeline(r: Result) {
  timeline.replaceChildren();
  const certs = [...r.history].sort((a, b) => b.notBefore.localeCompare(a.notBefore)).slice(0, 8);
  if (!certs.length) {
    timeline.append(el('p', 'empty', r.source ? 'No certificates in the public logs for this name yet.' : 'The certificate logs didn’t answer this time. Try again in a minute to see the history.'));
    return;
  }
  const now = Date.parse(r.checkedAt);
  const start = Math.min(now - 300 * DAY, ...certs.map((c) => Date.parse(c.notBefore)));
  const end = Math.max(now + 60 * DAY, ...certs.map((c) => Date.parse(c.notAfter)));
  const pos = (t: number) => `${(((t - start) / (end - start)) * 100).toFixed(2)}%`;

  for (const c of certs) {
    const row = el('div', 'row');
    const label = el('div', 'row-label');
    label.append(el('b', '', c.issuer), document.createTextNode(`${fmt(c.notBefore, false)} – ${fmt(c.notAfter)}`));
    const lane = el('div', 'lane');
    const bar = el('span', `bar${Date.parse(c.notAfter) < now ? ' old' : ''}`);
    bar.style.left = pos(Date.parse(c.notBefore));
    bar.style.width = `${(((Date.parse(c.notAfter) - Date.parse(c.notBefore)) / (end - start)) * 100).toFixed(2)}%`;
    bar.style.background = issuerColor(c.issuer);
    bar.title = `${c.issuer}: ${fmt(c.notBefore)} to ${fmt(c.notAfter)}\n${c.names.join(', ')}`;
    const today = el('span', 'today');
    today.style.left = pos(now);
    lane.append(bar, today);
    row.append(label, lane);
    timeline.append(row);
  }

  // Month marks along the bottom, plus "today".
  const axis = el('div', 'axis');
  const scale = el('div', 'axis-scale');
  // Fewer marks on a phone, and none crowding the "today" label.
  const narrow = timeline.clientWidth < 500;
  const marks = narrow ? 2 : 4;
  for (let i = 0; i <= marks; i++) {
    const t = start + ((end - start) * i) / marks;
    if (Math.abs(t - now) < (end - start) * (narrow ? 0.25 : 0.1)) continue;
    const s = el('span', '', new Date(t).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }));
    s.style.left = pos(t);
    if (i === 0) s.style.transform = 'none';
    if (i === marks) s.style.transform = 'translateX(-100%)';
    scale.append(s);
  }
  const todayLabel = el('span', 'today-label', 'today');
  todayLabel.style.left = pos(now);
  scale.append(todayLabel);
  axis.append(el('span'), scale);
  timeline.append(axis);
}

function renderTech(r: Result) {
  const table = el('table');
  const add = (k: string, v: string | Node) => {
    const tr = el('tr');
    const td = el('td');
    td.append(v);
    tr.append(el('th', '', k), td);
    table.append(tr);
  };
  const probe = (p: Probe) =>
    !p ? 'not checked' : p.ok ? `answered ${p.status}${p.finalUrl ? `, ended at ${p.finalUrl}` : ''}` : p.error === 'tls' ? 'certificate error' : p.error === 'timeout' ? 'timed out' : 'couldn’t connect';
  add(`https://${r.host}`, probe(r.live.https));
  add(`http://${r.host}`, probe(r.live.http));
  add(`https://${r.www}`, r.live.wwwDns ? probe(r.live.www) : 'no DNS record');
  if (r.current) {
    add('Issuer (raw)', el('code', '', r.current.issuerName || r.current.issuer));
    add('Valid from', new Date(r.current.notBefore).toUTCString());
    add('Valid until', new Date(r.current.notAfter).toUTCString());
    add('Lifetime', `${r.current.daysTotal} days`);
    if (r.source === 'crt.sh' && r.current.id) {
      const a = el('a', '', `crt.sh #${r.current.id}`);
      a.href = `https://crt.sh/?id=${encodeURIComponent(r.current.id)}`;
      a.target = '_blank';
      a.rel = 'noopener';
      add('Log entry', a);
    }
  }
  add('Data source', r.source === 'crt.sh' ? 'crt.sh (Certificate Transparency)' : r.source === 'certspotter' ? 'Cert Spotter (Certificate Transparency)' : r.history.length ? 'made-up example' : 'the logs didn’t answer');
  add('Checked', new Date(r.checkedAt).toLocaleString());
  const wrap = el('div', 'scroll');
  wrap.append(table);
  techBody.replaceChildren(wrap);
}

function render(r: Result) {
  const head = headline(r);
  hero.className = `hero ${head.tone}`;
  lock.replaceChildren(lockIcon(head.tone === 'fail'));
  verdict.textContent = head.title;
  sub.textContent = head.sub;

  const c = r.current;
  if (c) {
    const left = Math.max(0, c.daysLeft);
    days.textContent = String(left);
    daysLabel.textContent = left === 1 ? 'day left' : 'days left';
    ring.style.strokeDashoffset = String(CIRC * (1 - Math.min(1, left / Math.max(1, c.daysTotal))));
    const badge = el('span', 'badge', c.issuer.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase());
    badge.style.background = issuerColor(c.issuer);
    const wrap = el('span', 'issuer');
    wrap.append(badge, document.createTextNode(c.issuer));
    issuer.replaceChildren(wrap);
    dates.textContent = `${fmt(c.notBefore)} to ${fmt(c.notAfter)}`;
    // Hosts renew with about a third of the lifetime left.
    const due = Date.parse(c.notAfter) - (c.daysTotal * DAY) / 3;
    renews.textContent = due > Date.parse(r.checkedAt) ? `Automatically, around ${fmt(new Date(due).toISOString())}` : 'Any day now (it’s due)';
  } else if (r.live.https?.ok) {
    // The site works, but the logs had no dates for us.
    days.textContent = '?';
    daysLabel.textContent = 'dates unknown';
    ring.style.strokeDashoffset = String(CIRC);
    issuer.textContent = r.source ? 'Not in the logs for this exact name' : 'Logs didn’t answer, try again';
    dates.textContent = '–';
    renews.textContent = '–';
  } else {
    days.textContent = '–';
    daysLabel.textContent = 'no valid certificate';
    ring.style.strokeDashoffset = String(CIRC);
    issuer.textContent = r.history[0]?.issuer ? `${r.history[0].issuer} (last one, expired)` : 'Nobody yet';
    dates.textContent = r.history[0] ? `Ended ${fmt(r.history[0].notAfter)}` : '–';
    renews.textContent = '–';
  }
  hostRow.hidden = !r.hostedOn;
  hosted.textContent = r.hostedOn ?? '';

  // Names: the domain and its www twin first, marked covered or not, then anything else on the certificate.
  const covered = c?.names ?? [];
  const chips: HTMLLIElement[] = [];
  const mark = (name: string, ok: boolean) => {
    const li = el('li', ok ? 'yes' : 'no', `${ok ? '✓' : '✕'} ${name}`);
    li.setAttribute('aria-label', `${name}: ${ok ? 'covered' : 'not covered'}`);
    chips.push(li);
  };
  mark(r.host, !!c?.coversHost);
  if (r.live.wwwDns || c?.coversWww) mark(r.www, !!c?.coversWww);
  const rest = covered.filter((n) => n !== r.host && n !== r.www);
  rest.slice(0, 6).forEach((n) => chips.push(el('li', '', n)));
  if (rest.length > 6) chips.push(el('li', '', `+${rest.length - 6} more`));
  names.replaceChildren(...chips);

  const issues = [...r.issues].sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  list.replaceChildren(...issues.map(item));
  const todo = issues.filter((i) => i.level !== 'pass' && i.prompt);
  lastPrompt = todo.length
    ? [
        `My site ${r.host} has https problems. An SSL check found:`,
        '',
        ...todo.flatMap((i, n) => [`${n + 1}. ${i.title}: ${i.detail}${i.fix ? ` Suggested fix: ${i.fix}` : ''}`, '']),
        `${r.hostedOn ? `It looks like it’s hosted on ${r.hostedOn}. ` : ''}Work out what’s wrong from how this project is set up and deployed. Most of these are settings at my host or registrar, so tell me exactly what to click and which records to add, one step at a time.`,
      ].join('\n')
    : '';
  promptBtn.hidden = !todo.length;

  renderTimeline(r);
  renderTech(r);
}

// The made-up example shown before the first check, with dates around today.
function example(): Result {
  const now = Date.now();
  const iso = (d: number) => new Date(now + d * DAY).toISOString();
  const names = ['yoursite.com', 'www.yoursite.com'];
  const le = 'C=US, O=Let’s Encrypt, CN=R11';
  return {
    host: 'yoursite.com',
    www: 'www.yoursite.com',
    checkedAt: new Date(now).toISOString(),
    status: 'secure',
    live: { https: { ok: true, status: 200, finalUrl: 'https://yoursite.com/' }, http: { ok: true, status: 200, finalUrl: 'https://yoursite.com/' }, www: { ok: true, status: 200, finalUrl: 'https://yoursite.com/' }, dns: true, wwwDns: true },
    current: { id: '', issuer: 'Let’s Encrypt', issuerName: le, notBefore: iso(-22), notAfter: iso(68), names, daysLeft: 68, daysTotal: 90, coversHost: true, coversWww: true },
    history: [
      { id: '', issuer: 'Let’s Encrypt', issuerName: le, notBefore: iso(-22), notAfter: iso(68), names },
      { id: '', issuer: 'Let’s Encrypt', issuerName: le, notBefore: iso(-82), notAfter: iso(8), names },
      { id: '', issuer: 'Let’s Encrypt', issuerName: le, notBefore: iso(-142), notAfter: iso(-52), names },
      { id: '', issuer: 'Google Trust Services', issuerName: 'C=US, O=Google Trust Services, CN=WE1', notBefore: iso(-230), notAfter: iso(-140), names: ['yoursite.com', '*.yoursite.com'] },
    ],
    source: null,
    hostedOn: 'Vercel',
    issues: [
      { id: 'https', level: 'pass', title: 'yoursite.com loads over https', detail: 'We opened the site over a secure connection and the browser-trusted certificate checked out.' },
      { id: 'expiry', level: 'pass', title: 'Good for 68 more days', detail: 'Let’s Encrypt certificates renew automatically, so you don’t need to do anything.' },
      { id: 'www', level: 'pass', title: 'www.yoursite.com works too', detail: 'www.yoursite.com also loads over https and sends visitors to yoursite.com.' },
      { id: 'redirect', level: 'pass', title: 'http sends visitors to https', detail: 'Typing http://yoursite.com lands on the secure version.' },
    ],
  };
}

function cleanDomain(raw: string): string {
  const v = raw.trim();
  try {
    return new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).hostname.toLowerCase();
  } catch {
    return v.toLowerCase();
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const domain = cleanDomain(input.value);
  if (!domain) return;
  error.hidden = true;
  wait.hidden = false;
  button.disabled = true;
  button.textContent = 'Checking…';
  hero.classList.add('loading');
  try {
    const res = await fetch(`/api/ssl?domain=${encodeURIComponent(domain)}`);
    const data: Result = await res.json().catch(() => ({ error: 'Something went wrong. Try again.' }) as Result);
    if (!res.ok || data.error) throw new Error(data.error ?? 'Something went wrong. Try again.');
    exampleTag.hidden = true;
    input.value = data.host;
    render(data);
    history.replaceState(null, '', `?domain=${encodeURIComponent(data.host)}`);
  } catch (err) {
    error.textContent = (err as Error).message;
    error.hidden = false;
  } finally {
    hero.classList.remove('loading');
    wait.hidden = true;
    button.disabled = false;
    button.textContent = 'Check SSL';
  }
});

promptBtn.addEventListener('click', () => copyText(lastPrompt, promptBtn, PROMPT_LABEL));

render(example());

// Shared links like /tools/ssl-checker/?domain=example.com run straight away.
const preset = new URLSearchParams(location.search).get('domain') ?? new URLSearchParams(location.search).get('url');
if (preset) {
  input.value = preset;
  form.requestSubmit();
}
