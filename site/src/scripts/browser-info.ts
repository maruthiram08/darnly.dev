// Browser info: everything is read live in the visitor's browser. The only request is /api/whoami,
// which sends back the visitor's own country and IP address and stores nothing.
import { flag, major, markdown, parse, plain, tailwindBreakpoint, utcOffset, type Hints, type Parsed, type Row } from './browser-info-core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const set = (id: string, text: string) => {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
};

type NavExtra = Navigator & {
  userAgentData?: {
    brands: { brand: string; version: string }[];
    mobile: boolean;
    platform: string;
    getHighEntropyValues(h: string[]): Promise<Record<string, unknown>>;
  };
  brave?: { isBrave(): Promise<boolean> };
  connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean; type?: string; addEventListener?: (t: string, f: () => void) => void };
  deviceMemory?: number;
};
const nav = navigator as NavExtra;

const mq = (q: string) => window.matchMedia(q).matches;
const statusEl = $<HTMLParagraphElement>('bi-status');
let parsed: Parsed = parse(navigator.userAgent, {}, { touchPoints: navigator.maxTouchPoints });
let hintsRaw: Record<string, unknown> | null = null;
let where: { ip: string; country: string } | null = null;
let whereState: 'loading' | 'ok' | 'failed' = 'loading';

function say(msg: string) {
  statusEl.textContent = msg;
  window.clearTimeout(say.timer);
  say.timer = window.setTimeout(() => (statusEl.textContent = ''), 3000);
}
say.timer = 0;

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    say(done);
  } catch {
    say('Your browser blocked copying. Open “See what gets copied” and select the text instead.');
  }
}

function countryName(code: string): string {
  if (code === 'T1') return 'Hidden (Tor)';
  if (!code || code === 'XX') return 'Unknown';
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

// Everything that changes when the window is resized or settings flip.
function live() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const sw = screen.width;
  const sh = screen.height;
  const dpr = window.devicePixelRatio || 1;
  const dprText = `${Math.round(dpr * 100) / 100}x`;

  set('bi-viewport', `${vw} × ${vh}`);
  set('bi-bp', `Tailwind: ${tailwindBreakpoint(vw)}`);
  set('bi-screen', `${sw} × ${sh}`);
  set('bi-dpr', dprText);
  set('bi-dpr-note', dpr >= 2 ? 'A sharp “Retina” screen: 1 CSS pixel is drawn with ' + dprText.replace('x', '') + ' real pixels across.' : dpr === 1 ? 'A standard screen: 1 CSS pixel is 1 real pixel. Browser zoom also changes this.' : 'Usually from Windows display scaling or browser zoom.');

  // The drawing: the screen as an outline, the viewport inside it, both to scale.
  const box = $<HTMLDivElement>('bi-draw');
  const maxW = box.clientWidth || 260;
  const maxH = 170;
  const scale = Math.min(maxW / Math.max(sw, vw), maxH / Math.max(sh, vh));
  const scr = $<HTMLDivElement>('bi-draw-screen');
  const vp = $<HTMLDivElement>('bi-draw-vp');
  scr.style.width = `${Math.round(sw * scale)}px`;
  scr.style.height = `${Math.round(sh * scale)}px`;
  vp.style.width = `${Math.max(8, Math.round(vw * scale))}px`;
  vp.style.height = `${Math.max(8, Math.round(vh * scale))}px`;

  const dark = mq('(prefers-color-scheme: dark)');
  set('bi-scheme', dark ? 'Dark' : 'Light');
  $<HTMLDivElement>('bi-scheme-card').dataset.dark = String(dark);
  set('bi-scheme-note', dark ? 'Your system asks sites for dark mode. Sites that support it should look dark now.' : 'Your system asks sites for light mode (or has no preference).');

  const reduce = mq('(prefers-reduced-motion: reduce)');
  set('bi-motion', reduce ? 'Reduced' : 'Full motion');
  set('bi-motion-note', reduce ? 'You asked for less motion. Animations should be calm or off.' : 'No request for less motion, so animations play as designed.');
  $<HTMLDivElement>('bi-motion-card').dataset.reduce = String(reduce);

  const coarse = mq('(pointer: coarse)');
  const fine = mq('(any-pointer: fine)');
  const tp = navigator.maxTouchPoints || 0;
  set('bi-touch', tp > 0 ? (coarse ? 'Touch screen' : 'Touch + mouse') : 'No touch');
  set('bi-touch-note', tp > 0 ? `Up to ${tp} fingers at once. Main pointer: ${coarse ? 'finger' : 'mouse or trackpad'}${fine && coarse ? ', with a mouse too' : ''}.` : 'Mouse or trackpad only. Hover effects work here.');

  const c = nav.connection;
  if (c && (c.effectiveType || c.downlink)) {
    const speed = c.effectiveType ? c.effectiveType.toUpperCase().replace('SLOW-2G', 'Slow 2G') : '';
    set('bi-net', `${navigator.onLine ? '' : 'Offline · '}${speed || 'Online'}`);
    const bits = [c.downlink ? `about ${c.downlink} Mbps` : '', c.rtt != null ? `${c.rtt} ms round trip` : '', c.saveData ? 'Data Saver on' : ''].filter(Boolean);
    set('bi-net-note', `Speed class as the browser rates it${bits.length ? `: ${bits.join(', ')}` : ''}. “4G” means fast, not mobile data.`);
  } else {
    set('bi-net', navigator.onLine ? 'Online' : 'Offline');
    set('bi-net-note', 'This browser doesn’t share connection speed (Safari and Firefox keep it private).');
  }

  renderReport();
}

