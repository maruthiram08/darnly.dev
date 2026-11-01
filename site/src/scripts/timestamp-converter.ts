// Unix timestamp converter: everything runs in the visitor's browser with Intl. Nothing is uploaded.
import { parseInput, relative, partsIn, isoIn, dayShift, snippets, isoWeek, dayOfYear, type Parsed } from './timestamp-converter-core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLInputElement>('ts-in');
const picker = $<HTMLInputElement>('ts-pick');
const nowBtn = $<HTMLButtonElement>('ts-now-btn');
const err = $<HTMLParagraphElement>('ts-error');
const readAs = $<HTMLElement>('ts-read');
const bigDate = $<HTMLElement>('ts-date');
const bigTime = $<HTMLElement>('ts-time');
const zoneName = $<HTMLElement>('ts-zone');
const rel = $<HTMLElement>('ts-rel');
const utcLine = $<HTMLElement>('ts-utc');
const chipSec = $<HTMLButtonElement>('ts-sec');
const chipMs = $<HTMLButtonElement>('ts-ms');
const chipIso = $<HTMLButtonElement>('ts-iso');
const tickSec = $<HTMLButtonElement>('ts-tick');
const tickMs = $<HTMLElement>('ts-tick-ms');
const cities = $<HTMLDivElement>('ts-cities');
const formats = $<HTMLTableSectionElement>('ts-formats');
const tabs = document.querySelectorAll<HTMLButtonElement>('[data-ts-lang]');
const code = $<HTMLPreElement>('ts-code');
const copyCode = $<HTMLButtonElement>('ts-copy-code');
const linkBtn = $<HTMLButtonElement>('ts-link');
const status = $<HTMLParagraphElement>('ts-status');

const HERE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const CITY_LIST: [string, string][] = [
  ['San Francisco', 'America/Los_Angeles'],
  ['Denver', 'America/Denver'],
  ['Chicago', 'America/Chicago'],
  ['New York', 'America/New_York'],
  ['São Paulo', 'America/Sao_Paulo'],
  ['UTC', 'UTC'],
  ['London', 'Europe/London'],
  ['Lagos', 'Africa/Lagos'],
  ['Berlin', 'Europe/Berlin'],
  ['Paris', 'Europe/Paris'],
  ['Cairo', 'Africa/Cairo'],
  ['Istanbul', 'Europe/Istanbul'],
  ['Dubai', 'Asia/Dubai'],
  ['Karachi', 'Asia/Karachi'],
  ['Bengaluru', 'Asia/Kolkata'],
  ['Dhaka', 'Asia/Dhaka'],
  ['Bangkok', 'Asia/Bangkok'],
  ['Jakarta', 'Asia/Jakarta'],
  ['Singapore', 'Asia/Singapore'],
  ['Hong Kong', 'Asia/Hong_Kong'],
  ['Shanghai', 'Asia/Shanghai'],
  ['Tokyo', 'Asia/Tokyo'],
  ['Seoul', 'Asia/Seoul'],
  ['Sydney', 'Australia/Sydney'],
  ['Auckland', 'Pacific/Auckland'],
];
const DEFAULT_CITIES = ['America/New_York', 'Europe/London', 'Asia/Kolkata', 'Asia/Tokyo'];

let current: Parsed = { ms: Date.now(), kind: 'seconds', label: '' };
let lang: 'js' | 'postgres' | 'python' = 'js';
let zones = [...DEFAULT_CITIES];

function say(msg: string) {
  status.textContent = msg;
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    say(`Copied ${what}.`);
  } catch {
    say('Your browser blocked copying. Select the text instead.');
  }
}

const fmtDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const fmtTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
const fmtZoneLong = new Intl.DateTimeFormat(undefined, { timeZoneName: 'long' });
const fmtUtc = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'medium' });

function zoneLabel(ms: number): string {
  const name = fmtZoneLong.formatToParts(ms).find((p) => p.type === 'timeZoneName')?.value || HERE;
  return `${name} · ${partsIn(ms, HERE).offset.replace(/^\+00:00$/, '±0')}`;
}

function cityName(zone: string): string {
  return CITY_LIST.find((c) => c[1] === zone)?.[0] || zone.split('/').pop()!.replace(/_/g, ' ');
}

// One card per city, shaded by the hour there so day and night are easy to spot.
function buildCities() {
  cities.textContent = '';
  zones.forEach((zone, i) => {
    const card = document.createElement('div');
    card.className = 'city';
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', `City ${i + 1}`);
    const list = CITY_LIST.some((c) => c[1] === zone) ? CITY_LIST : [[cityName(zone), zone] as [string, string], ...CITY_LIST];
    for (const [name, z] of list) {
      const o = document.createElement('option');
      o.value = z;
      o.textContent = name;
      o.selected = z === zone;
      sel.append(o);
    }
    sel.addEventListener('change', () => {
      zones[i] = sel.value;
      buildCities();
      renderCities();
    });
    const time = document.createElement('span');
    time.className = 'city-time';
    const day = document.createElement('span');
    day.className = 'city-day';
    const off = document.createElement('span');
    off.className = 'city-off';
    card.append(sel, time, day, off);
    cities.append(card);
  });
}

