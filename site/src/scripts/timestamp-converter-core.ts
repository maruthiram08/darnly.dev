// Timestamp converter logic with no DOM, so it can be tested on its own.

export type Kind = 'seconds' | 'milliseconds' | 'microseconds' | 'nanoseconds' | 'date' | 'words';
export type Parsed = { ms: number; kind: Kind; label: string };

export const KIND_LABEL: Record<Kind, string> = {
  seconds: 'Unix time in seconds',
  milliseconds: 'Unix time in milliseconds',
  microseconds: 'Unix time in microseconds',
  nanoseconds: 'Unix time in nanoseconds',
  date: 'A written date',
  words: 'Plain words',
};

// Valid range of a JS Date: ±8.64e15 ms.
const MAX_MS = 8.64e15;

const UNITS: Record<string, number> = {
  s: 1e3, sec: 1e3, secs: 1e3, second: 1e3, seconds: 1e3,
  m: 6e4, min: 6e4, mins: 6e4, minute: 6e4, minutes: 6e4,
  h: 3.6e6, hr: 3.6e6, hrs: 3.6e6, hour: 3.6e6, hours: 3.6e6,
  d: 8.64e7, day: 8.64e7, days: 8.64e7,
  w: 6.048e8, wk: 6.048e8, week: 6.048e8, weeks: 6.048e8,
};
const CAL_UNITS: Record<string, 'month' | 'year'> = {
  mo: 'month', month: 'month', months: 'month',
  y: 'year', yr: 'year', yrs: 'year', year: 'year', years: 'year',
};
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const SHORT_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function dayIndex(word: string): number {
  const i = DAYS.indexOf(word);
  if (i >= 0) return i;
  const j = SHORT_DAYS.indexOf(word.slice(0, 3));
  return j >= 0 && (word.length === 3 || DAYS[j].startsWith(word) || word === `${SHORT_DAYS[j]}s`) ? j : -1;
}

// A number of digits: guess the unit from how long it is. Today in seconds is 10 digits, in ms 13.
export function guessUnit(digits: number): Kind {
  if (digits <= 11) return 'seconds';
  if (digits <= 14) return 'milliseconds';
  if (digits <= 17) return 'microseconds';
  return 'nanoseconds';
}