function staticInfo() {
  const p = parsed;
  const name = p.version ? `${p.browser} ${major(p.version)}` : p.browser;
  const osName = p.osVersion ? `${p.os} ${p.osVersion}` : p.os;
  set('bi-headline-browser', name);
  set('bi-headline-os', osName);
  set('bi-headline-device', p.model && p.model !== 'iPhone' && p.model !== 'iPad' ? `${p.device} · ${p.model}` : p.device);

  set('bi-browser', name);
  set('bi-browser-note', [p.version ? `Full version ${p.version}` : 'Version not shared', `${p.engine} engine`].join(' · '));
  set('bi-os', osName);
  set(
    'bi-os-note',
    p.os === 'macOS' && !p.osVersion
      ? 'This browser hides the exact macOS version. Apple menu → About This Mac shows it.'
      : p.os === 'Windows' && p.osVersion === '10 or 11'
        ? 'This browser can’t tell Windows 10 from 11. Chrome and Edge can.'
        : p.os === 'iPadOS'
          ? 'iPads ask for the desktop version of sites, so they look like a Mac to most code.'
          : 'As reported by your browser.',
  );
  set('bi-device', p.device);
  set('bi-device-note', p.model ? `Model: ${p.model}` : p.device === 'Desktop' ? 'A laptop or desktop computer.' : 'Model not shared by this browser.');
  $<HTMLDivElement>('bi-device-card').dataset.device = p.device.toLowerCase();

  const langs = (navigator.languages?.length ? navigator.languages : [navigator.language]).filter(Boolean);
  let langName = langs[0] ?? 'Unknown';
  try {
    langName = new Intl.DisplayNames(['en'], { type: 'language' }).of(langs[0]) ?? langName;
  } catch {
    /* keep the code */
  }
  set('bi-lang', langName);
  set('bi-lang-note', `${langs.slice(0, 4).join(', ')}${langs.length > 4 ? '…' : ''}${langs.length > 1 ? ' (in order of preference)' : ''}`);

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown';
  set('bi-tz', tz.replace(/_/g, ' '));
  tick();

  const cookies = navigator.cookieEnabled;
  let storage = false;
  try {
    localStorage.setItem('darnly-bi', '1');
    localStorage.removeItem('darnly-bi');
    storage = true;
  } catch {
    storage = false;
  }
  set('bi-cookies', cookies ? 'On' : 'Off');
  $<HTMLDivElement>('bi-cookies-card').dataset.ok = String(cookies && storage);
  set('bi-cookies-note', cookies && storage ? 'Cookies and local storage both work, so logins can stick.' : !cookies ? 'Cookies are blocked. Logins and carts on most sites will break.' : 'Cookies work, but local storage is blocked (private mode or a strict setting).');
}

