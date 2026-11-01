// Cron builder: the pure logic (parse, explain, next runs, snippets), kept apart from the page so it is easy to test.
// Standard 5-part cron: minute hour day-of-month month day-of-week, as Vercel, GitHub Actions,
// Supabase pg_cron and Cloudflare Cron Triggers read it.

export type Field = { values: number[]; any: boolean; text: string };
export type Cron = { minute: Field; hour: Field; dom: Field; month: Field; dow: Field; expr: string };
export type Parsed = { ok: true; cron: Cron; note?: string } | { ok: false; error: string };

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

const SPECS = [
  { key: 'minute', label: 'minute', min: 0, max: 59 },
  { key: 'hour', label: 'hour', min: 0, max: 23 },
  { key: 'dom', label: 'day of the month', min: 1, max: 31 },
  { key: 'month', label: 'month', min: 1, max: 12, names: MONTHS },
  { key: 'dow', label: 'day of the week', min: 0, max: 7, names: DAYS },
] as const;

function num(s: string, spec: (typeof SPECS)[number]): number {
  const up = s.toUpperCase();
  if ('names' in spec) {
    const i = spec.names.indexOf(up);
    if (i >= 0) return spec.key === 'month' ? i + 1 : i;
  }
  if (!/^\d+$/.test(s)) throw new Error(`“${s}” is not a number for the ${spec.label}.`);
  const n = Number(s);
  if (n < spec.min || n > spec.max) throw new Error(`${n} is out of range for the ${spec.label} (${spec.min} to ${spec.max}).`);
  return n;
}