function parseNumber(raw: string): Parsed | null {
  const s = raw.replace(/[\s,_']/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const intDigits = s.replace(/^-/, '').split('.')[0].replace(/^0+(?=\d)/, '').length;
  const kind = guessUnit(intDigits);
  const n = Number(s);
  const ms = kind === 'seconds' ? n * 1e3 : kind === 'milliseconds' ? n : kind === 'microseconds' ? n / 1e3 : n / 1e6;
  if (!Number.isFinite(ms) || Math.abs(ms) > MAX_MS) return null;
  return { ms, kind, label: KIND_LABEL[kind] };
}

function addCal(d: Date, unit: 'month' | 'year', n: number): Date {
  const out = new Date(d);
  if (unit === 'month') out.setMonth(out.getMonth() + n);
  else out.setFullYear(out.getFullYear() + n);
  return out;
}

function shift(now: Date, n: number, unit: string): Date | null {
  if (UNITS[unit]) return new Date(now.getTime() + n * UNITS[unit]);
  if (CAL_UNITS[unit]) return addCal(now, CAL_UNITS[unit], Math.round(n));
  return null;
}

// "9", "9am", "9:30 pm", "21:15", "noon", "midnight". Returns [hours, minutes] or null.
function parseClock(s: string): [number, number] | null {
  if (s === 'noon' || s === 'midday') return [12, 0];
  if (s === 'midnight') return [0, 0];
  const m = /^(\d{1,2})(?:[:.](\d{2}))?(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[4]?.replace(/\./g, '');
  if (!m[2] && !ap) return null; // a lone number is a timestamp, not a time
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === 'pm' && h !== 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
  } else if (h > 23) return null;
  return [h, min];
}

// Plain words, read in the visitor's own time zone: "now", "tomorrow 9am", "in 3 days", "2 hours ago", "next friday".
export function parseWords(raw: string, now: Date): Date | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]$/, '');
  if (!s) return null;
  if (s === 'now' || s === 'right now') return new Date(now);

  let m = /^(?:in )?([+-]?\d+(?:\.\d+)?|an?|one) ?([a-z]+)(?: from now)?$/.exec(s);
  if (m && (s.startsWith('in ') || s.endsWith('from now') || m[1].startsWith('+') || m[1].startsWith('-'))) {
    const n = /^\d|[+-]/.test(m[1]) ? Number(m[1]) : 1;
    return shift(now, n, m[2]);
  }
  m = /^([+-]?\d+(?:\.\d+)?|an?|one) ?([a-z]+) ago$/.exec(s);
  if (m) {
    const n = /^\d|[+-]/.test(m[1]) ? Number(m[1]) : 1;
    return shift(now, -n, m[2]);
  }

  // [day] [at] [time], in either order.
  let rest = s.replace(/\bat\b/g, ' ').replace(/\s+/g, ' ').trim();
  const found: { base: Date | null } = { base: null };
  let dayWord = false;
  const take = (re: RegExp, fn: (mm: RegExpExecArray) => Date | null) => {
    const mm = re.exec(rest);
    if (!mm) return;
    const d = fn(mm);
    if (!d) return;
    found.base = d;
    dayWord = true;
    rest = (rest.slice(0, mm.index) + rest.slice(mm.index + mm[0].length)).trim();
  };
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const plusDays = (n: number) => {
    const d = startOfDay(now);
    d.setDate(d.getDate() + n);
    return d;
  };
  take(/\b(today|tonight|this evening|this morning)\b/, () => plusDays(0));
  if (!found.base) take(/\b(tomorrow|tmrw|tmr)\b/, () => plusDays(1));
  if (!found.base) take(/\byesterday\b/, () => plusDays(-1));
  if (!found.base)
    take(/\b(next|last|this)? ?([a-z]+day|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/, (mm) => {
      const want = dayIndex(mm[2]);
      if (want < 0) return null;
      const today = now.getDay();
      let diff = (want - today + 7) % 7;
      if (mm[1] === 'last') diff = diff === 0 ? -7 : diff - 7;
      else if (mm[1] === 'next' && diff === 0) diff = 7;
      return plusDays(diff);
    });
  if (!found.base) take(/\bnext week\b/, () => plusDays(7));

  let clock: [number, number] | null = null;
  if (rest) {
    clock = parseClock(rest);
    if (!clock) return null;
  }
  if (!dayWord && !clock) return null;
  const d: Date = found.base ?? startOfDay(now);
  if (clock) d.setHours(clock[0], clock[1], 0, 0);
  else if (/tonight|this evening/.test(s)) d.setHours(20, 0, 0, 0);
  else if (/this morning/.test(s)) d.setHours(9, 0, 0, 0);
  else if (!/today/.test(s)) d.setHours(0, 0, 0, 0);
  else return new Date(now); // "today" alone: right now
  return d;
}