function tick() {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  set('bi-tz-note', `${utcOffset(-now.getTimezoneOffset())} · it’s ${time} for you`);
}

function renderWhere() {
  if (whereState === 'loading') {
    set('bi-country', 'Checking…');
    set('bi-country-note', '');
    return;
  }
  if (whereState === 'failed' || !where) {
    set('bi-country', 'Couldn’t check');
    set('bi-country-note', 'The lookup didn’t answer. Everything else on this page still works.');
    $<HTMLButtonElement>('bi-ip').hidden = true;
    return;
  }
  const f = flag(where.country);
  set('bi-country', `${f ? f + ' ' : ''}${countryName(where.country)}`);
  set('bi-country-note', 'Where your internet connection appears to come from. A VPN changes this.');
  const ipBtn = $<HTMLButtonElement>('bi-ip');
  ipBtn.hidden = !where.ip;
  ipBtn.textContent = where.ip;
}

// The rows that go into the report, in the order a developer wants them.
function rows(): Row[] {
  const p = parsed;
  const r: Row[] = [];
  r.push({ label: 'Browser', value: p.version ? `${p.browser} ${p.version}` : p.browser });
  r.push({ label: 'OS', value: p.osVersion ? `${p.os} ${p.osVersion}` : p.os });
  r.push({ label: 'Device', value: p.model ? `${p.device} (${p.model})` : p.device });
  r.push({ label: 'Viewport', value: `${window.innerWidth} × ${window.innerHeight} (Tailwind ${tailwindBreakpoint(window.innerWidth).split(' ')[0]})` });
  r.push({ label: 'Screen', value: `${screen.width} × ${screen.height} at ${Math.round((window.devicePixelRatio || 1) * 100) / 100}x` });
  r.push({ label: 'Color scheme', value: mq('(prefers-color-scheme: dark)') ? 'Dark' : 'Light' });
  r.push({ label: 'Reduced motion', value: mq('(prefers-reduced-motion: reduce)') ? 'On' : 'Off' });
  r.push({ label: 'Language', value: (navigator.languages?.length ? navigator.languages : [navigator.language]).slice(0, 3).join(', ') });
  const now = new Date();
  r.push({ label: 'Time zone', value: `${Intl.DateTimeFormat().resolvedOptions().timeZone} (${utcOffset(-now.getTimezoneOffset())})` });
  const tp = navigator.maxTouchPoints || 0;
  r.push({ label: 'Touch', value: tp > 0 ? `Yes (${mq('(pointer: coarse)') ? 'main pointer is touch' : 'main pointer is a mouse'})` : 'No' });
  r.push({ label: 'Cookies', value: navigator.cookieEnabled ? 'On' : 'Off' });
  const c = nav.connection;
  if (c?.effectiveType) r.push({ label: 'Connection', value: `${c.effectiveType}${c.downlink ? `, ~${c.downlink} Mbps` : ''}${c.saveData ? ', Data Saver on' : ''}` });
  if (where?.country) r.push({ label: 'Country', value: countryName(where.country) });
  if (where?.ip && $<HTMLInputElement>('bi-include-ip').checked) r.push({ label: 'IP address', value: where.ip });
  if ($<HTMLInputElement>('bi-include-ua').checked) r.push({ label: 'User agent', value: `\`${navigator.userAgent}\`` });
  return r;
}