function renderCities() {
  const cards = cities.querySelectorAll<HTMLDivElement>('.city');
  zones.forEach((zone, i) => {
    const card = cards[i];
    if (!card) return;
    const p = partsIn(current.ms, zone);
    const t = new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(current.ms);
    const d = new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric' }).format(current.ms);
    const shift = dayShift(current.ms, zone, HERE);
    const shiftText = shift === 0 ? '' : shift > 0 ? ` · next day` : ` · day before`;
    (card.querySelector('.city-time') as HTMLElement).textContent = t;
    (card.querySelector('.city-day') as HTMLElement).textContent = `${d}${shiftText}`;
    (card.querySelector('.city-off') as HTMLElement).textContent = `UTC${p.offset === '+00:00' ? '' : p.offset}`;
    const h = p.hour + p.minute / 60;
    card.dataset.sky = h >= 7 && h < 18 ? 'day' : h >= 5 && h < 21 ? 'dusk' : 'night';
  });
}

function rows(ms: number): [string, string][] {
  const d = new Date(ms);
  const sec = ms / 1e3;
  return [
    ['Unix seconds', String(Math.floor(sec))],
    ['Unix milliseconds', String(Math.round(ms))],
    ['ISO 8601 (UTC)', d.toISOString()],
    ['ISO 8601 (your time zone)', isoIn(ms, HERE)],
    ['RFC 2822 / HTTP date', d.toUTCString()],
    ['Your time zone', `${fmtDate.format(ms)}, ${fmtTime.format(ms)}`],
    ['Day of the year (UTC)', String(dayOfYear(ms))],
    ['Week number (ISO, UTC)', String(isoWeek(ms))],
  ];
}

function renderFormats() {
  formats.textContent = '';
  for (const [name, value] of rows(current.ms)) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = name;
    const td = document.createElement('td');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'val';
    b.title = 'Copy';
    b.textContent = value;
    b.addEventListener('click', () => copy(value, name));
    td.append(b);
    tr.append(th, td);
    formats.append(tr);
  }
}

function renderCode() {
  code.textContent = snippets(current.ms)[lang];
  tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tsLang === lang)));
}

function renderRelative() {
  rel.textContent = relative(current.ms, Date.now());
}

function render() {
  const ms = current.ms;
  readAs.textContent = current.label ? `Read as: ${current.label}` : '';
  readAs.hidden = !current.label;
  bigDate.textContent = fmtDate.format(ms);
  bigTime.textContent = fmtTime.format(ms);
  zoneName.textContent = zoneLabel(ms);
  utcLine.textContent = `${fmtUtc.format(ms)} UTC`;
  chipSec.textContent = String(Math.floor(ms / 1e3));
  chipMs.textContent = String(Math.round(ms));
  chipIso.textContent = new Date(ms).toISOString();
  renderRelative();
  renderCities();
  renderFormats();
  renderCode();
  // Keep the picker in step, in the visitor's own time zone.
  const p = partsIn(ms, HERE);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (p.year >= 1 && p.year <= 9999 && document.activeElement !== picker) {
    picker.value = `${String(p.year).padStart(4, '0')}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
  }
}

function fromInput() {
  const raw = input.value;
  if (!raw.trim()) {
    err.hidden = true;
    return;
  }
  const parsed = parseInput(raw);
  err.hidden = !!parsed;
  input.setAttribute('aria-invalid', String(!parsed));
  if (!parsed) return;
  current = parsed;
  render();
}

function setNow() {
  const s = Math.floor(Date.now() / 1e3);
  input.value = String(s);
  fromInput();
}

input.addEventListener('input', fromInput);
nowBtn.addEventListener('click', () => {
  setNow();
  say('Showing right now.');
});
picker.addEventListener('change', () => {
  if (!picker.value) return;
  const ms = new Date(picker.value).getTime();
  if (Number.isNaN(ms)) return;
  input.value = String(Math.floor(ms / 1e3));
  fromInput();
});
document.querySelectorAll<HTMLButtonElement>('[data-ts-try]').forEach((b) =>
  b.addEventListener('click', () => {
    input.value = b.dataset.tsTry || '';
    fromInput();
    input.focus();
  }),
);
chipSec.addEventListener('click', () => copy(chipSec.textContent || '', 'Unix seconds'));
chipMs.addEventListener('click', () => copy(chipMs.textContent || '', 'Unix milliseconds'));
chipIso.addEventListener('click', () => copy(chipIso.textContent || '', 'the ISO date'));
tickSec.addEventListener('click', () => copy(tickSec.textContent || '', 'the current Unix time'));
tabs.forEach((t) =>
  t.addEventListener('click', () => {
    lang = (t.dataset.tsLang as typeof lang) || 'js';
    renderCode();
  }),
);
copyCode.addEventListener('click', () => copy(code.textContent || '', 'the code'));
linkBtn.addEventListener('click', () => {
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('t', String(Math.floor(current.ms / 1e3)));
  copy(url.toString(), 'a link to this time');
});

// The live "now" ticker, and relative time that keeps counting.
function tick() {
  const now = Date.now();
  tickSec.textContent = String(Math.floor(now / 1e3));
  tickMs.textContent = String(now);
  renderRelative();
}
setInterval(tick, 250);

// Start from ?t= when someone shares a link, otherwise from right now.
const shared = new URLSearchParams(location.search).get('t');
buildCities();
if (shared) {
  input.value = shared.slice(0, 80);
  fromInput();
} else {
  setNow();
}
tick();