// Anything someone might paste: a Unix timestamp, an ISO or written date, or plain words.
export function parseInput(raw: string, now: Date = new Date()): Parsed | null {
  const s = raw.trim().replace(/^["'`]+|["'`]+$/g, '');
  if (!s) return null;
  const num = parseNumber(s);
  if (num) return num;
  const words = parseWords(s, now);
  if (words && !Number.isNaN(words.getTime())) return { ms: words.getTime(), kind: 'words', label: KIND_LABEL.words };
  // Postgres-style "2024-01-01 10:00:00+00" and "…+0530" are not read by every browser; tidy them first.
  let t = s.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/, '$1T$2').replace(/([+-]\d{2})$/, '$1:00').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  t = t.replace(/ ?(UTC|GMT|Z)$/i, 'Z').replace(/(T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?) ([+-])/, '$1$2');
  // Some browsers read almost anything as a date ("hello 2" becomes 2001), so ask for a year or a month name.
  if (!/\d{4}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(s)) return null;
  for (const candidate of [t, s]) {
    const ms = Date.parse(candidate);
    if (!Number.isNaN(ms)) return { ms, kind: 'date', label: KIND_LABEL.date };
  }
  // "March 5 2025 3pm": a date some browsers can't read with the time on the end.
  const tail = /^(.*\d{4}),? (?:at )?(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)$/i.exec(s);
  const clock = tail && parseClock(tail[2].toLowerCase());
  if (tail && clock) {
    const ms = Date.parse(tail[1]);
    if (!Number.isNaN(ms)) {
      const d = new Date(ms);
      d.setHours(clock[0], clock[1], 0, 0);
      return { ms: d.getTime(), kind: 'date', label: KIND_LABEL.date };
    }
  }
  return null;
}

// "in 3 days", "5 minutes ago", using the browser's own words for the language.
export function relative(ms: number, now: number, locale?: string): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  if (abs < 1500) return 'right now';
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [6e4, 'second'],
    [3.6e6, 'minute'],
    [8.64e7, 'hour'],
    [6.048e8, 'day'],
    [2.592e9, 'week'],
    [3.1536e10, 'month'],
    [Infinity, 'year'],
  ];
  const size: Record<string, number> = { second: 1e3, minute: 6e4, hour: 3.6e6, day: 8.64e7, week: 6.048e8, month: 2.592e9, year: 3.1536e10 };
  for (const [limit, unit] of steps) {
    if (abs < limit) return rtf.format(Math.round(diff / size[unit]), unit);
  }
  return '';
}

// Calendar parts of a moment in a given zone.
export function partsIn(ms: number, timeZone: string) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(ms)) p[part.type] = part.value;
  const off = (p.timeZoneName || 'GMT').replace('GMT', '') || '+00:00';
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    second: Number(p.second),
    offset: off,
  };
}

// The same moment as an ISO string with the zone's own offset, like 2026-11-01T23:30:00+05:30.
export function isoIn(ms: number, timeZone: string): string {
  const p = partsIn(ms, timeZone);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const y = p.year < 0 || p.year > 9999 ? (p.year < 0 ? '-' : '+') + pad(Math.abs(p.year), 6) : pad(p.year, 4);
  return `${y}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${p.offset === '+00:00' ? 'Z' : p.offset}`;
}

// How many calendar days the zone is ahead of or behind another zone at this moment: -1, 0 or +1.
export function dayShift(ms: number, zone: string, from: string): number {
  const a = partsIn(ms, zone);
  const b = partsIn(ms, from);
  return Math.round((Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)) / 8.64e7);
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

export function snippets(ms: number) {
  const sec = ms / 1e3;
  const secText = trimNum(sec);
  const iso = new Date(ms).toISOString();
  return {
    js: `// From a timestamp (JavaScript wants milliseconds)\nconst date = new Date(${trimNum(ms)});\ndate.toISOString(); // "${iso}"\n\n// Back to Unix seconds\nMath.floor(date.getTime() / 1000); // ${Math.floor(sec)}`,
    postgres: `-- From Unix seconds to a timestamptz\nSELECT to_timestamp(${secText});\n\n-- Back to Unix seconds\nSELECT extract(epoch FROM timestamptz '${iso}')::bigint;\n\n-- Rows from the last 24 hours\nSELECT * FROM events WHERE created_at > now() - interval '24 hours';`,
    python: `from datetime import datetime, timezone\n\n# From Unix seconds\ndt = datetime.fromtimestamp(${secText}, tz=timezone.utc)\ndt.isoformat()  # '${iso.replace('.000Z', '+00:00').replace('Z', '+00:00')}'\n\n# Back to Unix seconds\nint(dt.timestamp())  # ${Math.floor(sec)}`,
  };
}

// Week number by ISO 8601 (weeks start on Monday, week 1 holds the first Thursday).
export function isoWeek(ms: number): number {
  const d = new Date(ms);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - yearStart) / 8.64e7 + 1) / 7);
}

export function dayOfYear(ms: number): number {
  const d = new Date(ms);
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 8.64e7) + 1;
}