function when(): string {
  const d = new Date();
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function renderReport() {
  $<HTMLPreElement>('bi-report').textContent = markdown(rows(), when());
}

function details() {
  const tbody = $<HTMLTableSectionElement>('bi-tech');
  const add = (k: string, v: string) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = k;
    const td = document.createElement('td');
    td.textContent = v;
    tr.append(th, td);
    tbody.append(tr);
  };
  tbody.textContent = '';
  add('User agent', navigator.userAgent);
  if (hintsRaw) add('Client hints', JSON.stringify(hintsRaw, null, 1).replace(/\n\s*/g, ' '));
  else add('Client hints', 'Not offered by this browser (only Chrome, Edge and other Chromium browsers send them).');
  add('Platform', navigator.platform || 'Unknown');
  add('CPU cores', String(navigator.hardwareConcurrency || 'Not shared'));
  add('Memory', nav.deviceMemory ? `About ${nav.deviceMemory} GB (rounded by the browser)` : 'Not shared');
  add('Graphics', gpu());
  add('Color gamut', mq('(color-gamut: p3)') ? 'Wide (P3)' : mq('(color-gamut: srgb)') ? 'Standard (sRGB)' : 'Unknown');
  add('HDR screen', mq('(dynamic-range: high)') ? 'Yes' : 'No');
  add('More contrast', mq('(prefers-contrast: more)') ? 'Asked for' : 'No');
  add('Forced colors', mq('(forced-colors: active)') ? 'On (Windows high contrast)' : 'Off');
  add('Do Not Track', navigator.doNotTrack === '1' ? 'On' : 'Off');
  add('PDF viewer built in', 'pdfViewerEnabled' in navigator ? String((navigator as Navigator & { pdfViewerEnabled: boolean }).pdfViewerEnabled ? 'Yes' : 'No') : 'Unknown');
  add('Online', navigator.onLine ? 'Yes' : 'No');
}

function gpu(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return 'WebGL is off';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return String(name || 'Not shared');
  } catch {
    return 'Not shared';
  }
}

async function loadHints() {
  const uad = nav.userAgentData;
  let brave = false;
  try {
    brave = nav.brave ? await nav.brave.isBrave() : false;
  } catch {
    brave = false;
  }
  if (!uad) {
    parsed = parse(navigator.userAgent, {}, { touchPoints: navigator.maxTouchPoints, brave });
    return;
  }
  let hints: Hints = { brands: uad.brands, platform: uad.platform, mobile: uad.mobile };
  try {
    const h = await uad.getHighEntropyValues(['platformVersion', 'fullVersionList', 'model', 'architecture', 'bitness']);
    hintsRaw = h;
    hints = {
      brands: (h.fullVersionList as Hints['brands']) ?? uad.brands,
      platform: (h.platform as string) ?? uad.platform,
      platformVersion: h.platformVersion as string,
      mobile: (h.mobile as boolean) ?? uad.mobile,
      model: h.model as string,
    };
  } catch {
    hintsRaw = { brands: uad.brands, platform: uad.platform, mobile: uad.mobile };
  }
  parsed = parse(navigator.userAgent, hints, { touchPoints: navigator.maxTouchPoints, brave });
}

async function loadWhere() {
  try {
    const res = await fetch('/api/whoami', { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { ip?: string; country?: string };
    where = { ip: data.ip ?? '', country: data.country ?? '' };
    whereState = 'ok';
  } catch {
    whereState = 'failed';
  }
  renderWhere();
  renderReport();
}

// First paint straight from the user agent, then refine with client hints and the country.
staticInfo();
renderWhere();
live();
details();
loadHints().then(() => {
  staticInfo();
  details();
  renderReport();
});
loadWhere();

let resizeFrame = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(live);
});
for (const q of ['(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)', '(pointer: coarse)']) {
  window.matchMedia(q).addEventListener?.('change', live);
}
window.addEventListener('online', live);
window.addEventListener('offline', live);
nav.connection?.addEventListener?.('change', live);
window.setInterval(tick, 15_000);

$<HTMLInputElement>('bi-include-ip').addEventListener('change', renderReport);
$<HTMLInputElement>('bi-include-ua').addEventListener('change', renderReport);
for (const id of ['bi-copy', 'bi-copy-2']) {
  $<HTMLButtonElement>(id).addEventListener('click', () => copy(markdown(rows(), when()), 'Copied. Paste it into your bug report, GitHub issue or chat with your AI agent.'));
}
$<HTMLButtonElement>('bi-copy-plain').addEventListener('click', () => copy(plain(rows(), when()), 'Copied as plain text, ready for an email or a support chat.'));
$<HTMLButtonElement>('bi-ip').addEventListener('click', () => where?.ip && copy(where.ip, `Copied ${where.ip}.`));
$<HTMLButtonElement>('bi-share').addEventListener('click', () => copy('https://darnly.dev/tools/browser-info/', 'Copied the link. Send it to anyone and ask them to press “Copy for a bug report”.'));