function parseField(text: string, spec: (typeof SPECS)[number]): Field {
  const bare = 'names' in spec ? text.toUpperCase().replace(new RegExp(spec.names.join('|'), 'g'), '') : text;
  if (/[LW#]/i.test(bare)) {
    throw new Error(`“${text}” uses L, W or #. Those are Quartz extras that Vercel, GitHub and Cloudflare don't read.`);
  }
  const set = new Set<number>();
  const t = text === '?' ? '*' : text;
  for (const part of t.split(',')) {
    if (!part) throw new Error(`The ${spec.label} has an empty item in its list.`);
    const [range, stepS, extra] = part.split('/');
    if (extra !== undefined) throw new Error(`“${part}” has more than one “/”.`);
    let step = 1;
    if (stepS !== undefined) {
      if (!/^\d+$/.test(stepS) || Number(stepS) < 1) throw new Error(`“/${stepS}” needs a whole number of 1 or more.`);
      step = Number(stepS);
    }
    let lo: number;
    let hi: number;
    if (range === '*') {
      lo = spec.min;
      hi = spec.key === 'dow' ? 6 : spec.max;
    } else if (range.includes('-')) {
      const [a, b, c] = range.split('-');
      if (c !== undefined || !a || !b) throw new Error(`“${range}” is not a valid range.`);
      lo = num(a, spec);
      hi = num(b, spec);
      if (lo > hi) throw new Error(`“${range}” goes backwards. Write the smaller one first.`);
    } else {
      lo = num(range, spec);
      hi = stepS !== undefined ? (spec.key === 'dow' ? 6 : spec.max) : lo;
    }
    for (let v = lo; v <= hi; v += step) set.add(spec.key === 'dow' && v === 7 ? 0 : v);
  }
  return { values: [...set].sort((a, b) => a - b), any: t.startsWith('*'), text };
}

export function parse(input: string): Parsed {
  let expr = input.trim().replace(/\s+/g, ' ');
  let note: string | undefined;
  if (!expr) return { ok: false, error: 'Type a cron expression, like 0 9 * * 1-5.' };
  if (expr.startsWith('@')) {
    const m = MACROS[expr.toLowerCase()];
    if (!m) return { ok: false, error: `${expr} isn't something these platforms read. Try @hourly, @daily, @weekly, @monthly or @yearly.` };
    note = `${expr} is short for ${m}.`;
    expr = m;
  }
  const parts = expr.split(' ');
  if (parts.length === 6) {
    return { ok: false, error: 'This has 6 parts. That is the style with seconds first (Spring, Quartz). Vercel, GitHub and Cloudflare use 5: remove the first one.' };
  }
  if (parts.length !== 5) {
    return { ok: false, error: `A cron expression has 5 parts with spaces between: minute, hour, day of the month, month, day of the week. This one has ${parts.length}.` };
  }
  try {
    const f = parts.map((p, i) => parseField(p, SPECS[i]));
    return { ok: true, cron: { minute: f[0], hour: f[1], dom: f[2], month: f[3], dow: f[4], expr }, note };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---------- Next runs (UTC) ----------

function dayMatches(c: Cron, d: Date): boolean {
  if (!c.month.values.includes(d.getUTCMonth() + 1)) return false;
  const domOk = c.dom.values.includes(d.getUTCDate());
  const dowOk = c.dow.values.includes(d.getUTCDay());
  // Classic cron rule: when both day fields are restricted, a day matching EITHER one counts.
  if (!c.dom.any && !c.dow.any) return domOk || dowOk;
  return domOk && dowOk;
}

// Run times from `from` (exclusive), oldest first, up to `limit` or until `until`.
export function nextRuns(c: Cron, from: Date, limit: number, until?: Date): Date[] {
  const out: Date[] = [];
  const start = Math.floor(from.getTime() / 60000) * 60000 + 60000;
  const day = new Date(start);
  day.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < 366 * 8 && out.length < limit; i++) {
    const d = new Date(day.getTime() + i * 86400000);
    if (until && d > until) break;
    if (!dayMatches(c, d)) continue;
    for (const h of c.hour.values) {
      for (const m of c.minute.values) {
        const t = d.getTime() + h * 3600000 + m * 60000;
        if (t < start) continue;
        if (until && t > until.getTime()) return out;
        out.push(new Date(t));
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

// ---------- Plain English ----------

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
  return `${n}${s}`;
}

export function andList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function clock(h: number, m: number): string {
  if (m === 0 && h === 0) return 'midnight';
  if (m === 0 && h === 12) return 'noon';
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
}

const hourName = (h: number) => (h === 0 ? 'midnight' : h === 12 ? 'noon' : `${h % 12} ${h < 12 ? 'AM' : 'PM'}`);

// If a field is an even step (like */15 or 9-17/2), give the step and where it starts.
function stepOf(f: Field, full: number): { step: number; start: number } | null {
  const v = f.values;
  if (v.length < 2) return null;
  const step = v[1] - v[0];
  for (let i = 1; i < v.length; i++) if (v[i] - v[i - 1] !== step) return null;
  if (v[v.length - 1] + step < full) return null; // must run to the end of the range
  return { step, start: v[0] };
}

function isRange(f: Field): boolean {
  const v = f.values;
  return v.length > 1 && v[v.length - 1] - v[0] === v.length - 1;
}

function timePart(c: Cron): { text: string; frequent: boolean } {
  const mins = c.minute.values;
  const hours = c.hour.values;
  const mAll = mins.length === 60;
  const hAll = hours.length === 24;
  if (mins.length * hours.length <= 6 && !hAll) {
    const times: string[] = [];
    for (const h of hours) for (const m of mins) times.push(clock(h, m));
    return { text: `at ${andList(times)}`, frequent: false };
  }
  const ms = stepOf(c.minute, 60);
  let mText: string;
  if (mAll) mText = 'every minute';
  else if (ms && ms.start === 0) mText = `every ${ms.step} minutes`;
  else if (ms) mText = `every ${ms.step} minutes from minute ${ms.start}`;
  else if (mins.length === 1) mText = mins[0] === 0 ? 'on the hour' : `at ${mins[0]} minutes past`;
  else mText = `at minutes ${andList(mins.map(String))}`;
  const multi = mAll || !!ms || mins.length > 1;

  if (hAll) {
    if (multi) return { text: mText, frequent: true };
    return { text: mins[0] === 0 ? 'every hour, on the hour' : `every hour at ${mins[0]} minutes past`, frequent: true };
  }
  const hs = stepOf(c.hour, 24);
  if (hs && !multi) {
    const at = mins[0] === 0 ? 'on the hour' : `at ${mins[0]} minutes past`;
    const from = hs.start === 0 ? '' : `, starting at ${hourName(hs.start)}`;
    return { text: `every ${hs.step} hours, ${at}${from}`, frequent: true };
  }
  if (isRange(c.hour)) {
    const last = mins[mins.length - 1];
    const span = `between ${clock(hours[0], mins[0])} and ${clock(hours[hours.length - 1], last)}`;
    return { text: multi ? `${mText}, ${span}` : `every hour ${mins[0] === 0 ? 'on the hour' : `at ${mins[0]} minutes past`}, ${span}`, frequent: true };
  }
  return { text: `${mText} during the ${andList(hours.map(hourName))} hour${hours.length > 1 ? 's' : ''}`, frequent: true };
}

function dayPart(c: Cron): string {
  const parts: string[] = [];
  const dow = c.dow.values;
  const dom = c.dom.values;
  let dowText = '';
  if (!c.dow.any || dow.length < 7) {
    const key = dow.join(',');
    if (key === '1,2,3,4,5') dowText = 'on weekdays (Monday to Friday)';
    else if (key === '0,6') dowText = 'on weekends';
    else if (dow.length === 1) dowText = `on ${DAY_NAMES[dow[0]]}s`;
    else if (isRange(c.dow) && dow.length > 2) dowText = `${DAY_NAMES[dow[0]]} to ${DAY_NAMES[dow[dow.length - 1]]}`;
    else dowText = `on ${andList(dow.map((d) => DAY_NAMES[d]))}`;
  }
  let domText = '';
  if (!c.dom.any || dom.length < 31) {
    const st = stepOf(c.dom, 32);
    if (dom.length > 6 && st) domText = `every ${st.step} days of the month, from the ${ordinal(st.start)}`;
    else if (dom.length > 6 && isRange(c.dom)) domText = `from the ${ordinal(dom[0])} to the ${ordinal(dom[dom.length - 1])} of the month`;
    else domText = `on the ${andList(dom.map(ordinal))} of the month`;
  }
  const mon = c.month.values;
  if (dom.length === 1 && mon.length === 1 && !dowText) return `every year on ${MONTH_NAMES[mon[0] - 1]} ${ordinal(dom[0])}`;
  if (domText && dowText) {
    const also = dow.length === 1 ? `every ${DAY_NAMES[dow[0]]}` : dowText.startsWith('on ') ? dowText.replace(/^on /, 'every ').replace(/s\b/g, '').replace('every weekday (Monday to Friday)', 'every weekday').replace('every weekend', 'every weekend day').replace(/ \(Monday to Friday\)/, '') : `every day from ${dowText}`;
    parts.push(`${domText}, and also ${also}`);
  }
  else if (domText) parts.push(domText);
  else if (dowText) parts.push(dowText.startsWith('on ') ? dowText : `from ${dowText}`);

  if (mon.length < 12) {
    if (isRange(c.month) && mon.length > 2) parts.push(`from ${MONTH_NAMES[mon[0] - 1]} to ${MONTH_NAMES[mon[mon.length - 1] - 1]}`);
    else parts.push(`in ${andList(mon.map((m) => MONTH_NAMES[m - 1]))}`);
  }
  return parts.join(', ');
}

export function describe(c: Cron): string {
  const t = timePart(c);
  const d = dayPart(c);
  const s = d ? `${t.text}, ${d}` : t.frequent ? t.text : `${t.text}, every day`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- Warnings per platform ----------

export type Warning = { who: string; text: string };

export function warnings(c: Cron, runs: Date[]): Warning[] {
  const out: Warning[] = [];
  let minGap = Infinity;
  for (let i = 1; i < runs.length; i++) minGap = Math.min(minGap, runs[i].getTime() - runs[i - 1].getTime());
  const perDay = c.minute.values.length * c.hour.values.length;
  if (!c.dom.any && !c.dow.any) {
    out.push({ who: 'Heads up', text: 'You set both a day of the month and a day of the week. Cron runs on days that match either one, not only days that match both.' });
  }
  if (minGap < 5 * 60000) out.push({ who: 'GitHub Actions', text: 'Runs at most every 5 minutes, and runs can start late when GitHub is busy.' });
  if (perDay > 1) out.push({ who: 'Vercel', text: 'On the free Hobby plan a cron job can run only once a day. This schedule needs the Pro plan.' });
  if (runs.length === 0) out.push({ who: 'Heads up', text: 'This never runs (for example, 31 February). Check the day and month.' });
  return out;
}

// ---------- Snippets ----------

// Numbers everywhere, so every platform reads it the same way.
export function numeric(c: Cron): string {
  const fields = [c.minute, c.hour, c.dom, c.month, c.dow];
  return fields
    .map((f, i) => (/[A-Z]/i.test(f.text) ? f.text.toUpperCase().replace(/[A-Z]{3}/g, (n) => String(i === 3 ? MONTHS.indexOf(n) + 1 : DAYS.indexOf(n))) : f.text))
    .join(' ');
}

// Cloudflare: day names, since its day numbers start at a different place than standard cron.
export function cloudflare(c: Cron): string {
  const n = numeric(c).split(' ');
  if (!c.dow.any) n[4] = n[4].replace(/\d+/g, (d) => DAYS[Number(d) % 7]);
  return n.join(' ');
}

export function snippets(c: Cron, name = 'my-job') {
  const expr = numeric(c);
  return {
    vercel: `{\n  "crons": [\n    {\n      "path": "/api/cron/${name}",\n      "schedule": "${expr}"\n    }\n  ]\n}`,
    github: `on:\n  schedule:\n    - cron: '${expr}'\n  workflow_dispatch: # lets you run it by hand too`,
    supabase: `select cron.schedule(\n  '${name}',\n  '${expr}',\n  $$ select 1; -- your SQL here $$\n);`,
    cloudflare: `// wrangler.jsonc\n"triggers": {\n  "crons": ["${cloudflare(c)}"]\n}`,
  };
}

// ---------- Builder (plain words to cron) ----------

export type Freq = 'minutes' | 'hours' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type Build = {
  freq: Freq;
  everyMin: number; // minutes: every N minutes
  everyHour: number; // hours: every N hours
  atMinute: number; // hours: at minute M
  time: string; // HH:MM
  days: 'every' | 'weekdays' | 'weekends'; // daily
  weekdays: number[]; // weekly, 0 = Sunday
  dom: number; // monthly / yearly
  month: number; // yearly, 1-12
  offset: number; // minutes to add to the picked time to get UTC (0 when the time is already UTC)
};

export type Built = { expr: string; shiftNote?: string };

export function build(b: Build): Built {
  const [hh, mm] = b.time.split(':').map((x) => Number(x) || 0);
  let total = hh * 60 + mm + b.offset;
  const shift = Math.floor(total / 1440);
  total -= shift * 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  const shiftDays = (ds: number[]) => [...new Set(ds.map((d) => (((d + shift) % 7) + 7) % 7))].sort((a, b) => a - b);
  const list = (ds: number[]) => compact(ds);
  let shiftNote: string | undefined;
  const dayWord = shift > 0 ? 'the next day' : 'the day before';

  switch (b.freq) {
    case 'minutes':
      return { expr: b.everyMin === 1 ? '* * * * *' : `*/${b.everyMin} * * * *` };
    case 'hours': {
      const am = ((((b.atMinute + b.offset) % 60) + 60) % 60);
      return { expr: `${am} ${b.everyHour === 1 ? '*' : `*/${b.everyHour}`} * * *` };
    }
    case 'daily': {
      const base = b.days === 'weekdays' ? [1, 2, 3, 4, 5] : b.days === 'weekends' ? [0, 6] : null;
      if (base && shift) shiftNote = `In UTC that is ${dayWord}, so the days are shifted to match.`;
      return { expr: `${m} ${h} * * ${base ? list(shift ? shiftDays(base) : base) : '*'}`, shiftNote };
    }
    case 'weekly': {
      const ds = b.weekdays.length ? b.weekdays : [1];
      if (shift) shiftNote = `In UTC that is ${dayWord}, so the days are shifted to match.`;
      return { expr: `${m} ${h} * * ${list(shift ? shiftDays(ds) : ds)}`, shiftNote };
    }
    case 'monthly':
    case 'yearly': {
      let d = b.dom + shift;
      if (d < 1 || d > 28) {
        d = b.dom;
        if (shift) shiftNote = `In UTC that time is ${dayWord}. Cron can't move across a month edge, so it runs on the ${ordinal(b.dom)} in UTC.`;
      } else if (shift) shiftNote = `In UTC that is ${dayWord}, so it runs on the ${ordinal(d)} in UTC.`;
      return { expr: `${m} ${h} ${d} ${b.freq === 'yearly' ? b.month : '*'} *`, shiftNote };
    }
  }
}

// [1,2,3,4,5] -> "1-5", [1,3,5] -> "1,3,5"
export function compact(ns: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < ns.length; ) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    out.push(j - i >= 2 ? `${ns[i]}-${ns[j]}` : ns.slice(i, j + 1).join(','));
    i = j + 1;
  }
  return out.join(',');
}

// The same schedule in another time zone, when it can be said simply (one time a day).
// `offset` is minutes to add to UTC to get the local time (IST is +330). Returns null when it can't.
export function shiftTo(c: Cron, offset: number): Cron | null {
  if (c.minute.values.length !== 1 || c.hour.values.length !== 1) return null;
  let total = c.hour.values[0] * 60 + c.minute.values[0] + offset;
  const shift = Math.floor(total / 1440);
  total -= shift * 1440;
  if (shift && !c.dom.any) return null;
  const f = (n: number): Field => ({ values: [n], any: false, text: String(n) });
  const dowVals = shift ? [...new Set(c.dow.values.map((d) => (((d + shift) % 7) + 7) % 7))].sort((a, b) => a - b) : c.dow.values;
  const dow: Field = { values: dowVals, any: c.dow.any, text: c.dow.any ? c.dow.text : compact(dowVals) };
  return { ...c, minute: f(total % 60), hour: f(Math.floor(total / 60)), dow };
}
